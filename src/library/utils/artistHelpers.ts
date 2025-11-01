// ========================================
// 👤 ARTIST HELPER FUNCTIONS
// ========================================
// Helper functions for artist operations

import type { OpenSubsonicArtist, OpenSubsonicSong } from '../../opensubsonic';

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Create artist links from song object
 */
export function createArtistLinks(song: OpenSubsonicSong): string {
  // If we have artist references with IDs, create clickable links
  if (song.artists && song.artists.length > 0) {
    return song.artists.map(artist => 
      `<span class="clickable-artist" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" draggable="false">${escapeHtml(artist.name)}</span>`
    ).join(', ');
  }
  
  // Fallback: Just use artist name (not clickable)
  return escapeHtml(song.artist || 'Unknown Artist');
}

/**
 * Create artist card HTML
 */
export function createArtistCardHtml(artist: OpenSubsonicArtist): string {
  return `
    <div class="artist-card clickable" data-artist-id="${artist.id}">
      <div class="artist-image" data-artist-id="${artist.id}">
        <div class="no-cover">🎤</div>
      </div>
      <h4 class="artist-name">${escapeHtml(artist.name)}</h4>
    </div>
  `;
}

/**
 * Setup artist click listeners on container
 */
export function addArtistClickListeners(
  container: Element,
  onArtistClick: (artistId: string, artistName: string) => void
) {
  const artistElements = container.querySelectorAll('.clickable-artist');
  
  artistElements.forEach((element) => {
    const artistId = (element as HTMLElement).dataset.artistId;
    const artistName = (element as HTMLElement).dataset.artistName;
    
    if (!artistId || !artistName) return;
    
    element.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      onArtistClick(artistId, artistName);
    });
  });
}
