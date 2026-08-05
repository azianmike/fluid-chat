import { Readable } from "node:stream";
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
    const stream = Readable.toWeb(objectStream(record.storageKey)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "content-type": record.mimeType,
        "content-length": String(record.size),
        "content-disposition": contentDisposition(record.mimeType, record.name),
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, max-age=3600"
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
