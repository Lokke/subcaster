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

        let hideTimeout: number | null = null;

        // 🎯 SHOW SUBMENU IMMEDIATELY when context menu opens
        // This is better UX - user sees all options right away
        requestAnimationFrame(() => {
          submenu.classList.add('show');
          console.log('✅ Submenu auto-opened on context menu show');
          console.log('📊 Submenu element:', submenu);
          console.log('📊 Submenu display:', window.getComputedStyle(submenu).display);
          console.log('📊 Submenu visibility:', window.getComputedStyle(submenu).visibility);
          console.log('📊 Submenu position:', window.getComputedStyle(submenu).position);
          console.log('📊 Submenu left:', window.getComputedStyle(submenu).left);
          console.log('📊 Submenu top:', window.getComputedStyle(submenu).top);
          console.log('📊 Submenu z-index:', window.getComputedStyle(submenu).zIndex);
          console.log('📊 Submenu parent:', submenu.parentElement);
          console.log('📊 Submenu bounds:', submenu.getBoundingClientRect());
        });

        // Show submenu on hover (in case it was closed)
        menuItem.addEventListener('mouseenter', () => {
          console.log('🎯 Mouseenter on menu item with submenu');
          if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
          }
          submenu.classList.add('show');
          console.log('✅ Submenu shown, classes:', submenu.className);
        });

        // Delay hiding submenu to allow mouse to move to it
        menuItem.addEventListener('mouseleave', (e) => {
          console.log('🎯 Mouseleave on menu item');
          const relatedTarget = e.relatedTarget as Node;
          
          // Don't hide if moving to submenu
          if (submenu.contains(relatedTarget)) {
            console.log('⏭️ Moving to submenu, keeping it open');
            return;
          }
          
          // Longer delay to give user time to reach submenu
          hideTimeout = window.setTimeout(() => {
            submenu.classList.remove('show');
            console.log('❌ Submenu hidden');
          }, 500);
        });

        // Keep submenu open when hovering over it
        submenu.addEventListener('mouseenter', () => {
          console.log('🎯 Mouseenter on submenu itself');
          if (hideTimeout) {
            clearTimeout(hideTimeout);
            hideTimeout = null;
          }
          submenu.classList.add('show');
        });

        submenu.addEventListener('mouseleave', () => {
          console.log('🎯 Mouseleave on submenu');
          hideTimeout = window.setTimeout(() => {
            submenu.classList.remove('show');
            console.log('❌ Submenu hidden after leaving submenu');
          }, 200);
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
  
  console.log('🔍 Checking visible decks...');
  
  deckSides.forEach(side => {
    const deckElement = document.getElementById(`player-${side}`);
    const isVisible = deckElement && 
                      deckElement.style.display !== 'none' && 
                      getComputedStyle(deckElement).display !== 'none';
    
    console.log(`  Deck ${side.toUpperCase()}: element=${!!deckElement}, style.display=${deckElement?.style.display}, computed=${deckElement ? getComputedStyle(deckElement).display : 'N/A'}, visible=${isVisible}`);
    
    if (isVisible) {
      visibleDecks.push(side);
    }
  });
  
  console.log(`✅ Visible decks: [${visibleDecks.map(d => d.toUpperCase()).join(', ')}]`);
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
      action: () => {
        // Async action wrapped in IIFE
        (async () => {
          try {
            console.log(`🎵 Loading all songs from album: ${album.name} (ID: ${album.id})`);
            console.log('API Client:', apiClient);
            
            if (!apiClient) {
              console.error('❌ No API client available');
              return;
            }
            
            const albumSongs = await apiClient.getAlbumSongs(album.id);
            console.log('Album songs:', albumSongs);
            
            if (albumSongs && albumSongs.length > 0) {
              console.log(`Adding ${albumSongs.length} songs to queue...`);
              for (const song of albumSongs) {
                await addToQueue(song);
              }
              console.log(`✅ Added ${albumSongs.length} songs from album "${album.name}" to queue`);
            } else {
              console.warn('⚠️ No songs found in album');
            }
          } catch (error) {
            console.error('❌ Error loading album songs:', error);
          }
        })();
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
  console.log(`📋 Creating song context menu for "${song.title}"`);
  console.log(`📋 Visible decks: [${visibleDecks.map(d => d.toUpperCase()).join(', ')}]`);
  
  const items: ContextMenuItem[] = [
    {
      label: 'Zur Queue hinzufügen',
      icon: 'playlist_add',
      action: () => {
        addToQueue(song);
        console.log(`✅ Added "${song.title}" to queue`);
      }
    }
  ];
  
  // 🔬 TEST: Add a test submenu with dummy entries to debug submenu rendering
  console.log('🔬 Adding TEST submenu with 3 dummy entries');
  items.push({
    label: '🔬 TEST Untermenü',
    icon: 'bug_report',
    submenu: [
      {
        label: 'Dummy Eintrag 1',
        icon: 'star',
        action: () => console.log('✅ Dummy 1 clicked')
      },
      {
        label: 'Dummy Eintrag 2',
        icon: 'star',
        action: () => console.log('✅ Dummy 2 clicked')
      },
      {
        label: 'Dummy Eintrag 3',
        icon: 'star',
        action: () => console.log('✅ Dummy 3 clicked')
      }
    ]
  });
  
  // Add deck loading options directly to main menu (no submenu!)
  visibleDecks.forEach(side => {
    items.push({
      label: `Auf Deck ${side.toUpperCase()} laden`,
      icon: 'album',
      action: () => {
        console.log(`🎵 Loading song "${song.title}" to Deck ${side.toUpperCase()}`);
        loadTrackToPlayer(side, song);
      }
    });
  });
  
  console.log(`📋 Context menu has ${items.length} items (including test submenu):`, items.map(item => item.label));
  
  contextMenu.show(e.clientX, e.clientY, items);
}
