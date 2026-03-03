# ManyClaws Agent Environment

You are running inside a **ManyClaws** Kubernetes namespace (`${MANYCLAWS_NAMESPACE}`). You have a Kubernetes ServiceAccount (`agent-deployer`) that lets you manage workloads in your own namespace.

## What You Can Do

### Deploy workloads
```bash
kubectl apply -f deployment.yaml
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

### Check your resources
```bash
kubectl get pods                    # List your pods
kubectl get deployments             # List your deployments
kubectl get services                # List your services
kubectl get jobs,cronjobs           # List your jobs
kubectl get pvc                     # List your storage claims
kubectl describe pod <name>         # Pod details
kubectl top pods                    # Resource usage
```

### View logs
```bash
kubectl logs deployment/my-app      # Current logs
kubectl logs deployment/my-app -f   # Stream logs
kubectl logs pod/<name> --previous  # Previous crash logs
```

### Manage deployments
```bash
kubectl rollout restart deployment/my-app   # Restart
kubectl scale deployment/my-app --replicas=2  # Scale
kubectl delete deployment my-app            # Remove
```

### Create cron jobs
```bash
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-task
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: task
            image: curlimages/curl:latest
            command: ["curl", "-s", "https://example.com/api"]
          restartPolicy: OnFailure
EOF
```

## Resource Limits

Your namespace has quotas:
- **CPU:** 4 cores total
- **RAM:** 3GB total
- **Pods:** 10 max
- **PVCs:** 8 max

Each container defaults to 500m CPU / 256Mi RAM. Max per container: 2 CPU / 2Gi RAM.

Check your usage: `kubectl describe resourcequota`

## What You CANNOT Do

- Access other namespaces (RBAC denies it)
- Create or modify secrets (controller-managed)
- Create ingress routes (controller-managed)
- Modify network policies or RBAC rules
- Run privileged containers
- Use hostPath volumes

## Controller API Auth

All controller API calls require the `$MANYCLAWS_API_TOKEN` environment variable as a Bearer token:

```bash
-H "Authorization: Bearer $MANYCLAWS_API_TOKEN"
```

This token is pre-configured in your environment. Always include it in API requests.

## Friends System

Friend data lives in your workspace under `friends/<id>/`:
- `profile.json` — contact info and preferences
- `notes.md` — your notes about the person
- `MEMORY.md` — friend-editable memory (visible in their portal)

### Deploy to a Friend's Namespace

Each friend has their own isolated k8s namespace (`friend-{id}`) with ResourceQuota, LimitRange, and NetworkPolicy. You can deploy workloads there via the controller API:

```bash
# Deploy a manifest to a friend's namespace (JSON body, namespace is forced)
curl -s -X POST http://manyclaws-controller.manyclaws-system.svc/api/friends/{friend}/namespace/apply \
  -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"apiVersion":"apps/v1","kind":"Deployment","metadata":{"name":"my-app"},"spec":{"replicas":1,"selector":{"matchLabels":{"app":"my-app"}},"template":{"metadata":{"labels":{"app":"my-app"}},"spec":{"containers":[{"name":"app","image":"nginx:alpine","ports":[{"containerPort":80}]}]}}}}'

# Check friend namespace status (pods, services, deployments, quota)
curl -s -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  http://manyclaws-controller.manyclaws-system.svc/api/friends/{friend}/namespace/status

# List pods in friend namespace
curl -s -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  http://manyclaws-controller.manyclaws-system.svc/api/friends/{friend}/namespace/pods

# View pod logs in friend namespace
curl -s -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  http://manyclaws-controller.manyclaws-system.svc/api/friends/{friend}/namespace/logs/{pod}

# Delete a deployment in friend namespace
curl -s -X DELETE -H "Authorization: Bearer $MANYCLAWS_API_TOKEN" \
  http://manyclaws-controller.manyclaws-system.svc/api/friends/{friend}/namespace/deployments/{name}
```

Allowed resource kinds: Deployment, Service, ConfigMap, Job, CronJob. The namespace field is always forced to `friend-{id}`.

Friend namespace limits: 500m CPU, 512Mi RAM, 3 pods, 2 PVCs. Each container defaults to 100m/64Mi, max 500m/256Mi.

### Friend Portal

Friends can access their portal at `https://<agent>.your-domain.net/portal` to manage their secrets, view their namespace, and configure heartbeat tasks. Use the `portal.login` skill to send them a login link.
