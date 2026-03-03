import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();
try {
  kc.loadFromCluster();
} catch {
  kc.loadFromDefault();
}

export const coreApi = kc.makeApiClient(k8s.CoreV1Api);
export const appsApi = kc.makeApiClient(k8s.AppsV1Api);
export const batchApi = kc.makeApiClient(k8s.BatchV1Api);
export const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
export const networkApi = kc.makeApiClient(k8s.NetworkingV1Api);
export const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
export const metricsApi = new k8s.Metrics(kc);
export const logApi = new k8s.Log(kc);

export interface AgentInfo {
  name: string;
  namespace: string;
  status: "running" | "pending" | "error" | "unknown";
  ready: boolean;
  podCount: number;
  healthUrl?: string;
  image?: string;
  restarts: number;
  age?: string;
}

export async function listAgentNamespaces(): Promise<string[]> {
  const res = await coreApi.listNamespace();
  return res.items
    .filter((ns) => ns.metadata?.labels?.["manyclaws.io/type"] === "agent")
    .map((ns) => ns.metadata!.name!);
}

export async function getAgentInfo(agentName: string): Promise<AgentInfo> {
  const ns = `agent-${agentName}`;
  try {
    const pods = await coreApi.listNamespacedPod({ namespace: ns, labelSelector: "app=openclaw-gateway" });
    const pod = pods.items[0];
    const containerStatus = pod?.status?.containerStatuses?.[0];
    return {
      name: agentName,
      namespace: ns,
      status: pod?.status?.phase === "Running" ? "running" : pod?.status?.phase === "Pending" ? "pending" : "error",
      ready: containerStatus?.ready ?? false,
      podCount: pods.items.length,
      image: containerStatus?.image,
      restarts: containerStatus?.restartCount ?? 0,
      age: pod?.metadata?.creationTimestamp?.toISOString(),
    };
  } catch {
    return {
      name: agentName,
      namespace: ns,
      status: "unknown",
      ready: false,
      podCount: 0,
      restarts: 0,
    };
  }
}

export async function getNamespacedPods(namespace: string) {
  const res = await coreApi.listNamespacedPod({ namespace });
  return res.items.map((pod) => ({
    name: pod.metadata?.name,
    status: pod.status?.phase,
    ready: pod.status?.containerStatuses?.every((c) => c.ready) ?? false,
    restarts: pod.status?.containerStatuses?.reduce((sum, c) => sum + (c.restartCount ?? 0), 0) ?? 0,
    image: pod.spec?.containers?.[0]?.image,
    age: pod.metadata?.creationTimestamp?.toISOString(),
  }));
}

export async function getNamespacedServices(namespace: string) {
  const res = await coreApi.listNamespacedService({ namespace });
  return res.items.map((svc) => ({
    name: svc.metadata?.name,
    type: svc.spec?.type,
    clusterIP: svc.spec?.clusterIP,
    ports: svc.spec?.ports?.map((p) => ({ port: p.port, targetPort: p.targetPort, protocol: p.protocol })),
  }));
}

export async function getResourceQuota(namespace: string) {
  const res = await coreApi.listNamespacedResourceQuota({ namespace });
  const quota = res.items[0];
  if (!quota) return null;
  return {
    hard: quota.status?.hard,
    used: quota.status?.used,
  };
}

export async function getClusterInfo() {
  const nodes = await coreApi.listNode();
  const node = nodes.items[0];
  return {
    name: node?.metadata?.name,
    version: node?.status?.nodeInfo?.kubeletVersion,
    os: node?.status?.nodeInfo?.osImage,
    cpu: node?.status?.capacity?.["cpu"],
    memory: node?.status?.capacity?.["memory"],
    pods: node?.status?.capacity?.["pods"],
    conditions: node?.status?.conditions
      ?.filter((c) => c.type === "Ready" || c.type === "MemoryPressure" || c.type === "DiskPressure")
      .map((c) => ({ type: c.type, status: c.status })),
  };
}

export async function restartDeployment(namespace: string, name: string) {
  const patch = {
    spec: {
      template: {
        metadata: {
          annotations: {
            "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
          },
        },
      },
    },
  };
  await appsApi.patchNamespacedDeployment({
    name,
    namespace,
    body: patch,
    headers: { "Content-Type": "application/strategic-merge-patch+json" },
  });
}

export async function createNamespace(name: string, labels: Record<string, string> = {}) {
  await coreApi.createNamespace({
    body: {
      metadata: {
        name,
        labels: {
          "app.kubernetes.io/part-of": "manyclaws",
          ...labels,
        },
      },
    },
  });
}

export async function provisionFriendNamespace(namespace: string, friendId: string) {
  // 1. Create namespace with PodSecurity labels
  try {
    await coreApi.createNamespace({
      body: {
        metadata: {
          name: namespace,
          labels: {
            "app.kubernetes.io/part-of": "manyclaws",
            "manyclaws.io/type": "friend",
            "manyclaws.io/friend": friendId,
            "pod-security.kubernetes.io/enforce": "restricted",
            "pod-security.kubernetes.io/enforce-version": "latest",
          },
        },
      },
    });
  } catch (err: any) {
    if (!err.body?.message?.includes("already exists") && !err.message?.includes("already exists")) throw err;
  }

  // 2. ResourceQuota
  try {
    await coreApi.createNamespacedResourceQuota({
      namespace,
      body: {
        metadata: { name: "friend-quota", namespace },
        spec: {
          hard: {
            "requests.cpu": "500m",
            "requests.memory": "512Mi",
            "limits.cpu": "500m",
            "limits.memory": "512Mi",
            pods: "3",
            persistentvolumeclaims: "2",
          },
        },
      },
    });
  } catch (err: any) {
    if (!err.body?.message?.includes("already exists") && !err.message?.includes("already exists")) throw err;
  }

  // 3. LimitRange
  try {
    await coreApi.createNamespacedLimitRange({
      namespace,
      body: {
        metadata: { name: "friend-limits", namespace },
        spec: {
          limits: [
            {
              type: "Container",
              default: { cpu: "100m", memory: "64Mi" },
              defaultRequest: { cpu: "50m", memory: "32Mi" },
              max: { cpu: "500m", memory: "256Mi" },
            },
          ],
        },
      },
    });
  } catch (err: any) {
    if (!err.body?.message?.includes("already exists") && !err.message?.includes("already exists")) throw err;
  }

  // 4. NetworkPolicy — deny cross-namespace, allow internet egress, allow ingress from manyclaws-system
  try {
    await networkApi.createNamespacedNetworkPolicy({
      namespace,
      body: {
        metadata: { name: "friend-netpol", namespace },
        spec: {
          podSelector: {},
          policyTypes: ["Ingress", "Egress"],
          ingress: [
            {
              from: [
                {
                  namespaceSelector: {
                    matchLabels: { "kubernetes.io/metadata.name": "manyclaws-system" },
                  },
                },
              ],
            },
          ],
          egress: [
            // Allow DNS
            {
              to: [{ namespaceSelector: {} }],
              ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
            },
            // Allow internet (block pod/service CIDR)
            {
              to: [
                { ipBlock: { cidr: "0.0.0.0/0", except: ["10.42.0.0/16", "10.43.0.0/16"] } },
              ],
            },
          ],
        },
      },
    });
  } catch (err: any) {
    if (!err.body?.message?.includes("already exists") && !err.message?.includes("already exists")) throw err;
  }
}

export async function createSecret(namespace: string, name: string, data: Record<string, string>) {
  await coreApi.createNamespacedSecret({
    namespace,
    body: {
      metadata: { name, namespace },
      type: "Opaque",
      stringData: data,
    },
  });
}

export async function deleteSecret(namespace: string, name: string) {
  await coreApi.deleteNamespacedSecret({ name, namespace });
}

export async function listSecrets(namespace: string) {
  const res = await coreApi.listNamespacedSecret({ namespace });
  return res.items
    .filter((s) => s.type === "Opaque")
    .map((s) => ({
      name: s.metadata?.name,
      keys: Object.keys(s.data ?? {}),
      created: s.metadata?.creationTimestamp?.toISOString(),
    }));
}

export async function readSecret(namespace: string, name: string): Promise<Record<string, string>> {
  const secret = await coreApi.readNamespacedSecret({ name, namespace });
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(secret.data ?? {})) {
    result[k] = Buffer.from(v, "base64").toString("utf-8");
  }
  return result;
}

// ── Workspace file access via kubectl exec ──

async function getAgentPodName(agentName: string): Promise<string> {
  const ns = `agent-${agentName}`;
  const pods = await coreApi.listNamespacedPod({ namespace: ns, labelSelector: "app=openclaw-gateway" });
  const pod = pods.items.find(p => p.status?.phase === "Running");
  if (!pod?.metadata?.name) throw new Error(`No running pod found for agent ${agentName}`);
  return pod.metadata.name;
}

export async function execInAgentPod(agentName: string, command: string[]): Promise<string> {
  const ns = `agent-${agentName}`;
  const podName = await getAgentPodName(agentName);

  const proc = Bun.spawn(
    ["kubectl", "-n", ns, "exec", podName, "-c", "gateway", "--", ...command],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(stderr || `exec failed with code ${code}`);
  return stdout;
}

export async function readWorkspaceFile(agentName: string, relPath: string): Promise<string | null> {
  // Sanitize path to prevent directory traversal
  const clean = relPath.replace(/\.\./g, "").replace(/\/\//g, "/");
  const fullPath = `/home/node/workspace/${clean}`;
  try {
    return await execInAgentPod(agentName, ["cat", fullPath]);
  } catch {
    return null;
  }
}

export async function writeWorkspaceFile(agentName: string, relPath: string, content: string): Promise<void> {
  const clean = relPath.replace(/\.\./g, "").replace(/\/\//g, "/");
  const fullPath = `/home/node/workspace/${clean}`;
  const dirPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

  // Encode content as base64 (safe for shell embedding, no special chars)
  const b64 = Buffer.from(content, "utf-8").toString("base64");
  await execInAgentPod(agentName, ["sh", "-c", `mkdir -p '${dirPath}' && printf '%s' '${b64}' | base64 -d > '${fullPath}'`]);
}

export async function listWorkspaceDir(agentName: string, relDir: string): Promise<string[]> {
  const clean = relDir.replace(/\.\./g, "").replace(/\/\//g, "/");
  const fullPath = `/home/node/workspace/${clean}`;
  try {
    const out = await execInAgentPod(agentName, ["ls", "-1", fullPath]);
    return out.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
