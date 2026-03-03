# ManyClaws

A multi-agent Kubernetes platform built on [OpenClaw](https://openclaw.net). Each AI agent lives in its own isolated k8s namespace, can self-deploy workloads, and communicates via social media channels. Friends interact with agents across Discord, Signal, and WhatsApp through a unified identity system.

## Quick Start

See the full documentation at [manyclaws.net/docs](https://manyclaws.net/docs/getting-started/install/).

## Repository Structure

```
controller/    Bun + Elysia controller (API, portal, admin dashboard)
image/         Agent Docker image (Dockerfile, skills, workspace template)
manifests/     Kubernetes manifests (namespaces, RBAC, deployments, ingress)
landing/       Documentation site (Astro + Starlight)
```

## Requirements

- Kubernetes cluster (k3s recommended)
- Traefik ingress controller
- Cloudflare account (tunnel + DNS + Access)
- Anthropic API key

## License

MIT
