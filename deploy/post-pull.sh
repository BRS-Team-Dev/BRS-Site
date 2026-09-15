#!/usr/bin/env bash
# ----------------------------------------------------------------------
# cms/deploy/post-pull.sh — server-side post-deploy hook.
#
# Runs on the Hostinger host after the artifact-branch git pull. Bundled
# into every artifact (the CI Assemble step copies cms/ into the artifact
# tree, so this script lands at <docroot>/cc/deploy/post-pull.sh on prod
# and <docroot>/cc/deploy/post-pull.sh on dev).
#
# The cron job should call it immediately after the pull, e.g.:
#
#   cd /home/<user>/public_html/cc && \
#     git pull --ff-only && \
#     bash deploy/post-pull.sh >> deploy.log 2>&1
#
# Everything in here MUST be idempotent — the cron runs every few minutes
# and a no-op pull should produce a no-op script run.
# ----------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[post-pull] $(date -u +'%Y-%m-%dT%H:%M:%SZ') from $ROOT"

# --- Migrations ---------------------------------------------------------
# The runner is idempotent + checksum-guarded; it only applies migrations
# whose version hasn't been recorded yet. Safe to invoke on every pull.
# `db/migrate.php` resolves DB creds from ../api/config.php (.env loader),
# so dev vs prod targets the right database automatically.
if [ -f db/migrate.php ]; then
  echo "[post-pull] applying migrations…"
  php db/migrate.php
else
  echo "[post-pull] db/migrate.php missing — skipping migrations"
fi

# --- Composer (artifact already ships vendor/, but re-run as belt-and- ---
# braces in case CI ever emits a slim artifact). Only runs when vendor/
# is missing so the normal path is a no-op.
if [ -d api ] && [ ! -d api/vendor ]; then
  echo "[post-pull] api/vendor missing — running composer install"
  ( cd api && composer install --no-dev --optimize-autoloader --no-interaction --no-progress )
fi

# --- File permissions on writable dirs ----------------------------------
# uploads/ and storage/ are runtime-writable. The artifact ships them
# empty (or missing) — make sure they exist and are owner-writable.
mkdir -p uploads storage
chmod -R u+rwX uploads storage 2>/dev/null || true

echo "[post-pull] done"
