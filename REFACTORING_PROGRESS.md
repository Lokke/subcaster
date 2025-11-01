# 📦 Library Refactoring - Phase 1

## ✅ Was wurde gemacht:

### 1. Branch Management
- ✅ Aktuellen Stand auf `main` committed und gepusht
- ✅ Neues Branch `refactor/library-components` erstellt
- ✅ Branch auf GitHub gepusht

### 2. Ordnerstruktur erstellt

```
src/
├── library/
│   ├── components/          # UI-Komponenten (leer, bereit für Komponenten)
│   │   ├── AlbumCard.ts     # TODO: Album-Card Komponente
│   │   ├── ArtistCard.ts    # TODO: Artist-Card Komponente
│   │   ├── SongRow.ts       # TODO: Song-Row Komponente
│   │   └── SearchResults.ts # TODO: Such-Ergebnisse
│   ├── views/               # View-Klassen (leer, bereit für Views)
│   │   ├── HomeView.ts      # TODO: Startseite
│   │   ├── ArtistView.ts    # TODO: Artist-Detail-Ansicht
│   │   ├── AlbumView.ts     # TODO: Album-Detail-Ansicht
│   │   └── SearchView.ts    # TODO: Such-Ansicht
│   └── utils/               # ✅ Helper-Funktionen (fertig!)
│       ├── albumHelpers.ts  # ✅ Album-Helper
│       ├── artistHelpers.ts # ✅ Artist-Helper
│       └── dragHelpers.ts   # ✅ Drag & Drop Helper
├── contextMenu.ts           # ✅ Bereits erstellt (vorher)
└── main.ts                  # 16K+ Zeilen (noch zu refactoren)
```

### 3. Erstellte Module

#### ✅ `albumHelpers.ts`
- `getAlbumArtistHtml()` - Artist HTML mit Links
- `escapeHtml()` - HTML-Escaping
- `sortAlbums()` - Sortierung (Datum/Name)
- `createAlbumCardHtml()` - Album-Card HTML generieren

#### ✅ `artistHelpers.ts`
- `createArtistLinks()` - Klickbare Artist-Links
- `createArtistCardHtml()` - Artist-Card HTML
- `addArtistClickListeners()` - Event-Listener Setup

#### ✅ `dragHelpers.ts`
- `addDragScrolling()` - Horizontales Drag-Scrolling
- `addDragListeners()` - Drag & Drop + Context Menu Integration

## 🎯 Nächste Schritte (TODO):

### Phase 2: Song-Komponente erstellen
1. `src/library/components/SongRow.ts` erstellen
   - `createUnifiedSongElement()` aus main.ts extrahieren
   - `createCompactQueueSongElement()` aus main.ts extrahieren
   - Song-Click-Listener Logik
   - Song-Context-Menu Integration

### Phase 3: Album & Artist Komponenten
2. `src/library/components/AlbumCard.ts` erstellen
3. `src/library/components/ArtistCard.ts` erstellen

### Phase 4: View-Klassen erstellen
4. `src/library/views/HomeView.ts` - Startseite mit Recent/Most Played/Random
5. `src/library/views/ArtistView.ts` - Artist-Detail mit Albums + Songs
6. `src/library/views/AlbumView.ts` - Album-Detail mit Songs
7. `src/library/views/SearchView.ts` - Such-Ergebnisse

### Phase 5: LibraryBrowser refactoren
8. `src/library/LibraryBrowser.ts` erstellen
   - Große `LibraryBrowser`-Klasse aus main.ts extrahieren
   - Navigation History integrieren
   - Views verwenden

### Phase 6: main.ts bereinigen
9. Alle extrahierten Funktionen aus main.ts entfernen
10. Nur noch Imports und Initialisierung in main.ts

## 📊 Aktueller Stand:

- **main.ts**: ~16.672 Zeilen (noch zu refactoren)
- **Neue Module**: 3 Dateien (~400 Zeilen extrahiert)
- **Branch**: `refactor/library-components`
- **Status**: Phase 1 abgeschlossen ✅

## 🚀 Wie weiter?

Das Refactoring ist ein großes Projekt. Schrittweises Vorgehen:

1. **Kleine Commits**: Jede Komponente einzeln committen
2. **Tests**: Nach jedem Schritt testen ob alles funktioniert
3. **Merge zurück**: Wenn stabil, in `main` mergen

**Vorteil der neuen Struktur:**
- ✅ Bessere Wartbarkeit
- ✅ Wiederverwendbare Komponenten
- ✅ Einfacheres Testing
- ✅ Klarere Code-Organisation
- ✅ Kleinere Dateien (statt 16K Zeilen)

## 💡 Verwendung der Helper-Module:

```typescript
// In anderen Dateien importieren:
import { createAlbumCardHtml, sortAlbums } from './library/utils/albumHelpers';
import { createArtistLinks, addArtistClickListeners } from './library/utils/artistHelpers';
import { addDragListeners, addDragScrolling } from './library/utils/dragHelpers';

// Beispiel-Verwendung:
const albumHtml = createAlbumCardHtml(album, getCoverArtUrl);
const sortedAlbums = sortAlbums(albums, true); // true = by date
addDragListeners(container, apiClient, addToQueue, loadTrackToPlayer, contextMenu);
```

---

**Status**: ✅ Foundation gelegt, bereit für weitere Komponenten!
