#!/bin/bash
# Docker Setup Script für SubCaster

set -e

echo "🐳 SubCaster Docker Setup"
echo "=========================="
echo ""

# Prüfe ob Docker installiert ist
if ! command -v docker &> /dev/null; then
    echo "❌ Docker ist nicht installiert!"
    echo "   Bitte installiere Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# Prüfe ob Docker Compose installiert ist
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose ist nicht installiert!"
    echo "   Bitte installiere Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker und Docker Compose gefunden"
echo ""

# Erstelle docker-data Verzeichnis
if [ ! -d "docker-data" ]; then
    echo "📁 Erstelle docker-data Verzeichnis..."
    mkdir -p docker-data
    echo "✅ docker-data Verzeichnis erstellt"
else
    echo "✅ docker-data Verzeichnis existiert bereits"
fi

# Prüfe ob .env existiert
if [ ! -f ".env" ]; then
    echo "⚠️  Keine .env Datei gefunden!"
    echo "   Bitte erstelle eine .env Datei oder kopiere .env.example"
    exit 1
fi

# Kopiere .env nach docker-data wenn nicht vorhanden
if [ ! -f "docker-data/.env" ]; then
    echo "📄 Kopiere .env nach docker-data/..."
    cp .env docker-data/.env
    echo "✅ .env nach docker-data/ kopiert"
else
    echo "⚠️  docker-data/.env existiert bereits"
    read -p "   Überschreiben mit aktueller .env? (j/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Jj]$ ]]; then
        cp .env docker-data/.env
        echo "✅ docker-data/.env überschrieben"
    else
        echo "ℹ️  Behalte existierende docker-data/.env"
    fi
fi

echo ""
echo "🔍 Prüfe wichtige Umgebungsvariablen in docker-data/.env..."

# Prüfe Discord Token
if grep -q "VITE_DISCORD_BOT_TOKEN=" docker-data/.env && ! grep -q "VITE_DISCORD_BOT_TOKEN=$" docker-data/.env; then
    echo "✅ Discord Bot Token gesetzt"
else
    echo "⚠️  Discord Bot Token fehlt oder ist leer"
fi

# Prüfe Discord Channel ID
if grep -q "VITE_DISCORD_CHANNEL_ID=" docker-data/.env && ! grep -q "VITE_DISCORD_CHANNEL_ID=$" docker-data/.env; then
    echo "✅ Discord Channel ID gesetzt"
else
    echo "⚠️  Discord Channel ID fehlt oder ist leer"
fi

# Prüfe OpenSubsonic URL
if grep -q "VITE_OPENSUBSONIC_URL=" docker-data/.env && ! grep -q "VITE_OPENSUBSONIC_URL=$" docker-data/.env; then
    echo "✅ OpenSubsonic URL gesetzt"
else
    echo "⚠️  OpenSubsonic URL fehlt oder ist leer"
fi

echo ""
echo "🚀 Starte Docker Container..."
docker-compose up --build -d

echo ""
echo "✅ SubCaster wurde gestartet!"
echo ""
echo "📊 Status prüfen:"
echo "   docker-compose ps"
echo ""
echo "📝 Logs anzeigen:"
echo "   docker-compose logs -f"
echo ""
echo "🌐 Öffne im Browser:"
echo "   http://localhost:3002"
echo ""
echo "🛑 Container stoppen:"
echo "   docker-compose down"
echo ""
