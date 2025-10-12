# Docker Setup für SubCaster

## Voraussetzungen

- Docker und Docker Compose installiert
- Git installiert

## Erste Installation

1. **Repository klonen:**

```bash
git clone https://github.com/Lokke/subcaster.git
cd subcaster
```

2. **Docker-Data Verzeichnis erstellen:**

```bash
mkdir -p docker-data
```

3. **.env Datei vorbereiten:**

```bash
# Erstelle .env im Projektverzeichnis mit deinen Credentials
nano .env
# ODER kopiere eine existierende .env
# cp /path/to/your/.env .env

# Kopiere auch nach docker-data/ für Runtime
cp .env docker-data/.env
```

**WICHTIG:** 

- Die `.env` im **Root** wird für den **Build** benötigt (VITE_ Variablen werden eingebettet!)
- Die `.env` in `docker-data/` wird für die **Runtime** gemountet (Server-Variablen)

4. **Container bauen und starten:**

```bash
docker-compose up --build -d
```

5. **Logs überprüfen:**

```bash
docker-compose logs -f
```

Du solltest sehen:

```
Discord Bot Token: ✅ Set
Discord Channel ID: ✅ Set
```

## Updates durchführen

```bash
# Container stoppen
docker-compose down

# Neuesten Code pullen
git pull

# .env MUSS vorhanden sein für Build-Args!
# Prüfe ob .env existiert:
ls -la .env docker-data/.env

# Container neu bauen und starten
docker-compose up --build -d
```

**WICHTIG:** Die `.env`-Datei in `docker-data/.env` bleibt erhalten und wird automatisch geladen!

## Konfiguration ändern

1. **Editiere die .env im docker-data Verzeichnis:**

```bash
nano docker-data/.env
```

2. **Container neu starten:**

```bash
docker-compose restart
```

## Environment Variables

Die folgenden Variablen müssen in `docker-data/.env` gesetzt werden:

### Discord Wishbox (Wunschbox)

```env
VITE_DISCORD_BOT_TOKEN=dein_discord_bot_token
VITE_DISCORD_CHANNEL_ID=dein_channel_id
VITE_DISCORD_GUILD_ID=deine_server_id
```

### OpenSubsonic (Musikbibliothek)

```env
VITE_OPENSUBSONIC_URL=https://dein-server.de
VITE_OPENSUBSONIC_USERNAME=dein_username
VITE_OPENSUBSONIC_PASSWORD=dein_passwort
```

### AzuraCast (Streaming)

```env
VITE_AZURACAST_SERVERS=https://dein-azuracast-server.de
VITE_AZURACAST_STATION_ID=1
VITE_AZURACAST_DJ_USERNAME=dein_dj_username
VITE_AZURACAST_DJ_PASSWORD=dein_dj_passwort
```

### Streaming Server

```env
STREAM_SERVER=dein-streaming-server.de
STREAM_PORT=8000
STREAM_USERNAME=source
STREAM_PASSWORD=dein_stream_passwort
```

## Troubleshooting

### Wunschbox funktioniert nicht

1. **Prüfe ob die .env-Datei im Container geladen wird:**

```bash
docker-compose logs | grep "Discord Bot Token"
```

Du solltest sehen: `Discord Bot Token: ✅ Set`

2. **Prüfe ob die .env-Datei existiert:**

```bash
ls -la docker-data/.env
```

3. **Prüfe die .env im Container:**

```bash
docker exec -it subcaster cat /app/docker-data/.env
```

### Container startet nicht

```bash
# Logs anschauen
docker-compose logs

# Container Status prüfen
docker-compose ps

# Container neu bauen (ohne Cache)
docker-compose build --no-cache
docker-compose up -d
```

### Port bereits belegt

Ändere den Port in `docker-compose.yml`:

```yaml
ports:
  - "3003:3001"  # Ändere 3002 zu einem freien Port
```

## Datenstruktur

```
subcaster/
├── docker-data/           # Persistente Daten (wird nicht committet)
│   └── .env              # Deine Konfiguration
├── dist/                  # Build-Artefakte
├── src/                   # Source Code
├── docker-compose.yml     # Docker Compose Konfiguration
├── Dockerfile.production  # Production Dockerfile
└── unified-server.js      # Node.js Server
```

## Sicherheit

⚠️ **WICHTIG:** 

- Das `docker-data/` Verzeichnis ist in `.gitignore` und wird nicht committet
- Committe NIEMALS deine `.env`-Datei mit Tokens und Passwörtern
- Nutze `.env.example` als Vorlage für neue Installationen
