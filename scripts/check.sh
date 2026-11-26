#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ ! -d node_modules ]]; then
  pnpm install --frozen-lockfile
fi
pnpm biome check .
pnpm -r typecheck
pnpm -r test
pnpm test:docker
pnpm --filter @nanogent/web test:smoke
echo 'CHECK OK'
