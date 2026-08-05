import { NextRequest } from "next/server";
import { enforceCsrf, enforceRateLimit } from "@/lib/guards";
import { HttpError, errorResponse, json } from "@/lib/http";
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
  webhookRoutes
]);

export async function handleApiRequest(request: NextRequest, segments: string[]) {
  const path = `/${segments.join("/")}`;
  try {
    enforceCsrf(request);
    enforceRateLimit(request, path);

    const match = matchRoute(routes, request.method.toUpperCase(), segments);
    if (!match) throw new HttpError(404, `No route for ${request.method} ${path}`, "not_found");

    const result = await match.route.handler(new Context(request, match.params));
    if (result instanceof Response) return result;
    return json(result ?? { ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export const routeTable = routes.map((route) => route.spec);
