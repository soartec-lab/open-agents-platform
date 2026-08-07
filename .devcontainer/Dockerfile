# Dev image for open-agents-platform: Bun (workspace tooling, Vite, Biome) plus
# real Node.js 22 — flue requires real Node >= 22.19 (it refuses to run under Bun
# and uses node:sqlite), so the agent-backend's `vite dev`/`vite build` must
# resolve to real node. Installing Node in the image (instead of a devcontainer
# feature) keeps `docker compose --profile apps up` working outside VS Code too.
FROM oven/bun:1

RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    # Make sure `node` resolves to real Node even if a shim exists earlier in PATH.
    && ln -sf /usr/bin/node /usr/local/bin/node

WORKDIR /workspaces/open-agents-platform
