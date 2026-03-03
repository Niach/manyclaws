import { Elysia, t } from "elysia";
import { nanoid } from "nanoid";
import { getDb } from "../db/schema";
import { readWorkspaceFile, listWorkspaceDir } from "../services/k8s";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "manyclaws-admin-token";
export const AGENT_API_TOKEN = process.env.AGENT_API_TOKEN || "manyclaws-agent-token";
const BASE_DOMAIN = process.env.BASE_DOMAIN || "manyclaws.net";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

export function isAdmin(request: Request): boolean {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || request.headers.get("authorization")?.replace("Bearer ", "");
  return token === ADMIN_TOKEN;
}

export function isAgent(request: Request): boolean {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  return token === AGENT_API_TOKEN;
}

export function getFriendSession(request: Request): string | null {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  const db = getDb();
  const session = db.prepare("SELECT friend_id, expires_at FROM sessions WHERE token = ?").get(token) as any;
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return session.friend_id;
}

/** Delete all expired sessions from SQLite. Called from health endpoint. */
export function cleanupExpiredSessions() {
  const db = getDb();
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

function createSession(friendId: string): { token: string; expiresAt: string } {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();
  const db = getDb();
  db.prepare("INSERT INTO sessions (token, friend_id, expires_at) VALUES (?, ?, ?)").run(token, friendId, expiresAt);
  return { token, expiresAt };
}

export const authRoutes = new Elysia({ prefix: "/api/auth" })
  // Direct session creation — agent calls this, gets back a portal URL
  .post("/portal-session", async ({ body, set }) => {
    const agent = body.agent || "towelie";
    const friends = await listWorkspaceDir(agent, "friends");
    if (!friends.includes(body.friend_id)) {
      set.status = 400;
      return { error: `Unknown friend: ${body.friend_id}` };
    }

    const { token, expiresAt } = createSession(body.friend_id);
    const portalUrl = `https://${agent}.${BASE_DOMAIN}/portal?s=${token}`;

    return {
      portal_url: portalUrl,
      session_token: token,
      expires_at: expiresAt,
      expires_in: SESSION_TTL / 1000,
    };
  }, {
    body: t.Object({
      friend_id: t.String(),
      agent: t.Optional(t.String()),
    }),
  })
  // Legacy: magic-link — creates a direct session and returns portal_url
  .post("/magic-link", async ({ body, request, set }) => {
    const host = request.headers.get("host") || `towelie.${BASE_DOMAIN}`;
    const domainPattern = new RegExp(`^([^.]+)\\.${BASE_DOMAIN.replace(/\./g, "\\.")}`);
    const agentMatch = host.match(domainPattern);
    const agent = agentMatch?.[1] || "towelie";
    const friends = await listWorkspaceDir(agent, "friends");
    if (!friends.includes(body.friend_id)) {
      set.status = 400;
      return { error: `Unknown friend: ${body.friend_id}` };
    }

    const { token } = createSession(body.friend_id);
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    const portalUrl = `${protocol}://${host}/portal?s=${token}`;

    return {
      portal_url: portalUrl,
      session_token: token,
      link: `/portal?s=${token}`,
      expires_in: SESSION_TTL / 1000,
    };
  }, {
    body: t.Object({ friend_id: t.String() }),
  })
  // Legacy: verify endpoint — still works for any old links, creates session and redirects
  .get("/verify/:token", ({ params: { token }, set, request }) => {
    // Treat the token as a session token — check if it's already a valid session
    const db = getDb();
    const session = db.prepare("SELECT friend_id, expires_at FROM sessions WHERE token = ?").get(token) as any;
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      set.status = 401;
      return { error: "Link expired or invalid" };
    }

    const host = request.headers.get("host") || `towelie.${BASE_DOMAIN}`;
    const protocol = request.headers.get("x-forwarded-proto") || "https";
    set.redirect = `${protocol}://${host}/portal?s=${token}`;
  }, {
    params: t.Object({ token: t.String() }),
  })
  .get("/me", async ({ request }) => {
    const friendId = getFriendSession(request);
    if (!friendId) return new Response("Unauthorized", { status: 401 });

    // Read profile from workspace, fallback to derived defaults
    const host = request.headers.get("host") || "";
    const domainPattern = new RegExp(`^([^.]+)\\.${BASE_DOMAIN.replace(/\./g, "\\.")}`);
    const agentMatch = host.match(domainPattern);
    const agent = agentMatch?.[1] || "towelie";

    let profile: any = {};
    try {
      const raw = await readWorkspaceFile(agent, `friends/${friendId}/profile.json`);
      if (raw) profile = JSON.parse(raw);
    } catch {}

    return {
      id: friendId,
      display_name: profile.display_name || friendId.charAt(0).toUpperCase() + friendId.slice(1),
      preferred_channel: profile.preferred_channel || null,
      namespace: `friend-${friendId}`,
    };
  });
