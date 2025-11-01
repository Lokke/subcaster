/**
 * ArtistView - Artist Detail Page
 * Displays artist information, albums, singles, appears-on, top songs, and similar artists
 */

import type { OpenSubsonicAlbum, OpenSubsonicArtist, OpenSubsonicSong } from '../../opensubsonic';
import { escapeHtml, sortAlbums } from '../utils/albumHelpers';
import { addDragListeners } from '../utils/dragHelpers';
import { createUnifiedSongsContainer } from '../components/SongRow';

export interface ArtistViewDependencies {
  apiClient: any;
  addDragScrolling: (container: HTMLElement) => void;
  loadArtistImages: (container: HTMLElement, artists: OpenSubsonicArtist[]) => void;
  showAlbum: (album: OpenSubsonicAlbum) => void;
  showArtist: (artist: OpenSubsonicArtist) => void;
  addSongClickListeners: (container: Element) => void;
  loadVisibleSongWaveforms: (container: Element) => void;
  addToQueue: (song: any) => Promise<void>;
  loadTrackToPlayer: (song: any, deck: string) => Promise<void>;
  contextMenu: any;
  getCoverArtUrl: (id: string, size: number) => string;
  getStreamUrl: (id: string) => string;
  createStarRating: (rating: number, songId: string) => string;
}

/**
 * Get artist image URL
 */
function getArtistImageUrl(rawUrl: string | undefined, size: number): string {
  if (!rawUrl) return '';
  // Just return the URL as-is for now - can be enhanced with size param later
  return rawUrl;
}

/**
 * Sanitize biography text
 */
function sanitizeBiography(biography: string): string {
  if (!biography || biography === 'Empty biography') return '';
  
  if (biography.length > 300) {
    // Truncate at 300, but preserve HTML links
    const linkMatch = biography.substring(0, 300).lastIndexOf('<a ');
    const linkEnd = biography.indexOf('</a>', linkMatch);
    if (linkMatch !== -1 && linkEnd > 300) {
      // Link extends beyond 300, include the whole link
      return biography.substring(0, linkEnd + 4) + '...';
    } else {
      return biography.substring(0, 300) + '...';
    }
  }
  
  return biography;
}

/**
 * Render artist view HTML structure
 */
export async function renderArtistViewHTML(
  artist: OpenSubsonicArtist,
  deps: ArtistViewDependencies
): Promise<void> {
  const content = document.getElementById('library-content')!;
  
  // Fetch full artist data
  const [fullArtist, artistInfo] = await Promise.all([
    deps.apiClient.getArtist(artist.id),
    deps.apiClient.getArtistInfo(artist.id)
  ]);
  
  const albumCount = fullArtist?.albumCount || artist.albumCount || 0;
  const rawArtistImageUrl = fullArtist?.artistImageUrl || artistInfo?.largeImageUrl || artistInfo?.mediumImageUrl;
  const artistImageUrl = getArtistImageUrl(rawArtistImageUrl, 300);
  const biography = sanitizeBiography(artistInfo?.biography || '');
  
  content.innerHTML = `
    <div class="artist-header">
      <div class="artist-info">
        ${artistImageUrl 
          ? `<div class="artist-image-large"><img src="${artistImageUrl}" alt="${escapeHtml(artist.name)}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>person</span>';"></div>`
          : `<div class="artist-image-large"><span class="material-icons">person</span></div>`
        }
        <div class="artist-details">
          <h1 class="artist-name">${escapeHtml(artist.name)}</h1>
          <p class="artist-album-count">${albumCount} Album${albumCount !== 1 ? 's' : ''}</p>
          ${biography ? `<p class="artist-biography">${biography}</p>` : ''}
        </div>
      </div>
    </div>

    <div class="media-section">
      <div class="section-header">
        <h3 class="section-title">Albums</h3>
        <button id="album-sort-toggle" class="sort-toggle-button" title="Toggle sort by date/name">
          <span class="material-icons">calendar_month</span>
        </button>
      </div>
      <div class="horizontal-scroll" id="artist-albums">
        <div class="loading-placeholder">Loading albums...</div>
      </div>
    </div>

    <div class="media-section" id="singles-section" style="display: none;">
      <div class="section-header">
        <h3 class="section-title">Singles</h3>
        <button id="singles-sort-toggle" class="sort-toggle-button" title="Toggle sort by date/name">
          <span class="material-icons">calendar_month</span>
        </button>
      </div>
      <div class="horizontal-scroll" id="artist-singles">
        <div class="loading-placeholder">Loading singles...</div>
      </div>
    </div>

    <div class="media-section" id="appears-on-section" style="display: none;">
      <h3 class="section-title">Appears On</h3>
      <div class="horizontal-scroll" id="appears-on-albums">
        <div class="loading-placeholder">Loading appearances...</div>
      </div>
    </div>

    <div class="media-section">
      <h3 class="section-title">Top Songs</h3>
      <div class="songs-container" id="artist-songs">
        <div class="loading-placeholder">Loading songs...</div>
      </div>
    </div>

    <div class="media-section" id="similar-artists-section" style="display: none;">
      <h3 class="section-title">Similar Artists</h3>
      <div class="horizontal-scroll" id="similar-artists">
        <div class="loading-placeholder">Loading similar artists...</div>
      </div>
    </div>
  `;

  // Load artist data
  await loadArtistData(artist, artistInfo, deps);
}

/**
 * Load artist data (albums, songs, appears-on, similar)
 */
async function loadArtistData(
  artist: OpenSubsonicArtist,
  artistInfo: any,
  deps: ArtistViewDependencies
): Promise<void> {
  try {
    const [albums, songs, appearsOnAlbums] = await Promise.all([
      deps.apiClient.getArtistAlbums(artist.id),
      deps.apiClient.getArtistSongs(artist.id),
      deps.apiClient.getAllAlbumsWithArtist(artist.name)
    ]);

    // Similar Artists
    if (artistInfo?.similarArtist && artistInfo.similarArtist.length > 0) {
      renderSimilarArtists(artistInfo.similarArtist, deps);
    }

    // Filter appears-on albums (exclude albums where artist is album artist)
    const albumArtistIds = new Set(albums.map((a: OpenSubsonicAlbum) => a.id));
    const appearsOn = appearsOnAlbums.filter((album: OpenSubsonicAlbum) => !albumArtistIds.has(album.id));

    // Separate singles (1 track) from albums (2+ tracks)
    const actualAlbums = albums.filter((album: OpenSubsonicAlbum) => album.songCount > 1);
    const singles = albums.filter((album: OpenSubsonicAlbum) => album.songCount === 1);

    // Render albums with sortable functionality
    renderAlbumsSection(actualAlbums, 'artist-albums', 'album-sort-toggle', deps);
    
    // Render singles if any
    if (singles.length > 0) {
      const singlesSection = document.getElementById('singles-section')!;
      singlesSection.style.display = 'block';
      renderAlbumsSection(singles, 'artist-singles', 'singles-sort-toggle', deps);
    }

    // Render appears-on albums
    if (appearsOn.length > 0) {
      renderAppearsOnSection(appearsOn, deps);
    }

    // Render songs
    renderSongsSection(songs, deps);

  } catch (error) {
    console.error('Error loading artist content:', error);
  }
}

/**
 * Render albums section with sorting functionality
 */
function renderAlbumsSection(
  albums: OpenSubsonicAlbum[],
  containerId: string,
  toggleButtonId: string,
  deps: ArtistViewDependencies
): void {
  let currentAlbums = [...albums];
  let sortByDate = true; // Start with date sorting (newest first)

  // Render function
  const render = (albumsToRender: OpenSubsonicAlbum[]) => {
    const container = document.getElementById(containerId)!;
    if (albumsToRender.length === 0) {
      container.innerHTML = '<p class="no-items">No albums found</p>';
      return;
    }

    const albumsHtml = albumsToRender.map(album => `
      <div class="album-card clickable" data-album-id="${album.id}">
        <div class="album-image">
          <img src="${deps.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" draggable="false" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
        </div>
        <h4 class="album-title">${escapeHtml(album.name)}</h4>
        <p class="album-year">${album.year || 'Unknown Year'}</p>
      </div>
    `).join('');

    container.className = 'horizontal-scroll';
    container.innerHTML = albumsHtml;

    // Add drag scrolling
    deps.addDragScrolling(container as HTMLElement);

    // Add click listeners
    container.querySelectorAll('[data-album-id]').forEach(card => {
      card.addEventListener('click', (e) => {
        if (!container.classList.contains('dragging')) {
          const albumId = card.getAttribute('data-album-id');
          const album = albumsToRender.find(a => a.id === albumId);
          if (album) {
            deps.showAlbum(album);
          }
        }
      });
    });

    // Add drag listeners for context menu
    addDragListeners(container, deps.apiClient, deps.addToQueue, deps.loadTrackToPlayer, deps.contextMenu);
  };

  // Initial render with date sorting
  render(sortAlbums(currentAlbums, true));

  // Add sort toggle button listener
  const sortToggle = document.getElementById(toggleButtonId) as HTMLButtonElement;
  if (sortToggle) {
    sortToggle.addEventListener('click', () => {
      sortByDate = !sortByDate;

      // Update icon
      const icon = sortToggle.querySelector('.material-icons')!;
      icon.textContent = sortByDate ? 'calendar_month' : 'sort_by_alpha';
      sortToggle.title = sortByDate ? 'Sort by name' : 'Sort by date';

      // Re-render with new sort
      render(sortAlbums(currentAlbums, sortByDate));
    });
  }
}

/**
 * Render appears-on section
 */
function renderAppearsOnSection(
  appearsOn: OpenSubsonicAlbum[],
  deps: ArtistViewDependencies
): void {
  const appearsOnSection = document.getElementById('appears-on-section')!;
  appearsOnSection.style.display = 'block';

  const container = document.getElementById('appears-on-albums')!;
  const albumsHtml = appearsOn.map(album => `
    <div class="album-card clickable" data-album-id="${album.id}">
      <div class="album-image">
        <img src="${deps.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" draggable="false" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
      </div>
      <h4 class="album-title">${escapeHtml(album.name)}</h4>
      <p class="album-year">${album.year || 'Unknown Year'}</p>
    </div>
  `).join('');

  container.className = 'horizontal-scroll';
  container.innerHTML = albumsHtml;

  deps.addDragScrolling(container as HTMLElement);

  container.querySelectorAll('[data-album-id]').forEach(card => {
    card.addEventListener('click', (e) => {
      if (!container.classList.contains('dragging')) {
        const albumId = card.getAttribute('data-album-id');
        const album = appearsOn.find(a => a.id === albumId);
        if (album) {
          deps.showAlbum(album);
        }
      }
    });
  });
}

/**
 * Render songs section
 */
function renderSongsSection(
  songs: OpenSubsonicSong[],
  deps: ArtistViewDependencies
): void {
  const container = document.getElementById('artist-songs')!;
  
  if (songs.length === 0) {
    container.innerHTML = '<p class="no-items">No songs found</p>';
    return;
  }

  const songsListContainer = createUnifiedSongsContainer(
    songs,
    'album',
    deps.getCoverArtUrl,
    deps.getStreamUrl,
    deps.createStarRating
  );
  container.innerHTML = '';
  container.className = 'songs-container';
  container.appendChild(songsListContainer);

  // Add click listeners for artist and album links in songs
  deps.addSongClickListeners(container);

  // Load waveform backgrounds asynchronously
  setTimeout(() => deps.loadVisibleSongWaveforms(container), 100);
}

/**
 * Render similar artists section
 */
function renderSimilarArtists(
  similarArtists: any[],
  deps: ArtistViewDependencies
): void {
  const similarSection = document.getElementById('similar-artists-section');
  if (!similarSection) return;

  similarSection.style.display = 'block';
  const container = document.getElementById('similar-artists');
  if (!container) return;

  const artistsHtml = similarArtists.map((simArtist: any) => `
    <div class="artist-card clickable" data-artist-id="${simArtist.id}">
      <div class="artist-image" data-artist-id="${simArtist.id}">
        <div class="no-cover">🎤</div>
      </div>
      <h4 class="artist-name">${escapeHtml(simArtist.name)}</h4>
    </div>
  `).join('');

  container.className = 'horizontal-scroll';
  container.innerHTML = artistsHtml;

  // Add drag scrolling
  deps.addDragScrolling(container as HTMLElement);

  // Load artist images asynchronously
  deps.loadArtistImages(container, similarArtists);

  // Add click events
  container.querySelectorAll('[data-artist-id]').forEach(card => {
    card.addEventListener('click', () => {
      const artistId = card.getAttribute('data-artist-id');
      const simArtist = similarArtists.find((a: any) => a.id === artistId);
      if (simArtist) {
        const clickedArtist: OpenSubsonicArtist = {
          id: simArtist.id,
          name: simArtist.name,
          albumCount: simArtist.albumCount || 0
        };
        console.log(`🎤 Similar Artist clicked: "${simArtist.name}"`);
        deps.showArtist(clickedArtist);
      }
    });
  });
}
