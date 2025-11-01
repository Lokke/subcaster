/**
 * SongRow Component
 * Handles rendering of song elements in different contexts (search, album, queue)
 */

import type { OpenSubsonicSong } from '../../opensubsonic';
import { createArtistLinks } from '../utils/artistHelpers';
import { escapeHtml } from '../utils/albumHelpers';

/**
 * Create compact queue song element (stream-button style)
 */
export function createCompactQueueSongElement(
  song: OpenSubsonicSong,
  createStarRating: (rating: number, songId: string) => string
): HTMLElement {
  const songButton = document.createElement('div');
  songButton.className = 'queue-song-button';
  songButton.dataset.songId = song.id;
  songButton.dataset.type = 'song';
  
  // Song info compact display
  songButton.innerHTML = `
    <span class="material-icons queue-song-icon">music_note</span>
    <div class="queue-song-info">
      <div class="queue-song-title">${escapeHtml(song.title)}</div>
      <div class="queue-song-artist">${escapeHtml(song.artist)}</div>
    </div>
    <div class="queue-song-rating rating-stars" data-song-id="${song.id}">
      ${createStarRating(song.userRating || 0, song.id)}
    </div>
  `;
  
  // IMPORTANT: Element itself is NOT draggable, wrapper handles drag event
  songButton.draggable = false;
  
  return songButton;
}

/**
 * Create compact microphone placeholder for queue
 */
export function createCompactQueueMicrophoneElement(): HTMLElement {
  const micButton = document.createElement('div');
  micButton.className = 'queue-mic-button';
  micButton.dataset.type = 'microphone';
  
  micButton.innerHTML = `
    <span class="material-icons queue-mic-icon">mic</span>
    <div class="queue-mic-info">
      <div class="queue-mic-title">MICROPHONE</div>
      <div class="queue-mic-subtitle">Talk Break</div>
    </div>
  `;
  
  micButton.draggable = false;
  
  return micButton;
}

/**
 * Format duration from seconds to MM:SS
 */
function formatDuration(seconds: number | undefined): string {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Check if song has blacklisted genre
 */
function hasBlacklistedGenre(song: OpenSubsonicSong): boolean {
  // This would need to access global blacklistedGenres
  // For now return false, will be integrated with main.ts
  return false;
}

/**
 * Create unified song element for all contexts (search, album, queue)
 */
export function createUnifiedSongElement(
  song: OpenSubsonicSong,
  context: 'search' | 'album' | 'queue' = 'search',
  getCoverArtUrl: (id: string, size: number) => string,
  getStreamUrl: (id: string) => string,
  createStarRating: (rating: number, songId: string) => string
): HTMLElement {
  const trackItem = document.createElement('div');
  trackItem.className = 'music-card song-row';
  trackItem.dataset.songId = song.id;
  trackItem.dataset.songTitle = song.title;
  trackItem.dataset.songArtist = song.artist;
  trackItem.dataset.songAlbum = song.album;
  trackItem.dataset.songGenre = song.genre || '';
  trackItem.dataset.coverArt = song.coverArt || '';
  trackItem.dataset.type = 'song';
  
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt ? getCoverArtUrl(song.coverArt, 40) : '';
  
  // Check if genre is blacklisted
  const isBlacklisted = hasBlacklistedGenre(song);
  const genreClass = isBlacklisted ? 'track-genre blacklisted' : 'track-genre';
  
  // Modern row layout for song lists
  trackItem.innerHTML = `
    <div class="track-cover">
      ${coverUrl ? `<img src="${coverUrl}" alt="Cover" />` : '<div class="no-cover"><span class="material-icons">music_note</span></div>'}
    </div>
    <div class="track-title">${escapeHtml(song.title)}</div>
    <div class="track-artist">${createArtistLinks(song)}</div>
    <div class="track-album clickable-album" draggable="false" data-album-id="${song.albumId || ''}" data-album-name="${escapeHtml(song.album)}" title="View album details">${escapeHtml(song.album)}</div>
    <div class="${genreClass}">${escapeHtml(song.genre || '')}</div>
    <div class="track-rating" data-song-id="${song.id}">
      ${createStarRating(song.userRating || 0, song.id)}
    </div>
    <div class="track-duration">${duration}</div>
  `;
  
  // Enable drag and drop
  trackItem.draggable = true;
  trackItem.addEventListener('dragstart', (e) => {
    console.log('🚀 DRAGSTART on track item:', song.title, 'by', song.artist);
    
    if (e.dataTransfer) {
      // Set JSON data (preferred)
      const dragData = {
        type: 'song',
        song: song,
        sourceUrl: getStreamUrl(song.id)
      };
      
      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      // Set song ID as text/plain for fallback compatibility
      e.dataTransfer.setData('text/plain', song.id);
      e.dataTransfer.effectAllowed = 'copy';
    }
  });
  
  return trackItem;
}

/**
 * Create container for song lists
 */
export function createUnifiedSongsContainer(
  songs: OpenSubsonicSong[],
  context: 'search' | 'album' | 'queue' = 'album',
  getCoverArtUrl: (id: string, size: number) => string,
  getStreamUrl: (id: string) => string,
  createStarRating: (rating: number, songId: string) => string
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'songs-container';
  
  songs.forEach(song => {
    const songElement = createUnifiedSongElement(
      song,
      context,
      getCoverArtUrl,
      getStreamUrl,
      createStarRating
    );
    container.appendChild(songElement);
  });
  
  return container;
}

/**
 * Create song HTML (one-line format) - legacy, consider deprecating
 */
export function createSongHTMLOneline(
  song: OpenSubsonicSong,
  getCoverArtUrl: (id: string, size: number) => string,
  createStarRating: (rating: number, songId: string) => string
): string {
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt ? getCoverArtUrl(song.coverArt, 60) : '';
  
  return `
    <div class="music-card song-row" draggable="true" data-song-id="${song.id}" data-cover-art="${song.coverArt || ''}" data-type="song">
      <div class="track-cover">
        ${coverUrl ? `<img src="${coverUrl}" alt="Cover" />` : '<div class="no-cover"><span class="material-icons">music_note</span></div>'}
      </div>
      <div class="track-title">${escapeHtml(song.title)}</div>
      <div class="track-artist">${createArtistLinks(song)}</div>
      <div class="track-album clickable-album" draggable="false" data-album-id="${song.albumId || ''}" data-album-name="${escapeHtml(song.album)}" title="View album details">${escapeHtml(song.album)}</div>
      <div class="track-genre">${escapeHtml(song.genre || '')}</div>
      <div class="track-rating" data-song-id="${song.id}">
        ${createStarRating(song.userRating || 0, song.id)}
      </div>
      <div class="track-duration">${duration}</div>
    </div>
  `;
}
