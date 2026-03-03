FROM ghcr.io/openclaw/openclaw:2026.3.1

# Switch to root to install kubectl
USER root

# Install kubectl (compatible with k3s v1.34.x)
ADD --chmod=755 https://dl.k8s.io/release/v1.34.4/bin/linux/amd64/kubectl /usr/local/bin/kubectl

# ManyClaws workspace template (agent can override via PVC)
COPY --chown=node:node MANYCLAWS.md /home/node/workspace/MANYCLAWS.md

# Skills live in workspace/skills/ (workspace PVC), not here.
# The openclaw-data PVC mounts over ~/.openclaw and would hide any files copied here.

# ManyClaws entrypoint wrapper — sets default config values (e.g. dangerouslyDisableDeviceAuth)
COPY --chown=node:node manyclaws-entrypoint.sh /usr/local/bin/manyclaws-entrypoint.sh

# Switch back to node user
USER node

ENTRYPOINT ["manyclaws-entrypoint.sh"]
