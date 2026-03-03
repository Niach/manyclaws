---
name: manyclaws-k8s
description: Manage Kubernetes resources in your namespace. Deploy workloads, check pod status, view logs, delete resources, and monitor quota usage. Triggers on mentions of deploy, pods, k8s, kubernetes, containers, or namespace resources.
---

# Kubernetes Operations

You have a ServiceAccount (`agent-deployer`) that lets you manage workloads in your own namespace via `kubectl`.

## Deploy

Apply a YAML manifest to your namespace:

```bash
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
      - name: app
        image: nginx:alpine
        ports:
        - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: my-app
spec:
  selector:
    app: my-app
  ports:
  - port: 80
EOF
```

Always check quota before deploying: `kubectl describe resourcequota`

## Status

```bash
kubectl get pods,deployments,services,jobs,cronjobs -o wide
kubectl describe resourcequota
```

## Logs

```bash
kubectl logs deployment/<name>           # Current logs
kubectl logs deployment/<name> --tail=50 # Last 50 lines
kubectl logs pod/<name> --previous       # Previous crash logs
```

## Manage

```bash
kubectl rollout restart deployment/<name>      # Restart
kubectl scale deployment/<name> --replicas=2   # Scale
kubectl delete deployment <name>               # Remove (confirm with user first)
```

## Resources

```bash
kubectl describe resourcequota  # Quota usage vs limits
kubectl top pods                # CPU/memory per pod
```

## Limits

- **CPU:** 4 cores total, max 2 per container
- **RAM:** 3GB total, max 2Gi per container
- **Pods:** 10 max
- **PVCs:** 8 max
- Default per container: 500m CPU / 256Mi RAM

## Deploying FOR a Friend

When a friend asks you to deploy something, ALWAYS use the controller API — never deploy to your own namespace for friend workloads:

```bash
# Deploy to friend's namespace
curl -s -X POST http://manyclaws-controller.manyclaws-system.svc/api/friends/<friend-id>/namespace/apply \
  -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '[{"apiVersion":"apps/v1","kind":"Deployment",...},{"apiVersion":"v1","kind":"Service",...}]'

# Expose a friend's service externally
curl -s -X POST http://manyclaws-controller.manyclaws-system.svc/api/friends/<friend-id>/namespace/expose \
  -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-app","service":"my-app-svc","port":80}'
# Returns: {"ok":true,"hostname":"my-app-<friend-id>.manyclaws.net","url":"https://..."}
```

NEVER use `kubectl apply` in your own namespace for friend workloads. The friend's namespace is `friend-<friend-id>`.

## Restrictions

- Cannot access other namespaces
- Cannot create/modify secrets (controller-managed)
- Cannot create ingress routes
- Cannot run privileged containers
