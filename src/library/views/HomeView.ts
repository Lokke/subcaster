/**
 * HomeView - Library Home Page
 * Displays recently added, most played, random albums and artists
 */

import type { OpenSubsonicAlbum, OpenSubsonicArtist } from '../../opensubsonic';
import { escapeHtml, getAlbumArtistHtml } from '../utils/albumHelpers';
import { addArtistClickListeners } from '../utils/artistHelpers';
import { addDragListeners } from '../utils/dragHelpers';

export interface HomeViewDependencies {
  apiClient: any;
  addDragScrolling: (container: HTMLElement) => void;
  loadArtistImages: (container: HTMLElement, artists: OpenSubsonicArtist[]) => void;
  showAlbum: (album: OpenSubsonicAlbum) => void;
  showArtist: (artist: OpenSubsonicArtist) => void;
  showHausaufgabenPlaylist: (playlist: any) => void;
  addToQueue: (song: any) => Promise<void>;
  loadTrackToPlayer: (song: any, deck: string) => Promise<void>;
  contextMenu: any;
}

/**
 * Render the home view HTML structure
 */
export function renderHomeViewHTML(): string {
  return `
    <div class="media-section">
      <h3 class="section-title">Recently Added</h3>
      <div class="horizontal-scroll" id="recent-albums">
        <div class="loading-placeholder">Loading recent albums...</div>
      </div>
    </div>

    <div class="media-section">
      <h3 class="section-title">Most Played</h3>
      <div class="horizontal-scroll" id="most-played-albums">
        <div class="loading-placeholder">Loading most played...</div>
      </div>
    </div>

    <div class="media-section">
      <h3 class="section-title">random albums</h3>
      <div class="horizontal-scroll" id="random-albums">
        <div class="loading-placeholder">Loading random albums...</div>
      </div>
    </div>

    <div class="media-section">
      <h3 class="section-title">Random Artists</h3>
      <div class="horizontal-scroll" id="random-artists">
        <div class="loading-placeholder">Loading random artists...</div>
      </div>
    </div>
  `;
}

/**
 * Load home view data and populate containers
 */
export async function loadHomeViewData(deps: HomeViewDependencies): Promise<void> {
  if (!deps.apiClient) return;

  try {
    const [recentAlbums, mostPlayedAlbums, randomAlbums, randomArtists, hausaufgabenPlaylist] = await Promise.all([
      deps.apiClient.getNewestAlbums(20),
      deps.apiClient.getAlbumList2('frequent', 20),
      deps.apiClient.getRandomAlbums(20),
      deps.apiClient.getRandomArtists(20),
      deps.apiClient.getHausaufgabenPlaylist()
    ]);

    // Recent Albums
    renderRecentAlbums(recentAlbums, hausaufgabenPlaylist, deps);
    
    // Most Played Albums
    renderMostPlayedAlbums(mostPlayedAlbums, deps);
    
    // Random Albums
    renderRandomAlbums(randomAlbums, deps);
    
    // Random Artists
    renderRandomArtists(randomArtists, deps);

  } catch (error) {
    console.error('Error loading home view data:', error);
  }
}

/**
 * Render recently added albums (with optional Hausaufgaben playlist)
 */
function renderRecentAlbums(
  albums: OpenSubsonicAlbum[],
  hausaufgabenPlaylist: any,
  deps: HomeViewDependencies
): void {
  const container = document.getElementById('recent-albums');
  if (!container || albums.length === 0) return;

  // Hausaufgaben playlist as first element
  let hausaufgabenHtml = '';
  if (hausaufgabenPlaylist) {
    hausaufgabenHtml = `
      <div class="album-card clickable hausaufgaben-playlist" data-playlist-id="${hausaufgabenPlaylist.id}" data-playlist-type="hausaufgaben">
        <div class="album-cover">
          <div class="playlist-cover">
            <span class="material-icons" style="font-size: 48px; color: #ff6b6b;">school</span>
            <div class="playlist-overlay">Playlist</div>
          </div>
        </div>
        <h4 class="album-title">${escapeHtml(hausaufgabenPlaylist.name)}</h4>
        <p class="album-artist">${hausaufgabenPlaylist.songCount} Songs • ${Math.floor((hausaufgabenPlaylist.duration || 0) / 60)} Min</p>
      </div>
    `;
  }

  // Album cards
  const albumsHtml = albums.map(album => `
    <div class="album-card clickable" data-album-id="${album.id}">
      <div class="album-cover">
        <img src="${deps.apiClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <h4 class="album-title">${escapeHtml(album.name)}</h4>
      <p class="album-artist">${getAlbumArtistHtml(album)}</p>
    </div>
  `).join('');

  container.className = 'horizontal-scroll';
  container.innerHTML = hausaufgabenHtml + albumsHtml;

  // Add drag scrolling
  deps.addDragScrolling(container as HTMLElement);

  // Hausaufgaben playlist click handler
  if (hausaufgabenPlaylist) {
    const hausaufgabenCard = container.querySelector('[data-playlist-id]');
    if (hausaufgabenCard) {
      hausaufgabenCard.addEventListener('click', () => {
        deps.showHausaufgabenPlaylist(hausaufgabenPlaylist);
      });
    }
  }

  // Album click handlers
  container.querySelectorAll('[data-album-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!container.classList.contains('dragging')) {
        const albumId = card.getAttribute('data-album-id');
        const album = albums.find(a => a.id === albumId);
        if (album) {
          deps.showAlbum(album);
        }
      }
    });
  });

  // Artist click listeners
  addArtistClickListeners(container, (artistId, artistName) => {
    deps.showArtist({ id: artistId, name: artistName, albumCount: 0 });
  });

  // Drag listeners for context menu
  addDragListeners(container, deps.apiClient, deps.addToQueue, deps.loadTrackToPlayer, deps.contextMenu);
}

/**
 * Render most played albums
 */
function renderMostPlayedAlbums(
  albums: OpenSubsonicAlbum[],
  deps: HomeViewDependencies
): void {
  const container = document.getElementById('most-played-albums');
  if (!container || albums.length === 0) return;

  const albumsHtml = albums.map(album => `
    <div class="album-card clickable" data-album-id="${album.id}">
      <div class="album-cover">
        <img src="${deps.apiClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <h4 class="album-title">${escapeHtml(album.name)}</h4>
      <p class="album-artist">${getAlbumArtistHtml(album)}</p>
    </div>
  `).join('');

  container.className = 'horizontal-scroll';
  container.innerHTML = albumsHtml;

  deps.addDragScrolling(container as HTMLElement);

  container.querySelectorAll('[data-album-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!container.classList.contains('dragging')) {
        const albumId = card.getAttribute('data-album-id');
        const album = albums.find(a => a.id === albumId);
        if (album) {
          deps.showAlbum(album);
        }
      }
    });
  });

  addArtistClickListeners(container, (artistId, artistName) => {
    deps.showArtist({ id: artistId, name: artistName, albumCount: 0 });
  });
  addDragListeners(container, deps.apiClient, deps.addToQueue, deps.loadTrackToPlayer, deps.contextMenu);
}

/**
 * Render random albums
 */
function renderRandomAlbums(
  albums: OpenSubsonicAlbum[],
  deps: HomeViewDependencies
): void {
  const container = document.getElementById('random-albums');
  if (!container || albums.length === 0) return;

  const albumsHtml = albums.map(album => `
    <div class="album-card clickable" data-album-id="${album.id}">
      <div class="album-cover">
        <img src="${deps.apiClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <h4 class="album-title">${escapeHtml(album.name)}</h4>
      <p class="album-artist">${getAlbumArtistHtml(album)}</p>
    </div>
  `).join('');

  container.className = 'horizontal-scroll';
  container.innerHTML = albumsHtml;

  deps.addDragScrolling(container as HTMLElement);

  container.querySelectorAll('[data-album-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!container.classList.contains('dragging')) {
        const albumId = card.getAttribute('data-album-id');
        const album = albums.find(a => a.id === albumId);
        if (album) {
          deps.showAlbum(album);
        }
      }
    });
  });

  addArtistClickListeners(container, (artistId, artistName) => {
    deps.showArtist({ id: artistId, name: artistName, albumCount: 0 });
  });
  addDragListeners(container, deps.apiClient, deps.addToQueue, deps.loadTrackToPlayer, deps.contextMenu);
}

/**
 * Render random artists
 */
function renderRandomArtists(
  artists: OpenSubsonicArtist[],
  deps: HomeViewDependencies
): void {
  const container = document.getElementById('random-artists');
  if (!container || artists.length === 0) return;

  const artistsHtml = artists.map(artist => `
    <div class="artist-card clickable" data-artist-id="${artist.id}">
      <div class="artist-image" data-artist-id="${artist.id}">
        <div class="no-cover">🎤</div>
      </div>
      <h4 class="artist-name">${escapeHtml(artist.name)}</h4>
    </div>
  `).join('');

  container.className = 'horizontal-scroll';
  container.innerHTML = artistsHtml;

  deps.addDragScrolling(container as HTMLElement);

  // Load artist images asynchronously
  deps.loadArtistImages(container, artists);

  // Artist click handlers
  container.querySelectorAll('[data-artist-id]').forEach(card => {
    card.addEventListener('click', () => {
      const artistId = card.getAttribute('data-artist-id');
      const artist = artists.find(a => a.id === artistId);
      if (artist) {
        deps.showArtist(artist);
      }
    });
  });
}
