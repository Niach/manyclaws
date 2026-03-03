import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { agentRoutes } from "./routes/agents";
import { friendRoutes } from "./routes/friends";
import { clusterRoutes } from "./routes/cluster";
import { authRoutes, isAdmin, AGENT_API_TOKEN } from "./routes/auth";
import { portalRoutes } from "./routes/portal";

const PORT = parseInt(process.env.PORT || "3000");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "manyclaws-admin-token";
const BASE_DOMAIN = process.env.BASE_DOMAIN || "manyclaws.net";

// MIME types for static assets
const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const app = new Elysia()
  .use(cors())
  // Auth middleware for /api routes
  .onBeforeHandle(({ request, set }) => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) return;
    if (url.pathname.startsWith("/api/portal")) return; // friend session checked in route handlers
    if (url.pathname === "/api/health") return;

    const token = url.searchParams.get("token") || request.headers.get("authorization")?.replace("Bearer ", "");

    // Admin token: full access to all API routes
    if (token === ADMIN_TOKEN) return;

    // Agent token: scoped access to /api/auth/* and /api/friends/*
    if (token === AGENT_API_TOKEN) {
      if (url.pathname.startsWith("/api/auth") || url.pathname.startsWith("/api/friends")) return;
    }

    // Public: magic link verification (friends click this without auth)
    if (url.pathname.startsWith("/api/auth/verify/")) return;

    set.status = 401;
    return { error: "Unauthorized" };
  })
  .use(agentRoutes)
  .use(friendRoutes)
  .use(clusterRoutes)
  .use(authRoutes)
  .use(portalRoutes)
  // Host-aware SPA routing — serve different HTML based on hostname + path
  .get("*", ({ request, set }) => {
    const host = request.headers.get("host") || "";
    const hostname = host.split(":")[0];
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Cluster admin SPA
    if (hostname === `admin.${BASE_DOMAIN}`) return Bun.file("public/index.html");

    // Agent subdomains — portal SPA
    if (hostname.endsWith(`.${BASE_DOMAIN}`)) {
      // Try static asset from portal build (e.g. /portal/assets/client-abc.js)
      // Vite base="/portal" means browser requests /portal/assets/* but dist has assets/*
      if (pathname.startsWith("/portal/")) {
        const relativePath = pathname.slice("/portal".length); // e.g. /assets/index-abc.js
        const assetPath = `public/portal-dist${relativePath}`;
        const file = Bun.file(assetPath);
        if (file.size > 0) {
          const ext = pathname.substring(pathname.lastIndexOf("."));
          const mime = MIME_TYPES[ext];
          if (mime) set.headers["content-type"] = mime;
          return file;
        }
      }
      // SPA fallback: serve shell for all /portal/* routes
      return Bun.file("public/portal-dist/index.html");
    }

    return Bun.file("public/index.html");
  })
  .listen(PORT);

console.log(`ManyClaws Controller running at http://0.0.0.0:${PORT}`);
console.log(`Admin token: ${ADMIN_TOKEN}`);
