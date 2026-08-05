import { z } from "zod";
import { json } from "@/lib/http";
import { requireWorkspaceAdmin } from "@/lib/permissions";
import { SCOPE_NAMES } from "@/lib/api-scopes";
import { defineRoutes } from "../router";
import {
  DEFAULT_MESSAGE_LIMIT,
  DEFAULT_RATE_LIMIT,
  MAX_RATE_LIMIT,
  createApiKey,
  listApiKeys,
  loadApiKey,
  revokeApiKey,
  rotateApiKey,
  serializeApiKey,
  updateApiKey
} from "../services/api-keys";
import { createAudit } from "../services/workspaces";

const scopeList = z
  .array(z.string().min(1).max(40))
  .min(1)
  .max(SCOPE_NAMES.length + 8);

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: scopeList,
  identity: z.enum(["bot", "self"]).default("bot"),
  botRole: z.enum(["member", "admin"]).default("member"),
  rateLimitPerMinute: z.number().int().min(1).max(MAX_RATE_LIMIT).default(DEFAULT_RATE_LIMIT),
  messageLimitPerMinute: z.number().int().min(1).max(MAX_RATE_LIMIT).default(DEFAULT_MESSAGE_LIMIT),
  expiresInDays: z.number().int().min(1).max(3650).nullable().default(null)
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  scopes: scopeList.optional(),
  rateLimitPerMinute: z.number().int().min(1).max(MAX_RATE_LIMIT).optional(),
  messageLimitPerMinute: z.number().int().min(1).max(MAX_RATE_LIMIT).optional(),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional()
});

export const apiKeyRoutes = defineRoutes({
  "GET /workspaces/:workspaceId/api-keys": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    return { apiKeys: await listApiKeys(workspaceId, { includeRevoked: ctx.queryFlag("includeRevoked") }) };
  },

  "POST /workspaces/:workspaceId/api-keys": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    const input = await ctx.input(createSchema);

    const result = await createApiKey({ ...input, workspaceId, creator: user });
    await createAudit(workspaceId, user.id, "api_key.created", "api_key", result.key.id, {
      name: result.key.name,
      scopes: result.key.scopes,
      identity: input.identity
    });

    // The only time the secret is ever returned.
    return json({ apiKey: result.serialized, token: result.token }, 201);
  },

  "GET /api-keys/:keyId": async (ctx) => {
    const user = await ctx.user();
    const { key, actor } = await loadApiKey(ctx.param("keyId"));
    await requireWorkspaceAdmin(key.workspaceId, user.id);
    return { apiKey: serializeApiKey(key, actor) };
  },

  "PATCH /api-keys/:keyId": async (ctx) => {
    const user = await ctx.user();
    const { key, actor } = await loadApiKey(ctx.param("keyId"));
    await requireWorkspaceAdmin(key.workspaceId, user.id);
    const input = await ctx.input(updateSchema);

    const updated = await updateApiKey(key.id, input);
    await createAudit(key.workspaceId, user.id, "api_key.updated", "api_key", key.id, {
      name: updated.name,
      scopes: updated.scopes
    });
    return { apiKey: serializeApiKey(updated, actor) };
  },

  "POST /api-keys/:keyId/rotate": async (ctx) => {
    const user = await ctx.user();
    const { key, actor } = await loadApiKey(ctx.param("keyId"));
    await requireWorkspaceAdmin(key.workspaceId, user.id);

    const rotated = await rotateApiKey(key.id);
    await createAudit(key.workspaceId, user.id, "api_key.rotated", "api_key", key.id, { name: key.name });
    return { apiKey: serializeApiKey(rotated.key, actor), token: rotated.token };
  },

  "DELETE /api-keys/:keyId": async (ctx) => {
    const user = await ctx.user();
    const { key } = await loadApiKey(ctx.param("keyId"));
    await requireWorkspaceAdmin(key.workspaceId, user.id);

    await revokeApiKey(key.id, user.id);
    await createAudit(key.workspaceId, user.id, "api_key.revoked", "api_key", key.id, { name: key.name });
    return { ok: true };
  }
});
