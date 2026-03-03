import { Elysia, t } from "elysia";
import { getDb } from "../db/schema";
import { getFriendSession } from "./auth";
import {
  getNamespacedPods,
  getNamespacedServices,
  getResourceQuota,
  listSecrets,
  readSecret,
  createSecret,
  deleteSecret,
  appsApi,
  coreApi,
  customApi,
  readWorkspaceFile,
  writeWorkspaceFile,
  listWorkspaceDir,
  execInAgentPod,
} from "../services/k8s";
import {
  getDomains,
  getHostname,
  createDnsRecord,
  deleteDnsRecord,
  domainFromHostname,
} from "../services/cloudflare";

function requireFriend(request: Request): { friendId: string; namespace: string } {
  const friendId = getFriendSession(request);
  if (!friendId) throw new Response("Unauthorized", { status: 401 });
  return { friendId, namespace: `friend-${friendId}` };
}

const BASE_DOMAIN = process.env.BASE_DOMAIN || "manyclaws.net";

function getAgentFromHost(request: Request): string {
  const host = request.headers.get("host") || "";
  const pattern = new RegExp(`^([^.]+)\\.${BASE_DOMAIN.replace(/\./g, "\\.")}`);
  const match = host.match(pattern);
  return match?.[1] || "towelie";
}

export const portalRoutes = new Elysia({ prefix: "/api/portal" })
  // Friend profile
  .get("/me", async ({ request }) => {
    const friendId = getFriendSession(request);
    if (!friendId) return new Response("Unauthorized", { status: 401 });

    const agent = getAgentFromHost(request);

    // Read profile from workspace
    let profile: any = {};
    try {
      const raw = await readWorkspaceFile(agent, `friends/${friendId}/profile.json`);
      if (raw) profile = JSON.parse(raw);
    } catch {}

    let secretCount = 0;
    try {
      const secrets = await listSecrets(`friend-${friendId}`);
      secretCount = secrets.length;
    } catch {}

    let logCount = 0;
    try {
      const files = await listWorkspaceDir(agent, "memory");
      logCount = files.filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).length;
    } catch {}

    return {
      id: friendId,
      display_name: profile.display_name || friendId.charAt(0).toUpperCase() + friendId.slice(1),
      preferred_channel: profile.preferred_channel || null,
      namespace: `friend-${friendId}`,
      stats: {
        logs: logCount,
        secrets: secretCount,
      },
    };
  })

  // Secrets in friend namespace
  .get("/secrets", async ({ request }) => {
    const { namespace } = requireFriend(request);
    try {
      return await listSecrets(namespace);
    } catch {
      return [];
    }
  })
  .get("/secrets/:name", async ({ request, params: { name } }) => {
    const { namespace } = requireFriend(request);
    try {
      const data = await readSecret(namespace, name);
      return { name, data };
    } catch (err: any) {
      return new Response(err.body?.message || err.message || "Not found", { status: 404 });
    }
  }, {
    params: t.Object({ name: t.String() }),
  })
  .post("/secrets", async ({ request, body }) => {
    const { namespace } = requireFriend(request);
    try {
      await createSecret(namespace, body.name, body.data);
      return { ok: true, name: body.name };
    } catch (err: any) {
      const msg = err.body?.message || err.message;
      if (msg?.includes("already exists")) {
        return new Response(JSON.stringify({ error: "Secret already exists" }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }, {
    body: t.Object({ name: t.String(), data: t.Record(t.String(), t.String()) }),
  })
  .put("/secrets/:name", async ({ request, params: { name }, body }) => {
    const { namespace } = requireFriend(request);
    try {
      try { await deleteSecret(namespace, name); } catch {}
      await createSecret(namespace, name, body.data);
      return { ok: true };
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.body?.message || err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }, {
    params: t.Object({ name: t.String() }),
    body: t.Object({ data: t.Record(t.String(), t.String()) }),
  })
  .delete("/secrets/:name", async ({ request, params: { name } }) => {
    const { namespace } = requireFriend(request);
    try {
      await deleteSecret(namespace, name);
      return { ok: true };
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.body?.message || err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }, {
    params: t.Object({ name: t.String() }),
  })

  // Agent relationships
  .get("/agents", ({ request }) => {
    const { friendId } = requireFriend(request);
    const db = getDb();
    return db.prepare("SELECT * FROM friendships WHERE friend_id = ?").all(friendId);
  })

  // Namespace overview
  .get("/namespace", async ({ request }) => {
    const { namespace } = requireFriend(request);
    try {
      const [pods, services, quota] = await Promise.all([
        getNamespacedPods(namespace),
        getNamespacedServices(namespace),
        getResourceQuota(namespace),
      ]);

      let deployments: any[] = [];
      try {
        const depRes = await appsApi.listNamespacedDeployment({ namespace });
        deployments = depRes.items.map((d) => ({
          name: d.metadata?.name,
          replicas: `${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? 0}`,
          image: d.spec?.template?.spec?.containers?.[0]?.image,
          age: d.metadata?.creationTimestamp?.toISOString(),
          secretRefs: extractSecretRefs(d.spec?.template?.spec),
        }));
      } catch {}

      let ingressRoutes: any[] = [];
      try {
        const irRes = await customApi.listNamespacedCustomObject({
          group: "traefik.io",
          version: "v1alpha1",
          namespace,
          plural: "ingressroutes",
        });
        ingressRoutes = ((irRes as any).items || []).map((ir: any) => ({
          name: ir.metadata?.name,
          hostname: ir.spec?.routes?.[0]?.match?.match(/Host\(`([^`]+)`\)/)?.[1] || null,
          service: ir.spec?.routes?.[0]?.services?.[0]?.name || null,
        }));
      } catch {}

      return { pods, services, deployments, quota, ingressRoutes };
    } catch {
      return { pods: [], services: [], deployments: [], quota: null, ingressRoutes: [] };
    }
  })

  // Available domains for expose
  .get("/domains", () => {
    return getDomains().map((d) => d.domain);
  })

  // Expose a service externally via IngressRoute + DNS
  .post("/namespace/expose", async ({ request, body, set }) => {
    const { friendId, namespace } = requireFriend(request);

    if (!/^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/.test(body.name)) {
      set.status = 400;
      return { error: "Name must be alphanumeric + hyphens, 1-20 chars" };
    }

    const domain = body.domain || BASE_DOMAIN;
    const validDomains = getDomains().map((d) => d.domain);
    if (!validDomains.includes(domain)) {
      set.status = 400;
      return { error: `Invalid domain. Available: ${validDomains.join(", ")}` };
    }

    // Verify service exists
    try {
      await coreApi.readNamespacedService({ name: body.service, namespace });
    } catch {
      set.status = 404;
      return { error: `Service '${body.service}' not found in ${namespace}` };
    }

    const hostname = getHostname(domain, body.name, friendId);
    const port = body.port || 80;
    const irName = `expose-${body.name}`;

    const ingressRoute = {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: { name: irName, namespace },
      spec: {
        entryPoints: ["web"],
        routes: [{
          match: `Host(\`${hostname}\`)`,
          kind: "Rule",
          services: [{ name: body.service, port, namespace }],
        }],
      },
    };

    try {
      try {
        await customApi.deleteNamespacedCustomObject({
          group: "traefik.io", version: "v1alpha1", namespace, plural: "ingressroutes", name: irName,
        });
      } catch {}
      await customApi.createNamespacedCustomObject({
        group: "traefik.io", version: "v1alpha1", namespace, plural: "ingressroutes", body: ingressRoute,
      });

      // Create DNS CNAME record
      try {
        await createDnsRecord(domain, hostname);
      } catch (err: any) {
        console.error(`DNS record creation failed for ${hostname}:`, err.message);
      }

      return { ok: true, hostname, url: `https://${hostname}` };
    } catch (err: any) {
      set.status = 500;
      return { error: err.body?.message || err.message };
    }
  }, {
    body: t.Object({
      name: t.String(),
      service: t.String(),
      port: t.Optional(t.Number()),
      domain: t.Optional(t.String()),
    }),
  })

  .delete("/namespace/expose/:name", async ({ request, params: { name }, set }) => {
    const { namespace } = requireFriend(request);
    const irName = `expose-${name}`;

    // Read the IngressRoute to get the hostname before deleting
    let hostname: string | null = null;
    try {
      const ir = await customApi.getNamespacedCustomObject({
        group: "traefik.io", version: "v1alpha1", namespace, plural: "ingressroutes", name: irName,
      }) as any;
      hostname = ir.spec?.routes?.[0]?.match?.match(/Host\(`([^`]+)`\)/)?.[1] || null;
    } catch {}

    try {
      await customApi.deleteNamespacedCustomObject({
        group: "traefik.io", version: "v1alpha1", namespace, plural: "ingressroutes", name: irName,
      });

      // Delete DNS record if we found the hostname
      if (hostname) {
        const domain = domainFromHostname(hostname);
        if (domain) {
          try {
            await deleteDnsRecord(domain, hostname);
          } catch (err: any) {
            console.error(`DNS record deletion failed for ${hostname}:`, err.message);
          }
        }
      }

      return { ok: true };
    } catch (err: any) {
      set.status = err.body?.code === 404 ? 404 : 500;
      return { error: err.body?.message || err.message };
    }
  }, {
    params: t.Object({ name: t.String() }),
  })

  // ── Workspace memory files (purely MD-based) ──

  // Friend's own editable memory file
  .get("/workspace/memory", async ({ request }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    const content = await readWorkspaceFile(agent, `friends/${friendId}/MEMORY.md`);
    return { content: content || "", exists: content !== null };
  })
  .put("/workspace/memory", async ({ request, body }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    await writeWorkspaceFile(agent, `friends/${friendId}/MEMORY.md`, body.content);
    return { ok: true };
  }, {
    body: t.Object({ content: t.String() }),
  })

  // Agent's notes about this friend (read-only)
  .get("/workspace/friend-notes", async ({ request }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    const content = await readWorkspaceFile(agent, `friends/${friendId}/notes.md`);
    return { content: content || "", exists: content !== null };
  })

  // ── Heartbeat (HEARTBEAT.md) ──

  .get("/workspace/heartbeat", async ({ request }) => {
    requireFriend(request);
    const agent = getAgentFromHost(request);
    const content = await readWorkspaceFile(agent, "HEARTBEAT.md");
    return { content: content || "", exists: content !== null };
  })
  .put("/workspace/heartbeat", async ({ request, body }) => {
    requireFriend(request);
    const agent = getAgentFromHost(request);
    await writeWorkspaceFile(agent, "HEARTBEAT.md", body.content);
    return { ok: true };
  }, {
    body: t.Object({ content: t.String() }),
  })

  // ── Cron jobs (via npx openclaw cron) ──

  .get("/workspace/crons", async ({ request }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    try {
      const out = await execInAgentPod(agent, ["npx", "openclaw", "cron", "list", "--json"]);
      const parsed = JSON.parse(out);
      const jobs = (parsed.jobs || []).filter((j: any) =>
        j.sessionTarget === "isolated" ||
        j.sessionTarget?.includes(`:${friendId}`) ||
        j.payload?.to?.includes(friendId) ||
        j.delivery?.to?.includes(friendId)
      );
      return { jobs };
    } catch (err: any) {
      return { jobs: [], error: err.message };
    }
  })

  .post("/workspace/crons", async ({ request, body }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);

    // Validate that the cron targets this friend
    const targetsFriend = (body.session && body.session.includes(friendId)) ||
      (body.to && body.to.includes(friendId));
    if (!targetsFriend) {
      return new Response(JSON.stringify({ error: "Cron must target your own session or contact" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const args = ["npx", "openclaw", "cron", "add", "--json"];
    if (body.name) { args.push("--name", body.name); }
    if (body.message) { args.push("--message", body.message); }
    if (body.cron) { args.push("--cron", body.cron); }
    if (body.every) { args.push("--every", body.every); }
    if (body.at) { args.push("--at", body.at); }
    if (body.session) { args.push("--session", body.session); }
    if (body.thinking) { args.push("--thinking", body.thinking); }
    if (body.tz) { args.push("--tz", body.tz); }
    if (body.announce) { args.push("--announce"); }
    if (body.channel) { args.push("--channel", body.channel); }
    if (body.to) { args.push("--to", body.to); }
    if (body.model) { args.push("--model", body.model); }
    if (body.description) { args.push("--description", body.description); }
    if (body.timeoutSeconds) { args.push("--timeout-seconds", String(body.timeoutSeconds)); }
    try {
      const out = await execInAgentPod(agent, args);
      try { return JSON.parse(out); } catch { return { ok: true, output: out }; }
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }, {
    body: t.Object({
      name: t.Optional(t.String()),
      message: t.Optional(t.String()),
      cron: t.Optional(t.String()),
      every: t.Optional(t.String()),
      at: t.Optional(t.String()),
      session: t.Optional(t.String()),
      thinking: t.Optional(t.String()),
      tz: t.Optional(t.String()),
      announce: t.Optional(t.Boolean()),
      channel: t.Optional(t.String()),
      to: t.Optional(t.String()),
      model: t.Optional(t.String()),
      description: t.Optional(t.String()),
      timeoutSeconds: t.Optional(t.Number()),
    }),
  })

  .delete("/workspace/crons/:name", async ({ request, params: { name } }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    if (!(await verifyCronOwnership(agent, name, friendId))) {
      return new Response(JSON.stringify({ error: "Cron not found or not yours" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    try {
      await execInAgentPod(agent, ["npx", "openclaw", "cron", "rm", name, "--yes"]);
      return { ok: true };
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }, {
    params: t.Object({ name: t.String() }),
  })

  .post("/workspace/crons/:name/run", async ({ request, params: { name } }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    if (!(await verifyCronOwnership(agent, name, friendId))) {
      return new Response(JSON.stringify({ error: "Cron not found or not yours" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    try {
      const out = await execInAgentPod(agent, ["npx", "openclaw", "cron", "run", name]);
      return { ok: true, output: out };
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }, {
    params: t.Object({ name: t.String() }),
  })

  .post("/workspace/crons/:name/toggle", async ({ request, params: { name }, body }) => {
    const { friendId } = requireFriend(request);
    const agent = getAgentFromHost(request);
    if (!(await verifyCronOwnership(agent, name, friendId))) {
      return new Response(JSON.stringify({ error: "Cron not found or not yours" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }
    const cmd = body.enabled ? "enable" : "disable";
    try {
      await execInAgentPod(agent, ["npx", "openclaw", "cron", cmd, name]);
      return { ok: true };
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }, {
    params: t.Object({ name: t.String() }),
    body: t.Object({ enabled: t.Boolean() }),
  });

function extractSecretRefs(podSpec: any): string[] {
  if (!podSpec?.containers) return [];
  const refs = new Set<string>();
  for (const container of podSpec.containers) {
    for (const ef of container.envFrom || []) {
      if (ef.secretRef?.name) refs.add(ef.secretRef.name);
    }
    for (const ev of container.env || []) {
      if (ev.valueFrom?.secretKeyRef?.name) refs.add(ev.valueFrom.secretKeyRef.name);
    }
  }
  return [...refs];
}

async function verifyCronOwnership(agent: string, cronName: string, friendId: string): Promise<boolean> {
  try {
    const out = await execInAgentPod(agent, ["npx", "openclaw", "cron", "list", "--json"]);
    const parsed = JSON.parse(out);
    const job = (parsed.jobs || []).find((j: any) => j.name === cronName);
    if (!job) return false;
    return job.sessionTarget === "isolated" || job.sessionTarget?.includes(`:${friendId}`) || job.payload?.to?.includes(friendId) || job.delivery?.to?.includes(friendId);
  } catch {
    return false;
  }
}
