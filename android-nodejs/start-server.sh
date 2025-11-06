#!/bin/bash

# Android Node.js Server Startup Script
# This script starts the unified-server on Android using nodejs-mobile

echo "🚀 Starting SubCaster Server on Android..."

# Set environment variables
export NODE_ENV=production
export PORT=3000

# Start unified-server
cd "$(dirname "$0")/.."
node unified-server.js &

echo "✅ Server started on port 3000"
echo "📱 SubCaster is ready!"
