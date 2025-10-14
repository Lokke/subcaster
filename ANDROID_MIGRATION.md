# Android App Migration Plan

## Aktuelle Situation
- Electron-Desktop-App (veraltet: Electron 33.0.0)
- Web-basierte DJ-Software mit Node.js Backend
- TypeScript + Vite Frontend

## Empfohlene Lösung: **Capacitor** (von Ionic Team)

### Warum Capacitor statt Electron?
1. ✅ **Native Performance** - Echte native Android App (nicht Chromium-Wrapper)
2. ✅ **Kleinere App-Größe** - ~10-30 MB vs. Electron ~100-200 MB
3. ✅ **Modernes Tooling** - Aktiv maintained, große Community
4. ✅ **Web-Code Reuse** - 100% deiner Vite/TypeScript App funktioniert
5. ✅ **Native APIs** - Zugriff auf Android-Features (Mikrofon, Speicher, etc.)
6. ✅ **Google Play Ready** - Einfache Veröffentlichung im Play Store

### Alternativen (abgelehnt)
- **React Native**: Komplett neues Framework, müsste App neu schreiben
- **Flutter**: Dart statt TypeScript, komplette Neuentwicklung
- **Cordova**: Veraltet, Capacitor ist der Nachfolger
- **PWA**: Begrenzte Offline-Features, keine echte App-Experience
- **Electron + Repackaging**: Immer noch riesig, schlechte Performance

## Migration zu Capacitor

### Phase 1: Vorbereitung
- [ ] Capacitor CLI installieren
- [ ] Android Studio installieren (für Android SDK)
- [ ] Projekt-Struktur anpassen

### Phase 2: Capacitor Integration
- [ ] Capacitor initialisieren
- [ ] Android Platform hinzufügen
- [ ] Build-Konfiguration anpassen
- [ ] Assets optimieren für Mobile

### Phase 3: Native Features
- [ ] Audio-APIs testen (WebAudio funktioniert native)
- [ ] Microphone Permission Setup
- [ ] File Access für Musik-Library
- [ ] Background Audio Support
- [ ] Wake Lock (Display bleibt an während DJ-Session)

### Phase 4: Mobile Optimierungen
- [ ] Responsive Design (bereits vorhanden! ✅)
- [ ] Touch-Gesten optimieren
- [ ] Performance-Tuning
- [ ] Offline-Modus

### Phase 5: Testing & Distribution
- [ ] APK Build testen
- [ ] Android Emulator Testing
- [ ] Echtes Gerät Testing
- [ ] Google Play Console Setup
- [ ] App Bundle (.aab) erstellen

## Technische Details

### App-Architektur mit Capacitor
```
┌─────────────────────────────────────┐
│   Android Native Shell (Capacitor)  │
├─────────────────────────────────────┤
│   WebView (deine Vite App)          │
│   - TypeScript                       │
│   - HTML/CSS                         │
│   - WebAudio API                     │
│   - Wavesurfer.js                    │
├─────────────────────────────────────┤
│   Native Plugins                     │
│   - File System                      │
│   - Audio Sessions                   │
│   - Network                          │
└─────────────────────────────────────┘
```

### Backend-Integration
Dein Node.js Backend kann:
1. **Option A**: Lokal in der App laufen (Capacitor HTTP Server Plugin)
2. **Option B**: Auf Server laufen (Remote API Calls)
3. **Option C**: Hybrid (lokaler Cache + Remote Sync)

### Dependencies die bleiben
- ✅ Vite
- ✅ TypeScript
- ✅ WaveSurfer.js
- ✅ Three.js
- ✅ Deine komplette UI

### Dependencies die entfernt werden
- ❌ Electron
- ❌ Electron-Builder
- ❌ Electron-specific code

## Nächste Schritte

Soll ich:
1. **Electron komplett entfernen** und Capacitor setup starten?
2. **Nur Android hinzufügen** und Electron parallel behalten (Multi-Platform)?
3. **Erst analysieren** welche Features Android-Anpassungen brauchen?

## Geschätzte Entwicklungszeit
- Capacitor Setup: 2-4 Stunden
- Native Features Integration: 1-2 Tage
- Testing & Optimierung: 2-3 Tage
- **Total: ~1 Woche** für funktionale Android App

## Vorteile für deine App
1. **DJ-Controls**: Touch-optimiert mit deinen responsiven Breakpoints
2. **Waveforms**: Funktionieren nativ mit Canvas/WebGL
3. **Audio Processing**: WebAudio API läuft performant
4. **Real-time Mixing**: Niedrige Latenz möglich
5. **File Access**: Zugriff auf Music Library des Geräts
6. **Background Playback**: Musik läuft auch bei minimierter App
