#!/bin/bash
# One-click update, started by the app itself (packages/api/src/services/updater.ts).
#
#   self-update.sh docker <target> <compose project> <compose files, comma list> <work dir> <service> <old image id> <image repo>
#       Runs in a helper container made from the TARGET image, with the Docker
#       socket and the compose work dir mounted. It replaces the app container.
#   self-update.sh host <target> <install dir>
#       Runs on the host in its own systemd unit, so it lives through the
#       restart of remote-agent.service.
#
# Order: lock, database backup, change, check, and roll back if the check fails.
# The last line is always "RESULT: OK <version>", "RESULT: ROLLED BACK <reason>"
# or "RESULT: FAILED <reason>"; the app reads it.
# It never touches: the Postgres volume, workspaces, SSH keys, the Claude login.

set -uo pipefail

MODE="${1:?mode}"
TARGET="${2:?target version, e.g. v1.3.2}"
BACKUP_RETENTION=3

say() { echo "[$(date -u +%H:%M:%S)] $*"; }
finish() { echo "RESULT: $*"; rm -f "${LOCK:-/nonexistent}"; case "$*" in OK*) exit 0 ;; *) exit 1 ;; esac; }

case "$TARGET" in v[0-9]*.[0-9]*.[0-9]*) ;; *) finish "FAILED the target '$TARGET' is not a version like v1.2.3" ;; esac

# ── Database helpers. $DB is a command prefix that runs a program in the Postgres container. ──

db_backup() {
  local file="$BACKUP_DIR/$(date -u +%Y-%m-%d_%H%M%S)_$1.sql.gz"
  # pg_dump's own exit code, not gzip's.
  if $DB sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$file" && [ "${PIPESTATUS[0]}" -eq 0 ] && [ -s "$file" ]; then
    echo "$file"
  else
    rm -f "$file"
    return 1
  fi
}

db_restore() {
  $DB sh -c 'psql -q -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" -c "CREATE DATABASE \"$POSTGRES_DB\";"' \
    && gunzip -c "$1" | $DB sh -c 'psql -q -U "$POSTGRES_USER" "$POSTGRES_DB"' > /dev/null
}

# How many migrations ran. A change means the old code may not read the new schema.
db_migrations() {
  $DB sh -c 'psql -tA -U "$POSTGRES_USER" "$POSTGRES_DB" -c "select count(*) from drizzle.__drizzle_migrations"' 2>/dev/null | tr -d '[:space:]'
}

prune_backups() { ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +$((BACKUP_RETENTION + 1)) | xargs -r rm -f; }

take_lock() {
  mkdir -p "$BACKUP_DIR"
  LOCK="$BACKUP_DIR/.update.lock"
  # A lock older than 30 minutes is from an update that died.
  if [ -f "$LOCK" ] && [ -n "$(find "$LOCK" -mmin -30 2>/dev/null)" ]; then
    LOCK=""; finish "FAILED another update runs now"
  fi
  date -u > "$LOCK"
}

# ── Docker install ───────────────────────────────────────────────────────────

update_docker() {
  local project="$3" files="$4" workdir="$5" service="$6" old_image="$7" repo="$8"
  BACKUP_DIR="$workdir/backups"
  take_lock

  local args=(-p "$project" --project-directory "$workdir")
  local f; for f in ${files//,/ }; do args+=(-f "$f"); done
  compose() { docker compose "${args[@]}" "$@"; }
  # The app's version, read in the container. Empty while it starts.
  running_version() { compose exec -T "$service" bun -e 'console.log(require("/app/package.json").version)' 2>/dev/null | tr -d '[:space:]'; }
  healthy() { compose exec -T "$service" sh -c 'curl -sf "http://localhost:${PORT:-5100}/health"' > /dev/null 2>&1; }

  local db_service
  db_service="$(compose ps --format '{{.Service}} {{.Image}}' | awk '$2 ~ /postgres/ {print $1; exit}')"
  [ -n "$db_service" ] || finish "FAILED no Postgres service in the compose project; nothing was changed"
  DB="docker compose ${args[*]} exec -T $db_service"

  local old_version; old_version="$(running_version)"
  say "Update ${old_version:-unknown} -> $TARGET (project $project, service $service)"

  say "Database backup..."
  local backup; backup="$(db_backup "${old_version:-unknown}")" || finish "FAILED the database backup failed; nothing was changed"
  say "Backup: $backup"
  local migrations_before; migrations_before="$(db_migrations)"

  # The old image keeps a name of its own, so a rollback needs no registry.
  docker tag "$old_image" "$repo:rollback" || finish "FAILED cannot tag the old image; nothing was changed"

  say "Pull $repo:$TARGET..."
  IMAGE_TAG="$TARGET" compose pull -q "$service" || finish "FAILED cannot pull $repo:$TARGET; nothing was changed"

  say "Start the new container..."
  local reason=""
  if IMAGE_TAG="$TARGET" compose up -d --no-deps "$service"; then
    local i; for i in $(seq 1 60); do
      if healthy && [ "v$(running_version)" = "$TARGET" ]; then
        # Later `docker compose up` runs must keep this version.
        if grep -q '^IMAGE_TAG=' "$workdir/.env" 2>/dev/null; then sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TARGET/" "$workdir/.env"; else echo "IMAGE_TAG=$TARGET" >> "$workdir/.env"; fi
        prune_backups
        finish "OK $TARGET"
      fi
      sleep 2
    done
    reason="the new version did not answer its health check in 120 s"
  else
    reason="docker compose could not start the new container"
  fi

  say "Roll back: $reason"
  compose stop "$service" > /dev/null 2>&1
  if [ "$(db_migrations)" != "$migrations_before" ]; then
    say "The schema changed. Restore the database from the backup..."
    db_restore "$backup" || say "WARNING: the restore failed. The backup is $backup"
  fi
  IMAGE_TAG=rollback compose up -d --no-deps --pull never "$service" || finish "FAILED $reason, and the old version did not start. Backup: $backup"
  finish "ROLLED BACK $reason"
}

# ── Host install (systemd + git checkout) ────────────────────────────────────

update_host() {
  local install_dir="$3" app="$3/app"
  BACKUP_DIR="$install_dir/backups"
  take_lock
  DB="docker exec -i remote-agent-db"
  local port="${PORT:-5100}"
  running_version() { curl -sf "http://localhost:$port/api/version" | sed -n 's/.*"current":"\([^"]*\)".*/\1/p'; }
  build() { (cd "$app" && bun install && bun run build:ui) ; }

  local old_commit; old_commit="$(git -C "$app" rev-parse HEAD)" || finish "FAILED $app is not a git checkout; nothing was changed"
  say "Update $(running_version) -> $TARGET (commit ${old_commit:0:7})"

  say "Database backup..."
  local backup; backup="$(db_backup "${old_commit:0:7}")" || finish "FAILED the database backup failed; nothing was changed"
  say "Backup: $backup"
  local migrations_before; migrations_before="$(db_migrations)"

  git -C "$app" fetch --tags --force origin || finish "FAILED git fetch failed; nothing was changed"
  git -C "$app" rev-parse -q --verify "refs/tags/$TARGET" > /dev/null || finish "FAILED the tag $TARGET does not exist; nothing was changed"

  local reason=""
  say "Check out $TARGET and build..."
  if ! git -C "$app" reset --hard "$TARGET"; then reason="git could not check out $TARGET"
  elif ! build; then reason="the build failed"
  elif ! (cd "$app" && bun run db:migrate); then reason="the database migration failed"
  else
    systemctl restart remote-agent
    local i; for i in $(seq 1 30); do
      sleep 2
      if [ "v$(running_version)" = "$TARGET" ]; then prune_backups; finish "OK $TARGET"; fi
    done
    reason="the new version did not answer in 60 s"
  fi

  say "Roll back: $reason"
  systemctl stop remote-agent
  git -C "$app" reset --hard "$old_commit" && build
  if [ "$(db_migrations)" != "$migrations_before" ]; then
    say "The schema changed. Restore the database from the backup..."
    db_restore "$backup" || say "WARNING: the restore failed. The backup is $backup"
  fi
  systemctl start remote-agent || finish "FAILED $reason, and the old version did not start. Backup: $backup"
  finish "ROLLED BACK $reason"
}

case "$MODE" in
  docker) [ $# -eq 8 ] || finish "FAILED wrong arguments"; update_docker "$@" ;;
  host)   [ $# -eq 3 ] || finish "FAILED wrong arguments"; update_host "$@" ;;
  *)      finish "FAILED unknown mode $MODE" ;;
esac
