import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  channels,
  conversationMembers,
  conversations,
  reminders,
  users,
  workspaceMembers
} from "@/db/schema";
import type { Channel, Conversation, User, WorkspaceMember } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { toWorkspace } from "@/lib/realtime";
import { normalizeChannelName } from "@/lib/security";
import type { MessageDto } from "@/shared/types";
import { addChannelMembers, joinChannel, leaveChannel, openDirectConversation } from "./conversations";
import { createMessage, postSystemMessage } from "./messages";
import { setPresence, setStatus } from "./presence";
import { formatInZone, parseWhen } from "./time";

export type SlashOutcome =
  | { kind: "message"; message: MessageDto }
  | { kind: "ephemeral"; text: string }
  | { kind: "navigate"; conversationId: string; text?: string };

export type SlashCommandSpec = { name: string; usage: string; description: string };

export const SLASH_COMMANDS: SlashCommandSpec[] = [
  { name: "me", usage: "/me <action>", description: "Post an action in the third person" },
  { name: "shrug", usage: "/shrug <message>", description: "Append ¯\\_(ツ)_/¯ to your message" },
  { name: "topic", usage: "/topic <text>", description: "Set the channel topic" },
  { name: "purpose", usage: "/purpose <text>", description: "Set the channel description" },
  { name: "rename", usage: "/rename <name>", description: "Rename this channel" },
  { name: "invite", usage: "/invite @person", description: "Add people to this channel" },
  { name: "join", usage: "/join #channel", description: "Join a channel" },
  { name: "leave", usage: "/leave", description: "Leave this channel" },
  { name: "archive", usage: "/archive", description: "Archive this channel" },
  { name: "msg", usage: "/msg @person <message>", description: "Send a direct message" },
  { name: "remind", usage: "/remind me <text> in 20 minutes", description: "Set a reminder" },
  { name: "dnd", usage: "/dnd <duration>", description: "Pause notifications" },
  { name: "away", usage: "/away", description: "Set yourself away" },
  { name: "active", usage: "/active", description: "Set yourself active" },
  { name: "status", usage: "/status :emoji: <text>", description: "Set your status" },
  { name: "mute", usage: "/mute", description: "Mute this conversation" },
  { name: "unmute", usage: "/unmute", description: "Unmute this conversation" },
  { name: "who", usage: "/who", description: "List members of this conversation" },
  { name: "shortcuts", usage: "/shortcuts", description: "Show keyboard shortcuts" },
  { name: "help", usage: "/help", description: "List available commands" }
];

export function isSlashCommand(bodyText: string) {
  return /^\/[a-z]+/i.test(bodyText.trim());
}

type CommandContext = {
  conversation: Conversation;
  channel: Channel | null;
  actor: User;
  member: WorkspaceMember;
  clientMessageId?: string | null;
};

export async function runSlashCommand(raw: string, context: CommandContext): Promise<SlashOutcome> {
  const trimmed = raw.trim();
  const [commandToken, ...rest] = trimmed.split(/\s+/);
  const command = commandToken.slice(1).toLowerCase();
  const args = rest.join(" ").trim();

  switch (command) {
    case "me":
      if (!args) return ephemeral("Usage: /me <action>");
      return {
        kind: "message",
        message: await createMessage({
          conversation: context.conversation,
          sender: context.actor,
          bodyText: args,
          clientMessageId: context.clientMessageId,
          metadata: { subtype: "me_message" }
        })
      };

    case "shrug":
      return {
        kind: "message",
        message: await createMessage({
          conversation: context.conversation,
          sender: context.actor,
          bodyText: `${args} ¯\\_(ツ)_/¯`.trim(),
          clientMessageId: context.clientMessageId
        })
      };

    case "topic":
    case "purpose": {
      const channel = requireChannel(context);
      const field = command === "topic" ? "topic" : "description";
      await db
        .update(channels)
        .set({ [field]: args || null, updatedAt: new Date() })
        .where(eq(channels.id, channel.id));
      await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
      return {
        kind: "message",
        message: await postSystemMessage({
          conversation: context.conversation,
          actor: context.actor,
          type: command === "topic" ? "topic" : "purpose",
          bodyText: args
            ? `<@${context.actor.id}> set the ${field} to: ${args}`
            : `<@${context.actor.id}> cleared the ${field}.`
        })
      };
    }

    case "rename": {
      const channel = requireChannel(context);
      requireChannelManager(context);
      const name = normalizeChannelName(args.replace(/^#/, ""));
      if (!name) return ephemeral("Usage: /rename <name>");
      const [existing] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.workspaceId, channel.workspaceId), eq(channels.name, name)))
        .limit(1);
      if (existing && existing.id !== channel.id) return ephemeral(`#${name} already exists.`);
      await db.update(channels).set({ name, updatedAt: new Date() }).where(eq(channels.id, channel.id));
      await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
      return {
        kind: "message",
        message: await postSystemMessage({
          conversation: context.conversation,
          actor: context.actor,
          type: "rename",
          bodyText: `<@${context.actor.id}> renamed the channel to #${name}`
        })
      };
    }

    case "invite": {
      const channel = requireChannel(context);
      const userIds = await resolveUserTokens(channel.workspaceId, args);
      if (userIds.length === 0) return ephemeral("Mention the people to add, e.g. /invite @ada");
      const added = await addChannelMembers({
        channel,
        conversation: context.conversation,
        actor: context.actor,
        userIds
      });
      return ephemeral(`Added ${added.length} ${added.length === 1 ? "person" : "people"} to #${channel.name}.`);
    }

    case "join": {
      const name = args.replace(/^#/, "").trim();
      if (!name) return ephemeral("Usage: /join #channel");
      const [row] = await db
        .select({ channel: channels, conversation: conversations })
        .from(channels)
        .innerJoin(conversations, eq(conversations.channelId, channels.id))
        .where(and(eq(channels.workspaceId, context.conversation.workspaceId), eq(channels.name, name)))
        .limit(1);
      if (!row) return ephemeral(`#${name} does not exist.`);
      await joinChannel(row.channel, row.conversation, context.actor);
      return { kind: "navigate", conversationId: row.conversation.id, text: `Joined #${name}.` };
    }

    case "leave": {
      const channel = requireChannel(context);
      await leaveChannel(channel, context.conversation, context.actor);
      return ephemeral(`You left #${channel.name}.`);
    }

    case "archive": {
      const channel = requireChannel(context);
      requireChannelManager(context);
      if (channel.name === "general") return ephemeral("#general cannot be archived.");
      await db.update(channels).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(channels.id, channel.id));
      await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
      return ephemeral(`#${channel.name} is archived.`);
    }

    case "msg":
    case "dm": {
      const userIds = await resolveUserTokens(context.conversation.workspaceId, args);
      if (userIds.length === 0) return ephemeral("Usage: /msg @person your message");
      const conversation = await openDirectConversation({
        workspaceId: context.conversation.workspaceId,
        actor: context.actor,
        userIds
      });
      const text = stripUserTokens(args).trim();
      if (text) {
        await createMessage({ conversation, sender: context.actor, bodyText: text });
      }
      return { kind: "navigate", conversationId: conversation.id };
    }

    case "remind": {
      const body = args.replace(/^me\s+/i, "");
      const when = parseWhen(body, { timeZone: context.actor.timezone });
      if (!when) return ephemeral("Try: /remind me to ship the release in 30 minutes");
      const text = body
        .replace(/\bin\s+\d+\s*\w+\b/i, "")
        .replace(/\b(tomorrow|today|next week)\b/i, "")
        .replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?\b/i, "")
        .replace(/^to\s+/i, "")
        .trim();
      await db.insert(reminders).values({
        workspaceId: context.conversation.workspaceId,
        userId: context.actor.id,
        conversationId: context.conversation.id,
        text: text || "Reminder",
        remindAt: when.at
      });
      return ephemeral(`Reminder set for ${formatInZone(when.at, context.actor.timezone)}.`);
    }

    case "dnd": {
      const when = parseWhen(args.startsWith("in ") ? args : `in ${args || "30 minutes"}`, {
        timeZone: context.actor.timezone
      });
      const until = when?.at ?? new Date(Date.now() + 30 * 60_000);
      await setPresence(context.actor.id, "dnd", until);
      return ephemeral(`Do Not Disturb until ${formatInZone(until, context.actor.timezone, { dateStyle: undefined })}.`);
    }

    case "away":
      await setPresence(context.actor.id, "away");
      return ephemeral("You are now away.");

    case "active":
      await setPresence(context.actor.id, "active", null);
      return ephemeral("You are now active.");

    case "status": {
      if (!args || args === "clear") {
        await setStatus(context.actor.id, { emoji: null, text: null, expiresAt: null });
        return ephemeral("Status cleared.");
      }
      const emojiMatch = /^:([a-z0-9_+-]+):\s*/i.exec(args);
      await setStatus(context.actor.id, {
        emoji: emojiMatch ? emojiMatch[1] : "speech_balloon",
        text: args.replace(/^:([a-z0-9_+-]+):\s*/i, "").trim() || null
      });
      return ephemeral("Status updated.");
    }

    case "mute":
    case "unmute": {
      await db
        .update(conversationMembers)
        .set({ mutedAt: command === "mute" ? new Date() : null })
        .where(
          and(
            eq(conversationMembers.conversationId, context.conversation.id),
            eq(conversationMembers.userId, context.actor.id)
          )
        );
      return ephemeral(command === "mute" ? "Conversation muted." : "Conversation unmuted.");
    }

    case "who": {
      const rows = await db
        .select({ displayName: users.displayName })
        .from(conversationMembers)
        .innerJoin(users, eq(users.id, conversationMembers.userId))
        .where(
          and(eq(conversationMembers.conversationId, context.conversation.id), isNull(conversationMembers.leftAt))
        );
      return ephemeral(`${rows.length} here: ${rows.map((row) => row.displayName).join(", ")}`);
    }

    case "shortcuts":
      return ephemeral("Press ⌘/ (Ctrl+/) to see every keyboard shortcut.");

    case "help":
      return ephemeral(SLASH_COMMANDS.map((entry) => `${entry.usage} — ${entry.description}`).join("\n"));

    default:
      return ephemeral(`/${command} is not a command. Type /help to see what is available.`);
  }
}

function ephemeral(text: string): SlashOutcome {
  return { kind: "ephemeral", text };
}

function requireChannel(context: CommandContext) {
  if (!context.channel) throw new HttpError(400, "That command only works in a channel", "channel_required");
  return context.channel;
}

function requireChannelManager(context: CommandContext) {
  if (context.member.role === "owner" || context.member.role === "admin") return;
  throw new HttpError(403, "Only admins can do that", "admin_required");
}

function stripUserTokens(text: string) {
  return text.replace(/<@[0-9a-f-]{36}>/gi, "").replace(/(^|\s)@[a-z0-9._-]+/gi, "$1");
}

async function resolveUserTokens(workspaceId: string, text: string) {
  const ids = new Set<string>();
  for (const match of text.matchAll(/<@([0-9a-f-]{36})>/gi)) ids.add(match[1]);
  const handles = Array.from(text.matchAll(/(^|\s)@([a-z0-9._-]+)/gi)).map((match) => match[2].toLowerCase());

  if (handles.length > 0) {
    const rows = await db
      .select({ id: users.id, handle: users.handle, email: users.email, displayName: users.displayName })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")));
    for (const row of rows) {
      const candidates = [
        row.handle?.toLowerCase(),
        row.email.split("@")[0].toLowerCase(),
        row.displayName.toLowerCase().replace(/\s+/g, ".")
      ].filter(Boolean) as string[];
      if (candidates.some((candidate) => handles.includes(candidate))) ids.add(row.id);
    }
  }

  return Array.from(ids);
}
