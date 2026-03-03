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
    nodejs \
    npm \
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

# Create app user (no sudo access for security)
RUN useradd -m -s /bin/bash agent

# Claude Code CLI
USER agent
RUN curl -fsSL https://claude.ai/install.sh | bash || \
    npm install -g @anthropic-ai/claude-code || \
    echo "Claude CLI installation skipped"

# Setup git config
RUN git config --global user.email "agent@remote-agent.local" && \
    git config --global user.name "Remote Agent" && \
    git config --global init.defaultBranch main
USER root

# ═══════════════════════════════════════════════════════════════
# Stage 2: Application (cache-busted by VERSION arg on every commit)
# ═══════════════════════════════════════════════════════════════
FROM infra AS app

# VERSION changes every commit (dev-<sha>), which invalidates the cache
# for every layer below it in this stage. This ensures deps, source copy,
# and UI build are always fresh. The infra stage above stays cached.
ARG VERSION=dev

# Setup app directory
WORKDIR /app

# ── Dependencies ──
COPY --chown=agent:agent package.json bun.lockb* ./
COPY --chown=agent:agent packages/api/package.json ./packages/api/
COPY --chown=agent:agent packages/ui/package.json ./packages/ui/

RUN bun install --frozen-lockfile || bun install

# ── App source ──
COPY --chown=agent:agent . .

# Build UI
RUN bun run build:ui

# Create required directories
RUN mkdir -p /app/workspaces /app/ssh-keys /app/config/hooks /app/config/skills

# Copy hook scripts (--chmod eliminates ghost layer from separate chmod)
COPY --chown=agent:agent --chmod=755 docker/hooks/ /app/hooks/

# ── Metadata & environment ──
ENV APP_VERSION=$VERSION
ENV NODE_ENV=production
ENV WORKSPACES_ROOT=/app/workspaces
ENV SSH_KEYS_ROOT=/app/ssh-keys
ENV CONFIG_ROOT=/app/config
ENV PATH="/home/agent/.local/bin:/usr/local/bin:${PATH}"

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
