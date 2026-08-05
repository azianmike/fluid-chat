import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { apiKeys, users, workspaceMembers } from "@/db/schema";
import type { ApiKey, User } from "@/db/schema";
import { HttpError } from "./http";
import { newToken, tokenHash } from "./security";
import { IDENTITY_ROUTE, PUBLIC_ROUTE, SESSION_ONLY, grantsScope } from "./api-scopes";

/**
 * API keys authenticate the same routes the browser calls. Everything specific
 * to that credential lives here: the token format, resolution, and the two
 * invariants a key adds on top of normal permissions — it is pinned to one
 * workspace, and it only reaches the scopes it was granted.
 */

export const TOKEN_PREFIX = "fluid_sk_";

export type ApiKeyAuth = {
  key: ApiKey;
  actor: User;
  workspaceId: string;
  scopes: string[];
  role: string;
};

type RequestAuth = { apiKey: ApiKeyAuth | null };

const storage = new AsyncLocalStorage<RequestAuth>();

export function runWithRequestAuth<T>(auth: RequestAuth, fn: () => Promise<T>): Promise<T> {
  return storage.run(auth, fn);
}

/** The key behind the in-flight request, or null when a browser session made it. */
export function currentApiKey(): ApiKeyAuth | null {
  return storage.getStore()?.apiKey ?? null;
}

export function newApiToken() {
  const token = `${TOKEN_PREFIX}${newToken(24)}`;
  return { token, prefix: token.slice(0, TOKEN_PREFIX.length + 6), hash: tokenHash(token) };
}

/** `Authorization: Bearer fluid_sk_…`, or `X-Api-Key` for clients that prefer it. */
export function readBearerToken(request: { headers: { get(name: string): string | null } }) {
  const header = request.headers.get("authorization");
  if (header) {
    const [scheme, value] = header.split(/\s+/, 2);
    if (scheme?.toLowerCase() === "bearer" && value) return value.trim();
  }
  return request.headers.get("x-api-key")?.trim() || null;
}

export async function resolveApiKey(token: string, ip: string | null): Promise<ApiKeyAuth> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new HttpError(401, "Malformed API key", "invalid_api_key");
  }

  const [row] = await db
    .select({ key: apiKeys, actor: users })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.actorUserId))
    .where(eq(apiKeys.tokenHash, tokenHash(token)))
    .limit(1);

  if (!row) throw new HttpError(401, "Unknown API key", "invalid_api_key");
  if (row.key.revokedAt) throw new HttpError(401, "This API key was revoked", "api_key_revoked");
  if (row.key.expiresAt && row.key.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(401, "This API key has expired", "api_key_expired");
  }

  // A key is only ever as powerful as the member it acts as: suspend or remove
  // that member and every key they hold goes quiet.
  const [membership] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, row.key.workspaceId),
      eq(workspaceMembers.userId, row.key.actorUserId),
      eq(workspaceMembers.status, "active")
    ))
    .limit(1);
  if (!membership) {
    throw new HttpError(403, "The identity behind this key is no longer an active member", "api_key_actor_inactive");
  }

  recordUsage(row.key.id, ip);

  return {
    key: row.key,
    actor: row.actor,
    workspaceId: row.key.workspaceId,
    scopes: row.key.scopes ?? [],
    role: membership.role
  };
}

/**
 * Enforced for every key-authenticated request. Public and session-only classes
 * are decided here too, so the rules live in one readable place.
 */
export function assertRouteAllowed(auth: ApiKeyAuth, access: string, spec: string) {
  if (access === SESSION_ONLY) {
    throw new HttpError(403, `${spec} is only available to a signed-in browser session`, "session_only");
  }
  if (access === PUBLIC_ROUTE || access === IDENTITY_ROUTE) return;
  if (!grantsScope(auth.scopes, access)) {
    throw new HttpError(403, `This API key is missing the "${access}" scope`, "missing_scope");
  }
}

/**
 * Keys are workspace credentials. Every path into workspace data funnels through
 * `requireWorkspaceMember`, which calls this, so one check covers the surface.
 */
export function assertWorkspaceInScope(workspaceId: string) {
  const auth = currentApiKey();
  if (!auth) return;
  if (auth.workspaceId !== workspaceId) {
    throw new HttpError(403, "This API key belongs to a different workspace", "workspace_scope_mismatch");
  }
}

/** A key can never grant a scope it does not hold — no self-escalation. */
export function assertCanGrantScopes(scopes: string[]) {
  const auth = currentApiKey();
  if (!auth) return;
  const excess = scopes.filter((scope) => !grantsScope(auth.scopes, scope));
  if (excess.length > 0) {
    throw new HttpError(403, `An API key cannot grant scopes it lacks: ${excess.join(", ")}`, "scope_escalation");
  }
}

/* -------------------------------------------------------------------------- */
/* Usage counters                                                              */
/* -------------------------------------------------------------------------- */

const FLUSH_INTERVAL_MS = 30_000;
const pending = new Map<string, { count: number; ip: string | null; flushedAt: number }>();

/**
 * "Last used" is useful for spotting dead keys, but it must not cost a write per
 * request, so counts accumulate in memory and land at most twice a minute.
 */
function recordUsage(keyId: string, ip: string | null) {
  const now = Date.now();
  const entry = pending.get(keyId) ?? { count: 0, ip, flushedAt: now };
  entry.count += 1;
  entry.ip = ip ?? entry.ip;
  pending.set(keyId, entry);

  if (now - entry.flushedAt < FLUSH_INTERVAL_MS && entry.count < 50) return;
  const { count, ip: lastIp } = entry;
  pending.set(keyId, { count: 0, ip: lastIp, flushedAt: now });
  void db
    .update(apiKeys)
    .set({
      lastUsedAt: new Date(),
      lastUsedIp: lastIp,
      requestCount: sql`${apiKeys.requestCount} + ${count}`
    })
    .where(eq(apiKeys.id, keyId))
    .catch((error) => console.warn("api key usage flush failed", error));
}

export function resetApiKeyUsageBuffer() {
  pending.clear();
}
