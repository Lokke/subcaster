/**
 * AlbumView - Album Detail Page
 * Displays album information and track listing
 */

import type { OpenSubsonicAlbum, OpenSubsonicSong } from '../../opensubsonic';
import { escapeHtml } from '../utils/albumHelpers';
import { createUnifiedSongsContainer } from '../components/SongRow';

export interface AlbumViewDependencies {
  apiClient: any;
  createUnifiedSongsContainer: typeof createUnifiedSongsContainer;
  addSongClickListeners: (container: Element) => void;
  loadVisibleSongWaveforms: (container: Element) => void;
  getCoverArtUrl: (id: string, size: number) => string;
  getStreamUrl: (id: string) => string;
  createStarRating: (rating: number, songId: string) => string;
}

/**
 * Generate artist HTML with multi-artist support
 */
function generateArtistHtml(album: OpenSubsonicAlbum): string {
  let artistHtml = '';
  const artistsArray = album.albumArtists || album.artists;
  
  if (artistsArray && artistsArray.length > 1) {
    // Multiple artists - render as clickable links separated by bullet
    artistHtml = artistsArray.map((artist, index) => {
      return `<span class="clickable-artist" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}">${escapeHtml(artist.name)}</span>`;
    }).join(' <span class="artist-separator">•</span> ');
  } else if (artistsArray && artistsArray.length === 1) {
    // Single artist from array
    artistHtml = `<span class="clickable-artist" data-artist-id="${artistsArray[0].id}" data-artist-name="${escapeHtml(artistsArray[0].name)}">${escapeHtml(artistsArray[0].name)}</span>`;
  } else {
    // Fallback to single artist string
    artistHtml = `<span class="clickable-artist" data-artist-id="${album.artistId}" data-artist-name="${escapeHtml(album.artist)}">${escapeHtml(album.artist)}</span>`;
  }
  
  return artistHtml;
}

/**
 * Render album view HTML structure
 */
export function renderAlbumViewHTML(album: OpenSubsonicAlbum, getCoverArtUrl: (id: string, size: number) => string): string {
  const artistHtml = generateArtistHtml(album);
  
  return `
    <div class="album-header">
      <div class="album-info">
        <div class="album-cover-large">
          <img src="${getCoverArtUrl(album.coverArt || '', 300)}" alt="${album.name}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
        </div>
        <div class="album-details">
          <h1 class="album-name">${escapeHtml(album.name)}</h1>
          <p class="album-artist">${artistHtml}</p>
          <p class="album-year">${album.year || 'Unknown Year'}</p>
        </div>
      </div>
    </div>

    <div class="media-section">
      <h3 class="section-title">Tracks</h3>
      <div class="songs-container" id="album-songs">
        <div class="loading-placeholder">Loading tracks...</div>
      </div>
    </div>
  `;
}

/**
 * Load and render album songs
 */
export async function loadAlbumSongs(
  album: OpenSubsonicAlbum,
  deps: AlbumViewDependencies
): Promise<void> {
  try {
    const songs = await deps.apiClient.getAlbumSongs(album.id);
    
    const songsContainer = document.getElementById('album-songs')!;
    if (songs.length > 0) {
      const songsListContainer = deps.createUnifiedSongsContainer(
        songs,
        'album',
        deps.getCoverArtUrl,
        deps.getStreamUrl,
        deps.createStarRating
      );
      songsContainer.innerHTML = '';
      songsContainer.className = 'songs-container';
      songsContainer.appendChild(songsListContainer);
      
      // Add click listeners for artist and album links in songs
      deps.addSongClickListeners(songsContainer);
      
      // Load waveform backgrounds for album tracks asynchronously
      setTimeout(() => deps.loadVisibleSongWaveforms(songsContainer), 100);
    } else {
      songsContainer.innerHTML = '<p class="no-items">No tracks found</p>';
    }

  } catch (error) {
    console.error('Error loading album songs:', error);
  }
}
