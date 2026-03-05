# Remote Agent Docker Image
# Debian-based image with Bun, Claude Code, and GitHub CLI
#
# Stage 1 (infra): system deps, GitHub CLI, Claude Code — cached aggressively
# Stage 2 (app):   deps install, source copy, UI build  — always fresh

# ═══════════════════════════════════════════════════════════════
# Stage 1: Infrastructure (cached — only rebuilds on base image or apt changes)
# ═══════════════════════════════════════════════════════════════
FROM oven/bun:1.3.10 AS infra

# Install system dependencies
RUN apt-get update && apt-get install -y \
    bash \
    git \
    openssh-client \
    curl \
    ca-certificates \
    gnupg \
    sudo \
    jq \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Install Docker CLI + Compose plugin (daemon runs on host via socket mount)
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Create app user (no sudo access for security)
RUN useradd -m -s /bin/bash agent

# Ensure temp dirs are writable for all users (bun needs this)
RUN chmod 1777 /tmp && mkdir -p /var/tmp && chmod 1777 /var/tmp

# Install nvm, Node.js, and Claude CLI as agent user
USER agent
WORKDIR /home/agent
ENV HOME=/home/agent

# nvm + Node.js 24 LTS
ENV NVM_DIR=/home/agent/.nvm
RUN curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && \
    . "$NVM_DIR/nvm.sh" && \
    nvm install --lts 24 && \
    nvm alias default 24 && \
    ln -s "$(dirname "$(nvm which default)")" "$NVM_DIR/default_bin"

# Claude Code CLI
RUN curl -fsSL https://claude.ai/install.sh | bash || \
    . "$NVM_DIR/nvm.sh" && npm install -g @anthropic-ai/claude-code || \
    echo "Claude CLI installation skipped"

# Setup git config
RUN git config --global user.email "agent@remote-agent.local" && \
    git config --global user.name "Remote Agent" && \
    git config --global init.defaultBranch main
USER root

# Playwright — install system deps for all browsers directly via apt
# This is more robust than `npx playwright install-deps` which depends on
# the playwright version matching what workspaces use at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0t64 \
    libnspr4 \
    libnss3 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libdbus-1-3 \
    libcups2t64 \
    libxkbcommon0 \
    libatspi2.0-0t64 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libcairo2 \
    libpango-1.0-0 \
    libasound2t64 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxext6 \
    libdrm2 \
    libexpat1 \
    libxcb-dri3-0 \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
# Pre-install chromium browser as agent (workspaces can install others at runtime)
USER agent
ENV PATH="/home/agent/.nvm/default_bin:${PATH}"
RUN npx playwright install chromium

# Install agent-browser globally (uses Playwright chromium already installed above)
RUN npm install -g agent-browser
USER root

# ═══════════════════════════════════════════════════════════════
# Stage 2: Application (cache-busted by VERSION arg on every commit)
# ═══════════════════════════════════════════════════════════════
FROM infra AS app

# VERSION changes every commit (dev-<sha>), which invalidates the cache
# for every layer below it in this stage. This ensures deps, source copy,
# and UI build are always fresh. The infra stage above stays cached.
ARG VERSION=dev

# Fix temp dirs (bun 1.3.10 needs writable /tmp)
RUN chmod 1777 /tmp && mkdir -p /var/tmp && chmod 1777 /var/tmp

# Setup app directory
WORKDIR /app

# ── Dependencies ──
COPY --chown=agent:agent package.json bun.lock* ./
COPY --chown=agent:agent packages/api/package.json ./packages/api/
COPY --chown=agent:agent packages/ui/package.json ./packages/ui/

RUN bun install --frozen-lockfile || bun install

# ── App source ──
COPY --chown=agent:agent . .

# Build UI
RUN bun run build:ui

# Create required directories with agent ownership
RUN mkdir -p /app/workspaces /app/ssh-keys /app/config/hooks /app/config/skills && \
    chown -R agent:agent /app/workspaces /app/ssh-keys /app/config

# Copy hook scripts (--chmod eliminates ghost layer from separate chmod)
COPY --chown=agent:agent --chmod=755 docker/hooks/ /app/hooks/

# ── Metadata & environment ──
ENV APP_VERSION=$VERSION
ENV NODE_ENV=production
ENV WORKSPACES_ROOT=/app/workspaces
ENV SSH_KEYS_ROOT=/app/ssh-keys
ENV CONFIG_ROOT=/app/config
ENV NVM_DIR=/home/agent/.nvm
ENV PATH="/home/agent/.local/bin:/home/agent/.nvm/default_bin:/usr/local/bin:${PATH}"

LABEL org.opencontainers.image.title="Remote Agent"
LABEL org.opencontainers.image.description="Remote Claude Code sessions with web UI"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.source="https://github.com/mrtcmn/remote-agent"
LABEL org.opencontainers.image.licenses="MIT"

# Expose port
EXPOSE 5100

# Switch back to root for entrypoint (entrypoint drops to agent after fixing permissions)
# Entrypoint (--chmod eliminates ghost layer from separate chmod)
COPY --chmod=755 docker/entrypoint.sh /entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5100/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "run", "--cwd", "packages/api", "src/index.ts"]
