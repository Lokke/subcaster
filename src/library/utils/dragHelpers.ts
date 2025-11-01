// ========================================
// 🖱️ DRAG & DROP HELPER FUNCTIONS
// ========================================
// Helper functions for drag and drop operations

import type { OpenSubsonicSong, OpenSubsonicAlbum } from '../../opensubsonic';
import { showAlbumContextMenu, showSongContextMenu } from '../../contextMenu';
import type { ContextMenu } from '../../contextMenu';

/**
 * Add drag scrolling to horizontal scroll containers
 */
export function addDragScrolling(container: HTMLElement) {
  let isDown = false;
  let startX: number;
  let scrollLeft: number;
  
  container.addEventListener('mousedown', (e) => {
    isDown = true;
    container.classList.add('dragging');
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });
  
  container.addEventListener('mouseleave', () => {
    isDown = false;
    container.classList.remove('dragging');
  });
  
  container.addEventListener('mouseup', () => {
    isDown = false;
    setTimeout(() => {
      container.classList.remove('dragging');
    }, 10);
  });
  
  container.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 2;
    container.scrollLeft = scrollLeft - walk;
  });
}

/**
 * Add drag listeners for songs and albums (includes context menu support)
 */
export function addDragListeners(
  container: Element,
  apiClient: any,
  addToQueue: (song: OpenSubsonicSong) => void,
  loadTrackToPlayer: any,
  contextMenu: ContextMenu
) {
  const trackItems = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  const albumItems = container.querySelectorAll('.album-item, .album-item-modern, .album-card.clickable');
  
  console.log(`Adding drag listeners to ${trackItems.length} track items and ${albumItems.length} album items`);
  
  // Track item drag functionality
  trackItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for track item ${index}, song ID: ${target.dataset.songId}`);
      
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.setData('text/plain', target.dataset.songId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
        
        const songId = target.dataset.songId;
        if (songId) {
          dragEvent.dataTransfer.setData('application/json', JSON.stringify({
            type: 'song',
            songId: songId
          }));
        }
      }
    });
    
    item.addEventListener('dragend', (e) => {
      const target = e.target as HTMLElement;
      target.classList.remove('dragging');
    });
  });
  
  // Album drag functionality with context menu
  albumItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for album item ${index}, album ID: ${target.dataset.albumId}`);
      
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.setData('application/x-album-id', target.dataset.albumId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
      }
    });
    
    item.addEventListener('dragend', (e) => {
      const target = e.target as HTMLElement;
      target.classList.remove('dragging');
    });
    
    // Context menu for albums
    item.addEventListener('contextmenu', async (e: Event) => {
      const mouseEvent = e as MouseEvent;
      mouseEvent.preventDefault();
      mouseEvent.stopPropagation();
      
      const target = mouseEvent.target as HTMLElement;
      const albumCard = target.closest('.album-card, .album-item, .album-item-modern') as HTMLElement;
      
      if (!albumCard) return;
      
      const albumId = albumCard.dataset.albumId;
      if (!albumId) {
        console.error('No album ID found for right-clicked album');
        return;
      }
      
      const albumName = albumCard.dataset.albumName || 
                       albumCard.querySelector('.album-title')?.textContent || 
                       'Unknown Album';
      const artistName = albumCard.dataset.artistName || 
                        albumCard.querySelector('.album-artist')?.textContent || 
                        'Unknown Artist';
      
      const album: OpenSubsonicAlbum = {
        id: albumId,
        name: albumName,
        artist: artistName,
        artistId: albumCard.dataset.artistId || undefined
      };
      
      showAlbumContextMenu(mouseEvent, album, apiClient, addToQueue, contextMenu);
    });
  });
}
