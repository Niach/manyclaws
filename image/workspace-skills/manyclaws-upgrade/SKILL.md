---
name: manyclaws-upgrade
description: "Bootstrap ManyClaws onto a Kubernetes cluster. Guides existing OpenClaw users through installation step by step. Triggers on: ManyClaws install, ManyClaws setup, upgrade to ManyClaws, bootstrap ManyClaws."
---

# ManyClaws Installation Guide

Walk the user through installing ManyClaws on their Kubernetes cluster. This is a guidance skill — explain each step and help them execute it.

## Prerequisites

Before starting, verify:

```bash
# 1. kubectl access to a k8s cluster
kubectl cluster-info

# 2. k3s or k8s with Traefik ingress controller
kubectl get pods -n kube-system | grep traefik

# 3. At least 2GB free RAM for controller + first agent
kubectl top nodes
```

If they don't have a cluster, recommend a single Hetzner vServer (8 CPU, 16GB RAM) with k3s.

## Step 1: Clone the Repository

```bash
git clone https://github.com/niach/manyclaws.git
cd manyclaws
```

## Step 2: Create Namespaces

```bash
kubectl apply -f manifests/namespaces.yaml
```

This creates `manyclaws-system` and `agent-<name>` namespaces.

## Step 3: Configure Secrets

The user needs to create Kubernetes secrets with their own values. Guide them through each:

### Controller secrets (manyclaws-system)

```bash
kubectl -n manyclaws-system create secret generic controller-secrets \
  --from-literal=ADMIN_TOKEN="$(openssl rand -hex 16)" \
  --from-literal=AGENT_API_TOKEN="$(openssl rand -hex 24)" \
  --from-literal=CLOUDFLARE_API_TOKEN="YOUR_CF_TOKEN" \
  --from-literal=CLOUDFLARE_TUNNEL_ID="YOUR_TUNNEL_ID"
```

### Agent secrets (agent-<name>)

```bash
kubectl -n agent-<name> create secret generic agent-secrets \
  --from-literal=OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 24)" \
  --from-literal=ANTHROPIC_API_KEY="YOUR_ANTHROPIC_KEY" \
  --from-literal=MANYCLAWS_API_TOKEN="<same as AGENT_API_TOKEN above>"
```

Add channel tokens (Discord, etc.) as needed.

## Step 4: Deploy the Controller

```bash
# Build controller image
cd controller
docker build -t ghcr.io/manyclaws/controller:latest .
docker save ghcr.io/manyclaws/controller:latest | sudo k3s ctr images import -

# Apply manifests
kubectl apply -f ../manifests/manyclaws-system/
```

## Step 5: Set Up Cloudflare Tunnel

Guide through:
1. Create a Cloudflare Tunnel in their dashboard
2. Point all ingress rules to `http://traefik.kube-system.svc.cluster.local:80`
3. Set up Cloudflare Access policies
4. Deploy cloudflared (already in manifests, just needs the tunnel token)

## Step 6: Deploy First Agent

```bash
# Build agent image
cd ../image
docker build -t ghcr.io/manyclaws/agent:latest .
docker save ghcr.io/manyclaws/agent:latest | sudo k3s ctr images import -

# Apply agent manifests
kubectl apply -f ../manifests/agent-<name>/
```

## Step 7: Configure the Agent

Help them set up:
1. `openclaw.json` — gateway config, channel settings
2. `SOUL.md` — agent personality
3. `AGENTS.md` — behavioral rules
4. Channel connections (Discord bot, Signal linked device, etc.)

## Step 8: Verify

```bash
# Check all pods are running
kubectl get pods -A

# Test controller health
curl -s https://admin.your-domain.net/api/health

# Test agent
kubectl -n agent-<name> logs deployment/openclaw-gateway --tail=20
```

## Notes

- The entire installation is self-hosted — no external dependencies beyond Cloudflare
- One agent uses ~520MB RAM, the controller ~80MB
- 5-8 agents run comfortably on 16GB RAM
- Each agent gets its own namespace with RBAC isolation
