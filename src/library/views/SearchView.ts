/**
 * SearchView - Search Results Page
 * Displays artists, albums, and songs matching search query
 */

import type { OpenSubsonicAlbum, OpenSubsonicArtist, OpenSubsonicSong } from '../../opensubsonic';
import { escapeHtml, getAlbumArtistHtml } from '../utils/albumHelpers';
import { addArtistClickListeners } from '../utils/artistHelpers';
import { addDragListeners } from '../utils/dragHelpers';
import { createUnifiedSongsContainer } from '../components/SongRow';

export interface SearchViewDependencies {
  apiClient: any;
  addDragScrolling: (container: HTMLElement) => void;
  showArtist: (artist: OpenSubsonicArtist) => void;
  showAlbum: (album: OpenSubsonicAlbum) => void;
  addSongClickListeners: (container: Element) => void;
  loadVisibleSongWaveforms: (container: Element) => void;
  addToQueue: (song: any) => Promise<void>;
  loadTrackToPlayer: (song: any, deck: string) => Promise<void>;
  contextMenu: any;
  getCoverArtUrl: (id: string, size: number) => string;
  getStreamUrl: (id: string) => string;
  createStarRating: (rating: number, songId: string) => string;
}

export interface SearchResults {
  artist?: OpenSubsonicArtist[];
  album?: OpenSubsonicAlbum[];
  song?: OpenSubsonicSong[];
}

/**
 * Load and render search results
 */
export async function loadSearchResults(
  query: string,
  deps: SearchViewDependencies
): Promise<void> {
  const content = document.getElementById('library-content')!;
  content.innerHTML = '<div class="loading-placeholder">Searching...</div>';

  try {
    const results: SearchResults = await deps.apiClient.search(query, 20, 20, 20);
    
    content.innerHTML = '';

    // Render Artists
    if (results.artist && results.artist.length > 0) {
      renderArtistsSection(results.artist, content, deps);
    }

    // Render Albums
    if (results.album && results.album.length > 0) {
      renderAlbumsSection(results.album, content, deps);
    }

    // Render Songs
    if (results.song && results.song.length > 0) {
      renderSongsSection(results.song, content, deps);
    }

    // No results message
    if (!results.artist?.length && !results.album?.length && !results.song?.length) {
      content.innerHTML = '<p class="no-items">No results found</p>';
    }

  } catch (error) {
    console.error('Search error:', error);
    content.innerHTML = '<p class="error-message">Search failed. Please try again.</p>';
  }
}

/**
 * Render artists section
 */
function renderArtistsSection(
  artists: OpenSubsonicArtist[],
  parentContainer: HTMLElement,
  deps: SearchViewDependencies
): void {
  const artistSection = document.createElement('div');
  artistSection.className = 'media-section';
  artistSection.innerHTML = '<h3 class="section-title">Artists</h3>';
  
  const artistsHtml = artists.map(artist => `
    <div class="artist-item clickable" data-artist-id="${artist.id}">
      <div class="artist-image">
        <img src="${artist.coverArt ? deps.getCoverArtUrl(artist.coverArt, 300) : 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 viewBox=%220 0 200 200%22%3E%3Ccircle cx=%22100%22 cy=%22100%22 r=%22100%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22110%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'}" 
             alt="${escapeHtml(artist.name)}" 
             onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 viewBox=%220 0 200 200%22%3E%3Ccircle cx=%22100%22 cy=%22100%22 r=%22100%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22110%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <div class="artist-info">
        <h4 class="artist-name">${escapeHtml(artist.name)}</h4>
        <p class="artist-album-count">${artist.albumCount || 0} Albums</p>
      </div>
    </div>
  `).join('');
  
  const artistContainer = document.createElement('div');
  artistContainer.className = 'horizontal-scroll';
  artistContainer.innerHTML = artistsHtml;
  
  // Add drag scrolling to container
  deps.addDragScrolling(artistContainer as HTMLElement);
  
  // Add event listeners for artist cards
  artistContainer.querySelectorAll('[data-artist-id]').forEach(card => {
    card.addEventListener('click', () => {
      const artistId = card.getAttribute('data-artist-id');
      const artist = artists.find(a => a.id === artistId);
      if (artist) {
        deps.showArtist(artist);
      }
    });
  });
  
  artistSection.appendChild(artistContainer);
  parentContainer.appendChild(artistSection);
}

/**
 * Render albums section
 */
function renderAlbumsSection(
  albums: OpenSubsonicAlbum[],
  parentContainer: HTMLElement,
  deps: SearchViewDependencies
): void {
  const albumSection = document.createElement('div');
  albumSection.className = 'media-section';
  albumSection.innerHTML = '<h3 class="section-title">Albums</h3>';
  
  const albumsHtml = albums.map(album => `
    <div class="album-card clickable" data-album-id="${album.id}">
      <div class="album-image">
        <img src="${deps.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" draggable="false" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <h4 class="album-title">${escapeHtml(album.name)}</h4>
      <p class="album-artist">${getAlbumArtistHtml(album)}</p>
    </div>
  `).join('');
  
  const albumContainer = document.createElement('div');
  albumContainer.className = 'horizontal-scroll';
  albumContainer.innerHTML = albumsHtml;
  
  // Add drag scrolling to container
  deps.addDragScrolling(albumContainer as HTMLElement);
  
  // Add event listeners for album cards
  albumContainer.querySelectorAll('[data-album-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      // Only click if not dragging
      if (!albumContainer.classList.contains('dragging')) {
        const albumId = card.getAttribute('data-album-id');
        const album = albums.find(a => a.id === albumId);
        if (album) {
          deps.showAlbum(album);
        }
      }
    });
  });
  
  // Add artist click listeners
  addArtistClickListeners(albumContainer, (artistId, artistName) => {
    deps.showArtist({ id: artistId, name: artistName, albumCount: 0 });
  });
  
  // Add drag listeners for context menu support
  addDragListeners(albumContainer, deps.apiClient, deps.addToQueue, deps.loadTrackToPlayer, deps.contextMenu);
  
  albumSection.appendChild(albumContainer);
  parentContainer.appendChild(albumSection);
}

/**
 * Render songs section
 */
function renderSongsSection(
  songs: OpenSubsonicSong[],
  parentContainer: HTMLElement,
  deps: SearchViewDependencies
): void {
  const songSection = document.createElement('div');
  songSection.className = 'media-section';
  songSection.innerHTML = '<h3 class="section-title">Songs</h3>';
  
  const songsContainer = createUnifiedSongsContainer(
    songs,
    'search',
    deps.getCoverArtUrl,
    deps.getStreamUrl,
    deps.createStarRating
  );
  songSection.appendChild(songsContainer);
  parentContainer.appendChild(songSection);
  
  // Add click listeners for artist and album links in search results
  deps.addSongClickListeners(songSection);
  
  // Add drag listeners for context menu support
  addDragListeners(songSection, deps.apiClient, deps.addToQueue, deps.loadTrackToPlayer, deps.contextMenu);
  
  // Load waveform backgrounds for songs asynchronously
  setTimeout(() => deps.loadVisibleSongWaveforms(songSection), 100);
}
