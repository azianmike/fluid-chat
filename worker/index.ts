import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { channels, exportJobs, messageReactions, messages, notifications, users, workspaceMembers, workspaces } from "@/db/schema";
import { sendEmail } from "@/lib/email";

async function enforceBillingGracePeriods() {
  await db
    .update(workspaces)
    .set({ subscriptionStatus: "read_only", readOnlyAt: new Date(), updatedAt: new Date() })
    .where(and(eq(workspaces.subscriptionStatus, "grace_period"), lte(workspaces.gracePeriodEndsAt, new Date())));
}

async function runExports() {
  const jobs = await db.select().from(exportJobs).where(eq(exportJobs.status, "queued")).limit(5);
  for (const job of jobs) {
    await db.update(exportJobs).set({ status: "processing", updatedAt: new Date() }).where(eq(exportJobs.id, job.id));
    try {
      const dir = path.join(process.cwd(), "exports", job.workspaceId, job.id);
      await mkdir(dir, { recursive: true });

      const memberRows = await db
        .select({ user: users, member: workspaceMembers })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, job.workspaceId));
      const channelRows = await db.select().from(channels).where(eq(channels.workspaceId, job.workspaceId));
      const messageRows = await db.select().from(messages).where(and(eq(messages.workspaceId, job.workspaceId)));
      const reactionRows = await db.select().from(messageReactions).where(eq(messageReactions.workspaceId, job.workspaceId));

      await writeFile(path.join(dir, "users.csv"), ["id,email,display_name,role,status", ...memberRows.map(({ user, member }) => `${user.id},${user.email},${JSON.stringify(user.displayName)},${member.role},${member.status}`)].join("\n"));
      await writeFile(path.join(dir, "channels.csv"), ["id,name,visibility,archived_at", ...channelRows.map((channel) => `${channel.id},${channel.name},${channel.visibility},${channel.archivedAt ?? ""}`)].join("\n"));
      await writeFile(path.join(dir, "messages.jsonl"), messageRows.map((message) => JSON.stringify(message)).join("\n"));
      await writeFile(path.join(dir, "reactions.jsonl"), reactionRows.map((reaction) => JSON.stringify(reaction)).join("\n"));
      await writeFile(path.join(dir, "files_manifest.json"), JSON.stringify({ files: [] }, null, 2));

      await db.update(exportJobs).set({ status: "ready", fileUrl: dir, updatedAt: new Date() }).where(eq(exportJobs.id, job.id));
    } catch (error) {
      await db.update(exportJobs).set({ status: "failed", error: error instanceof Error ? error.message : "Unknown error", updatedAt: new Date() }).where(eq(exportJobs.id, job.id));
    }
  }
}

async function expireExports() {
  await db
    .update(exportJobs)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(exportJobs.status, "ready"), lte(exportJobs.expiresAt, new Date())));
}

async function sendInactiveNotificationEmails() {
  const pending = await db
    .select({ notification: notifications, user: users })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.readAt), isNull(notifications.emailSentAt), lte(notifications.createdAt, new Date(Date.now() - 15 * 60 * 1000))))
    .limit(25);

  for (const row of pending) {
    await sendEmail({
      to: row.user.email,
      subject: "New OpenChat notification",
      text: `You have a new ${row.notification.type} notification in OpenChat.`
    });
    await db.update(notifications).set({ emailSentAt: new Date() }).where(eq(notifications.id, row.notification.id));
  }
}

async function main() {
  console.log("OpenChat worker started");
  await enforceBillingGracePeriods();
  await runExports();
  await expireExports();
  await sendInactiveNotificationEmails();
  setInterval(() => {
    enforceBillingGracePeriods().catch((error) => console.error("Billing grace check failed", error));
    runExports().catch((error) => console.error("Worker failed", error));
    expireExports().catch((error) => console.error("Export expiry failed", error));
    sendInactiveNotificationEmails().catch((error) => console.error("Notification email failed", error));
  }, 15_000);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
