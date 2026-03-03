#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NAMESPACE="manyclaws-system"
PVC_NAME="landing-html"

echo "==> Building Astro site..."
cd "$SCRIPT_DIR"
npm run build

echo "==> Finding PVC backing directory..."
PVC_DIR=$(kubectl get pvc "$PVC_NAME" -n "$NAMESPACE" -o jsonpath='{.spec.volumeName}' | xargs -I{} find /var/lib/rancher/k3s/storage/ -maxdepth 1 -name "*{}*" -type d 2>/dev/null | head -1)

if [ -z "$PVC_DIR" ]; then
  echo "ERROR: Could not find PVC backing directory for $PVC_NAME"
  echo "Make sure the PVC exists: kubectl get pvc $PVC_NAME -n $NAMESPACE"
  exit 1
fi

echo "    PVC dir: $PVC_DIR"

echo "==> Syncing dist/ to PVC..."
sudo rsync -a --delete "$SCRIPT_DIR/dist/" "$PVC_DIR/"
sudo chown -R 101:101 "$PVC_DIR/"

echo "==> Restarting landing deployment..."
kubectl -n "$NAMESPACE" rollout restart deployment/landing

echo "==> Creating /workspace/landing symlink..."
sudo mkdir -p /workspace
sudo ln -sfn "$PVC_DIR" /workspace/landing

echo "==> Waiting for rollout..."
kubectl -n "$NAMESPACE" rollout status deployment/landing --timeout=60s

echo "==> Done! Landing page deployed."
echo "    https://manyclaws.net"
echo "    https://manyclaws.net/docs/"
