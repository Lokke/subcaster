# Discord Wishbox Integration

Die Discord Wishbox ermöglicht es, Song-Wünsche aus einem Discord-Channel direkt in WebDJ anzuzeigen.

## Features

✅ **Echtzeit-Verbindung** über Discord Gateway WebSocket  
✅ **Automatische Reconnection** mit exponentieller Backoff-Strategie  
✅ **Heartbeat-Management** für stabile Verbindung  
✅ **Message Content Intent** Support für volle Nachrichteninhalte  
✅ **Live-Updates** - Neue Wünsche erscheinen sofort im Wishbox-Modal  
✅ **Avatar-Anzeige** mit Discord CDN Integration  
✅ **Timestamp-Formatierung** auf Deutsch (vor X Minuten/Stunden)  
✅ **Notification Badge** auf Button bei neuen Nachrichten  
✅ **Nachrichten löschen** - Delete-Button für erledigte Wünsche  

## Setup

### 1. Discord Bot erstellen

1. Gehe zu: https://discord.com/developers/applications
2. Klicke auf **"New Application"**
3. Gib einen Namen ein (z.B. "WebDJ Wishbox")
4. Gehe zum **"Bot"** Tab
5. Klicke auf **"Reset Token"** → Kopiere den Token

### 2. Privileged Intents aktivieren

Im Bot-Tab scrolle runter zu **"Privileged Gateway Intents"**:

- ✅ **MESSAGE CONTENT INTENT** (erforderlich!)
- ✅ **GUILDS** (wird automatisch verwendet)
- ✅ **GUILD_MESSAGES** (wird automatisch verwendet)

### 3. Bot einladen

1. Gehe zum **"OAuth2"** → **"URL Generator"** Tab
2. Wähle unter **Scopes**: `bot`
3. Wähle unter **Bot Permissions**:
   - ✅ Read Messages/View Channels
   - ✅ Read Message History
   - ✅ **Manage Messages** (für Löschen von Wünschen)
4. Kopiere die generierte URL und öffne sie im Browser
5. Wähle deinen Server aus und autorisiere den Bot

### 4. Channel ID ermitteln

1. Aktiviere **Developer Mode** in Discord:  
   `Einstellungen → Erweitert → Entwicklermodus aktivieren`
2. Rechtsklick auf den gewünschten Channel → **"ID kopieren"**

### 5. Guild/Server ID ermitteln (optional)

1. Rechtsklick auf dein Server-Icon → **"Server-ID kopieren"**

### 6. Environment-Variablen setzen

Erstelle eine `.env` Datei im Projekt-Root (oder kopiere `.env.example`):

```env
VITE_DISCORD_BOT_TOKEN=dein_bot_token_hier
VITE_DISCORD_CHANNEL_ID=deine_channel_id_hier
VITE_DISCORD_GUILD_ID=deine_guild_id_hier
```

### 7. WebDJ starten

```bash
npm run dev
```

Der Discord-Client verbindet sich automatisch beim Start.

## Verwendung

1. **Wishbox öffnen**: Klicke auf den 💬-Button in der Queue-Leiste
2. **Nachrichten ansehen**: Alle Nachrichten aus dem konfigurierten Channel werden angezeigt
3. **Live-Updates**: Neue Nachrichten erscheinen automatisch
4. **Notification Badge**: Der Button wird blau wenn neue Nachrichten eintreffen

## Architektur

### Discord Gateway Client (`discordGateway.ts`)

Implementiert die vollständige Discord Gateway API v10:

- **Connection Lifecycle**: HELLO → IDENTIFY → READY → HEARTBEAT Loop
- **Reconnection Logic**: Automatisches Resume mit Session-ID
- **Heartbeat Management**: Jitter + Interval + ACK Tracking
- **Event Handling**: Dispatch Events (READY, RESUMED, MESSAGE_CREATE)
- **Error Handling**: Close Codes + Retry Logic mit Backoff

### Intents

Der Bot nutzt folgende Gateway Intents:

```typescript
GUILDS (1 << 0)           // Server-Informationen
GUILD_MESSAGES (1 << 9)   // Nachrichten in Channels
MESSAGE_CONTENT (1 << 15) // Nachrichteninhalte (privileged!)
```

### Message Flow

```
Discord Channel
    ↓
Gateway WebSocket (MESSAGE_CREATE Event)
    ↓
discordGateway.ts (Event Handler)
    ↓
main.ts (handleNewDiscordMessage)
    ↓
UI Update (renderDiscordMessage)
```

## API-Limits

- **Heartbeat**: Alle ~45 Sekunden (von Discord vorgegeben)
- **IDENTIFY**: Max 1000 pro 24h (global über alle Shards)
- **Gateway Events**: 120 Events pro 60 Sekunden pro Connection
- **Message Content**: Erfordert Privileged Intent + Approval für verifizierte Bots

## Troubleshooting

### Bot verbindet sich nicht

- ✅ Prüfe ob Token korrekt ist
- ✅ Prüfe ob MESSAGE_CONTENT Intent aktiviert ist
- ✅ Prüfe Browser Console für Fehler

### Keine Nachrichten sichtbar

- ✅ Prüfe ob Channel-ID korrekt ist
- ✅ Prüfe ob Bot im Channel Leserechte hat
- ✅ Teste: Sende eine neue Nachricht im Channel

### "Invalid Session" Error

- Der Bot reconnected automatisch
- Bei wiederholten Fehlern: Token neu generieren

### Button ist ausgegraut

- Environment-Variablen fehlen oder sind falsch
- Prüfe `.env` Datei und starte Dev-Server neu

## Sicherheit

⚠️ **NIEMALS** den Bot-Token committen oder öffentlich teilen!

- Token ist in `.env` (nicht in Git)
- `.gitignore` enthält `.env`
- Nur `.env.example` ist im Repository

## Logs

Der Discord-Client gibt ausführliche Logs aus:

```
🔗 Discord: Connecting to Gateway...
✅ Discord: WebSocket connected
👋 Discord: Received HELLO
🔐 Discord: Sending IDENTIFY
✅ Discord: READY
💬 Discord: New message from target channel
```

## Weitere Infos

- [Discord Gateway API Docs](https://discord.com/developers/docs/topics/gateway)
- [Discord Bot Permissions Calculator](https://discordapi.com/permissions.html)
- [Discord.js Guide](https://discordjs.guide/) (für JS-Library, nicht verwendet aber gute Referenz)
