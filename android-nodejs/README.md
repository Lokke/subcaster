# SubCaster Android Build

This directory contains configuration for running SubCaster on Android with an embedded Node.js server.

## Architecture

```
┌─────────────────────────────────┐
│   Android WebView (Capacitor)   │
│   ├─ SubCaster Web UI (dist/)   │
│   └─ http://localhost:3000      │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│   Node.js Server (nodejs-mobile)│
│   ├─ unified-server.js          │
│   ├─ Express API                │
│   └─ Port 3000                  │
└─────────────────────────────────┘
```

## Requirements

- Node.js 18+ (for development)
- Android Studio
- JDK 17+
- Android SDK 33+

## Setup

1. **Install nodejs-mobile-capacitor plugin:**
   ```bash
   npm install nodejs-mobile-capacitor
   npx cap sync android
   ```

2. **Build the web app:**
   ```bash
   npm run build
   ```

3. **Sync to Android:**
   ```bash
   npm run android:sync
   ```

4. **Open in Android Studio:**
   ```bash
   npm run android:open
   ```

## How it works

1. Capacitor WebView loads the built web app from `dist/`
2. nodejs-mobile starts unified-server.js in the background
3. WebView connects to localhost:3000
4. Full Node.js backend runs natively on Android

## Build for Release

```bash
npm run android:build
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

## Debugging

```bash
# Run in debug mode
npm run android:build-debug

# View logs
adb logcat | grep -i subcaster
```

## Notes

- Server runs on port 3000 (configurable in unified-server.js)
- All Node.js dependencies are bundled
- No internet required for local operation
- Streaming features require network access
