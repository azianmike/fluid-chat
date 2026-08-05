import { SCOPES } from "@/lib/api-scopes";
import { BURST_PER_SECOND, WORKSPACE_CEILING_PER_MINUTE } from "@/lib/guards";
import { TOKEN_PREFIX } from "@/lib/api-auth";
import { defineRoutes } from "../router";
import { DEFAULT_MESSAGE_LIMIT, DEFAULT_RATE_LIMIT, MAX_RATE_LIMIT } from "../services/api-keys";
import { describeRoutes, openApiDocument } from "../services/openapi";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

/**
 * Discovery. An agent handed nothing but a key and a base URL can read these
 * three endpoints and learn the entire surface, including which scope each call
 * needs and what the rate limits are.
 */
export const metaRoutes = defineRoutes({
  "GET /meta": () => ({
    name: "Fluid Chat API",
    version: "1.0.0",
    authentication: {
      header: "Authorization: Bearer <token>",
      alternativeHeader: "X-Api-Key: <token>",
      tokenPrefix: TOKEN_PREFIX,
      note: "Workspace admins create keys in Admin → API keys, or via POST /workspaces/:workspaceId/api-keys."
    },
    rateLimits: {
      defaultRequestsPerMinute: DEFAULT_RATE_LIMIT,
      maxRequestsPerMinute: MAX_RATE_LIMIT,
      defaultMessagesPerMinute: DEFAULT_MESSAGE_LIMIT,
      burstPerSecond: BURST_PER_SECOND,
      workspaceCeilingPerMinute: WORKSPACE_CEILING_PER_MINUTE,
      headers: ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "Retry-After"]
    },
    links: {
      routes: `${appUrl()}/api/meta/routes`,
      scopes: `${appUrl()}/api/meta/scopes`,
      openapi: `${appUrl()}/api/meta/openapi.json`
    }
  }),

  "GET /meta/routes": () => ({ routes: describeRoutes() }),

  "GET /meta/scopes": () => ({ scopes: SCOPES }),

  "GET /meta/openapi.json": () => openApiDocument(appUrl())
});
