#!/bin/bash
# Docker-Start Script mit automatischer Permission-Fix
# Stelle sicher, dass docker-data/ Volume beschreibbar ist

set -e

echo "🔧 Preparing Docker environment..."

# 1. Create docker-data directory if it doesn't exist
if [ ! -d "docker-data" ]; then
  echo "📁 Creating docker-data directory..."
  mkdir -p docker-data
fi

# 2. Set permissions for docker-data (readable/writable for container UID 1001)
echo "🔐 Setting permissions for docker-data..."
chmod 777 docker-data

# 3. Create .env template if it doesn't exist
if [ ! -f "docker-data/.env" ]; then
  echo "📝 Creating .env template..."
  cat > docker-data/.env << 'EOF'
# SubCaster Docker Environment Configuration
# This file will be created/updated by the Setup Wizard

# Discord Wishbox (optional)
DISCORD_BOT_TOKEN=
VITE_DISCORD_CHANNEL_ID=
VITE_DISCORD_GUILD_ID=

# OpenSubsonic
VITE_OPENSUBSONIC_URL=
OPENSUBSONIC_USERNAME=
OPENSUBSONIC_PASSWORD=

# AzuraCast
VITE_AZURACAST_SERVERS=
VITE_AZURACAST_STATION_ID=1
AZURACAST_DJ_USERNAME=
AZURACAST_DJ_PASSWORD=

# Unified Login
VITE_USE_UNIFIED_LOGIN=false
UNIFIED_USERNAME=
UNIFIED_PASSWORD=

# Stream Settings
VITE_STREAM_BITRATE=128
VITE_STREAM_SAMPLE_RATE=44100
VITE_DECK_CONFIGURATION=four-decks

# Proxy Port
PROXY_PORT=3001
EOF
  chmod 666 docker-data/.env
fi

# 4. Pull latest changes
echo "🔄 Pulling latest changes..."
git pull

# 5. Stop existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# 6. Build and start with no-cache to ensure fresh build
echo "🏗️  Building Docker image..."
docker-compose build --no-cache

echo "🚀 Starting SubCaster..."
docker-compose up -d

echo ""
echo "✅ SubCaster is starting!"
echo "📍 Access at: http://localhost:3002"
echo "📋 View logs: docker-compose logs -f"
echo "🔧 Setup Wizard will guide you through configuration"
echo ""
