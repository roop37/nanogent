#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

database_url=${NANOGENT_DATABASE_URL:-}
unset NANOGENT_DATABASE_URL

if [[ -z "$database_url" ]]; then
  if [[ ! -t 0 ]]; then
    printf 'Set NANOGENT_DATABASE_URL or run pnpm db:migrate from an interactive terminal.\n' >&2
    exit 1
  fi
  printf 'Paste the target PostgreSQL connection string: ' >&2
  if ! IFS= read -rs database_url; then
    printf '\nMigration canceled.\n' >&2
    exit 1
  fi
  printf '\n' >&2
fi

case "$database_url" in
  postgres://*|postgresql://*) ;;
  *)
    printf 'Expected a PostgreSQL connection string.\n' >&2
    exit 1
    ;;
esac

pnpm --filter @nanogent/core build
pnpm --filter @nanogent/store build
NANOGENT_DATABASE_URL="$database_url" exec node packages/store/dist/pg/migrate.js
