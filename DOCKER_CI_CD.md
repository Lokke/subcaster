# Docker CI/CD & Auto-Update System für SubCaster

## 🔄 Auto-Update Architektur

SubCaster bietet ein intelligentes Update-System mit mehreren Ebenen:

### Version Tracking
- **Build-Time:** Git Commit SHA wird beim Docker-Build ins Image gebacken
- **Runtime:** Version ist über `/api/version` endpoint verfügbar
- **Frontend:** Prüft alle 60 Sekunden auf neue Versionen

### Update Detection & User Notification
- **Check-Interval:** Alle 60 Sekunden
- **Methode:** Frontend fragt `/api/version` ab und vergleicht Git Commit SHA
- **Banner:** Gradient-Banner erscheint am oberen Bildschirmrand mit Optionen:
  - ✅ "Jetzt neu laden" → Sofortiges Page Reload
  - ⏭️ "Später" → Banner wird ausgeblendet, erscheint nach 5 Minuten wieder
- **Auto-Dismiss:** Banner wird nach 30 Sekunden transparent

## ✅ ENV-Variablen zur Laufzeit

Die ENV-Variablen werden **zur Laufzeit** vom Container geladen, nicht beim Build:
- ✅ Du kannst sie in `docker-compose.yml` setzen
- ✅ Du kannst sie in Portainer setzen
- ✅ Du kannst sie in einer `.env` Datei speichern
- ✅ Das Docker Image ist universell und passt sich an deine Umgebung an

## GitHub Actions Setup

### 1. GitHub Container Registry aktivieren

Die Workflow-Datei `.github/workflows/docker-build.yml` ist bereits konfiguriert!

**Was passiert:**
- Bei jedem `git push` auf `main` wird automatisch ein Docker Image gebaut
- Das Image wird zu `ghcr.io/lokke/subcaster:latest` gepusht
- Zusätzliche Tags: Branch-Name und Git-SHA

### 2. GitHub Packages Berechtigungen

Die Actions haben bereits `packages: write` Permission durch `GITHUB_TOKEN`.

### 3. Image pullen

```bash
# Image von GitHub Container Registry pullen
docker pull ghcr.io/lokke/subcaster:latest
```

## ENV-Variablen Konfiguration

### Variante 1: Docker Compose mit .env Datei

1. Erstelle eine `.env` Datei im Projekt-Root:

```env
# Discord Bot
VITE_DISCORD_BOT_TOKEN=your_discord_bot_token
VITE_DISCORD_CHANNEL_ID=your_channel_id
VITE_DISCORD_GUILD_ID=your_guild_id

# OpenSubsonic
VITE_OPENSUBSONIC_URL=https://musik.example.com
VITE_OPENSUBSONIC_USERNAME=your_username
VITE_OPENSUBSONIC_PASSWORD=your_password

# AzuraCast
VITE_AZURACAST_SERVERS=https://radio.example.com
VITE_AZURACAST_STATION_ID=1
VITE_AZURACAST_DJ_USERNAME=dj_user
VITE_AZURACAST_DJ_PASSWORD=dj_pass

# Stream Settings
VITE_STREAM_BITRATE=128
VITE_STREAM_SAMPLE_RATE=44100
VITE_DECK_CONFIGURATION=2

# Unified Login (optional)
VITE_USE_UNIFIED_LOGIN=false
VITE_UNIFIED_USERNAME=
VITE_UNIFIED_PASSWORD=
```

2. Starte mit dem GHCR Image:

```bash
docker-compose -f docker-compose.ghcr.yml up -d
```

### Variante 2: Portainer Stack

1. Gehe zu **Stacks** → **Add Stack**
2. Name: `subcaster`
3. Füge diese Docker Compose Configuration ein:

```yaml
version: '3.8'

services:
  subcaster:
    image: ghcr.io/lokke/subcaster:latest
    container_name: subcaster
    ports:
      - "3002:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
      - DOCKER_ENV=true
      # Discord Bot
      - VITE_DISCORD_BOT_TOKEN=${VITE_DISCORD_BOT_TOKEN}
      - VITE_DISCORD_CHANNEL_ID=${VITE_DISCORD_CHANNEL_ID}
      - VITE_DISCORD_GUILD_ID=${VITE_DISCORD_GUILD_ID}
      # OpenSubsonic
      - VITE_OPENSUBSONIC_URL=${VITE_OPENSUBSONIC_URL}
      - VITE_OPENSUBSONIC_USERNAME=${VITE_OPENSUBSONIC_USERNAME}
      - VITE_OPENSUBSONIC_PASSWORD=${VITE_OPENSUBSONIC_PASSWORD}
      # AzuraCast
      - VITE_AZURACAST_SERVERS=${VITE_AZURACAST_SERVERS}
      - VITE_AZURACAST_STATION_ID=${VITE_AZURACAST_STATION_ID}
      - VITE_AZURACAST_DJ_USERNAME=${VITE_AZURACAST_DJ_USERNAME}
      - VITE_AZURACAST_DJ_PASSWORD=${VITE_AZURACAST_DJ_PASSWORD}
      # Stream Settings
      - VITE_STREAM_BITRATE=${VITE_STREAM_BITRATE}
      - VITE_STREAM_SAMPLE_RATE=${VITE_STREAM_SAMPLE_RATE}
      - VITE_DECK_CONFIGURATION=${VITE_DECK_CONFIGURATION}
      # Unified Login (optional)
      - VITE_USE_UNIFIED_LOGIN=${VITE_USE_UNIFIED_LOGIN}
      - VITE_UNIFIED_USERNAME=${VITE_UNIFIED_USERNAME}
      - VITE_UNIFIED_PASSWORD=${VITE_UNIFIED_PASSWORD}
    restart: unless-stopped
    volumes:
      - ./docker-data:/app/docker-data
```

4. Klicke auf **Environment Variables** und füge alle Werte ein
5. Deploy!

### Variante 3: Docker CLI mit ENV-Variablen

```bash
docker run -d \
  --name subcaster \
  -p 3002:3001 \
  -e NODE_ENV=production \
  -e VITE_DISCORD_BOT_TOKEN="your_token" \
  -e VITE_OPENSUBSONIC_URL="https://musik.example.com" \
  -e VITE_OPENSUBSONIC_USERNAME="user" \
  -e VITE_OPENSUBSONIC_PASSWORD="pass" \
  --restart unless-stopped \
  ghcr.io/lokke/subcaster:latest
```

## Workflow: Automatisches Update

1. **Code ändern** → `git commit` → `git push`
2. **GitHub Actions** baut automatisch neues Image
3. **Auf Server**: Pull + Restart

```bash
# Image pullen
docker pull ghcr.io/lokke/subcaster:latest

# Container neu starten (ENV-Variablen bleiben erhalten!)
docker-compose -f docker-compose.ghcr.yml down
docker-compose -f docker-compose.ghcr.yml up -d
```

### Auto-Update Script (Optional)

Erstelle `update-subcaster.sh`:

```bash
#!/bin/bash
echo "🔄 Pulling latest image..."
docker pull ghcr.io/lokke/subcaster:latest

echo "🛑 Stopping old container..."
docker-compose -f docker-compose.ghcr.yml down

echo "🚀 Starting new container..."
docker-compose -f docker-compose.ghcr.yml up -d

echo "✅ Update complete!"
docker ps | grep subcaster
```

```bash
chmod +x update-subcaster.sh
./update-subcaster.sh
```

## Wichtig: ENV-Variablen im Build vs Runtime

### ❌ Build-Time (Dockerfile ARG)
- Werden beim `docker build` fest eingebacken
- Können später **nicht** geändert werden
- Nur für öffentliche Werte!

### ✅ Runtime (Docker ENV)
- Werden beim `docker run` / `docker-compose up` gesetzt
- Können **jederzeit** geändert werden (Container restart nötig)
- **Dein Setup verwendet Runtime ENVs** → Flexibel! 🎉

## Troubleshooting

### Image ist private?

Falls das Image private ist, musst du dich einloggen:

```bash
# GitHub Personal Access Token mit `read:packages` permission
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
```

### ENV-Variablen werden nicht geladen?

1. Prüfe `.env` Datei Format (keine Anführungszeichen nötig)
2. Restart Container: `docker-compose restart subcaster`
3. Logs checken: `docker logs subcaster`

### Build schlägt fehl?

- Prüfe GitHub Actions Logs unter **Actions** Tab
- Stelle sicher dass `Dockerfile.production` existiert
- Branch muss `main` oder `master` heißen (oder ändere Workflow)

## Zusammenfassung

✅ **Bei jedem Commit** wird automatisch ein Docker Image gebaut
✅ **ENV-Variablen** können in Docker Compose/Portainer gesetzt werden
✅ **Nach dem Build** kannst du ENV-Variablen ändern (Container restart)
✅ **Kein Rebuild nötig** für ENV-Änderungen!

🎯 **Perfect Setup für Production!**

---

## 🚀 Deployment-Optionen

### Option A: Nur Frontend-Notification (Standard)

User bekommt Update-Banner und kann manuell neu laden.

```bash
# Standard docker-compose
docker-compose -f docker-compose.env.yml up -d
```

**Vorteil:** User behält Kontrolle  
**Nachteil:** Manuelles Pullen des Images nötig

### Option B: Mit Watchtower (Automatisch)

Container updated sich automatisch und User bekommt Notification.

```bash
# Mit Auto-Update
docker-compose -f docker-compose.autoupdate.yml up -d
```

**Vorteil:** Komplett automatisch  
**Nachteil:** Container-Restarts können laufende Sessions unterbrechen

## ⚙️ Watchtower Konfiguration

### Standard-Einstellungen

- **Check-Interval:** Alle 5 Minuten
- **Cleanup:** Alte Images werden gelöscht
- **Label-basiert:** Nur Container mit `com.centurylinklabs.watchtower.enable=true`

### Anpassen

```yaml
environment:
  # Intervall in Sekunden (300 = 5 Minuten)
  - WATCHTOWER_POLL_INTERVAL=300
  
  # Nur zu bestimmten Zeiten updaten (Cron-Format)
  # - WATCHTOWER_SCHEDULE=0 0 4 * * *  # Jeden Tag um 4 Uhr
  
  # Discord Notifications
  # - WATCHTOWER_NOTIFICATION_URL=discord://webhook_id/webhook_token
```

## 🔐 GitHub Container Registry Access

Für private Repositories muss Watchtower Zugriff auf GHCR haben:

```bash
# GitHub Personal Access Token erstellen mit 'read:packages'
# https://github.com/settings/tokens

# Docker Login
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Watchtower verwendet automatisch ~/.docker/config.json
```

## 🧪 Testing & Troubleshooting

### Version anzeigen

```bash
# Im laufenden Container
docker exec subcaster env | grep -E "(APP_VERSION|GIT_COMMIT|BUILD_DATE)"
```

### Update simulieren

```bash
# Code ändern und pushen
git add .
git commit -m "Test update"
git push

# Warten bis Build fertig (~3-5 Min)
# Frontend-Banner sollte nach 1-2 Minuten erscheinen
```

### Watchtower Logs

```bash
docker logs -f subcaster-watchtower
```

### "Update-Banner erscheint nicht"

```bash
# Prüfe ob Version-Endpoint funktioniert
curl http://localhost:3002/api/version

# Prüfe Browser Console (F12)
# Sollte sehen: "🔄 Starting update checker service..."
```

### "Watchtower updated nicht"

```bash
# Prüfe Watchtower Logs
docker logs subcaster-watchtower

# Manuelles Update forcieren
docker exec subcaster-watchtower watchtower --run-once
```

### "Container startet nach Update nicht"

```bash
# Prüfe Logs
docker logs subcaster

# Zurück zur vorherigen Version
docker-compose down
docker pull ghcr.io/lokke/subcaster:main-PREVIOUS_SHA
docker-compose up -d
```

## 🎯 Best Practices

### Für Entwickler

- ✅ Semantic Versioning in Git Tags verwenden
- ✅ Changelog führen für User
- ✅ Breaking Changes klar kommunizieren

### Für Deployment

- ✅ Health Checks aktivieren (Container-Restart safe)
- ✅ Watchtower außerhalb der Hauptzeiten laufen lassen
- ✅ Backup-Strategie für persistente Daten

### Für User

- ✅ Banner nicht ignorieren (Security-Updates!)
- ✅ Laufende Streams vor Update beenden
- ✅ Browser-Cache bei Problemen löschen
