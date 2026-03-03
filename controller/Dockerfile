FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY . .

FROM oven/bun:1-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -LO "https://dl.k8s.io/release/$(curl -Ls https://dl.k8s.io/release/stable.txt)/bin/linux/$(dpkg --print-architecture)/kubectl" \
    && install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl \
    && rm kubectl && apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app /app
RUN mkdir -p /app/data
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
