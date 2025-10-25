# SubCaster - Multi-Platform Build Guide

SubCaster can run on:
- 🌐 **Web Browser** (Chrome, Firefox, Edge)
- 💻 **Electron Desktop** (Windows, macOS, Linux)
- 📱 **Android** (via Capacitor + Node.js)

All platforms use the **same codebase** - no changes to the main app!

---

## 🌐 Web (Default)

### Development
```bash
npm run dev
```
Open http://localhost:5173

### Production
```bash
npm run build
npm run start:production
```

---

## 💻 Electron Desktop

### Development
```bash
npm run electron:dev
```

### Build for Current Platform
```bash
npm run electron:build
```

### Build for Specific Platform
```bash
npm run electron:build:win    # Windows
npm run electron:build:mac    # macOS
npm run electron:build:linux  # Linux
```

**Output:** `dist-electron/`

### Features
- ✅ Runs unified-server locally (no internet needed)
- ✅ Native desktop app
- ✅ System tray integration
- ✅ Auto-updater ready

---

## 📱 Android

### Prerequisites
1. **Android Studio** (with Android SDK 33+)
2. **JDK 17+**
3. **Node.js 18+**

### First Time Setup
```bash
# Install Android platform
npm run android:init

# Sync project
npm run android:sync
```

### Development
```bash
# Open in Android Studio
npm run android:open

# Run on device/emulator
npm run android:run
```

### Build Release APK
```bash
npm run android:build
```

**Output:** `android/app/build/outputs/apk/release/app-release.apk`

### Build Debug APK
```bash
npm run android:build-debug
```

**Output:** `android/app/build/outputs/apk/debug/app-debug.apk`

### How Android Works

```
┌─────────────────────────────────┐
│   Android App (Capacitor)       │
│   ├─ WebView (loads dist/)      │
│   └─ http://localhost:3000      │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│   Node.js Server (nodejs-mobile)│
│   ├─ unified-server.js          │
│   ├─ Express API                │
│   └─ Runs natively on Android   │
└─────────────────────────────────┘
```

**Features:**
- ✅ Full Node.js backend on Android
- ✅ Offline operation (server runs locally)
- ✅ All streaming features work
- ✅ No WebView limitations

---

## 🔧 Architecture

### File Structure
```
webdj/
├── src/                    # Main web app (unchanged)
├── dist/                   # Built web app
├── unified-server.js       # Backend server (unchanged)
├── electron/               # Electron wrapper
│   ├── main.js            # Electron main process
│   ├── preload.js         # Preload script
│   └── package.json       # Electron dependencies
├── android/                # Android project (generated)
├── android-nodejs/         # Android Node.js config
└── capacitor.config.json   # Capacitor config
```

### How It Works

1. **Web/Electron:** unified-server runs as separate process
2. **Android:** unified-server runs via nodejs-mobile
3. **All platforms:** Load built web app from `dist/`
4. **No code changes needed** - same codebase everywhere!

---

## 📦 Build Commands Summary

| Platform | Command | Output |
|----------|---------|--------|
| Web Dev | `npm run dev` | http://localhost:5173 |
| Web Prod | `npm run build` | `dist/` |
| Electron Dev | `npm run electron:dev` | Electron window |
| Electron Prod | `npm run electron:build` | `dist-electron/` |
| Android Debug | `npm run android:build-debug` | `android/app/build/outputs/apk/debug/` |
| Android Release | `npm run android:build` | `android/app/build/outputs/apk/release/` |

---

## 🚀 Quick Start

### For Desktop (Electron)
```bash
npm install
npm run electron:dev
```

### For Android
```bash
npm install
npm run android:init
npm run android:sync
npm run android:open
# Then click "Run" in Android Studio
```

---

## 🐛 Troubleshooting

### Electron: Server not starting
- Check if port 3000 is available
- Look for errors in console (Ctrl+Shift+I)

### Android: Build failed
```bash
# Clean build
npm run android:clean
npm run android:sync
```

### Android: Server not connecting
- Check `adb logcat | grep -i subcaster`
- Ensure nodejs-mobile is installed: `npm list nodejs-mobile-capacitor`

---

## 📝 Notes

- **Electron:** Unified server starts automatically
- **Android:** Requires nodejs-mobile-capacitor plugin
- **All platforms:** Use same `.env` file for configuration
- **No changes to main app code** - platform wrappers only!

---

## 🔐 Android Signing (for Release)

1. Generate keystore:
```bash
keytool -genkey -v -keystore subcaster.keystore -alias subcaster -keyalg RSA -keysize 2048 -validity 10000
```

2. Update `capacitor.config.json`:
```json
"android": {
  "buildOptions": {
    "keystorePath": "path/to/subcaster.keystore",
    "keystorePassword": "your-password",
    "keystoreAlias": "subcaster",
    "keystoreAliasPassword": "your-alias-password"
  }
}
```

3. Build:
```bash
npm run android:build
```

---

## 📚 Additional Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Android Studio Setup](https://developer.android.com/studio)
- [nodejs-mobile](https://github.com/JaneaSystems/nodejs-mobile)
