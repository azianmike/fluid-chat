import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import { HttpError, json } from "@/lib/http";
import { isModerator, requireWorkspaceMember } from "@/lib/permissions";
import { defineRoutes } from "../router";
import { contentDisposition, deleteFile, readableFile, uploadFile } from "../services/files";
import { objectStream } from "../services/storage";

export const fileRoutes = defineRoutes({
  "POST /files": async (ctx) => {
    const user = await ctx.user();
    const form = await ctx.request.formData().catch(() => null);
    if (!form) throw new HttpError(400, "Expected a multipart upload", "invalid_upload");

    const workspaceId = String(form.get("workspaceId") ?? "");
    const conversationId = form.get("conversationId") ? String(form.get("conversationId")) : null;
    z.string().uuid().parse(workspaceId);
    await requireWorkspaceMember(workspaceId, user.id);

    const uploaded = form.get("file");
    if (!(uploaded instanceof File)) throw new HttpError(400, "No file provided", "missing_file");

    const file = await uploadFile({ workspaceId, uploader: user, conversationId, file: uploaded });
    return json({ file }, 201);
  },

  "GET /files/:fileId/download": async (ctx) => {
    const user = await ctx.user();
    const record = await readableFile(ctx.param("fileId"), user.id);

    // Uploads are immutable: each one gets a fresh storage key and nothing ever
    // rewrites an object, so the file id alone is a strong validator. Both
    // responses share these headers so the two paths cannot drift apart.
    //
    // no-cache, not max-age: the HTTP cache is keyed by URL per browser
    // profile, not per account, so any freshness window would let a second
    // person signed in on the same profile read a cached file without this
    // route ever running. Revalidating every time keeps readableFile the only
    // way to reach an object, and costs a 304 rather than an S3 read.
    const cacheHeaders = { etag: `"${record.id}"`, "cache-control": "private, no-cache" };

    if (ctx.request.headers.get("if-none-match") === cacheHeaders.etag) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }

    const stream = await objectStream(record.storageKey);
    return new Response(stream, {
      headers: {
        ...cacheHeaders,
        "content-type": record.mimeType,
        "content-length": String(record.size),
        "content-disposition": contentDisposition(record.mimeType, record.name),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox"
      }
    });
  },

  "DELETE /files/:fileId": async (ctx) => {
    const user = await ctx.user();
    const fileId = ctx.param("fileId");
    const [record] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
    if (!record) throw new HttpError(404, "File not found", "not_found");
    const member = await requireWorkspaceMember(record.workspaceId, user.id);
    await deleteFile(fileId, user, isModerator(member));
    return { ok: true };
  }
});
