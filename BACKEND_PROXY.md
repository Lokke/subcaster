# Backend Proxy System - Sichere Config ohne Neubuilds! 🔐

## Problem vorher

- **Alle Environment-Variablen** wurden beim Build **hart in JavaScript eingebettet**
- **Discord Bot Token** war **öffentlich sichtbar** in `dist/assets/index-*.js`
- **OpenSubsonic Passwort** war **öffentlich sichtbar** im Bundle
- **AzuraCast DJ Credentials** waren **öffentlich sichtbar**
- Bei **jeder Config-Änderung** musste die App **neu gebaut** werden

## Lösung jetzt

### 🎯 Alle Credentials bleiben auf dem Server!

Die App lädt jetzt **zur Laufzeit** die Config vom Backend:

```
Browser                      Backend (unified-server.js)               .env File
   |                                    |                                  |
   |  GET /api/config                   |                                  |
   | ---------------------------------> |                                  |
   |                                    |  Load from .env                  |
   |                                    | -------------------------------> |
   |                                    |                                  |
   |  { opensubsonic: { ... },          |                                  |
   |    discord: { enabled: true },     |                                  |
   |    NO SECRETS! }                   |                                  |
   | <--------------------------------- |                                  |
```

## Neue API-Endpunkte

### 1. `/api/config` - Konfiguration laden

**Was es macht:** Lädt alle öffentlichen Settings vom Backend

**Was NICHT exposed wird:**

- ❌ Discord Bot Token
- ❌ OpenSubsonic Passwort
- ❌ AzuraCast DJ Credentials
- ❌ Unified Login Passwort

**Was exposed wird:**

- ✅ Server URLs (OpenSubsonic, AzuraCast)
- ✅ Usernames (öffentlich sichtbar)
- ✅ Discord Channel/Guild IDs (öffentlich)
- ✅ Stream Settings (Bitrate, Sample Rate)

**Beispiel:**

```javascript
const response = await fetch('/api/config');
const config = await response.json();
console.log(config.discord.channelId); // Sicher!
console.log(config.discord.token); // ❌ Existiert nicht im Response!
```

---

### 2. `/api/discord/gateway` - Discord WebSocket URL

**Was es macht:** Holt die Discord Gateway URL mit **Bot Token auf Server-Seite**

**Vorher:**

```javascript
// ❌ Token im Frontend sichtbar!
const response = await fetch('https://discord.com/api/v10/gateway/bot', {
  headers: { 'Authorization': `Bot ${VITE_DISCORD_BOT_TOKEN}` }
});
```

**Jetzt:**

```javascript
// ✅ Token bleibt auf Server!
const response = await fetch('/api/discord/gateway');
const { url } = await response.json();
```

---

### 3. `/api/discord/channels/:channelId/messages` - Discord Messages

**Was es macht:** Fetcht Messages mit **Bot Token auf Server-Seite**

**Vorher:**

```javascript
// ❌ Token im Frontend!
fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
  headers: { 'Authorization': `Bot ${token}` }
});
```

**Jetzt:**

```javascript
// ✅ Token bleibt auf Server!
fetch(`/api/discord/channels/${channelId}/messages?limit=50`);
```

---

### 4. `/api/opensubsonic/auth` - OpenSubsonic Login

**Was es macht:** Generiert MD5-Token mit **Passwort auf Server-Seite**

**Vorher:**

```javascript
// ❌ Passwort im Frontend!
const salt = Math.random().toString(36);
const token = md5(password + salt);
```

**Jetzt:**

```javascript
// ✅ Passwort bleibt auf Server!
const response = await fetch('/api/opensubsonic/auth', { method: 'POST' });
const { token, salt } = await response.json();
```

---

### 5. `/api/opensubsonic/:endpoint` - OpenSubsonic API Proxy

**Was es macht:** Proxyt alle OpenSubsonic API-Calls mit **Credentials auf Server-Seite**

**Beispiel:**

```javascript
// ✅ Keine Credentials im Frontend!
const response = await fetch('/api/opensubsonic/search3?query=test&songCount=20');
const data = await response.json();
```

---

### 6. `/api/azuracast/liquidsoap` - AzuraCast Metadata Update

**Was es macht:** Sendet Liquidsoap-Commands mit **DJ Credentials auf Server-Seite**

**Vorher:**

```javascript
// ❌ DJ Password im Frontend!
fetch(`${serverUrl}/api/station/${stationId}/backend/liquidsoap/command`, {
  headers: {
    'Authorization': `Basic ${btoa(`${username}:${password}`)}`
  }
});
```

**Jetzt:**

```javascript
// ✅ DJ Credentials bleiben auf Server!
fetch('/api/azuracast/liquidsoap', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    serverUrl: 'https://funkturm.radio-endstation.de',
    stationId: '1',
    command: 'custom_metadata.insert artist="Test",title="Song"'
  })
});
```

---

## Frontend Config Loader

### Alte Methode (❌ Insecure):

```typescript
// Build-time - Token fest im Code!
const token = import.meta.env.VITE_DISCORD_BOT_TOKEN;
```

### Neue Methode (✅ Secure):

```typescript
import { loadConfig, getConfigValue } from './js/config-loader';

// Beim App-Start:
await loadConfig(); // Lädt Config vom Backend

// Im Code:
const channelId = getConfigValue('VITE_DISCORD_CHANNEL_ID');
```

---

## Vorteile

### 🔐 Sicherheit

- **Keine Tokens im JavaScript-Bundle**
- **Keine Passwörter im Browser sichtbar**
- **Kein DevTools-Hacking möglich**

### 🚀 Development

- **.env ändern** → Docker Container neu starten → **Fertig!**
- **Kein `npm run build`** mehr nötig
- **Schnellere Iteration** bei Config-Änderungen

### 🐳 Docker

```bash
# Config ändern:
nano docker-data/.env

# App neu starten (kein Rebuild!):
docker-compose restart subcaster

# ✅ Neue Config sofort aktiv!
```

---

## Migration Guide

### Alte Code-Muster ersetzen:

#### ❌ Vorher:

```typescript
const token = import.meta.env.VITE_DISCORD_BOT_TOKEN;
const url = import.meta.env.VITE_OPENSUBSONIC_URL;
const password = import.meta.env.VITE_OPENSUBSONIC_PASSWORD;
```

#### ✅ Nachher:

```typescript
// App-Start (main.ts):
await initializeConfig();

// Im Code:
const url = getConfigValue('VITE_OPENSUBSONIC_URL');

// Für Credentials: Backend-API nutzen!
const auth = await fetch('/api/opensubsonic/auth', { method: 'POST' });
const { token, salt } = await auth.json();
```

---

## Testing

### 1. Config laden:

```javascript
const response = await fetch('/api/config');
console.log(await response.json());
```

### 2. Discord Gateway:

```javascript
const response = await fetch('/api/discord/gateway');
console.log(await response.json());
```

### 3. OpenSubsonic Auth:

```javascript
const response = await fetch('/api/opensubsonic/auth', { method: 'POST' });
console.log(await response.json());
```

---

## Security Checklist

### ✅ Was ist jetzt sicher:

- [x] Discord Bot Token bleibt auf Server
- [x] OpenSubsonic Passwort bleibt auf Server
- [x] AzuraCast DJ Credentials bleiben auf Server
- [x] Unified Login Passwort bleibt auf Server
- [x] Keine Secrets im JavaScript-Bundle
- [x] Keine Secrets in Browser DevTools sichtbar

### ⚠️ Was ist noch public:

- Server URLs (OpenSubsonic, AzuraCast) → **OK, sind sowieso öffentlich**
- Usernames → **OK, kein Sicherheitsrisiko**
- Discord Channel/Guild IDs → **OK, sind öffentlich sichtbar**

---

## Troubleshooting

### Frontend zeigt "Config not loaded"

```bash
# Server-Logs prüfen:
docker-compose logs subcaster | grep "api/config"

# .env File prüfen:
cat docker-data/.env
```

### "Discord bot token not configured"

```bash
# .env prüfen:
grep VITE_DISCORD_BOT_TOKEN docker-data/.env

# Container neu starten:
docker-compose restart subcaster
```

### "OpenSubsonic not configured"

```bash
# Alle OpenSubsonic Variablen prüfen:
grep VITE_OPENSUBSONIC docker-data/.env

# Sollte enthalten:
# VITE_OPENSUBSONIC_URL=https://musik.radio-endstation.de
# VITE_OPENSUBSONIC_USERNAME=dein_username
# VITE_OPENSUBSONIC_PASSWORD=dein_password
```

---

## FAQ

**Q: Muss ich noch `docker-compose up --build` ausführen?**  
A: Nein! Nur bei Code-Änderungen. Bei Config-Änderungen reicht `docker-compose restart`.

**Q: Sind die Tokens wirklich sicher?**  
A: Ja! Sie verlassen nie den Server. Das Frontend nutzt nur Proxy-Endpunkte.

**Q: Was passiert wenn Backend offline ist?**  
A: Das Frontend nutzt Fallback-Config (falls vorhanden) oder zeigt Fehlermeldung.

**Q: Kann ich die alte Methode noch nutzen?**  
A: Ja, als Fallback. Aber **nicht empfohlen** in Production!

---

## Deployment Checklist

- [ ] .env File in `docker-data/` vorhanden
- [ ] Alle VITE_* Variablen gesetzt
- [ ] `docker-compose up --build -d` ausgeführt
- [ ] `/api/config` liefert Config zurück
- [ ] Discord WebSocket verbindet
- [ ] OpenSubsonic Login funktioniert
- [ ] AzuraCast Streaming funktioniert
- [ ] **Keine Secrets in Browser DevTools sichtbar!** ✅
