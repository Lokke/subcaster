@echo off
REM Docker-Start Script für Windows mit Permission-Fix
REM Stelle sicher, dass docker-data/ Volume beschreibbar ist

echo 🔧 Preparing Docker environment...

REM 1. Create docker-data directory if it doesn't exist
if not exist "docker-data" (
  echo 📁 Creating docker-data directory...
  mkdir docker-data
)

REM 2. Create .env template if it doesn't exist
if not exist "docker-data\.env" (
  echo 📝 Creating .env template...
  (
    echo # SubCaster Docker Environment Configuration
    echo # This file will be created/updated by the Setup Wizard
    echo.
    echo # Discord Wishbox ^(optional^)
    echo DISCORD_BOT_TOKEN=
    echo VITE_DISCORD_CHANNEL_ID=
    echo VITE_DISCORD_GUILD_ID=
    echo.
    echo # OpenSubsonic
    echo VITE_OPENSUBSONIC_URL=
    echo OPENSUBSONIC_USERNAME=
    echo OPENSUBSONIC_PASSWORD=
    echo.
    echo # AzuraCast
    echo VITE_AZURACAST_SERVERS=
    echo VITE_AZURACAST_STATION_ID=1
    echo AZURACAST_DJ_USERNAME=
    echo AZURACAST_DJ_PASSWORD=
    echo.
    echo # Unified Login
    echo VITE_USE_UNIFIED_LOGIN=false
    echo UNIFIED_USERNAME=
    echo UNIFIED_PASSWORD=
    echo.
    echo # Stream Settings
    echo VITE_STREAM_BITRATE=128
    echo VITE_STREAM_SAMPLE_RATE=44100
    echo VITE_DECK_CONFIGURATION=four-decks
    echo.
    echo # Proxy Port
    echo PROXY_PORT=3001
  ) > docker-data\.env
)

REM 3. Pull latest changes
echo 🔄 Pulling latest changes...
git pull

REM 4. Stop existing containers
echo 🛑 Stopping existing containers...
docker-compose down

REM 5. Build and start
echo 🏗️  Building Docker image...
docker-compose build --no-cache

echo 🚀 Starting SubCaster...
docker-compose up -d

echo.
echo ✅ SubCaster is starting!
echo 📍 Access at: http://localhost:3002
echo 📋 View logs: docker-compose logs -f
echo 🔧 Setup Wizard will guide you through configuration
echo.

pause
