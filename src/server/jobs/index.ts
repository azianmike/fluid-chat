import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  channels,
  conversations,
  customEmoji,
  exportJobs,
  files,
  linkPreviews,
  messageReactions,
  messages,
  notifications,
  reminders,
  scheduledMessages,
  users,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { toUser } from "@/lib/realtime";
import { extractUrls, toPlainText } from "@/shared/markdown";
import { notificationsPaused } from "@/shared/quiet-hours";
import { createMessage } from "../services/messages";
import { notify } from "../services/notifications";
import { broadcastPresence, broadcastUserUpdate } from "../services/presence";
import {
  buildExportPrefix,
  deleteObject,
  deleteObjectsWithPrefix,
  purgeExpiredStorageObjects,
  putObject,
  storageKeyFromUri,
  storageUri
} from "../services/storage";

export type Job = {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
};

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

/* -------------------------------------------------------------------------- */
/* Billing                                                                     */
/* -------------------------------------------------------------------------- */

export async function enforceBillingGracePeriods() {
  await db
    .update(workspaces)
    .set({ subscriptionStatus: "read_only", readOnlyAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workspaces.subscriptionStatus, "grace_period"), lte(workspaces.gracePeriodEndsAt, new Date())));
}

/* -------------------------------------------------------------------------- */
/* Scheduled messages                                                          */
/* -------------------------------------------------------------------------- */

export async function deliverScheduledMessages() {
  const due = await db
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.status, "pending"), lte(scheduledMessages.sendAt, new Date())))
    .limit(25);

  for (const job of due) {
    try {
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, job.conversationId))
        .limit(1);
      const [sender] = await db.select().from(users).where(eq(users.id, job.senderId)).limit(1);
      if (!conversation || !sender) throw new Error("Conversation or sender is gone");

      const message = await createMessage({
        conversation,
        sender,
        bodyText: job.bodyText,
        parentMessageId: job.parentMessageId,
        fileIds: job.fileIds ?? []
      });
      await db
        .update(scheduledMessages)
        .set({ status: "sent", sentMessageId: message.id, updatedAt: new Date() })
        .where(eq(scheduledMessages.id, job.id));
      await toUser(sender.id, { type: "conversation.updated", conversationId: conversation.id });
    } catch (error) {
      await db
        .update(scheduledMessages)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          updatedAt: new Date()
        })
        .where(eq(scheduledMessages.id, job.id));
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reminders                                                                   */
/* -------------------------------------------------------------------------- */

export async function fireReminders() {
  const due = await db
    .select()
    .from(reminders)
    .where(and(isNull(reminders.firedAt), isNull(reminders.completedAt), lte(reminders.remindAt, new Date())))
    .limit(50);

  for (const reminder of due) {
    await notify({
      workspaceId: reminder.workspaceId,
      conversationId: reminder.conversationId,
      messageId: reminder.messageId,
      type: "reminder",
      body: reminder.text,
      userIds: [reminder.userId]
    });
    await db.update(reminders).set({ firedAt: new Date() }).where(eq(reminders.id, reminder.id));
  }
}

/* -------------------------------------------------------------------------- */
/* Presence and status upkeep                                                  */
/* -------------------------------------------------------------------------- */

export async function decayPresence() {
  const cutoff = new Date(Date.now() - 5 * 60_000);
  const stale = await db
    .update(users)
    .set({ presence: "offline" })
    .where(
      and(
        inArray(users.presence, ["active", "away"]),
        or(isNull(users.lastActiveAt), lt(users.lastActiveAt, cutoff))
      )
    )
    .returning();
  await Promise.all(stale.map((user) => broadcastPresence(user)));
}

export async function expireStatuses() {
  const expired = await db
    .update(users)
    .set({ statusEmoji: null, statusText: null, statusExpiresAt: null })
    .where(and(isNotNull(users.statusExpiresAt), lte(users.statusExpiresAt, new Date())))
    .returning();
  await Promise.all(expired.map((user) => broadcastUserUpdate(user)));

  await db
    .update(users)
    .set({ dndUntil: null, presence: "active" })
    .where(and(isNotNull(users.dndUntil), lte(users.dndUntil, new Date())));
}

/* -------------------------------------------------------------------------- */
/* Notification email digests                                                  */
/* -------------------------------------------------------------------------- */

/** At most this many emails leave per run, however large the candidate pool is. */
const EMAIL_BATCH = 25;

export async function sendNotificationEmails() {
  const pending = await db
    .select({ notification: notifications, user: users })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(
      and(
        isNull(notifications.readAt),
        isNull(notifications.emailSentAt),
        lte(notifications.createdAt, new Date(Date.now() - 15 * 60_000))
      )
    )
    .orderBy(notifications.createdAt)
    // Deferred rows stay in the pool until their quiet hours end, so scan wider
    // than we send: otherwise one person's overnight backlog fills every batch
    // and nobody else's mail goes out.
    .limit(EMAIL_BATCH * 8);

  let sent = 0;
  for (const row of pending) {
    if (sent >= EMAIL_BATCH) break;

    const preference = row.user.preferences?.emailNotifications ?? "mentions";
    const isDirect = ["mention", "dm", "thread_reply", "reminder"].includes(row.notification.type);
    if (preference === "none" || (preference === "mentions" && !isDirect)) {
      // A preference-based skip is permanent, so stamp it and stop rescanning.
      await db.update(notifications).set({ emailSentAt: new Date() }).where(eq(notifications.id, row.notification.id));
      continue;
    }

    // Quiet hours and DND defer; they must not silently drop the email. Leaving
    // `emailSentAt` null means the next run picks the row up again once the
    // window closes.
    if (
      notificationsPaused({
        quietHours: { start: row.user.preferences?.quietHoursStart, end: row.user.preferences?.quietHoursEnd },
        timeZone: row.user.timezone,
        dndUntil: row.user.dndUntil
      })
    ) {
      continue;
    }

    await sendEmail({
      to: row.user.email,
      subject: subjectFor(row.notification.type),
      text: `${row.notification.body ?? "You have a new notification."}\n\nOpen Fluid Chat: ${appUrl()}`
    });
    sent += 1;
    await db.update(notifications).set({ emailSentAt: new Date() }).where(eq(notifications.id, row.notification.id));
  }
}

function subjectFor(type: string) {
  switch (type) {
    case "mention":
      return "You were mentioned on Fluid Chat";
    case "dm":
      return "New direct message on Fluid Chat";
    case "thread_reply":
      return "New reply in a thread you follow";
    case "reminder":
      return "Your Fluid Chat reminder";
    default:
      return "New Fluid Chat notification";
  }
}

/* -------------------------------------------------------------------------- */
/* Retention                                                                   */
/* -------------------------------------------------------------------------- */

export async function applyRetentionPolicies() {
  const workspaceRows = await db
    .select({ id: workspaces.id, retentionDays: workspaces.retentionDays })
    .from(workspaces)
    .where(and(isNotNull(workspaces.retentionDays), isNull(workspaces.deletedAt)));

  for (const workspace of workspaceRows) {
    const cutoff = new Date(Date.now() - (workspace.retentionDays ?? 0) * 86_400_000);
    await db.delete(messages).where(and(eq(messages.workspaceId, workspace.id), lt(messages.createdAt, cutoff)));
  }

  const channelRows = await db
    .select({ id: channels.id, retentionDays: channels.retentionDays })
    .from(channels)
    .where(isNotNull(channels.retentionDays));

  for (const channel of channelRows) {
    const cutoff = new Date(Date.now() - (channel.retentionDays ?? 0) * 86_400_000);
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.channelId, channel.id))
      .limit(1);
    if (!conversation) continue;
    await db
      .delete(messages)
      .where(and(eq(messages.conversationId, conversation.id), lt(messages.createdAt, cutoff)));
  }
}

/** Remove hidden/deleted files and enforce the 15-day object retention window. */
export async function purgeExpiredFiles() {
  const due = await db
    .select()
    .from(files)
    .where(or(isNotNull(files.deletedAt), lte(files.expiresAt, new Date())))
    .limit(100);

  for (const file of due) {
    try {
      await deleteObject(file.storageKey);
      await db.delete(files).where(eq(files.id, file.id));
    } catch (error) {
      console.error(`[storage] failed to purge object ${file.storageKey}`, error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Link previews                                                               */
/* -------------------------------------------------------------------------- */

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|\[?::1\]?$)/i;

export async function unfurlLinks() {
  if (process.env.ENABLE_LINK_UNFURL !== "true") return;

  const recent = await db
    .select({ id: messages.id, workspaceId: messages.workspaceId, bodyText: messages.bodyText })
    .from(messages)
    .where(
      and(
        isNull(messages.deletedAt),
        sql`${messages.createdAt} > now() - interval '10 minutes'`,
        sql`${messages.bodyText} ~* 'https?://'`,
        sql`not exists (select 1 from link_previews lp where lp.message_id = ${messages.id})`
      )
    )
    .limit(10);

  for (const message of recent) {
    const [url] = extractUrls(message.bodyText);
    if (!url) continue;
    const preview = await fetchPreview(url);
    if (!preview) continue;
    await db
      .insert(linkPreviews)
      .values({ workspaceId: message.workspaceId, messageId: message.id, url, ...preview })
      .onConflictDoNothing();
  }
}

async function fetchPreview(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (PRIVATE_HOST.test(url.hostname)) return null;

    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "user-agent": "Fluid Chat-LinkPreview/1.0" }
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;

    const html = (await response.text()).slice(0, 512_000);
    const meta = (property: string) =>
      new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i").exec(html)?.[1] ??
      null;
    const title = meta("og:title") ?? /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? null;

    return {
      title: title?.slice(0, 300) ?? null,
      description: meta("og:description")?.slice(0, 500) ?? null,
      imageUrl: meta("og:image"),
      siteName: meta("og:site_name")
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                     */
/* -------------------------------------------------------------------------- */

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function runExports() {
  const jobs = await db.select().from(exportJobs).where(eq(exportJobs.status, "queued")).limit(3);

  for (const job of jobs) {
    await db.update(exportJobs).set({ status: "processing", updatedAt: new Date() }).where(eq(exportJobs.id, job.id));
    const prefix = buildExportPrefix(job.workspaceId, job.id);
    try {
      const [memberRows, channelRows, conversationRows, messageRows, reactionRows, fileRows, emojiRows] =
        await Promise.all([
          db
            .select({ user: users, member: workspaceMembers })
            .from(workspaceMembers)
            .innerJoin(users, eq(users.id, workspaceMembers.userId))
            .where(eq(workspaceMembers.workspaceId, job.workspaceId)),
          db.select().from(channels).where(eq(channels.workspaceId, job.workspaceId)),
          db.select().from(conversations).where(eq(conversations.workspaceId, job.workspaceId)),
          db.select().from(messages).where(eq(messages.workspaceId, job.workspaceId)),
          db.select().from(messageReactions).where(eq(messageReactions.workspaceId, job.workspaceId)),
          db
            .select()
            .from(files)
            .where(
              and(
                eq(files.workspaceId, job.workspaceId),
                isNull(files.deletedAt),
                sql`${files.expiresAt} > now()`
              )
            ),
          db.select().from(customEmoji).where(eq(customEmoji.workspaceId, job.workspaceId))
        ]);

      const artifacts: Array<{ name: string; contentType: string; body: string }> = [
        {
          name: "users.csv",
          contentType: "text/csv; charset=utf-8",
          body: [
            "id,email,display_name,handle,role,status,joined_at",
            ...memberRows.map(({ user, member }) =>
              [user.id, user.email, user.displayName, user.handle, member.role, member.status, member.joinedAt]
                .map(csvCell)
                .join(",")
            )
          ].join("\n")
        },
        {
          name: "channels.csv",
          contentType: "text/csv; charset=utf-8",
          body: [
            "id,name,visibility,topic,description,archived_at,created_at",
            ...channelRows.map((channel) =>
              [
                channel.id,
                channel.name,
                channel.visibility,
                channel.topic,
                channel.description,
                channel.archivedAt,
                channel.createdAt
              ]
                .map(csvCell)
                .join(",")
            )
          ].join("\n")
        },
        {
          name: "conversations.jsonl",
          contentType: "application/x-ndjson",
          body: conversationRows.map((row) => JSON.stringify(row)).join("\n")
        },
        {
          name: "messages.jsonl",
          contentType: "application/x-ndjson",
          body: messageRows
            .map((message) => JSON.stringify({ ...message, plainText: toPlainText(message.bodyText) }))
            .join("\n")
        },
        {
          name: "reactions.jsonl",
          contentType: "application/x-ndjson",
          body: reactionRows.map((row) => JSON.stringify(row)).join("\n")
        },
        {
          name: "emoji.json",
          contentType: "application/json",
          body: JSON.stringify(emojiRows, null, 2)
        },
        {
          name: "files_manifest.json",
          contentType: "application/json",
          body: JSON.stringify(
            {
              count: fileRows.length,
              files: fileRows.map((file) => ({
                id: file.id,
                name: file.name,
                size: file.size,
                mimeType: file.mimeType,
                storageKey: file.storageKey,
                messageId: file.messageId
              }))
            },
            null,
            2
          )
        },
        {
          name: "README.txt",
          contentType: "text/plain; charset=utf-8",
          body: [
            "Fluid Chat workspace export",
            `Generated: ${new Date().toISOString()}`,
            "",
            "users.csv           workspace members",
            "channels.csv        channels and their settings",
            "conversations.jsonl channels, DMs and group DMs",
            "messages.jsonl      every message, one JSON object per line",
            "reactions.jsonl     emoji reactions",
            "emoji.json          custom emoji",
            "files_manifest.json uploaded file metadata and storage keys"
          ].join("\n")
        }
      ];

      await Promise.all(
        artifacts.map((artifact) =>
          putObject(`${prefix}/${artifact.name}`, Buffer.from(artifact.body), {
            contentType: artifact.contentType,
            expiresAt: job.expiresAt ?? undefined
          })
        )
      );

      await db
        .update(exportJobs)
        .set({ status: "ready", fileUrl: storageUri(`${prefix}/`), updatedAt: new Date() })
        .where(eq(exportJobs.id, job.id));
    } catch (error) {
      await deleteObjectsWithPrefix(`${prefix}/`).catch(() => undefined);
      await db
        .update(exportJobs)
        .set({
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
          updatedAt: new Date()
        })
        .where(eq(exportJobs.id, job.id));
    }
  }
}

export async function expireExports() {
  const expired = await db
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.status, "ready"), lte(exportJobs.expiresAt, new Date())));

  for (const job of expired) {
    const key = storageKeyFromUri(job.fileUrl);
    try {
      if (key) await deleteObjectsWithPrefix(key);
      await db
        .update(exportJobs)
        .set({ status: "expired", fileUrl: null, updatedAt: new Date() })
        .where(eq(exportJobs.id, job.id));
    } catch (error) {
      console.error(`[storage] failed to expire export ${job.id}`, error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Schedule                                                                    */
/* -------------------------------------------------------------------------- */

export const jobs: Job[] = [
  { name: "scheduled-messages", intervalMs: 15_000, run: deliverScheduledMessages },
  { name: "reminders", intervalMs: 20_000, run: fireReminders },
  { name: "presence-decay", intervalMs: 60_000, run: decayPresence },
  { name: "status-expiry", intervalMs: 60_000, run: expireStatuses },
  { name: "link-previews", intervalMs: 30_000, run: unfurlLinks },
  { name: "exports", intervalMs: 30_000, run: runExports },
  { name: "export-expiry", intervalMs: 300_000, run: expireExports },
  { name: "file-expiry", intervalMs: 300_000, run: purgeExpiredFiles },
  { name: "storage-expiry", intervalMs: 3_600_000, run: purgeExpiredStorageObjects },
  { name: "notification-emails", intervalMs: 60_000, run: sendNotificationEmails },
  { name: "billing-grace", intervalMs: 300_000, run: enforceBillingGracePeriods },
  { name: "retention", intervalMs: 3_600_000, run: applyRetentionPolicies }
];
