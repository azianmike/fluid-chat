import {
  IDENTITY_ROUTE,
  PUBLIC_ROUTE,
  ROUTE_ACCESS,
  SCOPES,
  SESSION_ONLY,
  isRealScope
} from "@/lib/api-scopes";

/**
 * Machine-readable description of the API, generated from the same table the
 * server enforces — so it cannot drift from what actually works. It deliberately
 * describes transport and authorisation only: request bodies are validated per
 * route by zod, and inventing schemas here would be a promise we cannot keep.
 */

export type RouteDescriptor = {
  method: string;
  path: string;
  scope: string | null;
  auth: "public" | "session" | "any_key" | "scope";
  summary: string;
  tag: string;
};

const VERBS: Record<string, string> = {
  GET: "Read",
  POST: "Create",
  PATCH: "Update",
  PUT: "Set",
  DELETE: "Delete"
};

export function describeRoutes(): RouteDescriptor[] {
  return Object.entries(ROUTE_ACCESS)
    .map(([spec, access]) => {
      const [method, path] = spec.split(" ");
      return {
        method,
        path,
        scope: isRealScope(access) ? access : null,
        auth: authClass(access),
        summary: summarize(method, path),
        tag: path.split("/").filter(Boolean)[0] ?? "root"
      };
    })
    .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
}

function authClass(access: string): RouteDescriptor["auth"] {
  if (access === PUBLIC_ROUTE) return "public";
  if (access === SESSION_ONLY) return "session";
  if (access === IDENTITY_ROUTE) return "any_key";
  return "scope";
}

function summarize(method: string, path: string) {
  const segments = path.split("/").filter(Boolean);
  const subject = [...segments].reverse().find((segment) => !segment.startsWith(":")) ?? "resource";
  const context = segments.filter((segment) => segment.startsWith(":")).map((segment) => segment.slice(1));
  const verb = VERBS[method] ?? method;
  const target = subject.replace(/-/g, " ");
  return context.length > 0 ? `${verb} ${target} (by ${context.join(", ")})` : `${verb} ${target}`;
}

export function openApiDocument(appUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of describeRoutes()) {
    if (route.auth === "session") continue; // Not reachable with a key; not part of the public contract.
    const openApiPath = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const params = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" }
    }));

    paths[openApiPath] ??= {};
    paths[openApiPath][route.method.toLowerCase()] = {
      summary: route.summary,
      tags: [route.tag],
      operationId: operationId(route.method, route.path),
      parameters: params,
      security: route.auth === "public" ? [] : [{ apiKey: [] }],
      "x-fluid-scope": route.scope,
      responses: {
        "200": { description: "Success" },
        "401": { description: "Missing or invalid API key" },
        "403": { description: "Missing scope, or the key belongs to another workspace" },
        "429": { description: "Rate limited; see the X-RateLimit-* headers" }
      }
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Fluid Chat API",
      version: "1.0.0",
      description:
        "Every action available in the Fluid Chat UI, callable with a workspace API key. " +
        "Send `Authorization: Bearer fluid_sk_…`. Requests and responses are JSON except file upload and download."
    },
    servers: [{ url: `${appUrl}/api` }],
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          description: "A workspace API key created by an admin."
        }
      }
    },
    security: [{ apiKey: [] }],
    "x-fluid-scopes": SCOPES,
    paths
  };
}

function operationId(method: string, path: string) {
  const parts = path
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.startsWith(":") ? `by-${segment.slice(1)}` : segment));
  return [method.toLowerCase(), ...parts].join("-").replace(/[^a-z0-9-]/gi, "");
}
