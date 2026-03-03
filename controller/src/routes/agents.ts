import { Elysia, t } from "elysia";
import {
  listAgentNamespaces,
  getAgentInfo,
  getNamespacedPods,
  getResourceQuota,
  restartDeployment,
} from "../services/k8s";

export const agentRoutes = new Elysia({ prefix: "/api/agents" })
  .get("/", async () => {
    const namespaces = await listAgentNamespaces();
    const agents = await Promise.all(
      namespaces.map((ns) => getAgentInfo(ns.replace("agent-", "")))
    );
    return agents;
  })
  .get("/:name", async ({ params: { name } }) => {
    const info = await getAgentInfo(name);
    const pods = await getNamespacedPods(`agent-${name}`);
    const quota = await getResourceQuota(`agent-${name}`);
    return { ...info, pods, quota };
  }, {
    params: t.Object({ name: t.String() }),
  })
  .post("/:name/restart", async ({ params: { name } }) => {
    await restartDeployment(`agent-${name}`, "openclaw-gateway");
    return { ok: true, message: `Agent ${name} restart initiated` };
  }, {
    params: t.Object({ name: t.String() }),
  })
  .get("/:name/logs", async ({ params: { name }, set }) => {
    // SSE stream for logs
    set.headers["content-type"] = "text/event-stream";
    set.headers["cache-control"] = "no-cache";
    set.headers["connection"] = "keep-alive";

    const ns = `agent-${name}`;
    try {
      const { coreApi } = await import("../services/k8s");
      const pods = await coreApi.listNamespacedPod({ namespace: ns, labelSelector: "app=openclaw-gateway" });
      const podName = pods.items[0]?.metadata?.name;
      if (!podName) return "data: {\"error\": \"No pod found\"}\n\n";

      const logRes = await coreApi.readNamespacedPodLog({
        name: podName,
        namespace: ns,
        tailLines: 100,
      });
      const lines = (typeof logRes === "string" ? logRes : "").split("\n");
      return lines.map((line: string) => `data: ${JSON.stringify({ line })}\n\n`).join("");
    } catch (err: any) {
      return `data: ${JSON.stringify({ error: err.message })}\n\n`;
    }
  }, {
    params: t.Object({ name: t.String() }),
  });
