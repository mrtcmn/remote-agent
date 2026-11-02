---
name: release
description: Cut a Remote Agent server release - a GitHub release (vX.Y.Z) on main that makes the Docker workflow push versioned ghcr.io images, so /api/version, the UpdateBanner, and scripts/upgrade.sh see an update. Use when the user says "release", "cut a release", "publish a version", or "ship vX.Y.Z". Not for the desktop (Electrobun) app.
---

# Release

The update check (`packages/api/src/routes/version.routes.ts`) and `scripts/upgrade.sh` read
`api.github.com/repos/mrtcmn/remote-agent/releases/latest`. With no release, both report
"Could not fetch latest version". A release fixes that.

## How the pipeline works

- `.github/workflows/docker-publish.yml` runs on the `release: published` event.
- It builds with `VERSION=<tag>`. The Dockerfile bakes that into `APP_VERSION`.
- It pushes `ghcr.io/mrtcmn/remote-agent:vX.Y.Z`, `:X.Y`, and `:X`. It does not move `:latest`. Only a push to main moves `:latest`.
- `isNewerVersion` compares only numeric tags. Use `vX.Y.Z` exactly. A tag like `v1.3.0-rc1` never counts as an update.

## Steps

Confirm the version and the target commit with the user before step 4. A release is public and pushes images.

1. Make sure the work is on `main`: `git fetch origin && git log origin/main --oneline -5`.
2. Find the last release: `gh release list -R mrtcmn/remote-agent -L 5`. Pick the next semver.
3. Make sure the last main run is green: `gh run list -R mrtcmn/remote-agent -L 3`.
4. Create the release:
   ```bash
   gh release create vX.Y.Z -R mrtcmn/remote-agent --target main --generate-notes
   ```
5. Watch the workflow: `gh run watch -R mrtcmn/remote-agent $(gh run list -R mrtcmn/remote-agent -e release -L 1 --json databaseId -q '.[0].databaseId')`.
6. Verify:
   ```bash
   curl -s https://api.github.com/repos/mrtcmn/remote-agent/releases/latest | jq .tag_name
   docker buildx imagetools inspect ghcr.io/mrtcmn/remote-agent:vX.Y.Z
   ```

## If the workflow fails

- `No space left on device` on the ARM64 self-hosted runner: the build cache filled the disk. The workflow runs `docker buildx prune -af` first. If it still fails, old images fill the disk. Ask the user before you prune images on that host.
- Rerun the failed jobs: `gh run rerun <id> --failed -R mrtcmn/remote-agent`. Do not delete and re-create the release for a CI failure.
