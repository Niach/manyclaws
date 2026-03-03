import { Elysia } from "elysia";
import { getClusterInfo, listAgentNamespaces, getAgentInfo } from "../services/k8s";
import { cleanupExpiredSessions } from "./auth";

export const clusterRoutes = new Elysia({ prefix: "/api" })
  .get("/cluster", async () => {
    return await getClusterInfo();
  })
  .get("/health", async () => {
    cleanupExpiredSessions();
    const namespaces = await listAgentNamespaces();
    const agents = await Promise.all(
      namespaces.map((ns) => getAgentInfo(ns.replace("agent-", "")))
    );
    return {
      status: agents.every((a) => a.ready) ? "healthy" : "degraded",
      agents: agents.map((a) => ({ name: a.name, ready: a.ready, status: a.status })),
      timestamp: new Date().toISOString(),
    };
  });
