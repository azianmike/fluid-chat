import { NextRequest } from "next/server";
import {
  clientIp,
  enforceApiKeyRateLimit,
  enforceCsrf,
  enforceRateLimit,
  rateLimitHeaders,
  rateLimitStatusOf
} from "@/lib/guards";
import { HttpError, errorResponse, json } from "@/lib/http";
import { assertRouteAllowed, readBearerToken, resolveApiKey, runWithRequestAuth } from "@/lib/api-auth";
import type { ApiKeyAuth } from "@/lib/api-auth";
import { accessFor, assertRoutesAreClassified } from "@/lib/api-scopes";
import { Context, compileRoutes, matchRoute } from "./router";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { workspaceRoutes } from "./routes/workspaces";
import { inviteRoutes } from "./routes/invites";
import { channelRoutes } from "./routes/channels";
import { conversationRoutes } from "./routes/conversations";
import { messageRoutes } from "./routes/messages";
import { fileRoutes } from "./routes/files";
import { activityRoutes } from "./routes/activity";
import { webhookRoutes } from "./routes/webhooks";
import { apiKeyRoutes } from "./routes/api-keys";
import { metaRoutes } from "./routes/meta";

/**
 * The whole HTTP surface. Adding an endpoint means adding one line to a route
 * module; nothing here needs to change.
 */
const routes = compileRoutes([
  authRoutes,
  userRoutes,
  workspaceRoutes,
  inviteRoutes,
  channelRoutes,
  conversationRoutes,
  messageRoutes,
  fileRoutes,
  activityRoutes,
  webhookRoutes,
  apiKeyRoutes,
  metaRoutes
]);

// Fails loudly at startup if a route has no declared API access class, which is
// what keeps "anything a person can do, a key can do" honest.
assertRoutesAreClassified(routes.map((route) => route.spec));

export async function handleApiRequest(request: NextRequest, segments: string[]) {
  const path = `/${segments.join("/")}`;
  const method = request.method.toUpperCase();
  try {
    enforceCsrf(request);
    const token = readBearerToken(request);
    if (!token) enforceRateLimit(request, path);

    const match = matchRoute(routes, method, segments);
    if (!match) throw new HttpError(404, `No route for ${request.method} ${path}`, "not_found");

    if (!token) {
      return await runWithRequestAuth({ apiKey: null }, () => invoke(request, match));
    }

    let auth: ApiKeyAuth;
    try {
      auth = await resolveApiKey(token, clientIp(request));
    } catch (error) {
      // A key that does not resolve earns no exemption: presenting a bearer
      // header must never be a way to switch the IP budget off.
      enforceRateLimit(request, path);
      throw error;
    }
    // Only now is the per-IP catch-all replaced by this key's own budget.
    enforceRateLimit(request, path, { hasApiKey: true });
    assertRouteAllowed(auth, accessFor(match.route.spec), match.route.spec);
    const status = enforceApiKeyRateLimit(auth, method, path);

    const response = await runWithRequestAuth({ apiKey: auth }, () => invoke(request, match));
    for (const [header, value] of Object.entries(rateLimitHeaders(status))) {
      response.headers.set(header, value);
    }
    return response;
  } catch (error) {
    const status = rateLimitStatusOf(error);
    return errorResponse(error, status ? rateLimitHeaders(status, { retryAfter: true }) : undefined);
  }
}

type Match = NonNullable<ReturnType<typeof matchRoute>>;

async function invoke(request: NextRequest, match: Match) {
  const result = await match.route.handler(new Context(request, match.params));
  if (result instanceof Response) return result;
  return json(result ?? { ok: true });
}

export const routeTable = routes.map((route) => route.spec);
