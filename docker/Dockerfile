# Remote Agent Docker Image
# Debian-based image with Bun, Claude Code, and GitHub CLI

FROM oven/bun:latest AS base

# Version information (set at build time)
ARG VERSION=dev
ENV APP_VERSION=$VERSION

# OCI Labels for container registry
LABEL org.opencontainers.image.title="Remote Agent"
LABEL org.opencontainers.image.description="Remote Claude Code sessions with web UI"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.source="https://github.com/yourorg/remote-agent"
LABEL org.opencontainers.image.licenses="MIT"

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

# Setup app directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lockb* ./
COPY packages/api/package.json ./packages/api/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY . .

# Build UI
RUN bun run build:ui

# Create required directories
RUN mkdir -p /app/workspaces /app/ssh-keys /app/config/hooks /app/config/skills && \
    chown -R agent:agent /app

# Copy hook scripts
COPY docker/hooks/ /app/hooks/
RUN chmod +x /app/hooks/*.sh

# Environment
ENV NODE_ENV=production
ENV WORKSPACES_ROOT=/app/workspaces
ENV SSH_KEYS_ROOT=/app/ssh-keys
ENV CONFIG_ROOT=/app/config
ENV PATH="/home/agent/.local/bin:/usr/local/bin:${PATH}"

# Expose port
EXPOSE 5100

# Switch to non-root user
USER agent

# Install Claude Code CLI as agent user (installs to ~/.local/bin)
RUN curl -fsSL https://claude.ai/install.sh | bash || \
    npm install -g @anthropic-ai/claude-code || \
    echo "Claude CLI installation skipped"

# Setup git config
RUN git config --global user.email "agent@remote-agent.local" && \
    git config --global user.name "Remote Agent" && \
    git config --global init.defaultBranch main

# Entrypoint
COPY --chown=agent:agent docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5100/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "run", "--cwd", "packages/api", "start"]
