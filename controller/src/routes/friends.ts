import { Elysia, t } from "elysia";
import { getDb } from "../db/schema";
import {
  provisionFriendNamespace, listSecrets,
  getNamespacedPods, getNamespacedServices, getResourceQuota,
  coreApi, appsApi, batchApi, customApi,
  readWorkspaceFile, writeWorkspaceFile, listWorkspaceDir,
} from "../services/k8s";
import {
  getDomains,
  getHostname,
  createDnsRecord,
} from "../services/cloudflare";

const DEFAULT_AGENT = "towelie";

async function readFriendProfile(agent: string, friendId: string): Promise<any> {
  try {
    const raw = await readWorkspaceFile(agent, `friends/${friendId}/profile.json`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export const friendRoutes = new Elysia({ prefix: "/api/friends" })
  .get("/", async () => {
    // List friend dirs from workspace, read each profile.json
    const dirs = await listWorkspaceDir(DEFAULT_AGENT, "friends");
    const friends: any[] = [];
    for (const id of dirs) {
      const profile = await readFriendProfile(DEFAULT_AGENT, id);
      friends.push({
        id,
        display_name: profile.display_name || id.charAt(0).toUpperCase() + id.slice(1),
        discord_id: profile.discord_id || null,
        signal: profile.signal || null,
        whatsapp: profile.whatsapp || null,
        preferred_channel: profile.preferred_channel || null,
        namespace: `friend-${id}`,
      });
    }
    return friends;
  })
  .post("/", async ({ body }) => {
    const id = body.id;
    const namespace = `friend-${id}`;

    // Provision fully hardened friend namespace
    await provisionFriendNamespace(namespace, id);

    // Write profile.json to workspace
    const profile: any = { display_name: body.display_name };
    if (body.discord_id) profile.discord_id = body.discord_id;
    if (body.signal) profile.signal = body.signal;
    if (body.whatsapp) profile.whatsapp = body.whatsapp;
    if (body.preferred_channel) profile.preferred_channel = body.preferred_channel;
    await writeWorkspaceFile(DEFAULT_AGENT, `friends/${id}/profile.json`, JSON.stringify(profile, null, 2));

    return { id, namespace };
  }, {
    body: t.Object({
      id: t.String(),
      display_name: t.String(),
      discord_id: t.Optional(t.String()),
      signal: t.Optional(t.String()),
      whatsapp: t.Optional(t.String()),
      preferred_channel: t.Optional(t.String()),
    }),
  })
  .get("/:id", async ({ params: { id } }) => {
    const profile = await readFriendProfile(DEFAULT_AGENT, id);
    const db = getDb();
    const friendships = db.prepare("SELECT * FROM friendships WHERE friend_id = ?").all(id);
    return {
      id,
      display_name: profile.display_name || id.charAt(0).toUpperCase() + id.slice(1),
      discord_id: profile.discord_id || null,
      signal: profile.signal || null,
      whatsapp: profile.whatsapp || null,
      preferred_channel: profile.preferred_channel || null,
      namespace: `friend-${id}`,
      friendships,
    };
  }, {
    params: t.Object({ id: t.String() }),
  })
  .put("/:id", async ({ params: { id }, body }) => {
    // Read existing profile, merge updates, write back
    const existing = await readFriendProfile(DEFAULT_AGENT, id);
    const updated = { ...existing };
    if (body.display_name !== undefined) updated.display_name = body.display_name;
    if (body.discord_id !== undefined) updated.discord_id = body.discord_id;
    if (body.signal !== undefined) updated.signal = body.signal;
    if (body.whatsapp !== undefined) updated.whatsapp = body.whatsapp;
    if (body.preferred_channel !== undefined) updated.preferred_channel = body.preferred_channel;
    await writeWorkspaceFile(DEFAULT_AGENT, `friends/${id}/profile.json`, JSON.stringify(updated, null, 2));
    return { ok: true };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      display_name: t.Optional(t.String()),
      discord_id: t.Optional(t.String()),
      signal: t.Optional(t.String()),
      whatsapp: t.Optional(t.String()),
      preferred_channel: t.Optional(t.String()),
    }),
  })
  .get("/:id/agents", ({ params: { id } }) => {
    const db = getDb();
    return db.prepare("SELECT * FROM friendships WHERE friend_id = ?").all(id);
  }, {
    params: t.Object({ id: t.String() }),
  })
  // Secrets
  .get("/:id/secrets", async ({ params: { id } }) => {
    const namespace = `friend-${id}`;
    try {
      return await listSecrets(namespace);
    } catch {
      return [];
    }
  }, {
    params: t.Object({ id: t.String() }),
  })
  // ── Friend Namespace Deploy API (agent-initiated) ──
  .post("/:id/namespace/apply", async ({ params: { id }, body }) => {
    const namespace = `friend-${id}`;

    const ALLOWED_KINDS = ["Deployment", "Service", "ConfigMap", "Job", "CronJob"];
    const manifests = Array.isArray(body) ? body : [body];
    const results: any[] = [];

    for (const manifest of manifests) {
      const kind = manifest.kind;
      if (!ALLOWED_KINDS.includes(kind)) {
        results.push({ kind, error: `Kind '${kind}' not allowed. Allowed: ${ALLOWED_KINDS.join(", ")}` });
        continue;
      }

      // Force namespace
      if (!manifest.metadata) manifest.metadata = {};
      manifest.metadata.namespace = namespace;

      try {
        switch (kind) {
          case "Deployment":
            try {
              await appsApi.readNamespacedDeployment({ name: manifest.metadata.name, namespace });
              await appsApi.replaceNamespacedDeployment({ name: manifest.metadata.name, namespace, body: manifest });
            } catch {
              await appsApi.createNamespacedDeployment({ namespace, body: manifest });
            }
            break;
          case "Service":
            try {
              await coreApi.readNamespacedService({ name: manifest.metadata.name, namespace });
              await coreApi.replaceNamespacedService({ name: manifest.metadata.name, namespace, body: manifest });
            } catch {
              await coreApi.createNamespacedService({ namespace, body: manifest });
            }
            break;
          case "ConfigMap":
            try {
              await coreApi.readNamespacedConfigMap({ name: manifest.metadata.name, namespace });
              await coreApi.replaceNamespacedConfigMap({ name: manifest.metadata.name, namespace, body: manifest });
            } catch {
              await coreApi.createNamespacedConfigMap({ namespace, body: manifest });
            }
            break;
          case "Job":
            await batchApi.createNamespacedJob({ namespace, body: manifest });
            break;
          case "CronJob":
            try {
              await batchApi.readNamespacedCronJob({ name: manifest.metadata.name, namespace });
              await batchApi.replaceNamespacedCronJob({ name: manifest.metadata.name, namespace, body: manifest });
            } catch {
              await batchApi.createNamespacedCronJob({ namespace, body: manifest });
            }
            break;
        }
        results.push({ kind, name: manifest.metadata.name, status: "applied" });
      } catch (err: any) {
        results.push({ kind, name: manifest.metadata.name, error: err.body?.message || err.message });
      }
    }

    return { results };
  }, {
    params: t.Object({ id: t.String() }),
  })
  .get("/:id/namespace/pods", async ({ params: { id } }) => {
    const namespace = `friend-${id}`;
    return getNamespacedPods(namespace);
  }, {
    params: t.Object({ id: t.String() }),
  })
  .get("/:id/namespace/status", async ({ params: { id } }) => {
    const namespace = `friend-${id}`;

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
      }));
    } catch {}

    return { pods, services, deployments, quota };
  }, {
    params: t.Object({ id: t.String() }),
  })
  .delete("/:id/namespace/deployments/:name", async ({ params: { id, name } }) => {
    const namespace = `friend-${id}`;
    try {
      await appsApi.deleteNamespacedDeployment({ name, namespace });
      return { ok: true };
    } catch (err: any) {
      return new Response(err.body?.message || err.message, { status: 500 });
    }
  }, {
    params: t.Object({ id: t.String(), name: t.String() }),
  })
  .get("/:id/namespace/logs/:pod", async ({ params: { id, pod }, query }) => {
    const namespace = `friend-${id}`;
    try {
      const tailLines = parseInt(query.tail || "100");
      const res = await coreApi.readNamespacedPodLog({
        name: pod,
        namespace,
        tailLines: Math.min(tailLines, 500),
      });
      return { logs: res };
    } catch (err: any) {
      return new Response(err.body?.message || err.message, { status: 500 });
    }
  }, {
    params: t.Object({ id: t.String(), pod: t.String() }),
    query: t.Object({ tail: t.Optional(t.String()) }),
  })
  // Provision namespace for existing friend (without overwriting profile)
  .post("/:id/namespace/provision", async ({ params: { id } }) => {
    const namespace = `friend-${id}`;
    await provisionFriendNamespace(namespace, id);
    return { ok: true, namespace };
  }, {
    params: t.Object({ id: t.String() }),
  })
  // Expose a service externally via IngressRoute + DNS
  .post("/:id/namespace/expose", async ({ params: { id }, body, set }) => {
    const namespace = `friend-${id}`;

    if (!/^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/.test(body.name)) {
      set.status = 400;
      return { error: "Name must be alphanumeric + hyphens, 1-20 chars" };
    }

    const domain = body.domain || (getDomains()[0]?.domain || "manyclaws.net");
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

    const hostname = getHostname(domain, body.name, id);
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
    params: t.Object({ id: t.String() }),
    body: t.Object({
      name: t.String(),
      service: t.String(),
      port: t.Optional(t.Number()),
      domain: t.Optional(t.String()),
    }),
  });
