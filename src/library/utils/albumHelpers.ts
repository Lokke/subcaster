// ========================================
// 🎵 ALBUM HELPER FUNCTIONS
// ========================================
// Helper functions for album operations

import type { OpenSubsonicAlbum } from '../../opensubsonic';

/**
 * Get album artist HTML with clickable artist links
 */
export function getAlbumArtistHtml(album: OpenSubsonicAlbum): string {
  if (album.artist) {
    if (album.artistId) {
      return `<span class="clickable-artist" data-artist-id="${album.artistId}" data-artist-name="${escapeHtml(album.artist)}" draggable="false">${escapeHtml(album.artist)}</span>`;
    }
    return escapeHtml(album.artist);
  }
  return 'Various Artists';
}

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sort albums by date (newest first) or alphabetically
 */
export function sortAlbums(albums: OpenSubsonicAlbum[], sortByDate: boolean): OpenSubsonicAlbum[] {
  const sorted = [...albums];
  
  if (sortByDate) {
    // Sort by year, newest first
    sorted.sort((a, b) => {
      const yearA = a.year || 9999; // Unknown years at the end
      const yearB = b.year || 9999;
      return yearB - yearA; // Newest first
    });
  } else {
    // Sort alphabetically by name
    sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
  
  return sorted;
}

/**
 * Create album card HTML
 */
export function createAlbumCardHtml(
  album: OpenSubsonicAlbum,
  getCoverArtUrl: (coverArt: string, size: number) => string
): string {
  return `
    <div class="album-card clickable" data-album-id="${album.id}" data-album-name="${escapeHtml(album.name)}" data-artist-name="${escapeHtml(album.artist || '')}" data-artist-id="${album.artistId || ''}">
      <div class="album-cover">
        <img src="${getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <h4 class="album-title">${escapeHtml(album.name)}</h4>
      <p class="album-artist">${getAlbumArtistHtml(album)}</p>
    </div>
  `;
}
