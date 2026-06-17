#!/bin/bash
set -e

echo "🔨 Building Pulse for Render..."
echo "PWD: $PWD"
echo "Files: $(ls -la | head -5)"
echo ""

# Install dependencies WITH devDependencies even if NODE_ENV=production
unset NODE_ENV
pnpm install --prod=false

# Build the web app
pnpm --filter @pulse/web build

echo "✅ Build complete!"
