// ========================================
// 🎯 CONTEXT MENU SYSTEM
// ========================================
// Reusable context menu system for songs, albums, playlists, etc.

import type { OpenSubsonicSong, OpenSubsonicAlbum } from './opensubsonic';
import type { DeckSide } from './audio/Deck';

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action?: () => void;
  submenu?: ContextMenuItem[];
  divider?: boolean;
}

export class ContextMenu {
  private element: HTMLElement | null = null;
  private currentItems: ContextMenuItem[] = [];

  constructor() {
    this.createMenuElement();
    this.setupGlobalListeners();
  }

  private createMenuElement() {
    this.element = document.createElement('div');
    this.element.id = 'context-menu';
    this.element.className = 'context-menu hidden';
    document.body.appendChild(this.element);
  }

  private setupGlobalListeners() {
    // Close menu on click outside
    document.addEventListener('click', (e) => {
      if (this.element && !this.element.contains(e.target as Node)) {
        this.hide();
      }
    });

    // Close menu on scroll
    document.addEventListener('scroll', () => this.hide(), true);

    // Close menu on escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    });
  }

  show(x: number, y: number, items: ContextMenuItem[]) {
    if (!this.element) return;

    this.currentItems = items;
    this.element.innerHTML = '';

    items.forEach(item => {
      if (item.divider) {
        const divider = document.createElement('div');
        divider.className = 'context-menu-divider';
        this.element!.appendChild(divider);
        return;
      }

      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';

      if (item.icon) {
        const icon = document.createElement('span');
        icon.className = 'material-icons context-menu-icon';
        icon.textContent = item.icon;
        menuItem.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = item.label;
      menuItem.appendChild(label);

      if (item.submenu && item.submenu.length > 0) {
        const arrow = document.createElement('span');
        arrow.className = 'material-icons context-menu-arrow';
        arrow.textContent = 'chevron_right';
        menuItem.appendChild(arrow);

        const submenu = this.createSubmenu(item.submenu);
        menuItem.appendChild(submenu);

        menuItem.addEventListener('mouseenter', () => {
          submenu.classList.add('show');
        });

        menuItem.addEventListener('mouseleave', () => {
          submenu.classList.remove('show');
        });
      }

      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!item.submenu && item.action) {
          item.action();
          this.hide();
        }
      });

      this.element!.appendChild(menuItem);
    });

    // Position menu
    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    this.element.classList.remove('hidden');

    // Adjust if menu goes off screen
    requestAnimationFrame(() => {
      if (!this.element) return;
      const rect = this.element.getBoundingClientRect();
      
      if (rect.right > window.innerWidth) {
        this.element.style.left = `${window.innerWidth - rect.width - 10}px`;
      }
      
      if (rect.bottom > window.innerHeight) {
        this.element.style.top = `${window.innerHeight - rect.height - 10}px`;
      }
    });
  }

  private createSubmenu(items: ContextMenuItem[]): HTMLElement {
    const submenu = document.createElement('div');
    submenu.className = 'context-menu-submenu';

    items.forEach(item => {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';

      if (item.icon) {
        const icon = document.createElement('span');
        icon.className = 'material-icons context-menu-icon';
        icon.textContent = item.icon;
        menuItem.appendChild(icon);
      }

      const label = document.createElement('span');
      label.textContent = item.label;
      menuItem.appendChild(label);

      menuItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.action) {
          item.action();
          this.hide();
        }
      });

      submenu.appendChild(menuItem);
    });

    return submenu;
  }

  hide() {
    if (this.element) {
      this.element.classList.add('hidden');
    }
  }
}

// ========================================
// 🎯 CONTEXT MENU HELPERS
// ========================================

// Helper function to get visible decks
export function getVisibleDecks(): DeckSide[] {
  const visibleDecks: DeckSide[] = [];
  const deckSides: DeckSide[] = ['a', 'b', 'c', 'd'];
  
  deckSides.forEach(side => {
    const deckElement = document.getElementById(`player-${side}`);
    if (deckElement && deckElement.style.display !== 'none') {
      visibleDecks.push(side);
    }
  });
  
  return visibleDecks;
}

// ========================================
// 🎯 CONTEXT MENU BUILDERS
// ========================================

/**
 * Show context menu for album
 * @param e Mouse event
 * @param album Album object
 * @param apiClient API client instance
 * @param addToQueue Function to add song to queue
 */
export function showAlbumContextMenu(
  e: MouseEvent, 
  album: OpenSubsonicAlbum,
  apiClient: any,
  addToQueue: (song: OpenSubsonicSong) => void,
  contextMenu: ContextMenu
) {
  e.preventDefault();
  
  const items: ContextMenuItem[] = [
    {
      label: 'Zur Queue hinzufügen',
      icon: 'playlist_add',
      action: async () => {
        try {
          console.log(`🎵 Loading all songs from album: ${album.name}`);
          const albumDetails = await apiClient.getAlbum(album.id);
          
          if (albumDetails && albumDetails.song) {
            albumDetails.song.forEach((song: OpenSubsonicSong) => {
              addToQueue(song);
            });
            console.log(`✅ Added ${albumDetails.song.length} songs from album "${album.name}" to queue`);
          }
        } catch (error) {
          console.error('❌ Error loading album songs:', error);
        }
      }
    }
  ];
  
  contextMenu.show(e.clientX, e.clientY, items);
}

/**
 * Show context menu for song
 * @param e Mouse event
 * @param song Song object
 * @param addToQueue Function to add song to queue
 * @param loadTrackToPlayer Function to load track to player
 */
export function showSongContextMenu(
  e: MouseEvent, 
  song: OpenSubsonicSong,
  addToQueue: (song: OpenSubsonicSong) => void,
  loadTrackToPlayer: (side: DeckSide, song: OpenSubsonicSong) => void,
  contextMenu: ContextMenu
) {
  e.preventDefault();
  
  const visibleDecks = getVisibleDecks();
  const deckSubmenu: ContextMenuItem[] = visibleDecks.map(side => ({
    label: `Deck ${side.toUpperCase()}`,
    icon: 'album',
    action: () => {
      console.log(`🎵 Loading song "${song.title}" to Deck ${side.toUpperCase()}`);
      loadTrackToPlayer(side, song);
    }
  }));
  
  const items: ContextMenuItem[] = [
    {
      label: 'Zur Queue hinzufügen',
      icon: 'playlist_add',
      action: () => {
        addToQueue(song);
        console.log(`✅ Added "${song.title}" to queue`);
      }
    },
    {
      label: 'Auf Deck laden',
      icon: 'album',
      submenu: deckSubmenu
    }
  ];
  
  contextMenu.show(e.clientX, e.clientY, items);
}
