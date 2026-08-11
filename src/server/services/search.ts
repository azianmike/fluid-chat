import { and, desc, eq, exists, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  channels,
  conversationMembers,
  conversations,
  files,
  messagePins,
  messages,
  users,
  workspaceMembers
} from "@/db/schema";
import { hydrateMessages } from "./messages";

export type ParsedSearch = {
  text: string;
  from: string[];
  in: string[];
  has: string[];
  before?: string;
  after?: string;
  during?: string;
  isPinned: boolean;
};

const OPERATOR = /(\w+):("[^"]+"|\S+)/g;

/** Slack-style operators: `in:#design from:@ada has:file before:2024-01-01`. */
export function parseSearchQuery(raw: string): ParsedSearch {
  const parsed: ParsedSearch = { text: "", from: [], in: [], has: [], isPinned: false };
  const remainder = raw
    .replace(OPERATOR, (match, key: string, rawValue: string) => {
      const value = rawValue.replace(/^"|"$/g, "");
      switch (key.toLowerCase()) {
        case "from":
          parsed.from.push(value.replace(/^@/, "").toLowerCase());
          return "";
        case "in":
          parsed.in.push(value.replace(/^#/, "").toLowerCase());
          return "";
        case "has":
          parsed.has.push(value.toLowerCase());
          if (value.toLowerCase() === "pin") parsed.isPinned = true;
          return "";
        case "before":
          parsed.before = value;
          return "";
        case "after":
          parsed.after = value;
          return "";
        case "during":
          parsed.during = value;
          return "";
        case "is":
          if (value.toLowerCase() === "pinned") parsed.isPinned = true;
          return "";
        default:
          return match;
      }
    })
    .trim();
  parsed.text = remainder.replace(/\s+/g, " ").trim();
  return parsed;
}

export type SearchResult = {
  message: Awaited<ReturnType<typeof hydrateMessages>>[number];
  conversationId: string;
  channelName: string | null;
  conversationType: "channel" | "dm" | "group_dm";
};

export async function searchMessages(options: {
  workspaceId: string;
  viewerId: string;
  query: string;
  limit?: number;
  sort?: "recent" | "relevant";
}): Promise<{ results: SearchResult[]; parsed: ParsedSearch }> {
  const parsed = parseSearchQuery(options.query);
  const limit = Math.min(options.limit ?? 40, 100);

  const senderIds = parsed.from.length > 0 ? await resolveUserIds(options.workspaceId, parsed.from) : null;
  const conversationIds = parsed.in.length > 0 ? await resolveConversationIds(options.workspaceId, parsed.in) : null;

  if ((senderIds && senderIds.length === 0) || (conversationIds && conversationIds.length === 0)) {
    return { results: [], parsed };
  }

  const dateRange = resolveDateRange(parsed);

  const rows = await db
    .select({ message: messages, channelName: channels.name, conversationType: conversations.type })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(channels, eq(channels.id, conversations.channelId))
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, messages.conversationId),
        eq(conversationMembers.userId, options.viewerId),
        isNull(conversationMembers.leftAt)
      )
    )
    .where(
      and(
        eq(messages.workspaceId, options.workspaceId),
        isNull(messages.deletedAt),
        eq(messages.type, "user"),
        parsed.text
          ? sql`${messages.searchVector} @@ websearch_to_tsquery('simple', ${parsed.text})`
          : undefined,
        senderIds ? inArray(messages.senderId, senderIds) : undefined,
        conversationIds ? inArray(messages.conversationId, conversationIds) : undefined,
        dateRange.after ? gt(messages.createdAt, dateRange.after) : undefined,
        dateRange.before ? lt(messages.createdAt, dateRange.before) : undefined,
        parsed.has.includes("link") ? sql`${messages.bodyText} ~* 'https?://'` : undefined,
        parsed.has.includes("file")
          ? exists(
              db
                .select({ one: sql`1` })
                .from(files)
                .where(
                  and(
                    eq(files.messageId, messages.id),
                    isNull(files.deletedAt),
                    gt(files.expiresAt, new Date())
                  )
                )
            )
          : undefined,
        parsed.isPinned
          ? exists(db.select({ one: sql`1` }).from(messagePins).where(eq(messagePins.messageId, messages.id)))
          : undefined
      )
    )
    .orderBy(
      options.sort === "relevant" && parsed.text
        ? sql`ts_rank(${messages.searchVector}, websearch_to_tsquery('simple', ${parsed.text})) desc, ${messages.createdAt} desc`
        : desc(messages.createdAt)
    )
    .limit(limit);

  const hydrated = await hydrateMessages(
    rows.map((row) => row.message),
    options.viewerId
  );

  return {
    parsed,
    results: hydrated.map((message, index) => ({
      message,
      conversationId: rows[index].message.conversationId,
      channelName: rows[index].channelName,
      conversationType: rows[index].conversationType
    }))
  };
}

async function resolveUserIds(workspaceId: string, terms: string[]) {
  const rows = await db
    .select({ id: users.id, handle: users.handle, email: users.email, displayName: users.displayName })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")));

  const wanted = new Set(terms.map((term) => term.toLowerCase()));
  return rows
    .filter((row) => {
      const candidates = [
        row.id.toLowerCase(),
        row.handle?.toLowerCase(),
        row.email.toLowerCase(),
        row.email.split("@")[0].toLowerCase(),
        row.displayName.toLowerCase(),
        row.displayName.toLowerCase().replace(/\s+/g, ".")
      ].filter(Boolean) as string[];
      return candidates.some((candidate) => wanted.has(candidate));
    })
    .map((row) => row.id);
}

async function resolveConversationIds(workspaceId: string, terms: string[]) {
  const rows = await db
    .select({ conversationId: conversations.id, name: channels.name })
    .from(conversations)
    .leftJoin(channels, eq(channels.id, conversations.channelId))
    .where(eq(conversations.workspaceId, workspaceId));

  const wanted = new Set(terms.map((term) => term.toLowerCase()));
  return rows
    .filter((row) => wanted.has(row.conversationId.toLowerCase()) || (row.name && wanted.has(row.name.toLowerCase())))
    .map((row) => row.conversationId);
}

function resolveDateRange(parsed: ParsedSearch) {
  const range: { before?: Date; after?: Date } = {};
  if (parsed.before) {
    const date = new Date(parsed.before);
    if (!Number.isNaN(date.getTime())) range.before = date;
  }
  if (parsed.after) {
    const date = new Date(parsed.after);
    if (!Number.isNaN(date.getTime())) range.after = date;
  }
  if (parsed.during) {
    const date = new Date(parsed.during);
    if (!Number.isNaN(date.getTime())) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      range.after = start;
      range.before = end;
    }
  }
  return range;
}
