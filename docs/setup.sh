#!/usr/bin/env bash
set -euo pipefail
cd /workspace/myblog
npm ci --cache /workspace/.cache/npm
npm test
npm run build
