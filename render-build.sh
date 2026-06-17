#!/bin/bash
set -e

echo "🔨 Building Pulse for Render..."
echo ""

# Install dependencies WITH devDependencies even if NODE_ENV=production
export NODE_ENV=
pnpm install --frozen-lockfile --prod=false

# Build the web app
pnpm --filter @pulse/web build

echo "✅ Build complete!"
