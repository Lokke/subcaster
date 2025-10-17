# 🐳 SubCaster Docker Compose Deployment

Es gibt **3 Varianten** zum Starten von SubCaster mit Docker:

## 📋 Übersicht der Varianten

| Datei | Beschreibung | Verwendung |
|-------|-------------|------------|
| `docker-compose.production.yml` | **Standalone** - Alle ENV-Variablen direkt im File | Für Server ohne .env Datei (z.B. Portainer) |
| `docker-compose.env.yml` | **Mit .env** - Lädt Variablen aus .env | Für lokale/Server-Deployments mit .env |
| `docker-compose.ghcr.yml` | **Minimal** - Nur Basis-Config | Einfache Variante, selbst konfigurieren |

---

## 🚀 Variante 1: Production (Standalone)

**Vorteile:**
- ✅ Funktioniert ohne .env Datei
- ✅ Perfekt für Portainer/Remote Server
- ✅ Alle Werte sichtbar im Compose File

**Verwendung:**

1. **Öffne `docker-compose.production.yml`**

2. **Ersetze alle Platzhalter:**
   ```yaml
   # Suche nach "your_*" und ersetze:
   - UNIFIED_USERNAME=your_unified_username     # ← Ersetzen!
   - UNIFIED_PASSWORD=your_unified_password     # ← Ersetzen!
   - OPENSUBSONIC_USERNAME=your_opensubsonic_username  # ← Ersetzen!
   # ... usw.
   ```

3. **Starte:**
   ```bash
   docker-compose -f docker-compose.production.yml up -d
   ```

4. **Logs checken:**
   ```bash
   docker logs -f subcaster
   ```

5. **Update:**
   ```bash
   docker-compose -f docker-compose.production.yml pull
   docker-compose -f docker-compose.production.yml up -d
   ```

---

## 🔐 Variante 2: Mit .env Datei (Empfohlen für Server)

**Vorteile:**
- ✅ Secrets nicht direkt im Compose File
- ✅ Einfach zu updaten (.env editieren + restart)
- ✅ .env wird nicht committed (in .gitignore)

**Verwendung:**

1. **Stelle sicher dass `.env` existiert und korrekt ist**
   ```bash
   cat .env  # Linux/Mac
   type .env # Windows
   ```

2. **Starte:**
   ```bash
   docker-compose -f docker-compose.env.yml up -d
   ```

3. **ENV-Variablen ändern:**
   ```bash
   # Editiere .env
   nano .env
   
   # Restart Container (lädt neue Werte)
   docker-compose -f docker-compose.env.yml restart
   ```

---

## 🎯 Variante 3: Minimal (GHCR)

**Vorteile:**
- ✅ Minimale Konfiguration
- ✅ Flexibel anpassbar

**Verwendung:**

```bash
docker-compose -f docker-compose.ghcr.yml up -d
```

**Hinweis:** Du musst ENV-Variablen manuell in die Datei einfügen!

---

## 📦 Portainer Setup

### Option A: Production File (Empfohlen)

1. **Stacks** → **Add Stack**
2. **Name:** `subcaster`
3. **Web Editor:** Kopiere Inhalt von `docker-compose.production.yml`
4. **Ersetze alle `your_*` Platzhalter** im Editor
5. **Deploy!**

### Option B: Mit .env

1. **Stacks** → **Add Stack**
2. **Name:** `subcaster`
3. **Web Editor:** Kopiere Inhalt von `docker-compose.env.yml`
4. **Environment Variables** → Füge alle aus `.env` ein:
   ```
   DISCORD_BOT_TOKEN=MTQyNjAwMjg0ODE0NzE4MTYzOA.GXkUTk...
   VITE_DISCORD_CHANNEL_ID=927495125888794634
   VITE_DISCORD_GUILD_ID=785932996406280192
   # ... usw.
   ```
5. **Deploy!**

---

## 🔄 Updates

### Automatisches Update Script

Erstelle `update-subcaster.sh`:

```bash
#!/bin/bash
COMPOSE_FILE="docker-compose.production.yml"  # Oder env.yml

echo "🔄 Pulling latest image..."
docker-compose -f $COMPOSE_FILE pull

echo "🛑 Stopping old container..."
docker-compose -f $COMPOSE_FILE down

echo "🚀 Starting new container..."
docker-compose -f $COMPOSE_FILE up -d

echo "✅ Update complete!"
docker ps | grep subcaster
```

```bash
chmod +x update-subcaster.sh
./update-subcaster.sh
```

---

## 🐛 Troubleshooting

### Container startet nicht

```bash
# Logs ansehen
docker logs subcaster

# Detaillierte Logs
docker-compose -f docker-compose.production.yml logs -f
```

### ENV-Variablen werden nicht geladen

```bash
# Prüfe ENV im laufenden Container
docker exec subcaster env | grep VITE

# Container neu starten (lädt ENVs neu)
docker-compose -f docker-compose.production.yml restart
```

### Image kann nicht gepullt werden

```bash
# Login zu GitHub Container Registry
echo "YOUR_GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USERNAME --password-stdin

# Dann nochmal pullen
docker pull ghcr.io/lokke/subcaster:latest
```

### Port bereits belegt

Ändere den Host-Port in der Compose-Datei:
```yaml
ports:
  - "3003:3001"  # Statt 3002 → 3003 verwenden
```

---

## 📊 Nützliche Befehle

```bash
# Status checken
docker ps | grep subcaster

# Logs ansehen (live)
docker logs -f subcaster

# Container neu starten
docker restart subcaster

# Container stoppen
docker stop subcaster

# Container löschen (Daten bleiben erhalten)
docker rm subcaster

# Kompletter Neustart
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml up -d

# Health check manuell
docker exec subcaster wget -qO- http://localhost:3001/health
```

---

## 🔒 Sicherheitshinweise

### ⚠️ WICHTIG: ENV-Variablen Sicherheit

**VITE_* Variablen:**
- ✅ Werden ins JavaScript eingebaut
- ✅ Im Browser sichtbar (DevTools)
- ✅ Können öffentlich sein (URLs, IDs, Settings)

**Ohne VITE_:**
- ❌ Bleiben auf dem Server
- ❌ Nicht im Browser sichtbar
- ❌ NUR für Secrets (Tokens, Passwörter)

**Beispiel:**
```yaml
# ❌ FALSCH - Token wäre im Browser sichtbar!
- VITE_DISCORD_BOT_TOKEN=geheim123

# ✅ RICHTIG - Token bleibt auf Server
- DISCORD_BOT_TOKEN=geheim123
```

### 🔐 .env Datei schützen

```bash
# .env sollte NIEMALS committed werden!
# Prüfe .gitignore:
cat .gitignore | grep .env

# Ausgabe sollte sein:
# .env
# .env.local
# .env.*
```

---

## 🎉 Fertig!

SubCaster sollte jetzt laufen unter:
```
http://your-server:3002
```

Bei Fragen oder Problemen, checke die Logs:
```bash
docker logs -f subcaster
```
