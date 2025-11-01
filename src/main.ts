import "./style.css";
import { SubsonicApiClient, type OpenSubsonicSong, type OpenSubsonicAlbum, type OpenSubsonicArtist, type OpenSubsonicPlaylist, type OpenSubsonicArtistRef } from "./opensubsonic";
import { AzuraCastWebcaster, createAzuraCastConfig, fetchAzuraCastStations, fetchAllAzuraCastStations, type AzuraCastMetadata, type AzuraCastStation, type AzuraCastNowPlayingResponse } from "./azuracast";
import { azuraCastWebSocket, type AzuraCastNowPlayingData } from "./azuracast-websocket";
import { SetupWizard } from "./setup-wizard";
import { loadConfig, getConfigValue as getRuntimeConfigValue } from "../js/config-loader";
import { updateChecker } from "./update-checker";
import { initElectronTitlebar } from "./electron-titlebar";
import * as THREE from 'three';

// 🚀 WebGPU & Hardware Acceleration
import { initWebGPU, isWebGPUAvailable, enableHardwareAcceleration } from './webgpu-utils';

// 🎵 NEW AUDIO SYSTEM - Phase 1, 2, 3, 4, 5 & 6
import * as AudioManager from './audio/AudioManager';
import { getOrCreateSourceNode as getOrCreateSourceNodeNew, removeSourceNode, hasSourceNode } from './audio/SourceNodeCache';
import * as Mixer from './audio/Mixer';
import { Deck, type DeckSide } from './audio/Deck';
import * as MicManager from './audio/MicManager';
import { volumeMeters } from './audio/VolumeMeters';
import { CustomWaveform, createCustomWaveform } from './audio/CustomWaveform';

// 🎯 Context Menu System
import { ContextMenu, showAlbumContextMenu, showSongContextMenu } from './contextMenu';

console.log("SubCaster loaded!");

// ========================================
// 🔙 NAVIGATION HISTORY SYSTEM
// ========================================
// Enables browser-like navigation with mouse back/forward buttons

interface NavigationState {
  type: 'browse' | 'home' | 'artist' | 'album' | 'search';
  data?: any;
}

class NavigationHistory {
  private history: NavigationState[] = [];
  private currentIndex: number = -1;
  private maxHistorySize: number = 50;
  private isNavigating: boolean = false;

  constructor() {
    this.setupMouseButtons();
  }

  private setupMouseButtons() {
    // Listen for mouse button 3 (back) and 4 (forward)
    document.addEventListener('mouseup', (e) => {
      if (e.button === 3) { // Back button
        e.preventDefault();
        this.goBack();
      } else if (e.button === 4) { // Forward button
        e.preventDefault();
        this.goForward();
      }
    });

    // Prevent default browser navigation
    document.addEventListener('mousedown', (e) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
      }
    });
  }

  push(state: NavigationState) {
    // Don't add to history if we're currently navigating (back/forward)
    if (this.isNavigating) {
      this.isNavigating = false;
      return;
    }

    // Remove any forward history when pushing new state
    this.history = this.history.slice(0, this.currentIndex + 1);
    
    // Don't add duplicate states
    const lastState = this.history[this.history.length - 1];
    if (lastState && this.statesEqual(lastState, state)) {
      return;
    }

    // Add new state
    this.history.push(state);
    this.currentIndex++;

    // Limit history size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
      this.currentIndex--;
    }

    console.log(`📍 Navigation: Pushed ${state.type} state (${this.currentIndex + 1}/${this.history.length})`);
  }

  private statesEqual(a: NavigationState, b: NavigationState): boolean {
    if (a.type !== b.type) return false;
    
    if (a.type === 'home' || a.type === 'browse') return true;
    
    if (a.type === 'artist' && b.type === 'artist') {
      return a.data?.id === b.data?.id;
    }
    
    if (a.type === 'album' && b.type === 'album') {
      return a.data?.id === b.data?.id;
    }
    
    if (a.type === 'search' && b.type === 'search') {
      return a.data === b.data; // search term
    }
    
    return false;
  }

  canGoBack(): boolean {
    return this.currentIndex > 0;
  }

  canGoForward(): boolean {
    return this.currentIndex < this.history.length - 1;
  }

  goBack() {
    if (!this.canGoBack()) {
      console.log('🔙 Navigation: Cannot go back');
      return;
    }

    this.isNavigating = true;
    this.currentIndex--;
    const state = this.history[this.currentIndex];
    console.log(`🔙 Navigation: Going back to ${state.type} (${this.currentIndex + 1}/${this.history.length})`);
    this.restoreState(state);
  }

  goForward() {
    if (!this.canGoForward()) {
      console.log('🔜 Navigation: Cannot go forward');
      return;
    }

    this.isNavigating = true;
    this.currentIndex++;
    const state = this.history[this.currentIndex];
    console.log(`🔜 Navigation: Going forward to ${state.type} (${this.currentIndex + 1}/${this.history.length})`);
    this.restoreState(state);
  }

  private restoreState(state: NavigationState) {
    if (!libraryBrowser) return;

    switch (state.type) {
      case 'browse':
      case 'home':
        libraryBrowser.showHome();
        break;
      case 'artist':
        if (state.data) {
          libraryBrowser.showArtist(state.data);
        }
        break;
      case 'album':
        if (state.data) {
          libraryBrowser.showAlbum(state.data);
        }
        break;
      case 'search':
        if (state.data) {
          libraryBrowser.performSearch(state.data);
        }
        break;
    }
  }
}

// Global navigation history instance
let navigationHistory: NavigationHistory;

// Initialize WebGPU
initWebGPU().then(() => {
  if (isWebGPUAvailable()) {
    console.log('🚀 WebGPU enabled for hardware acceleration');
  } else {
    console.log('ℹ️ WebGPU not available - using CPU fallback');
  }
});

// Global runtime configuration (loaded from backend at startup)
let runtimeConfig: Record<string, string> = {};
let configLoaded = false;

// Load configuration from backend on startup
async function initializeConfig() {
  try {
    console.log('🔧 Loading configuration from backend...');
    const config = await loadConfig();
    
    // Map backend config to old VITE_* format for compatibility
    runtimeConfig = {
      'VITE_OPENSUBSONIC_URL': config.opensubsonic.url,
      'VITE_OPENSUBSONIC_USERNAME': config.opensubsonic.username,
      'VITE_AZURACAST_SERVERS': config.azuracast.servers,
      'VITE_AZURACAST_STATION_ID': config.azuracast.stationId,
      'VITE_DISCORD_CHANNEL_ID': config.discord.channelId,
      'VITE_DISCORD_GUILD_ID': config.discord.guildId,
      'VITE_STREAM_BITRATE': config.stream.bitrate,
      'VITE_STREAM_SAMPLE_RATE': config.stream.sampleRate,
      'VITE_DECK_CONFIGURATION': config.deckConfiguration,
      'VITE_USE_UNIFIED_LOGIN': String(config.unifiedLogin.enabled),
      'VITE_BLACKLISTED_GENRES': config.blacklistedGenres || '',
    };
    
    configLoaded = true;
    
    // Lade blacklisted genres
    loadBlacklistedGenres();
    
    console.log('✅ Configuration loaded from backend (no secrets exposed!)');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to load backend configuration:', error);
    console.warn('⚠️ Falling back to build-time config (if available)');
    return false;
  }
}

// Helper function to get config value (runtime config from backend takes precedence)
function getConfigValue(key: string): string | undefined {
  // First: Runtime config from backend (secure!)
  if (key in runtimeConfig) {
    return runtimeConfig[key];
  }
  
  // ❌ KEIN Fallback mehr zu import.meta.env - würde ALLE Secrets embedden!
  // Nur Runtime-Config vom Backend wird verwendet (secure!)
  console.warn(`⚠️ Config key '${key}' not found in runtime config from backend`);
  
  return undefined;
}

// Blacklisted Genres für Live-Streaming
let blacklistedGenres: string[] = [];

function loadBlacklistedGenres() {
  const genresConfig = getConfigValue('VITE_BLACKLISTED_GENRES') || '';
  console.log('🔍 Loading blacklisted genres from config:', genresConfig);
  
  blacklistedGenres = genresConfig
    .split(',')
    .map(g => g.trim().toLowerCase())
    .filter(g => g.length > 0);
  
  console.log('🚫 Blacklisted genres for streaming:', blacklistedGenres);
  console.log('🚫 Total blacklisted genres count:', blacklistedGenres.length);
}

// Prüfe ob Song ein blacklisted Genre hat
function hasBlacklistedGenre(song: OpenSubsonicSong): boolean {
  if (!song.genre || blacklistedGenres.length === 0) {
    return false;
  }
  
  // Genre kann multi-valued sein (komma-separiert)
  const songGenres = song.genre.toLowerCase().split(/[,;/]/).map(g => g.trim());
  
  console.log('🔍 Checking blacklist:', {
    songTitle: song.title,
    songGenre: song.genre,
    songGenresArray: songGenres,
    blacklistedGenres: blacklistedGenres
  });
  
  // Prüfe ob eines der Song-Genres auf der Blacklist ist
  const isBlacklisted = songGenres.some(genre => 
    blacklistedGenres.some(blacklisted => {
      const matches = genre.includes(blacklisted);
      if (matches) {
        console.warn(`🚫 MATCH FOUND: "${genre}" contains blacklisted "${blacklisted}"`);
      }
      return matches;
    })
  );
  
  return isBlacklisted;
}

// Global metadata update function - used for immediate metadata broadcasting
function broadcastCurrentMetadata(force: boolean = false) {
  console.log(`🔍 broadcastCurrentMetadata called (force: ${force})`);
  
  if (azuraCastWebcaster?.getConnectionStatus()) {
    console.log(`🔗 AzuraCast connected, getting current track...`);
    const currentTrack = getCurrentTrackMetadata();
    
    if (currentTrack) {
      console.log(`🎵 Current track found: ${currentTrack.artist} - ${currentTrack.title}`);
      azuraCastWebcaster.updateMetadataImmediate(currentTrack);
      if (force) {
        console.log(`🎯 Forced metadata broadcast: ${currentTrack.artist} - ${currentTrack.title}`);
      }
    } else {
      console.log(`❌ No current track found, using fallback metadata`);
      azuraCastWebcaster.updateMetadataImmediate(); // Fallback metadata
      if (force) {
        console.log('🎯 Forced metadata broadcast (fallback)');
      }
    }
  } else {
    console.log(`❌ AzuraCast not connected, skipping metadata broadcast`);
  }
}

// ========================================
// 🎯 GLOBAL SONG LOCATION TRACKING SYSTEM
// ========================================
// Ensures that every song exists at EXACTLY ONE location at any time
// Songs are MOVED, not COPIED, between queue and decks
// This prevents duplicates and ensures data integrity

type SongLocation = 
  | { type: 'queue'; queueIndex: number }
  | { type: 'deck'; deck: 'a' | 'b' | 'c' | 'd' }
  | { type: 'nowhere' }; // Song was removed/played

// Central registry: songId -> location
const songLocationRegistry = new Map<string, SongLocation>();

/**
 * Register song location in the global registry
 * @throws Error if song already exists at a different location
 */
function registerSongLocation(songId: string, location: SongLocation) {
  const existingLocation = songLocationRegistry.get(songId);
  
  if (existingLocation && existingLocation.type !== 'nowhere') {
    console.error(`❌ [SongRegistry] Song ${songId} already exists at:`, existingLocation);
    throw new Error(`Song ${songId} already exists at ${existingLocation.type}`);
  }
  
  songLocationRegistry.set(songId, location);
  console.log(`📍 [SongRegistry] Registered song ${songId} at:`, location);
}

/**
 * Unregister song from its current location
 */
function unregisterSongLocation(songId: string) {
  const location = songLocationRegistry.get(songId);
  if (location) {
    console.log(`🗑️ [SongRegistry] Unregistered song ${songId} from:`, location);
  }
  songLocationRegistry.set(songId, { type: 'nowhere' });
}

/**
 * Move song from one location to another
 * Automatically handles cleanup at old location
 */
function moveSong(songId: string, fromLocation: SongLocation, toLocation: SongLocation): boolean {
  const currentLocation = songLocationRegistry.get(songId);
  
  // Verify song is at expected location
  if (!currentLocation || JSON.stringify(currentLocation) !== JSON.stringify(fromLocation)) {
    console.error(`❌ [SongRegistry] Cannot move song ${songId}: not at expected location`, {
      expected: fromLocation,
      actual: currentLocation
    });
    return false;
  }
  
  // Update registry
  songLocationRegistry.set(songId, toLocation);
  console.log(`🚚 [SongRegistry] Moved song ${songId}:`, { from: fromLocation, to: toLocation });
  
  return true;
}

/**
 * Check if song exists anywhere in the system
 */
function getSongLocation(songId: string): SongLocation | null {
  return songLocationRegistry.get(songId) || null;
}

/**
 * Check if song is on any deck
 */
function isSongOnAnyDeck(songId: string): 'a' | 'b' | 'c' | 'd' | null {
  const location = songLocationRegistry.get(songId);
  if (location && location.type === 'deck') {
    return location.deck;
  }
  return null;
}

/**
 * Check if song is in queue
 */
function isSongInQueue(songId: string): boolean {
  const location = songLocationRegistry.get(songId);
  return location?.type === 'queue';
}

// ========================================
// 🔒 DECK LOADING LOCK SYSTEM
// ========================================
// Prevents multiple songs from loading simultaneously on decks
// Each deck can only load one song at a time
// Includes timeout protection to prevent permanent locks

type DeckLoadingState = {
  isLoading: boolean;
  songId: string | null;
  startTime: number;
};

const deckLoadingLocks: Record<'a' | 'b' | 'c' | 'd', DeckLoadingState> = {
  a: { isLoading: false, songId: null, startTime: 0 },
  b: { isLoading: false, songId: null, startTime: 0 },
  c: { isLoading: false, songId: null, startTime: 0 },
  d: { isLoading: false, songId: null, startTime: 0 }
};

// Maximum time a deck can be in loading state (30 seconds)
const DECK_LOADING_TIMEOUT = 30000;

/**
 * Check if deck is currently loading a song
 */
function isDeckLoading(deck: 'a' | 'b' | 'c' | 'd'): boolean {
  const lock = deckLoadingLocks[deck];
  
  // Check for timeout
  if (lock.isLoading) {
    const elapsed = Date.now() - lock.startTime;
    if (elapsed > DECK_LOADING_TIMEOUT) {
      console.warn(`⚠️ [LoadingLock] Deck ${deck.toUpperCase()} loading timeout (${elapsed}ms) - releasing lock`);
      releaseDeckLoadingLock(deck);
      return false;
    }
  }
  
  return lock.isLoading;
}

/**
 * Acquire loading lock for deck
 * Returns true if lock was acquired, false if deck is already loading
 */
function acquireDeckLoadingLock(deck: 'a' | 'b' | 'c' | 'd', songId: string): boolean {
  if (isDeckLoading(deck)) {
    console.warn(`⚠️ [LoadingLock] Deck ${deck.toUpperCase()} is already loading song ${deckLoadingLocks[deck].songId}`);
    return false;
  }
  
  deckLoadingLocks[deck] = {
    isLoading: true,
    songId: songId,
    startTime: Date.now()
  };
  
  console.log(`🔒 [LoadingLock] Acquired lock for Deck ${deck.toUpperCase()} (song: ${songId})`);
  return true;
}

/**
 * Release loading lock for deck
 */
function releaseDeckLoadingLock(deck: 'a' | 'b' | 'c' | 'd') {
  const lock = deckLoadingLocks[deck];
  if (lock.isLoading) {
    const elapsed = Date.now() - lock.startTime;
    console.log(`🔓 [LoadingLock] Released lock for Deck ${deck.toUpperCase()} (${elapsed}ms)`);
  }
  
  deckLoadingLocks[deck] = {
    isLoading: false,
    songId: null,
    startTime: 0
  };
}

// Helper: Artist Image URL mit 300px Größe
function getArtistImageUrl(imageUrl: string | undefined, size: number = 300): string {
  if (!imageUrl) return '';
  
  // Remove existing size parameter
  let url = imageUrl.replace(/[?&]size=\d+/g, '');
  
  // Add size parameter
  url += (url.includes('?') ? '&' : '?') + `size=${size}`;
  
  return url;
}

// User status update function
function updateUserStatus(service: 'opensubsonic' | 'stream', username: string, connected: boolean) {
  if (service === 'opensubsonic') {
    const indicator = document.getElementById('opensubsonic-user-status');
    const label = document.getElementById('opensubsonic-username');
    
    if (indicator) {
      if (connected) {
        indicator.classList.add('connected');
        indicator.classList.remove('disconnected');
      } else {
        indicator.classList.add('disconnected');
        indicator.classList.remove('connected');
      }
    }
    
    if (label) {
      label.textContent = connected ? username : '-';
    }
  } else if (service === 'stream') {
    const indicator = document.getElementById('stream-live-status');
    const label = document.getElementById('stream-username-display');
    
    if (indicator) {
      if (connected) {
        indicator.classList.add('connected');
        indicator.classList.remove('disconnected');
      } else {
        indicator.classList.add('disconnected');
        indicator.classList.remove('connected');
        indicator.classList.remove('live'); // Remove live state when disconnected
      }
    }
    
    if (label) {
      label.textContent = connected ? username : '-';
    }
  }
  
  console.log(`🔄 Updated ${service} status: ${connected ? `connected as ${username}` : 'disconnected'}`);
}

// Global variables
let libraryBrowser: any; // Wird später als LibraryBrowser initialisiert
// let volumeMeterIntervals: { [key: string]: NodeJS.Timeout }; // Wird später definiert

// 🆕 NEW: Deck instances for managing player decks (imported above)
const deckInstances: Map<DeckSide, Deck> = new Map();

// Helper to get or create a Deck instance
function getDeck(side: DeckSide): Deck | null {
  return deckInstances.get(side) || null;
}

// Global flag to track if we're in setup-only mode
let isSetupOnlyMode = false;

// Queue for initialization functions that need to wait for class definitions
let pendingInitializations: (() => void)[] = [];

// AzuraCast WebDJ Integration
let azuraCastWebcaster: AzuraCastWebcaster | null = null;
let isStreaming = false;

// Global state for search results
let lastSearchResults: any = null;
let lastSearchQuery: string = '';

// Track storage for each deck to enable drag & drop between decks
const deckSongs: {
  a: OpenSubsonicSong | null;
  b: OpenSubsonicSong | null;
  c: OpenSubsonicSong | null;
  d: OpenSubsonicSong | null;
} = {
  a: null,
  b: null,
  c: null,
  d: null
};

// Audio Mixing Infrastruktur
let audioContext: AudioContext | null = null;
let masterGainNode: GainNode | null = null;
let streamGainNode: GainNode | null = null; // Monitor/Kopfhörer-Ausgabe
let masterAudioDestination: MediaStreamAudioDestinationNode | null = null; // For streaming
let aPlayerGain: GainNode | null = null;
let bPlayerGain: GainNode | null = null;
let cPlayerGain: GainNode | null = null;
let dPlayerGain: GainNode | null = null;
let microphoneGain: GainNode | null = null;
// REMOVED: crossfaderGain - now handled by Mixer module with direct routing (no crossfading)
let microphoneStream: MediaStream | null = null;

// Radio Broadcast Processing Nodes
let micCompressorNode: DynamicsCompressorNode | null = null;
// micGateNode removed - was just a gain reducer, not a real noise gate
let micEqLowNode: BiquadFilterNode | null = null;
let micEqMidNode: BiquadFilterNode | null = null;
let micEqHighNode: BiquadFilterNode | null = null;
let micLimiterNode: DynamicsCompressorNode | null = null;
let micDeEsserNode: DynamicsCompressorNode | null = null;
let micProcessingGain: GainNode | null = null;

// Radio Processing State
let micProcessingState = {
  compressor: true,    // Default ON - essential for broadcast
  // gate removed - was ineffective (just reduced gain, didn't gate noise)
  eq: true,            // Default ON - speech optimization
  limiter: true,       // Default ON - prevents clipping
  deesser: false       // Default OFF - only when needed
};

// Audio Cleanup Function - Essential for preventing browser audio conflicts
function cleanupAudioResources(): void {
  console.log('🧹 Cleaning up audio resources...');
  
  try {
    // Stop volume meter animation loop (Phase 6)
    stopVolumeMeterAnimationLoop();
    
    // Cleanup VolumeMeters module (Phase 6)
    volumeMeters.disposeAll();
    
    // Stop microphone stream and all tracks
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => {
        track.stop();
        console.log('🎤 Microphone track stopped');
      });
      microphoneStream = null;
    }
    
    // Cleanup MicManager module (Phase 4)
    MicManager.cleanup();
    
    // Cleanup Mixer module (Phase 3)
    Mixer.cleanup();
    
    // Close AudioManager (includes AudioContext and SourceNodeCache cleanup)
    AudioManager.close();
    
    // Close legacy AudioContext (will be removed once migration complete)
    if (audioContext && audioContext.state !== 'closed') {
      audioContext.close().then(() => {
        console.log('🔊 Legacy AudioContext closed successfully');
      }).catch((error) => {
        console.warn('⚠️ Legacy AudioContext close error:', error);
      });
      audioContext = null;
    }
    
    // Reset all gain nodes
    masterGainNode = null;
    streamGainNode = null;
    masterAudioDestination = null;
    aPlayerGain = null;
    bPlayerGain = null;
    cPlayerGain = null;
    dPlayerGain = null;
    microphoneGain = null;
    // REMOVED: crossfaderGain - no longer needed (direct routing)
    
    console.log('✅ Audio resources cleaned up successfully');
  } catch (error) {
    console.error('❌ Error during audio cleanup:', error);
  }
}

// Register cleanup handlers
window.addEventListener('beforeunload', (event) => {
  console.log('🔄 Page reload/close detected - cleaning up audio resources');
  cleanupAudioResources();
});

window.addEventListener('unload', () => {
  console.log('🔄 Page unload - final cleanup');
  cleanupAudioResources();
});

// BROWSER-AUDIO-KOMPATIBILITÄT: Page Visibility Handling für bessere Koexistenz
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('📱 Page hidden - optimizing for background audio compatibility');
    // DON'T suspend AudioContext - this would stop all players!
    // Aber reduziere Resource Usage für bessere Browser-Kompatibilität
    
    // Reduziere Analyser-Updates wenn Seite nicht sichtbar
    if ((window as any).volumeMeterAnimationId) {
      cancelAnimationFrame((window as any).volumeMeterAnimationId);
      (window as any).volumeMeterAnimationId = null;
      console.log('⏸️ Volume meter animations paused for background compatibility');
    }
  } else {
    console.log('📱 Page visible - resuming full audio compatibility mode');
    
    // Ensure AudioContext is resumed if it was suspended
    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log('🔊 AudioContext resumed when page became visible');
      });
    }
    
    // Volume meters werden automatisch beim nächsten Audio-Update reaktiviert
  }
});

// AzuraCast Station Selection
let currentStationId: string | null = null;
let currentStationShortcode: string | null = null;
let currentServerUrl: string | null = null;

// Button States
const StreamButtonState = {
  SELECT_STATION: 'select_station',
  START_STREAMING: 'start_streaming', 
  STREAMING_ACTIVE: 'streaming_active'
} as const;
type StreamButtonState = typeof StreamButtonState[keyof typeof StreamButtonState];
let currentButtonState: StreamButtonState = StreamButtonState.SELECT_STATION;

// SMART METADATA PRIORITY SYSTEM
interface PlayerState {
  song: OpenSubsonicSong | null;
  isPlaying: boolean;
  startTime: number; // Timestamp when track started playing
  side: 'a' | 'b' | 'c' | 'd';
}

let playerStates: Record<'a' | 'b' | 'c' | 'd', PlayerState> = {
  a: { song: null, isPlaying: false, startTime: 0, side: 'a' },
  b: { song: null, isPlaying: false, startTime: 0, side: 'b' },
  c: { song: null, isPlaying: false, startTime: 0, side: 'c' },
  d: { song: null, isPlaying: false, startTime: 0, side: 'd' }
};

// ========================================
// 🎵 PLAY HISTORY SYSTEM
// ========================================
// Tracks songs that were played >50% and marks them with a scribble effect
// Songs: Red scribble (0-1h) → Gray scribble (1-2h) → Removed (>2h)
// Artists: Scribble for 1h, then removed

interface PlayHistoryEntry {
  songId: string;
  artistName: string;
  playedAt: number; // Timestamp
  progress: number; // 0-1 (percentage played)
}

// Track which songs have been marked as >50% played (per deck, per session)
const songsMarkedAsPlayed: Record<'a' | 'b' | 'c' | 'd', Set<string>> = {
  a: new Set(),
  b: new Set(),
  c: new Set(),
  d: new Set()
};

// Get play history from localStorage
function getPlayHistory(): PlayHistoryEntry[] {
  try {
    const history = localStorage.getItem('subcaster_play_history');
    if (!history) return [];
    const parsed = JSON.parse(history);
    
    // Clean up entries older than 2 hours
    const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
    const cleaned = parsed.filter((entry: PlayHistoryEntry) => entry.playedAt > twoHoursAgo);
    
    // Save cleaned history
    if (cleaned.length !== parsed.length) {
      savePlayHistory(cleaned);
    }
    
    return cleaned;
  } catch (e) {
    console.warn('Failed to load play history:', e);
    return [];
  }
}

// Save play history to localStorage
function savePlayHistory(history: PlayHistoryEntry[]): void {
  try {
    localStorage.setItem('subcaster_play_history', JSON.stringify(history));
  } catch (e) {
    console.warn('Failed to save play history:', e);
  }
}

// Add song to play history (called when >50% played)
function addSongToPlayHistory(song: OpenSubsonicSong, progress: number): void {
  const history = getPlayHistory();
  const now = Date.now();
  
  // Check if this song was already added recently (within last 5 minutes)
  const recentEntry = history.find(entry => 
    entry.songId === song.id && 
    (now - entry.playedAt) < (5 * 60 * 1000)
  );
  
  if (recentEntry) {
    console.log(`⏩ Song "${song.title}" already in recent play history, skipping`);
    return;
  }
  
  const entry: PlayHistoryEntry = {
    songId: song.id,
    artistName: song.artist || 'Unknown Artist',
    playedAt: now,
    progress: progress
  };
  
  history.push(entry);
  savePlayHistory(history);
  
  console.log(`✅ Added to play history: "${song.title}" by ${entry.artistName} (${Math.round(progress * 100)}% played)`);
  
  // Update library markers
  setTimeout(() => markSongsInLibrary(), 100);
  
  // Update queue display to reflect new play history (transparency, cooldown effects)
  updateQueueDisplay();
}

// Get time since song was last played (in hours)
function getTimeSinceLastPlayed(songId: string): number | null {
  const history = getPlayHistory();
  const entry = history.find(e => e.songId === songId);
  if (!entry) return null;
  
  const hoursSince = (Date.now() - entry.playedAt) / (1000 * 60 * 60);
  return hoursSince;
}

// Get time since artist was last played (in hours)
function getTimeSinceArtistPlayed(artistName: string): number | null {
  const history = getPlayHistory();
  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  
  const recentArtistPlay = history.find(e => 
    e.artistName === artistName && 
    e.playedAt > oneHourAgo
  );
  
  if (!recentArtistPlay) return null;
  
  const hoursSince = (Date.now() - recentArtistPlay.playedAt) / (1000 * 60 * 60);
  return hoursSince;
}

// Calculate scribble color based on time since played
function getScribbleColor(hoursSince: number): string {
  if (hoursSince < 1) {
    // 0-1h: Red
    const intensity = 1 - hoursSince; // 1.0 at 0h, 0.0 at 1h
    const red = Math.round(255 * intensity + 100 * (1 - intensity));
    const green = Math.round(50 * (1 - intensity));
    const blue = Math.round(50 * (1 - intensity));
    return `rgb(${red}, ${green}, ${blue})`;
  } else {
    // 1-2h: Transition from dark red to dark gray
    const progress = (hoursSince - 1); // 0.0 at 1h, 1.0 at 2h
    const red = Math.round(100 - 40 * progress);
    const gray = Math.round(50 + 30 * progress);
    return `rgb(${red}, ${gray}, ${gray})`;
  }
}



// Track player state changes
function setPlayerState(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong | null, isPlaying: boolean) {
  const state = playerStates[side];
  const wasPlaying = state.isPlaying;
  
  state.song = song;
  state.isPlaying = isPlaying;
  
  // Update start time if player just started playing
  if (isPlaying && !wasPlaying) {
    state.startTime = Date.now();
    console.log(`?? Player ${side.toUpperCase()} started: "${song?.title}" at ${state.startTime}`);
    
    // Auto-update stream metadata when a new track starts
    setTimeout(() => broadcastCurrentMetadata(true), 100); // Small delay to ensure state is updated
  } else if (!isPlaying && wasPlaying) {
    console.log(`?? Player ${side.toUpperCase()} stopped: "${song?.title}"`);
    
    // Auto-update stream metadata when a track stops (in case this was the priority track)
    setTimeout(() => broadcastCurrentMetadata(true), 100);
  }
}

// Get currently loaded song from player
function getCurrentLoadedSong(side: 'a' | 'b' | 'c' | 'd'): OpenSubsonicSong | null {
  const audio = getAudioElement(side);
  if (!audio || !audio.dataset.songId) return null;
  
  // Find song by ID in current songs or player state
  return playerStates[side].song || 
         currentSongs.find(song => song.id === audio.dataset.songId) || 
         null;
}

// Complete deck reset when track ends or eject is pressed
function clearPlayerDeck(side: 'a' | 'b' | 'c' | 'd') {
  console.log(`🔄 Clearing Player ${side.toUpperCase()} deck completely`);
  
  const audio = getAudioElement(side);
  
  // Get song ID BEFORE clearing (for library update and registry cleanup)
  const clearedSongId = audio?.dataset.songId || playerStates[side]?.song?.id;
  
  // ========================================
  // 🎯 UNREGISTER SONG FROM LOCATION REGISTRY
  // ========================================
  if (clearedSongId) {
    const location = getSongLocation(clearedSongId);
    if (location?.type === 'deck' && location.deck === side) {
      unregisterSongLocation(clearedSongId);
      console.log(`📍 [SongRegistry] Unregistered song ${clearedSongId} from deck ${side.toUpperCase()}`);
    }
  }
  
  const titleElement = document.getElementById(`track-title-${side}`);
  const artistElement = document.getElementById(`track-artist-${side}`);
  const albumCover = document.getElementById(`album-cover-${side}`) as HTMLElement;
  const playerRating = document.getElementById(`player-rating-${side}`);
  const timeDisplay = document.getElementById(`time-display-${side}`);
  const progressBar = document.getElementById(`progress-bar-${side}`);
  const volumeMeter = document.getElementById(`volume-meter-${side}`);
  const playerDeck = document.getElementById(`player-deck-${side}`);
  
  // ========================================
  // 🔊 RESET VOLUME TO DEFAULT (1.0 = 100%)
  // ========================================
  if (audio) {
    audio.volume = 1.0;
    console.log(`🔊 Reset volume for deck ${side.toUpperCase()} to 100%`);
  }
  
  // Reset volume slider UI
  const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
  if (volumeSlider) {
    volumeSlider.value = '100';
    console.log(`🎚️ Reset volume slider UI for deck ${side.toUpperCase()}`);
  }
  
  // Clear audio
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    
    // 🔧 ELECTRON FIX: Use SourceNodeCache for cleanup
    // Import at top: import { clearCache } from './audio/SourceNodeCache';
    // Note: SourceNodeCache uses WeakMap, so GC will handle cleanup automatically
    // But we can disconnect the node explicitly if it exists
    const sourceNode = getOrCreateSourceNode(audio);
    if (sourceNode) {
      try {
        sourceNode.disconnect();
        console.log(`🔌 Disconnected MediaElementSourceNode for player ${side}`);
      } catch (e) {
        // Already disconnected
      }
    }
    
    // Clear src and reset audio element
    audio.src = '';
    audio.load(); // Force reload to clean state
    audio.removeAttribute('src');
    
    console.log(`🎵 Audio element cleared for player ${side}`);
  }
  
  // Clear stored song data for drag & drop
  deckSongs[side] = null;
  
  // Clear radio stream refresh interval if exists
  const refreshInterval = (window as any)[`radioRefreshInterval_${side}`];
  if (refreshInterval) {
    clearInterval(refreshInterval);
    delete (window as any)[`radioRefreshInterval_${side}`];
    console.log(`🔄 Cleared radio stream refresh interval for deck ${side.toUpperCase()}`);
  }
  
  // Clear radio stream reconnect timers if exist
  const reconnectCleanup = (window as any)[`radioReconnectCleanup_${side}`];
  if (reconnectCleanup) {
    reconnectCleanup();
    delete (window as any)[`radioReconnectCleanup_${side}`];
    console.log(`🔄 Cleared radio stream reconnect timers for deck ${side.toUpperCase()}`);
  }
  
  // Clear radio track data if exists
  if ((window as any)[`radioTrack_${side}`]) {
    delete (window as any)[`radioTrack_${side}`];
    console.log(`📻 Cleared radio track data for deck ${side.toUpperCase()}`);
  }
  
  // Clear HTTP polling interval if exists
  const pollInterval = (window as any)[`radioPollInterval_${side}`];
  if (pollInterval) {
    clearInterval(pollInterval);
    delete (window as any)[`radioPollInterval_${side}`];
    console.log(`🔄 Cleared radio HTTP polling for deck ${side.toUpperCase()}`);
  }
  
  // Clear local file ObjectURL if exists (prevent memory leaks)
  const localObjectUrl = (window as any)[`localObjectUrl_${side}`];
  if (localObjectUrl) {
    URL.revokeObjectURL(localObjectUrl);
    delete (window as any)[`localObjectUrl_${side}`];
    console.log(`📁 Revoked local file ObjectURL for deck ${side.toUpperCase()}`);
  }
  
  // Clear local track data if exists
  if ((window as any)[`localTrack_${side}`]) {
    delete (window as any)[`localTrack_${side}`];
    console.log(`📁 Cleared local track data for deck ${side.toUpperCase()}`);
  }
  
  // Clear metadata display
  if (titleElement) titleElement.textContent = 'No Track Loaded';
  if (artistElement) artistElement.textContent = '';

  // Clear waveform info overlay
  clearWaveformInfo(side);
  
  // Clear album cover
  if (albumCover) {
    albumCover.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
  }
  
  // Clear rating but keep placeholder structure
  if (playerRating) {
    // Create placeholder stars to reserve space
    playerRating.innerHTML = `
      <div class="rating-stars placeholder">
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
        <span class="star empty">☆</span>
      </div>
    `;
  }
  
  // Clear time display
  if (timeDisplay) {
    timeDisplay.textContent = '00:00 / 00:00';
  }
  
  // Reset progress bar visual state
  if (progressBar) {
    const progressFill = progressBar.querySelector('.progress-fill');
    if (progressFill) {
      (progressFill as HTMLElement).style.width = '0%';
    }
  }
  
  // Clear volume meter
  if (volumeMeter) {
    const meterBars = volumeMeter.querySelectorAll('.meter-bar');
    meterBars.forEach(bar => {
      (bar as HTMLElement).classList.remove('active');
    });
  }
  
  // Remove player deck status classes
  if (playerDeck) {
    playerDeck.classList.remove('playing', 'loaded', 'has-track');
  }
  
  // Reset waveform completely
  clearWaveform(side);
  
  // Clear waveform blinking effects
  clearWaveformBlinking(side);
  
  // Clear player state
  setPlayerState(side, null, false);
  
  // Reset any loading indicators
  const loadingIndicator = document.getElementById(`waveform-loading-${side}`);
  if (loadingIndicator) {
    loadingIndicator.classList.remove('visible');
  }
  
  console.log(`✅ Player ${side.toUpperCase()} deck cleared COMPLETELY (including volume reset)`);
  
  // Update only the cleared song's status in library
  if (clearedSongId) {
    updateSongStatus(clearedSongId);
  }
}

// Get comprehensive deck state information
function getDeckState(side: 'a' | 'b' | 'c' | 'd'): 'empty' | 'loading' | 'ready' | 'playing' | 'paused' | 'ended' | 'error' {
  const audio = getAudioElement(side);
  
  if (!audio || !audio.src || audio.src === '') {
    return 'empty';
  }
  
  // Check for error states
  if (audio.error) {
    return 'error';
  }
  
  // Check loading state
  if (audio.readyState < 2) { // HAVE_CURRENT_DATA or less
    return 'loading';
  }
  
  // Check if track has ended
  if (audio.ended || (audio.duration > 0 && audio.currentTime >= audio.duration)) {
    return 'ended';
  }
  
  // Check playing state
  if (!audio.paused && audio.currentTime > 0) {
    return 'playing';
  }
  
  // Check paused state  
  if (audio.paused && audio.currentTime > 0) {
    return 'paused';
  }
  
  // Track is loaded and ready to play
  return 'ready';
}

// Check if a deck is currently playing
function isDeckPlaying(side: 'a' | 'b' | 'c' | 'd'): boolean {
  const audio = getAudioElement(side);
  return !!audio && !audio.paused && audio.currentTime > 0 && !audio.ended;
}

// Check if deck is truly available for new content
function isDeckAvailableForNewTrack(side: 'a' | 'b' | 'c' | 'd'): boolean {
  const state = getDeckState(side);
  
  // ❌ CRITICAL: Deck must be in empty/ended/error state
  if (!(state === 'empty' || state === 'ended' || state === 'error')) {
    return false;
  }
  
  // ✅ ADDITIONAL CHECK: Deck must NOT have a song loaded
  // This prevents overwriting decks that still have a valid song
  const currentSong = getCurrentLoadedSong(side);
  if (currentSong) {
    console.log(`⚠️ [isDeckAvailable] Deck ${side.toUpperCase()} has song "${currentSong.title}" - NOT available`);
    return false; // Deck has a song, NOT available for new track
  }
  
  return true; // Deck is truly empty and available
}

/**
 * Check if a song is already loaded on any deck (excluding specified deck)
 * Returns the deck letter if found, null otherwise
 */
function isSongLoadedOnAnyDeck(songId: string, excludeDeck?: 'a' | 'b' | 'c' | 'd'): 'a' | 'b' | 'c' | 'd' | null {
  const allDecks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  for (const deck of allDecks) {
    // Skip the excluded deck (usually the target deck we want to load to)
    if (excludeDeck && deck === excludeDeck) continue;
    
    const loadedSong = getCurrentLoadedSong(deck);
    if (loadedSong && loadedSong.id === songId) {
      return deck; // Song found on this deck
    }
  }
  
  return null; // Song not found on any deck
}

// Debug function to show current player states
function debugPlayerStates() {
  console.log('?? CURRENT PLAYER STATES DEBUG:');
  console.log('Player A:', playerStates.a);
  console.log('Player B:', playerStates.b);
  console.log('Player C:', playerStates.c);
  console.log('Player D:', playerStates.d);
}

// Make debug function available globally
(window as any).debugPlayerStates = debugPlayerStates;

// Streaming Konfiguration
interface StreamConfig {
  serverUrl: string;
  serverType: 'icecast' | 'shoutcast';
  mountPoint: string; // nur für Icecast und Shoutcast v2
  password: string;
  bitrate: number;
  format: 'mp3' | 'aac';
  sampleRate: number;
  username?: string; // für manche Server
}

let streamConfig: StreamConfig = {
  serverUrl: '', // No longer used for actual streaming
  serverType: 'icecast',
  mountPoint: '/live',
  password: '',
  bitrate: 192,
  format: 'mp3',
  sampleRate: 48000,
  username: ''
};

// Hilfsfunktion für Stream-Server-URL mit Proxy-Unterstützung


// AUDIO MIXING FUNCTIONS (Moved up for proper scoping)

// Audio-Mixing-System initialisieren
// 🎵 NEW: Facade to AudioManager + Mixer modules (Phase 1 & 3)
async function initializeAudioMixing() {
  try {
    console.log('🎵 Initializing audio mixing (routing to new AudioManager + Mixer)...');
    
    // Initialize AudioManager first
    await AudioManager.init();
    
    // Initialize Mixer (direct routing, no crossfader)
    Mixer.init();
    
    // Get references to nodes for backwards compatibility
    const ctx = AudioManager.getContext();
    audioContext = ctx;
    
    // Get gain nodes from AudioManager
    masterGainNode = AudioManager.getMasterGain();
    streamGainNode = AudioManager.getStreamGain(); // Now properly exposed
    
    const streamDest = AudioManager.getStreamDestination();
    if (streamDest) {
      masterAudioDestination = streamDest;
    }
    
    // Get per-deck gains
    aPlayerGain = AudioManager.getDeckGain('a');
    bPlayerGain = AudioManager.getDeckGain('b');
    cPlayerGain = AudioManager.getDeckGain('c');
    dPlayerGain = AudioManager.getDeckGain('d');
    microphoneGain = AudioManager.getMicrophoneGain();
    
    // REMOVED: crossfaderGain - no longer needed (direct routing)
    
    console.log('✅ Audio mixing initialized via AudioManager + Mixer');
    console.log('🎛️ Routing: Decks → Direct → [Master + Stream] (no crossfader)');
    
    // Initialize VolumeMeters (NEW Phase 6 integration)
    console.log('📊 Initializing VolumeMeters module...');
    try {
      initializeVolumeMeters();
      console.log('✅ VolumeMeters initialized successfully');
    } catch (error) {
      console.error('⚠️ Error initializing VolumeMeters:', error);
    }
    
    return true;
  } catch (error) {
    console.error('Failed to initialize audio mixing:', error);
    return false;
  }
}

/**
 * Initialize VolumeMeters module for all audio sources
 * 🎵 NEW: Phase 6 - Centralized meter management
 */
function initializeVolumeMeters() {
  console.log('📊 Creating meters for all audio sources...');
  
  // Create meters for deck gain nodes
  if (aPlayerGain) volumeMeters.createMeter('deck-a', aPlayerGain);
  if (bPlayerGain) volumeMeters.createMeter('deck-b', bPlayerGain);
  if (cPlayerGain) volumeMeters.createMeter('deck-c', cPlayerGain);
  if (dPlayerGain) volumeMeters.createMeter('deck-d', dPlayerGain);
  
  // Create meter for microphone
  if (microphoneGain) volumeMeters.createMeter('mic', microphoneGain);
  
  // Create meters for master/stream outputs
  if (masterGainNode) volumeMeters.createMeter('master', masterGainNode);
  if (streamGainNode) volumeMeters.createMeter('stream', streamGainNode);
  
  console.log(`📊 Created ${volumeMeters.getMeterCount()} meters`);
  
  // Start animation loop for UI updates
  startVolumeMeterAnimationLoop();
}

/**
 * Animation loop for VolumeMeters UI updates
 * Updates all VU meter displays at 30 FPS
 */
let volumeMeterAnimationId: number | null = null;

function startVolumeMeterAnimationLoop() {
  if (volumeMeterAnimationId !== null) {
    console.log('📊 VolumeMeters animation loop already running');
    return;
  }
  
  const meterMap: Record<string, string> = {
    'deck-a': 'volume-meter-a',
    'deck-b': 'volume-meter-b',
    'deck-c': 'volume-meter-c',
    'deck-d': 'volume-meter-d',
    'mic': 'mic-volume-meter',
    'master': 'deck-master-meter',
    'stream': 'stream-output-meter'
  };
  
  function animate() {
    // Get all readings at once
    const readings = volumeMeters.getAllReadings();
    
    // Update each meter UI
    for (const [meterId, reading] of readings) {
      const uiElementId = meterMap[meterId];
      if (!uiElementId) continue;
      
      // Convert RMS to LED bar level (0-8)
      // dB range: -∞ to 0, typical speech/music: -40 to -10 dB
      const db = reading.db;
      let ledLevel = 0;
      
      if (db > -60) {
        // Map -60dB to 0dB → 0 to 8 LEDs
        ledLevel = Math.floor(((db + 60) / 60) * 8);
        ledLevel = Math.max(0, Math.min(8, ledLevel));
      }
      
      updateVolumeMeter(uiElementId, ledLevel);
    }
    
    // Continue loop
    volumeMeterAnimationId = requestAnimationFrame(animate);
  }
  
  // Start the loop
  volumeMeterAnimationId = requestAnimationFrame(animate);
  console.log('📊 VolumeMeters animation loop started');
}

function stopVolumeMeterAnimationLoop() {
  if (volumeMeterAnimationId !== null) {
    cancelAnimationFrame(volumeMeterAnimationId);
    volumeMeterAnimationId = null;
    console.log('📊 VolumeMeters animation loop stopped');
  }
}

// Audio-Quellen zu Mixing-System hinzufügen
function connectAudioToMixer(audioElement: HTMLAudioElement, side: 'a' | 'b' | 'c' | 'd') {
  if (!audioContext) {
    console.error(`❌ AudioContext not initialized for ${side} player`);
    return false;
  }
  
  // FEHLERFIX: Zusätzliche Validierung für bessere Stabilität
  if (!audioElement || audioElement.readyState === 0) {
    console.warn(`⚠️ Audio element not ready for ${side} player - retrying later`);
    return false;
  }
  
  try {
    // 🔧 ELECTRON FIX: Delay Web Audio API connection until audio is actually playing
    // This prevents ACCESS_VIOLATION crash (0xC0000005) in Electron when connecting
    // a loaded-but-not-playing audio element to the Web Audio API
    if (audioElement.paused && audioElement.currentTime === 0) {
      console.log(`⏸️ ${side} player: audio not yet playing - deferring Web Audio connection`);
      // Mark as ready to connect when play event fires
      (audioElement as any)._pendingMixerConnection = true;
      return false; // Not connected yet, but will connect on play
    }
    
    // FEHLERFIX: Ensure AudioContext is running before creating connections (non-blocking)
    if (audioContext.state === 'suspended') {
      audioContext.resume().then(() => {
        console.log(`🔊 AudioContext resumed for ${side} player connection`);
      }).catch(err => {
        console.warn(`⚠️ AudioContext resume failed:`, err);
      });
    }
    
    // Audio routing always through Web Audio API for monitoring and mixing
    console.log(`🎚️ ${side} player: connecting to Web Audio API for monitoring`);
    
    // NUR BEIM STREAMING: Web Audio API verwenden
    // WICHTIG: Audio Element Eigenschaften für bessere Browser-Kompatibilität setzen
    audioElement.crossOrigin = 'anonymous';
    audioElement.preservesPitch = false; // Weniger CPU-intensiv
    
    // 🔧 ELECTRON FIX: Use centralized SourceNode management
    // This prevents creating duplicate MediaElementSourceNodes which causes crashes
    const sourceNode = getOrCreateSourceNode(audioElement);
    if (!sourceNode) {
      console.error(`❌ ${side} player: Failed to get MediaElementSourceNode`);
      return false;
    }
    console.log(`✅ ${side} player: MediaElementSourceNode ready`);
    
    // Mit entsprechendem Player Gain verbinden
    if (side === 'a' && aPlayerGain) {
      sourceNode.connect(aPlayerGain);
      console.log(`🎵 ${side} player connected to aPlayerGain for streaming`);
      
    } else if (side === 'b' && bPlayerGain) {
      sourceNode.connect(bPlayerGain);
      console.log(`🎵 ${side} player connected to bPlayerGain for streaming`);
      
    } else if (side === 'c' && cPlayerGain) {
      sourceNode.connect(cPlayerGain);
      console.log(`🎵 ${side} player connected to cPlayerGain for streaming`);
      
    } else if (side === 'd' && dPlayerGain) {
      sourceNode.connect(dPlayerGain);
      console.log(`🎵 ${side} player connected to dPlayerGain for streaming`);
      
    } else {
      console.error(`❌ Failed to connect ${side} player: gain node not available`);
      return false;
    }
    
    console.log(`💡 Audio Flow when STREAMING: ${side} Player → Web Audio API → [Monitor + Stream]`);
    console.log(`💡 Audio Flow when NOT streaming: ${side} Player → Browser Audio → Headphones`);
    
    return true;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('AudioNode is already connected')) {
      console.log(`? ${side} player already connected to mixer`);
      return true;
    } else if (errorMsg.includes('MediaElementAudioSource')) {
      console.warn(`??  ${side} player already has MediaElementSource - this is normal for track changes`);
      return true;
    } else {
      console.error(`? Failed to connect ${side} player to mixer:`, error);
      return false;
    }
  }
}

// Player Deck Fragment Template
function createPlayerDeckHTML(side: 'a' | 'b' | 'c' | 'd'): string {
  const playerLetter = side.toUpperCase();
  const labelClass = side;
  
  return `
    <div class="player-label ${labelClass}">
      <div class="player-label-dot"></div>
      <span class="player-label-text">Player ${playerLetter}</span>
      <!-- Audio element will be created by WaveSurfer -->
      <!-- Hidden track info elements for JavaScript -->
      <div style="display: none;">
        <div class="track-title" id="track-title-${side}">No Track Loaded</div>
        <div class="track-artist" id="track-artist-${side}">-</div>
      </div>
    </div>
    
    <!-- Player Main Content (Album + Waveform) -->
    <div class="player-main">
      <!-- Top Section: Album Cover Only -->
      <div class="player-top-section">
        <div class="album-section">
          <div class="album-cover" id="album-cover-${side}">
            <div class="no-cover">
              <span class="material-icons">music_note</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Waveform Section (Full Width) -->
      <div class="waveform-container">
        <!-- Zoomable waveform (top, no seek) -->
        <div class="waveform-zoom" id="waveform-${side}-zoom"></div>
        <!-- Overview waveform (bottom, seekable) -->
        <div class="waveform-overview" id="waveform-${side}-overview"></div>
        <div class="waveform-loading" id="waveform-loading-${side}">Loading...</div>
        <!-- Glass overlay with gradient -->
        <div class="waveform-glass-overlay"></div>
        <div class="waveform-track-info" id="waveform-info-${side}">
          <!-- Large centered title -->
          <div class="track-title-large">
            <span class="track-title"></span>
          </div>
          <!-- Bottom left: artist and album stacked -->
          <div class="track-details-bottom-left">
            <div class="track-artist-line">
              <span class="track-artist"></span>
            </div>
            <div class="track-album-line">
              <span class="track-album"></span>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Controls Bar (Outside player-main, spans full width) -->
    <div class="controls-bar">
      <div class="controls-line-breadcrumb">
        <!-- LEFT SECTION: Transport Controls (Fixed) -->
        <div class="controls-left-section">
          <button class="breadcrumb-btn play-pause-btn" id="play-pause-${side}" title="Play/Pause">
            <span class="material-icons">play_arrow</span>
          </button>
          <button class="breadcrumb-btn restart-btn" id="restart-${side}" title="Restart">
            <span class="material-icons">skip_previous</span>
          </button>
          <button class="breadcrumb-btn eject-btn" id="eject-${side}" title="Eject">
            <span class="material-icons">eject</span>
          </button>
        </div>
        
        <!-- MIDDLE SECTION: Flexible Elements (Intelligent Hide/Show) -->
        <div class="controls-middle-section">
          <!-- Time Display -->
          <div class="breadcrumb-element time-display" id="time-display-${side}">0:00 / 0:00</div>
          
          <!-- Rating Stars -->
          <div class="breadcrumb-element rating-display" id="player-rating-${side}">
            <span class="rating-star">★</span>
            <span class="rating-star">★</span>
            <span class="rating-star">★</span>
            <span class="rating-star">★</span>
            <span class="rating-star">★</span>
          </div>
          
          <!-- Volume Control -->
          <div class="breadcrumb-element volume-control">
            <span class="volume-label material-icons">volume_up</span>
            <input type="range" class="volume-slider-breadcrumb" id="volume-${side}" min="0" max="100" step="1" value="80">
          </div>
          
          <!-- Volume Meter -->
          <div class="breadcrumb-element volume-meter" id="volume-meter-${side}">
            <div class="meter-bars">
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
              <div class="meter-bar"></div>
            </div>
          </div>
        </div>
        
        <!-- RIGHT SECTION: Wizard Control (Fixed) -->
        <div class="controls-right-section">
          <div class="breadcrumb-element wizard-control" id="wizard-control-${side}" title="Ähnliche Songs finden">
            <i class="material-icons wizard-icon">casino</i>
            <i class="material-icons wizard-dice-animation" style="display: none;">casino</i>
            <i class="material-icons wizard-loading" style="display: none;">hourglass_empty</i>
          </div>
        </div>
      </div>
    </div>
  `;
}

// Deck Configuration Management
const deckConfig = {
  // Get deck configuration from ENV (default: four-decks)
  getEnvConfig(): 'two-decks' | 'four-decks' {
    const envConfig = import.meta.env.VITE_DECK_CONFIGURATION;
    return (envConfig === 'two-decks' || envConfig === 'four-decks') ? envConfig : 'four-decks';
  },
  
  // Get user preference for deck C+D visibility (only if four-decks is enabled)
  getUserPreference(): boolean {
    if (this.getEnvConfig() === 'two-decks') {
      return false; // Always hide if ENV says two-decks
    }
    // Check localStorage for user preference
    const stored = localStorage.getItem('deckCDVisible');
    return stored === null ? true : stored === 'true'; // Default: visible
  },
  
  // Set user preference
  setUserPreference(visible: boolean) {
    localStorage.setItem('deckCDVisible', String(visible));
    this.applyDeckVisibility();
  },
  
  // Apply deck visibility based on config
  applyDeckVisibility() {
    const playerC = document.getElementById('player-c');
    const playerD = document.getElementById('player-d');
    const wishboxFrame = document.getElementById('wishbox-frame');
    const deckToggleBtn = document.getElementById('deck-toggle-btn');
    
    const shouldShowCD = this.getUserPreference();
    
    // Show/hide Deck C and D
    if (playerC) {
      playerC.style.display = shouldShowCD ? '' : 'none';
    }
    if (playerD) {
      playerD.style.display = shouldShowCD ? '' : 'none';
    }
    
    // Show/hide Wishbox Frame (follows Deck C+D visibility)
    if (wishboxFrame) {
      wishboxFrame.style.display = shouldShowCD ? '' : 'none';
    }
    
    // Auto-Queue Management for C+D
    if (!shouldShowCD) {
      // Deactivate auto-queue for C+D when hidden
      if (autoQueueConfig.deckPairCD) {
        console.log('⏸️ Deactivating Auto-Queue for C+D (decks hidden)');
        autoQueueConfig.deckPairCD = false;
        
        // Move songs from C+D back to queue instead of clearing
        const songOnC = getCurrentLoadedSong('c');
        const songOnD = getCurrentLoadedSong('d');
        
        if (songOnC) {
          console.log(`📤 Moving song from Deck C back to queue: ${songOnC.title}`);
          moveQueueItemToEnd(songOnC, false);
        }
        
        if (songOnD) {
          console.log(`📤 Moving song from Deck D back to queue: ${songOnD.title}`);
          moveQueueItemToEnd(songOnD, false);
        }
        
        // Clear C+D decks
        clearPlayerDeck('c');
        clearPlayerDeck('d');
        
        // Update auto-queue button state
        const cdButton = document.getElementById('auto-queue-cd') as HTMLButtonElement;
        if (cdButton) {
          cdButton.classList.remove('active');
        }
        
        // Reset deck assignments for C+D
        resetDeckAssignments(['c', 'd']);
      }
      
      // Update button icon to visibility_off
      if (deckToggleBtn) {
        const icon = deckToggleBtn.querySelector('.material-icons');
        if (icon) {
          icon.textContent = 'visibility_off';
        }
      }
    } else {
      // When showing C+D: Just show them, don't auto-activate auto-queue
      // User must manually activate C+D auto-queue if desired
      console.log('👁️ Deck C+D are now visible (auto-queue remains unchanged)');
      
      // Update button icon to visibility
      if (deckToggleBtn) {
        const icon = deckToggleBtn.querySelector('.material-icons');
        if (icon) {
          icon.textContent = 'visibility';
        }
      }
    }
    
    // Update toggle button if it exists
    if (deckToggleBtn) {
      const btnText = deckToggleBtn.querySelector('.deck-toggle-text');
      const btnIcon = deckToggleBtn.querySelector('.material-icons');
      
      if (btnText) {
        btnText.textContent = shouldShowCD ? 'Hide C+D' : 'Show C+D';
      }
      if (btnIcon) {
        btnIcon.textContent = shouldShowCD ? 'visibility_off' : 'visibility';
      }
      
      // Only show toggle button if four-decks is enabled in ENV
      deckToggleBtn.style.display = this.getEnvConfig() === 'four-decks' ? '' : 'none';
    }
    
    console.log(`🎛️ Deck visibility: C+D ${shouldShowCD ? 'visible' : 'hidden'} (ENV: ${this.getEnvConfig()})`);
  }
};

// Initialize Player Decks
function initializePlayerDecks() {
  // Initialize all 4 player decks
  const playerA = document.getElementById('player-a');
  const playerB = document.getElementById('player-b');
  const playerC = document.getElementById('player-c');
  const playerD = document.getElementById('player-d');
  
  if (playerA) {
    playerA.innerHTML = createPlayerDeckHTML('a');
  }
  
  if (playerB) {
    playerB.innerHTML = createPlayerDeckHTML('b');
  }
  
  if (playerC) {
    playerC.innerHTML = createPlayerDeckHTML('c');
  }
  
  if (playerD) {
    playerD.innerHTML = createPlayerDeckHTML('d');
  }
  
  // Apply deck visibility based on configuration
  // If user is not logged in yet, ensure Deck C+D are hidden by default
  if (!isOpenSubsonicLoggedIn) {
    try {
      // Use the existing toggle method so behavior is consistent and persisted
      deckConfig.setUserPreference(false);
    } catch (e) {
      // Fallback: directly apply visibility
      deckConfig.applyDeckVisibility();
    }
  } else {
    deckConfig.applyDeckVisibility();
  }
  
  // Setup volume controls after HTML is created
  setupVolumeControls();
  
  // Setup Wizard labels for similar songs
  setupWizardLabels();
  
  // Mark that we need to setup audio event listeners laterwishbox-frame
  setTimeout(() => {
    console.log('🎵 Audio event listeners will be setup in main DOMContentLoaded...');
  }, 100);
  
  console.log('All 4 player decks initialized with professional layout');
}

// Setup Wizard controls for similar songs
function setupWizardLabels() {
  const players = ['a', 'b', 'c', 'd'];
  
  players.forEach(playerLetter => {
    const wizardControl = document.getElementById(`wizard-control-${playerLetter}`);
    console.log(`Looking for wizard-control-${playerLetter}:`, !!wizardControl);
    if (wizardControl) {
      wizardControl.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log(`🧙‍♂️ Wizard clicked for player ${playerLetter.toUpperCase()}`);
        await handleWizardClick(playerLetter);
      });
      console.log(`✅ Wizard control for player ${playerLetter.toUpperCase()} connected`);
    } else {
      console.error(`❌ Wizard control for player ${playerLetter.toUpperCase()} NOT FOUND`);
    }
  });
}

// Display similar songs directly in browse content (replacing current content)
function displaySimilarSongsInBrowser(songs: OpenSubsonicSong[], songTitle: string, artist: string) {
  // Get browse content container
  const browseContent = document.getElementById('browse-content');
  if (!browseContent) {
    console.error('Browse content container not found');
    return;
  }
  
  // Switch to browse tab to show the results
  const searchTabBtn = document.querySelector('.tab-btn[data-tab="search"]') as HTMLElement;
  const browseTabBtn = document.querySelector('.tab-btn[data-tab="browse"]') as HTMLElement;
  const searchContent = document.getElementById('search-content');
  
  if (searchTabBtn && browseTabBtn && searchContent) {
    // Switch to browse tab
    searchTabBtn.classList.remove('active');
    browseTabBtn.classList.add('active');
    searchContent.classList.remove('active');
    browseContent.classList.add('active');
  }
  
  // Use the LibraryBrowser system to show wizard results with proper breadcrumbs
  if (libraryBrowser) {
    libraryBrowser.showWizardResults(songs, songTitle, artist);
  } else {
    console.error('LibraryBrowser not available');
  }
  
  console.log(`✅ Displayed ${songs.length} similar songs using LibraryBrowser system`);
}

// Handle Wizard label click to get similar songs
async function handleWizardClick(playerLetter: string) {
  try {
    // Get the currently loaded song from player state
    const currentSong = getCurrentLoadedSong(playerLetter as 'a' | 'b' | 'c' | 'd');
    if (!currentSong) {
      console.log(`No song loaded in player ${playerLetter.toUpperCase()}`);
      return;
    }
    
    const artist = currentSong.artist;
    if (!artist) {
      console.log(`No artist found for loaded song in player ${playerLetter.toUpperCase()}`);
      return;
    }
    
    const songId = currentSong.id;
    if (!songId) {
      console.log(`No song ID found for loaded song in player ${playerLetter.toUpperCase()}`);
      return;
    }
    
    console.log(`Wizard! Getting similar songs for song: "${currentSong.title}" (ID: ${songId}) by ${artist} in player ${playerLetter.toUpperCase()}`);
    
    // Add loading state to control
    const wizardControl = document.getElementById(`wizard-control-${playerLetter}`);
    if (wizardControl) {
      wizardControl.classList.add('loading');
      const wizardIcon = wizardControl.querySelector('.wizard-icon') as HTMLElement;
      const diceAnimation = wizardControl.querySelector('.wizard-dice-animation') as HTMLElement;
      const loadingIcon = wizardControl.querySelector('.wizard-loading') as HTMLElement;
      
      if (wizardIcon && diceAnimation && loadingIcon) {
        // Start with dice animation
        wizardIcon.style.display = 'none';
        diceAnimation.style.display = 'block';
        loadingIcon.style.display = 'none';
        
        // After dice animation (600ms), switch to loading spinner
        setTimeout(() => {
          wizardIcon.style.display = 'none'; // Keep wizard icon hidden
          diceAnimation.style.display = 'none';
          loadingIcon.style.display = 'block';
        }, 600);
      }
    }
    
    // Get similar songs from API using song ID
    const similarSongs = await openSubsonicClient.getSimilarSongs2(songId, 20);
    
    if (similarSongs && similarSongs.length > 0) {
      console.log(`Found ${similarSongs.length} similar songs for ${currentSong.title}`);
      
      // Display similar songs directly in browse content (replacing current content)
      displaySimilarSongsInBrowser(similarSongs, currentSong.title, artist);
      
    } else {
      console.log(`No similar songs found for song: ${currentSong.title}`);
    }
    
  } catch (error) {
    console.error('Error getting similar songs:', error);
  } finally {
    // Remove loading state from control
    const wizardControl = document.getElementById(`wizard-control-${playerLetter}`);
    if (wizardControl) {
      wizardControl.classList.remove('loading');
      const wizardIcon = wizardControl.querySelector('.wizard-icon') as HTMLElement;
      const diceAnimation = wizardControl.querySelector('.wizard-dice-animation') as HTMLElement;
      const loadingIcon = wizardControl.querySelector('.wizard-loading') as HTMLElement;
      
      if (wizardIcon && diceAnimation && loadingIcon) {
        wizardIcon.style.display = 'block';
        diceAnimation.style.display = 'none';
        loadingIcon.style.display = 'none';
      }
    }
  }
}

// Display similar songs in the universal container
function displaySimilarSongs(songs: OpenSubsonicSong[], songTitle: string, artist: string) {
  const universalContainer = document.getElementById('universal-container');
  if (!universalContainer) return;
  
  // Clear existing content
  universalContainer.innerHTML = '';
  
  // Add header
  const header = document.createElement('div');
  header.className = 'similar-songs-header';
  header.innerHTML = `
    <h3>🎵 Ähnliche Songs wie "${songTitle}"</h3>
    <p>Von ${artist} • Gefunden: ${songs.length} Tracks</p>
  `;
  universalContainer.appendChild(header);
  
  // Add songs
  songs.forEach(song => {
    const songElement = document.createElement('div');
    songElement.className = 'song';
    songElement.innerHTML = `
      <div class="song-title">${song.title}</div>
      <div class="song-artist">${song.artist}</div>
      <div class="song-album">${song.album || 'Unknown Album'}</div>
      <div class="song-duration">${formatTime(song.duration || 0)}</div>
    `;
    
    // Add double-click handler to add to queue
    songElement.addEventListener('dblclick', () => {
      // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
      if (azuraCastWebcaster?.getConnectionStatus() && hasBlacklistedGenre(song)) {
        console.warn(`🚫 Cannot add song with blacklisted genre to queue while streaming: "${song.title}" (${song.genre})`);
        showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
        return;
      }
      
      // Check if song is already in queue
      if (isSongInQueue(song.id)) {
        console.log(`⚠️ Song already in queue: ${song.title}`);
        return;
      }
      
      // Check if song is already on a deck
      const deck = getSongDeck(song.id);
      if (deck) {
        console.log(`⚠️ Song already on deck ${deck.toUpperCase()}: ${song.title}`);
        return;
      }
      
      console.log(`Adding similar song "${song.title}" to queue`);
      
      // Add song to end of queue
      queue.push(createSongQueueItem(song));
      updateQueueDisplay();
      
      // Visual feedback
      console.log(`✓ Added to queue: ${song.title}`);
      
      // Update library markers
      markSongsInLibrary();
    });
    
    universalContainer.appendChild(songElement);
  });
  
  console.log(`Displayed ${songs.length} similar songs for ${artist} in universal container`);
}

// Setup Volume Controls and Meters
function setupVolumeControls() {
  ['a', 'b', 'c', 'd'].forEach(side => {
    const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    
    if (volumeSlider && audio) {
      // Volume slider event
      volumeSlider.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        const sliderValue = parseFloat(target.value); // 0-100 from slider
        const volume = sliderValue / 100; // Convert to 0-1 for audio.volume
        audio.volume = volume;
        // Note: Volume meter is driven by WebAudio analyser, not by slider value
        // This ensures meter shows actual audio signal, not just slider position
      });
      
      // Audio level monitoring for volume meter
      if (audio) {
        // Volume meters are now exclusively driven by WebAudio analysers
        // Started via startVolumeMeter() which uses real audio signal data
        // No need for play/pause/ended event handlers here anymore
        
        // Note: The WebAudio-based meters in startVolumeMeter() automatically
        // handle pause/mute states by reading actual audio data (which will be silent)
      }
    }
  });
}

// Consolidated Player System Initialization
function initializePlayerSystem() {
  // 1. Initialize deck HTML first
  initializePlayerDecks();
  
  // 2. Create CustomWaveform instances (which create the audio elements)
  console.log('🎵 Creating CustomWaveform instances and audio elements...');
  
  const sides: Array<'a' | 'b' | 'c' | 'd'> = ['a', 'b', 'c', 'd'];
  sides.forEach(side => {
    // Initialize CustomWaveforms (creates the shared audio element)
    const audioElement = initializeWaveforms(side);
    
    // Now create Deck instance with CustomWaveform's audio element
    deckInstances.set(side, new Deck(side, audioElement));
    setupAudioPlayer(side, audioElement);
    
    console.log(`✅ Deck ${side.toUpperCase()} ready with CustomWaveform audio element`);
  });
  
  console.log('🎵 All deck instances created:', deckInstances.size);
  
  // 3. Setup drop zones for drag & drop (with delay to ensure DOM is ready)
  setTimeout(() => {
    console.log('🎯 Initializing drop zones after DOM is ready...');
    initializePlayerDropZones();
    setupQueueDropZone();
    console.log('🎯 Drop zones initialization complete');
    
    // Setup album cover drag & drop after drop zones are ready
    setupAlbumCoverDragDrop();
    console.log('🎯 Album cover drag & drop initialized');
    
    // Setup player deck drag to queue
    setupPlayerDeckDragToQueue();
    console.log('🎯 Player deck drag to queue initialized');
  }, 500);
  
  // 5. Setup auto-queue controls
  setupAutoQueueControls();
  
  console.log('✅ Complete player system initialized with WaveSurfer audio elements');
}

// Update Album Cover Function
function updateAlbumCover(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong) {
  const albumCoverElement = document.getElementById(`album-cover-${side}`);
  console.log(`🎵 Updating album cover for ${side} player:`, {
    element: albumCoverElement,
    song: song.title,
    coverArt: song.coverArt,
    openSubsonicClient: !!openSubsonicClient
  });
  
  if (!albumCoverElement) {
    console.error(`❌ Album cover element not found: album-cover-${side}`);
    return;
  }
  
  if (!openSubsonicClient) {
    console.warn(`⚠️ OpenSubsonic client not available`);
    albumCoverElement.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
    return;
  }
  
  if (song.coverArt) {
    try {
      // Direct cover URL
      const coverUrl = openSubsonicClient.getCoverArtUrl(song.coverArt, 90);
      
      console.log(`🖼️ Setting cover URL for ${side}`);
      
      const img = document.createElement('img');
      img.src = coverUrl;
      img.alt = 'Album Cover';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      
      // Debug: Check if image loads
      img.onload = () => {
        console.log(`✅ Album cover loaded successfully for ${side}`);
      };
      img.onerror = (error) => {
        console.error(`❌ Album cover failed to load for ${side}:`, error);
        // Fallback to no-cover display
        albumCoverElement.innerHTML = `
          <div class="no-cover">
            <span class="material-icons">music_note</span>
          </div>
        `;
      };
      
      albumCoverElement.innerHTML = '';
      albumCoverElement.appendChild(img);
    } catch (error) {
      console.error(`❌ Error loading cover for ${side}:`, error);
      albumCoverElement.innerHTML = `
        <div class="no-cover">
          <span class="material-icons">music_note</span>
        </div>
      `;
    }
  } else {
    console.log(`ℹ️ No cover art for song: ${song.title}`);
    albumCoverElement.innerHTML = `
      <div class="no-cover">
        <span class="material-icons">music_note</span>
      </div>
    `;
  }
}

// Drag & Drop functionality for album covers
function setupAlbumCoverDragDrop() {
  const sides: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  sides.forEach(side => {
    const albumCover = document.getElementById(`album-cover-${side}`);
    if (!albumCover) return;
    
    // Make album cover draggable when it has content
    function updateDragability() {
      if (!albumCover) {
        console.warn(`🎵 Album cover for deck ${side} not found`);
        return;
      }
      
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      const isPlaying = audio && audio.src && !audio.paused;
      const hasLoadedTrack = audio && audio.src; // Simplified: just check if there's a source
      const songData = deckSongs[side];
      
      console.log(`🎵 Deck ${side} dragability check:`, {
        hasAudio: !!audio,
        hasSrc: !!audio?.src,
        hasLoadedTrack,
        isPlaying,
        songData: !!songData
      });
      
      if (hasLoadedTrack && !isPlaying) {
        // Only allow dragging if track is loaded but NOT playing
        albumCover.draggable = true;
        albumCover.style.cursor = 'grab';
        albumCover.setAttribute('draggable', 'true'); // Ensure attribute is set
        console.log(`🎵 Deck ${side} album cover: draggable=true (track loaded, not playing)`);
      } else if (hasLoadedTrack && isPlaying) {
        // Track is playing - disable dragging
        albumCover.draggable = false;
        albumCover.style.cursor = 'not-allowed';
        albumCover.removeAttribute('draggable'); // Remove attribute
        console.log(`🎵 Deck ${side} album cover: draggable=false (track is playing)`);
      } else {
        // No track loaded - disable dragging
        albumCover.draggable = false;
        albumCover.style.cursor = 'default';
        albumCover.removeAttribute('draggable'); // Remove attribute
        console.log(`🎵 Deck ${side} album cover: draggable=false (no track loaded)`);
      }
    }
    
    // Update dragability when track state changes
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    if (audio) {
      audio.addEventListener('loadstart', updateDragability);
      audio.addEventListener('loadeddata', updateDragability); // Add this for better detection
      audio.addEventListener('canplay', updateDragability); // Add this for better detection
      audio.addEventListener('play', updateDragability);
      audio.addEventListener('pause', updateDragability);
      audio.addEventListener('ended', updateDragability);
    }
    
    // Initial dragability check
    updateDragability();
    
    albumCover.addEventListener('dragstart', (e) => {
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      
      // Prevent drag if track is playing
      if (audio && !audio.paused) {
        e.preventDefault();
        albumCover.style.cursor = 'not-allowed';
        console.log(`🎵 Prevented drag from deck ${side} - track is playing`);
        return;
      }
      
      // Check if there's actually a track loaded (relaxed check)
      if (!audio || !audio.src) {
        e.preventDefault();
        console.log(`🎵 Prevented drag from deck ${side} - no track loaded`);
        return;
      }
      
      console.log(`🎵 Starting drag from deck ${side}`);
      albumCover.style.cursor = 'grabbing';
      if (e.dataTransfer) {
        // Get the song data for this deck
        const song = deckSongs[side];
        console.log(`🎵 Drag start from deck ${side.toUpperCase()}, song data:`, song);
        if (song) {
          // Set JSON data with song object
          const dragData = {
            type: 'deck-song',
            song: song,
            sourceDeck: side
          };
          e.dataTransfer.setData('application/json', JSON.stringify(dragData));
          console.log(`🎵 Dragging track from deck ${side.toUpperCase()}: "${song.title}"`);
        } else {
          console.warn(`❌ No song data found for deck ${side.toUpperCase()}, trying fallback`);
          // Fallback: try to get song info from UI elements
          const titleElement = document.querySelector(`#player-${side} .track-title`);
          const artistElement = document.querySelector(`#player-${side} .track-artist`);
          if (titleElement && artistElement) {
            const fallbackSong = {
              id: 'unknown',
              title: titleElement.textContent || 'Unknown Title',
              artist: artistElement.textContent || 'Unknown Artist',
              album: 'Unknown Album'
            };
            const dragData = {
              type: 'deck-song',
              song: fallbackSong,
              sourceDeck: side
            };
            e.dataTransfer.setData('application/json', JSON.stringify(dragData));
            console.log(`🎵 Using fallback song data for deck ${side}`);
          }
        }
        
        // Fallback text data for backwards compatibility
        e.dataTransfer.setData('text/plain', side);
        e.dataTransfer.effectAllowed = 'move';
      }
      
      // Add visual feedback
      albumCover.style.opacity = '0.5';
    });
    
    albumCover.addEventListener('dragend', () => {
      // Reset all visual drag states
      albumCover.style.opacity = '1';
      
      // Clean up drag classes from all decks
      const allSides: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
      allSides.forEach(otherSide => {
        const otherDeck = document.getElementById(`player-${otherSide}`);
        if (otherDeck) {
          otherDeck.classList.remove('drag-over', 'drop-blocked');
          otherDeck.style.opacity = '1';
        }
      });
      
      updateDragability();
      console.log(`🏁 Dragend on album cover ${side} - cleaned up all drag states`);
    });
    
    // Initial dragability check
    updateDragability();
  });
}

// Setup Player Deck Drag to Queue
function setupPlayerDeckDragToQueue() {
  const sides: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  sides.forEach(side => {
    const playerDeck = document.getElementById(`player-${side}`);
    if (!playerDeck) return;
    
    // Make player deck draggable when it has a track loaded (but not playing)
    function updateDeckDragability() {
      // REMOVED: Player deck dragging disabled
      // Only album cover is draggable now to avoid accidental drops
      // This function kept for compatibility but does nothing
      if (!playerDeck) return;
      
      // Always make deck NOT draggable (only album cover should be draggable)
      playerDeck.draggable = false;
      playerDeck.style.cursor = 'default';
    }
    
    // Update dragability when track state changes
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    if (audio) {
      audio.addEventListener('loadstart', updateDeckDragability);
      audio.addEventListener('loadeddata', updateDeckDragability);
      audio.addEventListener('play', updateDeckDragability);
      audio.addEventListener('pause', updateDeckDragability);
      audio.addEventListener('ended', updateDeckDragability);
    }
    
    // Initial check
    updateDeckDragability();
    
    // REMOVED: Player deck dragstart/dragend handlers
    // Only album cover is draggable now to avoid accidental deck-to-deck/deck-to-queue drops
    // Users must grab the album cover specifically to drag tracks
  });
}

// Update Time Display Function
function updateTimeDisplay(side: 'a' | 'b' | 'c' | 'd', currentTime: number, duration: number) {
  const timeDisplay = document.getElementById(`time-display-${side}`);
  if (!timeDisplay) return;
  
  const current = formatTime(currentTime);
  const total = formatTime(duration);
  timeDisplay.textContent = `${current} / ${total}`;
}

// Format time helper function
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Custom Waveform instances for both players (zoom + overview per deck)
const waveformsZoom: { [key in 'a' | 'b' | 'c' | 'd']?: CustomWaveform } = {};
const waveformsOverview: { [key in 'a' | 'b' | 'c' | 'd']?: CustomWaveform } = {};

// Audio elements for each deck (shared with waveform visualization)
const deckAudioElements: { [key in 'a' | 'b' | 'c' | 'd']?: HTMLAudioElement } = {};

/**
 * Helper function to get audio element for a deck
 * Replaces document.getElementById('audio-${side}') throughout the codebase
 */
function getAudioElement(side: 'a' | 'b' | 'c' | 'd'): HTMLAudioElement | null {
  return deckAudioElements[side] || null;
}

// Waveform zoom levels for each deck (8.0 = 800% default zoom for detail)
const waveformZoom: { [key in 'a' | 'b' | 'c' | 'd']: number } = {
  a: 8.0,
  b: 8.0,
  c: 8.0,
  d: 8.0
};

// Initialize Custom Waveforms for a player with dual waveforms (zoom + overview)
// Returns the audio element
function initializeWaveforms(side: 'a' | 'b' | 'c' | 'd', trackDuration?: number): HTMLAudioElement {
  const containerZoom = document.getElementById(`waveform-${side}-zoom`);
  const containerOverview = document.getElementById(`waveform-${side}-overview`);
  
  if (!containerZoom || !containerOverview) {
    throw new Error(`Waveform containers not found for ${side} player`);
  }

  // Destroy existing waveforms if they exist
  if (waveformsZoom[side]) {
    waveformsZoom[side]!.destroy();
  }
  if (waveformsOverview[side]) {
    waveformsOverview[side]!.destroy();
  }

  // Adaptive settings based on track duration
  let barWidth = 2;
  let barGap = 1;
  
  // For very long tracks (>10 minutes), reduce detail for better performance
  if (trackDuration && trackDuration > 600) {
    barWidth = 1;
    barGap = 0;
    console.log(`🎵 Long track detected (${Math.round(trackDuration/60)}min), using optimized waveform settings`);
  }

  // Deck-specific colors using CSS variables
  const getPlayerColor = (playerSide: string, variant: 'main' | 'dark' = 'main'): string => {
    const colorMap = {
      'a': variant === 'main' ? '#ff4444' : '#cc0000',
      'b': variant === 'main' ? '#4488ff' : '#2266dd', 
      'c': variant === 'main' ? '#ffdd44' : '#ddbb00',
      'd': variant === 'main' ? '#44ff88' : '#22dd66'
    };
    return colorMap[playerSide as keyof typeof colorMap] || '#666666';
  };
  
  const waveColor = getPlayerColor(side);
  const progressColor = getPlayerColor(side, 'dark');

  // Create or reuse audio element
  let audioElement = deckAudioElements[side];
  if (!audioElement) {
    audioElement = document.createElement('audio');
    audioElement.id = `audio-${side}`;
    audioElement.preload = 'metadata';
    audioElement.crossOrigin = 'anonymous'; // For CORS
    
    // 🔧 CRITICAL FIX: Audio elements MUST be in DOM to work!
    // Add to body (hidden)
    audioElement.style.display = 'none';
    document.body.appendChild(audioElement);
    
    deckAudioElements[side] = audioElement;
    console.log(`🎵 Created and attached audio element for deck ${side}`);
  }

  // Get AudioContext from AudioManager
  const audioContext = AudioManager.getContext();

  // 1. CREATE ZOOM WAVEFORM (top, 5-second window, no seek, centered playhead)
  const waveformZoomInstance = createCustomWaveform({
    container: containerZoom,
    waveColor: waveColor,
    progressColor: progressColor,
    cursorColor: '#ffffff', // White cursor in center
    barWidth: barWidth,
    barGap: barGap,
    height: 60,
    normalize: true,
    interact: false, // Disable all interactions (no seek)
    responsive: true
  }, audioElement, audioContext, 5); // 5 seconds zoom window
  
  console.log(`🎨 CustomWaveform Zoom ${side} created (5s window, centered cursor)`);

  // 2. CREATE OVERVIEW WAVEFORM (bottom, always 1.0x, seekable)
  const waveformOverviewInstance = createCustomWaveform({
    container: containerOverview,
    waveColor: waveColor,
    progressColor: progressColor,
    cursorColor: '#ffffff',
    barWidth: 1, // Thinner bars for overview
    barGap: 0,
    height: 20,
    normalize: true,
    interact: true, // Enable seek interactions
    responsive: true
  }, audioElement, audioContext); // SAME audio element - shared!
  
  console.log(`🎨 CustomWaveform Overview ${side} created (seekable, SHARED audio element)`);

  // Store waveform instances
  waveformsZoom[side] = waveformZoomInstance;
  waveformsOverview[side] = waveformOverviewInstance;
  
  console.log(`✅ Deck ${side.toUpperCase()} initialized: CustomWaveform + shared audio element`);
  console.log(`🎵 CustomWaveform initialized for deck ${side} with shared audio element`);
  
  return audioElement;
}

// Reset waveforms for a new track
function resetWaveform(side: 'a' | 'b' | 'c' | 'd') {
  const waveformZoom = waveformsZoom[side];
  const waveformOverview = waveformsOverview[side];
  
  // CustomWaveform doesn't need explicit reset - it will be updated on next load
  console.log(`Waveform reset for ${side} player`);
  
  // Hide loading indicator if it's visible
  const loadingElement = document.getElementById(`waveform-loading-${side}`);
  if (loadingElement) {
    loadingElement.classList.remove('visible');
  }
}

// Show zoom level indicator with fade in/out
let zoomIndicatorTimeouts: { [key in 'a' | 'b' | 'c' | 'd']?: NodeJS.Timeout } = {};

function showZoomIndicator(side: 'a' | 'b' | 'c' | 'd', zoomLevel: number) {
  let indicator = document.getElementById(`zoom-indicator-${side}`);
  
  // Create indicator if it doesn't exist
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = `zoom-indicator-${side}`;
    indicator.className = 'zoom-indicator';
    const waveformContainer = document.querySelector(`#waveform-${side}`)?.parentElement;
    if (waveformContainer) {
      waveformContainer.appendChild(indicator);
    }
  }
  
  // Update text
  indicator.textContent = `${zoomLevel.toFixed(1)}x`;
  
  // Show indicator
  indicator.classList.add('visible');
  
  // Clear existing timeout
  if (zoomIndicatorTimeouts[side]) {
    clearTimeout(zoomIndicatorTimeouts[side]);
  }
  
  // Hide after 1 second
  zoomIndicatorTimeouts[side] = setTimeout(() => {
    indicator?.classList.remove('visible');
  }, 1000);
}

// Completely clear waveforms (for eject)
function clearWaveform(side: 'a' | 'b' | 'c' | 'd') {
  const waveformZoom = waveformsZoom[side];
  const waveformOverview = waveformsOverview[side];
  
  if (waveformZoom) {
    waveformZoom.destroy();
    delete waveformsZoom[side];
  }
  if (waveformOverview) {
    waveformOverview.destroy();
    delete waveformsOverview[side];
  }
  
  // Clear the containers visually
  const containerZoom = document.getElementById(`waveform-${side}-zoom`);
  const containerOverview = document.getElementById(`waveform-${side}-overview`);
  
  if (containerZoom) {
    containerZoom.innerHTML = '';
    containerZoom.style.opacity = '1';
  }
  if (containerOverview) {
    containerOverview.innerHTML = '';
    containerOverview.style.opacity = '1';
  }
  
  // Remove any lingering error indicators
  const errorIndicator = document.getElementById(`waveform-error-${side}`);
  if (errorIndicator && errorIndicator.parentNode) {
    errorIndicator.remove();
  }
  
  // Hide loading indicator
  const loadingElement = document.getElementById(`waveform-loading-${side}`);
  if (loadingElement) {
    loadingElement.classList.remove('visible');
  }
  
  console.log(`🗑️ Waveform completely cleared for ${side} player`);
}

// Cache for waveform data to avoid redundant requests
const waveformCache = new Map<string, { peaks: number[], duration: number }>();

// Pending waveforms that are being generated on the server
const pendingWaveforms = new Map<string, { 
  element: HTMLElement, 
  streamUrl: string, 
  attempts: number,
  lastCheck: number 
}>();

// Polling interval for checking pending waveforms
let waveformPollingInterval: number | null = null;

// Start polling for pending waveforms
function startWaveformPolling() {
  if (waveformPollingInterval !== null) return; // Already polling
  
  console.log('🔄 [LibraryWaveform] Starting background polling for pending waveforms');
  
  waveformPollingInterval = window.setInterval(async () => {
    if (pendingWaveforms.size === 0) {
      // No pending waveforms, stop polling
      if (waveformPollingInterval !== null) {
        clearInterval(waveformPollingInterval);
        waveformPollingInterval = null;
        console.log('⏸️ [LibraryWaveform] Stopped polling - no pending waveforms');
      }
      return;
    }
    
    console.log(`🔍 [LibraryWaveform] Polling ${pendingWaveforms.size} pending waveforms...`);
    
    // Check each pending waveform (don't await - process all in parallel)
    const checkPromises: Promise<void>[] = [];
    
    for (const [songId, info] of pendingWaveforms.entries()) {
      const now = Date.now();
      if (now - info.lastCheck < 2000) continue; // Wait at least 2 seconds between checks
      
      info.lastCheck = now;
      
      // Create a promise for each check (process in parallel)
      const checkPromise = (async () => {
        try {
          const waveformUrl = `/api/waveform/${songId}?url=${encodeURIComponent(info.streamUrl)}`;
          const response = await fetch(waveformUrl);
          
          if (response.status === 202) {
            // Still generating
            info.attempts++;
            console.log(`⏳ [LibraryWaveform] Still generating ${songId} (attempt ${info.attempts})`);
            
            // Give up after 20 attempts (40 seconds)
            if (info.attempts > 20) {
              console.warn(`⏰ [LibraryWaveform] Giving up on ${songId} after ${info.attempts} attempts`);
              pendingWaveforms.delete(songId);
              info.element.dataset.waveformLoading = 'false';
            }
            return;
          }
          
          if (response.ok) {
            // Waveform is ready! Render it IMMEDIATELY
            const waveformData = await response.json();
            console.log(`✅ [LibraryWaveform] Waveform ready for ${songId} - rendering NOW!`);
            
            // Cache it
            waveformCache.set(songId, waveformData);
            
            // Render it immediately (don't wait for other songs)
            await renderWaveformBackground(info.element, songId, waveformData);
            
            // Remove from pending
            pendingWaveforms.delete(songId);
          } else {
            console.error(`❌ [LibraryWaveform] Failed to fetch ${songId}: ${response.status}`);
            pendingWaveforms.delete(songId);
            info.element.dataset.waveformLoading = 'false';
          }
        } catch (error) {
          console.error(`❌ [LibraryWaveform] Error checking ${songId}:`, error);
          pendingWaveforms.delete(songId);
          info.element.dataset.waveformLoading = 'false';
        }
      })();
      
      checkPromises.push(checkPromise);
    }
    
    // Wait for all checks to complete (but each renders independently)
    await Promise.all(checkPromises);
  }, 2000); // Check every 2 seconds
}

/**
 * Analyze waveform data to detect intro/outro silence
 * Returns timing information for optimal track transition
 */
interface WaveformAnalysis {
  introSilence: number;    // Seconds of silence/quietness at start
  outroSilence: number;    // Seconds of silence/quietness at end
  introEnd: number;        // When the actual music starts (in seconds)
  outroStart: number;      // When the music starts fading out (in seconds)
  optimalCueInPoint: number; // Best time to cue in next track (in seconds before outro)
  duration: number;        // Total track duration
}

function analyzeWaveformForCrossfade(waveformData: { peaks: number[], duration: number }, silenceThreshold = 0.15): WaveformAnalysis {
  const { peaks, duration } = waveformData;
  const totalPeaks = peaks.length;
  
  // Calculate time per peak
  const secondsPerPeak = duration / totalPeaks;
  
  // Find intro end (first significant peak)
  let introEndIndex = 0;
  for (let i = 0; i < totalPeaks; i++) {
    const peak = Math.abs(peaks[i]);
    if (peak > silenceThreshold) {
      introEndIndex = i;
      break;
    }
  }
  
  // Find outro start (last significant peak)
  let outroStartIndex = totalPeaks - 1;
  for (let i = totalPeaks - 1; i >= 0; i--) {
    const peak = Math.abs(peaks[i]);
    if (peak > silenceThreshold) {
      outroStartIndex = i;
      break;
    }
  }
  
  // Calculate average peak level in the middle section (for better threshold)
  const middleStart = Math.floor(totalPeaks * 0.25);
  const middleEnd = Math.floor(totalPeaks * 0.75);
  let middleSum = 0;
  let middleCount = 0;
  
  for (let i = middleStart; i < middleEnd; i++) {
    middleSum += Math.abs(peaks[i]);
    middleCount++;
  }
  
  const averageMidLevel = middleSum / middleCount;
  const fadeThreshold = averageMidLevel * 0.3; // 30% of average level
  
  // Find better outro start (when volume drops below 30% of average)
  for (let i = outroStartIndex; i >= Math.floor(totalPeaks * 0.5); i--) {
    const peak = Math.abs(peaks[i]);
    if (peak < fadeThreshold) {
      outroStartIndex = i;
    } else {
      break; // Found the start of fade-out
    }
  }
  
  // Convert indices to seconds
  const introEnd = introEndIndex * secondsPerPeak;
  const outroStart = outroStartIndex * secondsPerPeak;
  const introSilence = introEnd;
  const outroSilence = duration - outroStart;
  
  // Optimal cue-in point: 5-10 seconds before outro starts fading
  // This allows for smooth mixing while music is still playing
  const cueInLeadTime = Math.min(8, outroSilence * 0.5); // 8 seconds or half the outro
  const optimalCueInPoint = Math.max(0, outroStart - cueInLeadTime);
  
  console.log(`🎵 [WaveformAnalysis] Intro: ${introSilence.toFixed(1)}s, Outro: ${outroSilence.toFixed(1)}s, Cue-In at: ${optimalCueInPoint.toFixed(1)}s`);
  
  return {
    introSilence,
    outroSilence,
    introEnd,
    outroStart,
    optimalCueInPoint,
    duration
  };
}

/**
 * Get waveform analysis for a song
 * Checks cache first, otherwise fetches and analyzes
 */
async function getWaveformAnalysis(songId: string, streamUrl: string): Promise<WaveformAnalysis | null> {
  try {
    // Check cache first
    let waveformData = waveformCache.get(songId);
    
    if (!waveformData) {
      // Fetch from server
      const waveformUrl = `/api/waveform/${songId}?url=${encodeURIComponent(streamUrl)}`;
      const response = await fetch(waveformUrl);
      
      if (response.status === 202) {
        console.log(`⏳ [WaveformAnalysis] Waveform still generating for ${songId}`);
        return null; // Not ready yet
      }
      
      if (!response.ok) {
        console.warn(`⚠️ [WaveformAnalysis] Failed to fetch waveform for ${songId}`);
        return null;
      }
      
      waveformData = await response.json();
      
      if (!waveformData || !waveformData.peaks || waveformData.peaks.length === 0) {
        console.warn(`⚠️ [WaveformAnalysis] Invalid waveform data for ${songId}`);
        return null;
      }
      
      // Cache it
      waveformCache.set(songId, waveformData);
    }
    
    // Analyze and return
    return analyzeWaveformForCrossfade(waveformData);
    
  } catch (error) {
    console.error(`❌ [WaveformAnalysis] Error analyzing ${songId}:`, error);
    return null;
  }
}

// Track which songs have triggered smart cue-in (to avoid multiple triggers)
const smartCueInTriggered = new Set<string>();

/**
 * Check if we should trigger smart cue-in based on waveform analysis
 * Called from timeupdate event
 */
async function checkAndTriggerSmartCrossfade(side: 'a' | 'b' | 'c' | 'd', currentTime: number) {
  const currentSong = getCurrentLoadedSong(side);
  if (!currentSong) return;
  
  // Check if already triggered for this song
  const triggerKey = `${side}-${currentSong.id}`;
  if (smartCueInTriggered.has(triggerKey)) return;
  
  // Get waveform analysis
  const audio = getAudioElement(side);
  if (!audio || !audio.src) return;
  
  const streamUrl = audio.src;
  const analysis = await getWaveformAnalysis(currentSong.id, streamUrl);
  
  if (!analysis) {
    // Fallback: Use simple time-based trigger (10 seconds before end)
    const timeRemaining = audio.duration - currentTime;
    if (timeRemaining <= 10 && timeRemaining > 0) {
      smartCueInTriggered.add(triggerKey);
      triggerNextTrackForCrossfade(side);
    }
    return;
  }
  
  // Smart cue-in: trigger at optimal point
  if (currentTime >= analysis.optimalCueInPoint) {
    console.log(`🎵 [SmartCueIn] Triggering at ${currentTime.toFixed(1)}s (optimal: ${analysis.optimalCueInPoint.toFixed(1)}s)`);
    smartCueInTriggered.add(triggerKey);
    
    // Remove trigger key when song ends (for reuse)
    const clearTrigger = () => {
      smartCueInTriggered.delete(triggerKey);
      audio.removeEventListener('ended', clearTrigger);
    };
    audio.addEventListener('ended', clearTrigger, { once: true });
    
    triggerNextTrackForCrossfade(side);
  }
}

/**
 * Trigger next track to start playing for smooth transition
 * This is different from handleAutoQueue - it starts BEFORE current track ends
 */
function triggerNextTrackForCrossfade(currentDeck: 'a' | 'b' | 'c' | 'd') {
  console.log(`🔄 [SmartCueIn] Starting next track while ${currentDeck.toUpperCase()} is still playing`);
  
  // Determine next deck
  const nextDeck = getNextDeck(currentDeck);
  if (!nextDeck) {
    console.log('⏸️ No valid next deck for cue-in');
    return;
  }
  
  // Check if next deck is ready
  const nextDeckState = getDeckState(nextDeck);
  
  if (nextDeckState === 'ready') {
    // Deck has a track loaded and ready - start it!
    console.log(`▶️ [SmartCueIn] Starting prepared track on ${nextDeck.toUpperCase()}`);
    simulatePlayButtonClick(nextDeck);
  } else if (nextDeckState === 'empty') {
    // Deck is empty - load next track from queue
    console.log(`🔄 [SmartCueIn] Loading next track to ${nextDeck.toUpperCase()}`);
    startNextDeckWithNewTrack(nextDeck); // Will auto-play
  } else {
    console.log(`⚠️ [SmartCueIn] Next deck ${nextDeck.toUpperCase()} is not ready (state: ${nextDeckState})`);
  }
  
  // Prepare the deck after next deck (for next transition)
  setTimeout(() => {
    prepareNextDeckInSequence(nextDeck);
  }, 2000);
}

// Render waveform background on an element
async function renderWaveformBackground(element: HTMLElement, songId: string, waveformData: { peaks: number[], duration: number }): Promise<void> {
  if (!waveformData || !waveformData.peaks || waveformData.peaks.length === 0) {
    return;
  }
  
  // Check if element has album cover (track-cover)
  const coverElement = element.querySelector('.track-cover') as HTMLElement;
  let coverWidth = 0;
  let leftOffset = 0;
  
  if (coverElement) {
    // Get actual position of cover relative to parent
    const elementRect = element.getBoundingClientRect();
    const coverRect = coverElement.getBoundingClientRect();
    
    // Calculate left offset (includes padding and gap)
    leftOffset = coverRect.left - elementRect.left;
    // Calculate total width including gap after cover
    coverWidth = coverRect.width;
    
    // Add gap after cover (typically 0.75rem = 12px for unified-song-item)
    const computedStyle = window.getComputedStyle(element);
    const gap = computedStyle.gap || computedStyle.gridGap || '0px';
    const gapValue = parseFloat(gap);
    if (!isNaN(gapValue)) {
      coverWidth += gapValue;
    }
  }
  
  const totalLeftOffset = leftOffset + coverWidth;
  
  // Determine waveform color based on deck/queue status
  let waveformColor = { r: 0, g: 255, b: 136 }; // Default green
  let borderColor = '#7cacff'; // Default light blue
  
  if (element.classList.contains('in-queue')) {
    waveformColor = { r: 114, g: 137, b: 218 }; // Blue #7289da
    borderColor = '#7289da';
  } else if (element.classList.contains('on-deck-a')) {
    waveformColor = { r: 255, g: 107, b: 107 }; // Red #ff6b6b
    borderColor = '#ff6b6b';
  } else if (element.classList.contains('on-deck-b')) {
    waveformColor = { r: 78, g: 205, b: 196 }; // Türkis #4ecdc4
    borderColor = '#4ecdc4';
  } else if (element.classList.contains('on-deck-c')) {
    waveformColor = { r: 255, g: 217, b: 61 }; // Gelb #ffd93d
    borderColor = '#ffd93d';
  } else if (element.classList.contains('on-deck-d')) {
    waveformColor = { r: 149, g: 225, b: 211 }; // Hellgrün #95e1d3
    borderColor = '#95e1d3';
  }
  
  // Remove existing waveform canvas if present (for re-rendering with new color)
  const existingCanvas = element.querySelector('.song-waveform-bg');
  if (existingCanvas) {
    existingCanvas.remove();
  }
  
  // Create canvas element for waveform background
  const canvas = document.createElement('canvas');
  canvas.className = 'song-waveform-bg';
  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: ${totalLeftOffset}px;
    width: calc(100% - ${totalLeftOffset}px);
    height: 100%;
    opacity: 0.25;
    pointer-events: none;
    z-index: 0;
    box-sizing: border-box;
  `;
  
  // Set canvas size
  const rect = element.getBoundingClientRect();
  canvas.width = (rect.width - totalLeftOffset) || 400;
  canvas.height = rect.height || 60;
  
  // Draw waveform
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const peaks = waveformData.peaks;
    const barWidth = canvas.width / peaks.length;
    const halfHeight = canvas.height / 2;
    
    // Use a gradient for the waveform (color based on deck/queue status)
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, `rgba(${waveformColor.r}, ${waveformColor.g}, ${waveformColor.b}, 0.4)`);
    gradient.addColorStop(0.5, `rgba(${waveformColor.r}, ${waveformColor.g}, ${waveformColor.b}, 0.8)`);
    gradient.addColorStop(1, `rgba(${waveformColor.r}, ${waveformColor.g}, ${waveformColor.b}, 0.4)`);
    ctx.fillStyle = gradient;
    
    // Draw bars
    for (let i = 0; i < peaks.length; i++) {
      const peak = Math.abs(peaks[i]);
      const barHeight = peak * halfHeight;
      const x = i * barWidth;
      const y = halfHeight - barHeight;
      
      ctx.fillRect(x, y, barWidth * 0.8, barHeight * 2);
    }
  }
  
  // Insert canvas as first child (background)
  element.style.position = 'relative';
  element.insertBefore(canvas, element.firstChild);
  
  element.dataset.waveformLoaded = 'true';
  element.dataset.waveformLoading = 'false';
  
  // Apply correct color filter based on current CSS classes
  // This ensures the waveform has the right color even if CSS classes were added after rendering
  if (element.classList.contains('on-deck-a')) {
    canvas.style.filter = 'hue-rotate(-120deg) saturate(1.5) brightness(1.2)';
  } else if (element.classList.contains('on-deck-b')) {
    canvas.style.filter = 'hue-rotate(30deg) saturate(1.2) brightness(1.1)';
  } else if (element.classList.contains('on-deck-c')) {
    canvas.style.filter = 'hue-rotate(-60deg) saturate(1.8) brightness(1.3)';
  } else if (element.classList.contains('on-deck-d')) {
    canvas.style.filter = 'hue-rotate(10deg) saturate(0.9) brightness(1.2)';
  } else if (element.classList.contains('in-queue')) {
    canvas.style.filter = 'hue-rotate(200deg) saturate(0.9) brightness(1.3)';
  }
  // Default green needs no filter
  
  console.log(`✅ [LibraryWaveform] Rendered waveform for ${songId} with color ${borderColor}`);
}

// Load waveform JSON as background for song items
async function loadSongWaveformBackground(element: HTMLElement, songId: string, streamUrl: string): Promise<void> {
  // Check if already loaded or loading
  if (element.dataset.waveformLoaded === 'true' || element.dataset.waveformLoading === 'true') {
    return;
  }
  
  element.dataset.waveformLoading = 'true';
  console.log(`🌊 [LibraryWaveform] Requesting waveform for song ${songId}`);
  
  try {
    // Check cache first
    let waveformData = waveformCache.get(songId);
    
    if (!waveformData) {
      console.log(`📥 [LibraryWaveform] Cache MISS - fetching from server for ${songId}`);
      
      // Use the SAME endpoint as CustomWaveform.ts
      const waveformUrl = `/api/waveform/${songId}?url=${encodeURIComponent(streamUrl)}`;
      const response = await fetch(waveformUrl);
      
      if (response.status === 202) {
        // Waveform is being generated - add to pending queue
        console.log(`⏳ [LibraryWaveform] Waveform generating for ${songId} - added to polling queue`);
        pendingWaveforms.set(songId, {
          element,
          streamUrl,
          attempts: 0,
          lastCheck: Date.now()
        });
        
        // Start polling if not already running
        startWaveformPolling();
        return;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch waveform: ${response.status}`);
      }
      
      waveformData = await response.json();
      console.log(`✅ [LibraryWaveform] Waveform data received for ${songId}: ${waveformData?.peaks?.length || 0} peaks`);
      
      // Validate waveform data before caching
      if (!waveformData || !waveformData.peaks || waveformData.peaks.length === 0) {
        console.error(`❌ [LibraryWaveform] Invalid waveform data received for ${songId}:`, waveformData);
        element.dataset.waveformLoading = 'false';
        return;
      }
      
      // Cache the waveform data
      waveformCache.set(songId, waveformData);
      console.log(`💾 [LibraryWaveform] Cached waveform for ${songId}`);
    } else {
      console.log(`✅ [LibraryWaveform] Cache HIT for ${songId}`);
    }
    
    // Render the waveform using the cached data
    await renderWaveformBackground(element, songId, waveformData);
    
  } catch (error) {
    console.warn(`⚠️ [SongWaveform] Failed to load waveform for ${songId}:`, error);
    element.dataset.waveformLoading = 'false';
    // Don't throw - just log and continue without waveform
  }
}

// Batch load waveforms for ALL song elements in container (not just visible ones)
// The polling system will handle background generation efficiently
function loadVisibleSongWaveforms(container?: HTMLElement) {
  if (!openSubsonicClient) {
    console.warn('🌊 [LibraryWaveform] No OpenSubsonic client available');
    return;
  }
  
  const root = container || document;
  const songElements = root.querySelectorAll<HTMLElement>(
    '.track-item, .track-item-oneline, .song-row, .unified-song-item, .music-card'
  );
  
  console.log(`🌊 [LibraryWaveform] Found ${songElements.length} song elements in container:`, container?.id || 'document');
  
  let newLoads = 0;
  
  songElements.forEach(element => {
    const songId = element.dataset.songId || element.dataset.trackId;
    if (!songId) return;
    
    // Skip if already loaded on THIS element or currently loading
    // NOTE: Don't skip just because it's in cache - cache needs to be rendered to element!
    if (element.dataset.waveformLoaded === 'true' || 
        element.dataset.waveformLoading === 'true') {
      return;
    }
    
    // Also skip if currently being generated (in pending queue)
    if (pendingWaveforms.has(songId)) {
      return;
    }
    
    // Load waveform (will use cache if available, or fetch from server)
    const originalStreamUrl = openSubsonicClient.getOriginalStreamUrl(songId);
    loadSongWaveformBackground(element, songId, originalStreamUrl);
    newLoads++;
  });
  
  if (newLoads > 0) {
    console.log(`� [LibraryWaveform] Loading ${newLoads} new waveforms (${songElements.length} total songs)`);
  }
}

// Load audio file into CustomWaveform for a player
async function loadWaveform(side: 'a' | 'b' | 'c' | 'd', audioUrl: string, trackDuration?: number) {
  console.log(`🌊 [CustomWaveform] Loading waveform for ${side} player from: ${audioUrl}`);
  
  // Reset existing waveform first
  resetWaveform(side);
  
  // Initialize waveforms if not exists
  if (!waveformsZoom[side] || !waveformsOverview[side]) {
    const audioElement = initializeWaveforms(side, trackDuration);
    console.log(`🎵 CustomWaveform initialized for deck ${side} with audio element`);
  }

  const waveformZoom = waveformsZoom[side]!;
  const waveformOverview = waveformsOverview[side]!;
  
  // Show loading indicator
  const loadingIndicator = document.getElementById(`waveform-loading-${side}`);
  if (loadingIndicator) {
    loadingIndicator.classList.add('visible');
    loadingIndicator.textContent = 'Loading waveform...';
  }

  try {
    // Load audio into both waveforms (they share the same audio element)
    console.log(`🌊 [CustomWaveform] Loading audio into waveforms...`);
    await Promise.all([
      waveformZoom.load(audioUrl),
      waveformOverview.load(audioUrl)
    ]);
    
    console.log(`✅ [CustomWaveform] Waveforms loaded for ${side} player`);
    
    // Hide loading indicator
    if (loadingIndicator) {
      loadingIndicator.classList.remove('visible');
    }
    
    // Ensure full opacity
    const containerZoom = document.getElementById(`waveform-${side}-zoom`);
    const containerOverview = document.getElementById(`waveform-${side}-overview`);
    if (containerZoom) containerZoom.style.opacity = '1';
    if (containerOverview) containerOverview.style.opacity = '0.7';
    
  } catch (error) {
    console.error(`❌ [CustomWaveform] Failed to load waveform for ${side}:`, error);
    
    // Hide loading indicator
    if (loadingIndicator) {
      loadingIndicator.classList.remove('visible');
    }
    
    throw error;
  }
}

// OpenSubsonic Client (wird später mit echten Credentials initialisiert)
let openSubsonicClient: SubsonicApiClient;
let isOpenSubsonicLoggedIn = false;
let autoLoginInProgress = false;

// Globale Variablen
let currentSongs: OpenSubsonicSong[] = [];
let currentAlbums: OpenSubsonicAlbum[] = [];
let currentArtists: OpenSubsonicArtist[] = [];

// Enhanced Queue System with Deck Tracking and Microphone Placeholders
interface QueueItem {
  song?: OpenSubsonicSong; // Optional for mic placeholders
  type: 'song' | 'microphone'; // Type of queue item
  assignedToDeck?: 'a' | 'b' | 'c' | 'd' | null; // null = available, deck = loaded to that deck
  loadedAt?: Date; // When it was loaded to a deck
  id: string; // Unique identifier for queue items
}

let queue: QueueItem[] = [];
let autoQueueEnabled = true; // Auto-Queue standardmäßig aktiviert

// Queue item helper functions
function createSongQueueItem(song: OpenSubsonicSong): QueueItem {
  return {
    type: 'song',
    song: song,
    assignedToDeck: null,
    id: `song-${song.id}-${Date.now()}`
  };
}

function createMicrophoneQueueItem(): QueueItem {
  return {
    type: 'microphone',
    assignedToDeck: null,
    id: `mic-${Date.now()}`
  };
}

// [REMOVED - duplicate function, using registry-based version at line 234]

// Check if song is loaded on any deck and return deck letter
function getSongDeck(songId: string): 'a' | 'b' | 'c' | 'd' | null {
  return null;
}

// Fast update: Mark a single song in library (without re-rendering waveform)
function updateSongStatus(songId: string, targetElement?: HTMLElement) {
  // If element provided, only update that one (fastest)
  if (targetElement) {
    updateSingleElement(targetElement, songId);
    return;
  }
  
  // Otherwise find all instances of this song in the library
  const songElements = document.querySelectorAll(`[data-song-id="${songId}"]`);
  songElements.forEach((element) => {
    updateSingleElement(element as HTMLElement, songId);
  });
}

// Update a single element's status
function updateSingleElement(el: HTMLElement, songId: string) {
  // Remove all existing deck/queue markers
  el.classList.remove('in-queue', 'on-deck-a', 'on-deck-b', 'on-deck-c', 'on-deck-d');
  el.style.removeProperty('border-left');
  
  // Check if song is on a deck (priority)
  const deck = getSongDeck(songId);
  if (deck) {
    el.classList.add(`on-deck-${deck}`);
    const deckColors = {
      'a': '#ff6b6b',
      'b': '#4ecdc4', 
      'c': '#ffd93d',
      'd': '#95e1d3'
    };
    el.style.borderLeft = `4px solid ${deckColors[deck]}`;
    
    // Update waveform color via CSS filter (fast)
    updateWaveformColor(el, deck);
    return;
  }
  
  // Check if song is in queue
  if (isSongInQueue(songId)) {
    el.classList.add('in-queue');
    el.style.borderLeft = '4px solid #7289da';
    
    // Update waveform color via CSS filter (fast)
    updateWaveformColor(el, 'queue');
  } else {
    // Default state
    updateWaveformColor(el, 'default');
  }
}

// Update waveform color using CSS filter (much faster than re-rendering canvas)
function updateWaveformColor(element: HTMLElement, status: 'a' | 'b' | 'c' | 'd' | 'queue' | 'default') {
  const canvas = element.querySelector('.song-waveform-bg') as HTMLCanvasElement;
  if (!canvas) return;
  
  // Remove filter for default green (base color of canvas)
  // For other colors, apply hue rotation from green base
  // Base: Green #00ff88 (rgb(0, 255, 136))
  // Queue: Blue #7289da (rgb(114, 137, 218))
  // Deck A: Red #ff6b6b (rgb(255, 107, 107))
  // Deck B: Türkis #4ecdc4 (rgb(78, 205, 196))
  // Deck C: Gelb #ffd93d (rgb(255, 217, 61))
  // Deck D: Hellgrün #95e1d3 (rgb(149, 225, 211))
  
  switch (status) {
    case 'queue':
      // Blue: hue-rotate from green to blue
      canvas.style.filter = 'hue-rotate(200deg) saturate(0.9) brightness(1.3)';
      break;
    case 'a':
      // Red: hue-rotate from green to red
      canvas.style.filter = 'hue-rotate(-120deg) saturate(1.5) brightness(1.2)';
      break;
    case 'b':
      // Türkis: hue-rotate from green to türkis
      canvas.style.filter = 'hue-rotate(30deg) saturate(1.2) brightness(1.1)';
      break;
    case 'c':
      // Gelb: hue-rotate from green to yellow
      canvas.style.filter = 'hue-rotate(-60deg) saturate(1.8) brightness(1.3)';
      break;
    case 'd':
      // Hellgrün: similar to green but lighter
      canvas.style.filter = 'hue-rotate(10deg) saturate(0.9) brightness(1.2)';
      break;
    case 'default':
      // Green: No filter (original canvas color)
      canvas.style.filter = 'none';
      break;
  }
}

// Mark songs in library browser with deck colors
function markSongsInLibrary() {
  // Get all song elements in library
  const songElements = document.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  
  songElements.forEach((element) => {
    const el = element as HTMLElement;
    const songId = el.dataset.songId;
    
    if (!songId) return;
    
    // Remove all existing deck markers and play history markers
    el.classList.remove('in-queue', 'on-deck-a', 'on-deck-b', 'on-deck-c', 'on-deck-d', 'recently-played');
    el.style.removeProperty('border-left');
    el.style.removeProperty('--scribble-color');
    el.style.removeProperty('--scribble-opacity');
    
    // Remove old scribble overlay if exists
    const oldScribble = el.querySelector('.recently-played-scribble');
    if (oldScribble) {
      oldScribble.remove();
    }
    
    // Check if song was recently played (within 2 hours)
    const hoursSincePlayed = getTimeSinceLastPlayed(songId);
    if (hoursSincePlayed !== null && hoursSincePlayed < 2) {
      el.classList.add('recently-played');
      
      // Calculate opacity: 0.5 at 0h, 1.0 at 2h
      const opacity = 0.5 + (hoursSincePlayed / 2) * 0.5;
      el.style.opacity = String(opacity);
      
      // Add tooltip
      const playedDate = new Date(Date.now() - hoursSincePlayed * 60 * 60 * 1000);
      const timeAgo = hoursSincePlayed < 1 
        ? `${Math.round(hoursSincePlayed * 60)} min ago`
        : `${Math.round(hoursSincePlayed * 10) / 10}h ago`;
      el.title = `Last played: ${timeAgo}`;
    }
    
    // Check artist play history (fade artist text for 1 hour)
    const artistEl = el.querySelector('.track-artist, .song-artist, .artist-name') as HTMLElement;
    if (artistEl) {
      const artistName = artistEl.textContent?.trim();
      if (artistName) {
        const hoursSinceArtist = getTimeSinceArtistPlayed(artistName);
        if (hoursSinceArtist !== null && hoursSinceArtist < 1) {
          // Calculate opacity: 0.5 at 0h, 1.0 at 1h
          const artistOpacity = 0.5 + hoursSinceArtist * 0.5;
          artistEl.style.opacity = String(artistOpacity);
          
          const timeAgo = `${Math.round(hoursSinceArtist * 60)} min ago`;
          artistEl.title = `Artist last played: ${timeAgo}`;
        } else {
          artistEl.style.opacity = '1';
        }
      }
    }
    
    // Check if song is on a deck (priority over play history)
    const deck = getSongDeck(songId);
    if (deck) {
      el.classList.add(`on-deck-${deck}`);
      const deckColors = {
        'a': '#ff6b6b',
        'b': '#4ecdc4', 
        'c': '#ffd93d',
        'd': '#95e1d3'
      };
      el.style.borderLeft = `4px solid ${deckColors[deck]}`;
      
      // Update waveform color via CSS filter (fast!)
      // No need to check if loaded - updateWaveformColor will handle missing canvas gracefully
      updateWaveformColor(el, deck);
      return;
    }
    
    // Check if song is in queue (only if not on deck and not recently played)
    if (!el.classList.contains('recently-played') && isSongInQueue(songId)) {
      el.classList.add('in-queue');
      el.style.borderLeft = '4px solid #7289da';
      
      // Update waveform color via CSS filter (fast!)
      updateWaveformColor(el, 'queue');
    } else {
      // Update waveform color via CSS filter (fast!)
      updateWaveformColor(el, 'default');
    }
  });
}

function isSongQueueItem(item: QueueItem): item is QueueItem & { song: OpenSubsonicSong } {
  return item.type === 'song' && !!item.song;
}

function isMicrophoneQueueItem(item: QueueItem): boolean {
  return item.type === 'microphone';
}

// Auto-Queue System State
let autoQueueConfig = {
  deckPairAB: true,   // A+B Deck-Pair standardmäßig AKTIVIERT (entspricht HTML default)
  deckPairCD: false,   // C+D Deck-Pair standardmäßig deaktiviert
  lastPlayedDeck: null as 'a' | 'b' | 'c' | 'd' | null,  // Letztes gespieltes Deck für Rotation
  playbackOrder: ['a', 'b', 'c', 'd'] as ('a' | 'b' | 'c' | 'd')[],  // Playback-Reihenfolge
  isAutoPlaying: false  // Verhindert mehrfache Auto-Plays
};

// Check if configuration exists before initializing the app
async function checkConfigurationAndInitialize() {
  console.log("🔍 Checking configuration status...");
  
  // 🔐 STEP 1: Load configuration from backend (SECURE - no tokens in frontend!)
  console.log('🔐 Loading configuration from backend API...');
  const backendConfigLoaded = await initializeConfig();
  
  if (backendConfigLoaded) {
    console.log('✅ Backend configuration loaded successfully');
    console.log('   - All secrets stay on server');
    console.log('   - No rebuild needed for config changes');
  } else {
    console.warn('⚠️ Backend configuration failed, using fallback');
  }
  
  // Check if we have any environment variables that indicate configuration exists
  const hasOpenSubsonicUrl = getConfigValue('VITE_OPENSUBSONIC_URL');
  const hasAzuraCastServers = getConfigValue('VITE_AZURACAST_SERVERS');
  const hasStreamConfig = getConfigValue('VITE_STREAM_BITRATE');

  console.log('🔍 Configuration check:', {
    hasOpenSubsonicUrl: !!hasOpenSubsonicUrl,
    hasAzuraCastServers: !!hasAzuraCastServers,
    hasStreamConfig: !!hasStreamConfig,
    openSubsonicUrl: hasOpenSubsonicUrl,
    azuraCastServers: hasAzuraCastServers,
    source: backendConfigLoaded ? 'backend (secure)' : 'build-time (insecure)',
  });
  
  // 🚀 PRODUCTION MODE: Skip setup wizard and load directly from server
  console.log('� Production mode detected - loading config from server API...');
  
  try {
    const response = await fetch('/api/setup-status');
    const setupStatus = await response.json();
    
    console.log('📡 Server setup status:', setupStatus);
    
    if (setupStatus.configExists && setupStatus.hasContent) {
      console.log('✅ Server configuration found - loading runtime config');
      
      // Load runtime configuration from server
      const configResponse = await fetch('/api/config');
      const configData = await configResponse.json();
      
      // API returns config directly (not wrapped in { success: true, config: {...} })
      if (configData && configData.opensubsonic) {
        console.log('📡 Runtime config loaded:', configData);
        
        // Map backend config to old VITE_* format for compatibility
        runtimeConfig = {
          'VITE_OPENSUBSONIC_URL': configData.opensubsonic.url,
          'VITE_OPENSUBSONIC_USERNAME': configData.opensubsonic.username,
          'VITE_AZURACAST_SERVERS': configData.azuracast.servers,
          'VITE_AZURACAST_STATION_ID': configData.azuracast.stationId,
          'VITE_DISCORD_CHANNEL_ID': configData.discord.channelId,
          'VITE_DISCORD_GUILD_ID': configData.discord.guildId,
          'VITE_STREAM_BITRATE': configData.stream.bitrate,
          'VITE_STREAM_SAMPLE_RATE': configData.stream.sampleRate,
          'VITE_DECK_CONFIGURATION': configData.deckConfiguration,
          'VITE_USE_UNIFIED_LOGIN': String(configData.unifiedLogin.enabled),
        };
        
        (window as any).runtimeConfig = runtimeConfig;
        (window as any).getConfigValue = getConfigValue;
        
        console.log('🔄 Runtime configuration stored globally');
        console.log('🚀 Calling initializeFullApp()...');
        initializeFullApp();
      } else {
        console.log('❌ Failed to load runtime config - trying app initialization');
        initializeFullApp();
      }
    } else {
      console.log('❌ No server configuration found - trying app initialization');
      console.log('🔧 Calling initializeFullApp()...');
      initializeFullApp();
    }
  } catch (error) {
    console.error('❌ Error checking server configuration:', error);
    console.log('� Checking localStorage for offline config (mobile/Capacitor mode)...');
    
    // Try to load from localStorage (for mobile/offline mode)
    const localStorageConfig = localStorage.getItem('subcaster-config');
    if (localStorageConfig) {
      try {
        const configData = JSON.parse(localStorageConfig);
        console.log('📱 Config loaded from localStorage:', configData);
        
        // Map to runtime config format
        runtimeConfig = {
          'VITE_OPENSUBSONIC_URL': configData.opensubsonic?.url || '',
          'VITE_OPENSUBSONIC_USERNAME': configData.opensubsonic?.username || '',
          'VITE_AZURACAST_SERVERS': configData.azuracast?.servers || '',
          'VITE_AZURACAST_STATION_ID': String(configData.azuracast?.stationId || '1'),
          'VITE_DISCORD_CHANNEL_ID': configData.discord?.channelId || '',
          'VITE_DISCORD_GUILD_ID': configData.discord?.guildId || '',
          'VITE_STREAM_BITRATE': String(configData.streaming?.bitrate || '128'),
          'VITE_STREAM_SAMPLE_RATE': String(configData.streaming?.sampleRate || '44100'),
          'VITE_DECK_CONFIGURATION': 'four-decks',
          'VITE_USE_UNIFIED_LOGIN': String(configData.unifiedLogin?.enabled || false),
        };
        
        (window as any).runtimeConfig = runtimeConfig;
        (window as any).getConfigValue = getConfigValue;
        
        console.log('🔄 Runtime configuration loaded from localStorage');
        console.log('🚀 Calling initializeFullApp()...');
        initializeFullApp();
        return;
      } catch (parseError) {
        console.error('❌ Failed to parse localStorage config:', parseError);
      }
    }
    
    console.log('�🔧 Falling back to setup wizard due to API error');
    showSetupWizardOnly();
  }
}

function showSetupWizardOnly() {
  console.log('� PRODUCTION MODE: Setup wizard disabled - starting app directly');
  
  // 🚀 PRODUCTION: Skip setup wizard completely and load app
  initializeFullApp();
}

// Display current version in UI
async function displayCurrentVersion() {
  try {
    const response = await fetch('/api/version');
    if (response.ok) {
      const data = await response.json();
      const versionDisplay = document.getElementById('version-display');
      if (versionDisplay) {
        const versionText = versionDisplay.querySelector('.version-text');
        if (versionText) {
          // Show short Git SHA (first 7 chars)
          const shortSha = data.gitCommit?.substring(0, 7) || 'dev';
          versionText.textContent = shortSha;
          versionDisplay.title = `Version: ${data.version}\nCommit: ${data.gitCommit}\nBuild: ${data.buildDate}`;
          console.log('📌 Version displayed:', shortSha);
        }
      }
    }
  } catch (error) {
    console.error('❌ Failed to fetch version:', error);
    const versionDisplay = document.getElementById('version-display');
    if (versionDisplay) {
      const versionText = versionDisplay.querySelector('.version-text');
      if (versionText) {
        versionText.textContent = 'dev';
      }
    }
  }
}

function initializeFullApp() {
  console.log("🚀 Initializing full SubCaster application...");
  
  // Start update checker service
  updateChecker.start().catch(err => {
    console.error('❌ Failed to start update checker:', err);
  });
  
  // Display current version
  displayCurrentVersion();
  
  // 1. Initialize Player Decks first (creates HTML)
  initializePlayerDecks();
  
  // 2. Setup audio event listeners AFTER deck creation
  setTimeout(() => {
    console.log('🎵 Setting up audio event listeners for all players...');
    ['a', 'b', 'c', 'd'].forEach(side => {
      const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
      if (audio) {
        console.log(`🎵 Setting up audio for player ${side.toUpperCase()}`);
        try {
          setupAudioEventListeners(audio, side as 'a' | 'b' | 'c' | 'd');
          setupAudioPlayer(side as 'a' | 'b' | 'c' | 'd', audio);
          console.log(`✅ Audio setup complete for player ${side.toUpperCase()}`);
        } catch (error) {
          console.error(`❌ Audio setup failed for player ${side.toUpperCase()}:`, error);
        }
      } else {
        console.error(`❌ Audio element not found for player ${side.toUpperCase()}`);
      }
    });
  }, 200);
  
  // 3. Setup drop zones with delay
  setTimeout(() => {
    initializePlayerDropZones();
    setupQueueDropZone();
    setupAlbumCoverDragDrop();
    setupPlayerDeckDragToQueue();
    setupAutoQueueControls();
    setupRadioStreamSelector();
  }, 500);
  
  // 5. Initialize UI components
  initializeOpenSubsonicLogin();
  initializeMediaLibrary();
  
  // 6. Initialize rating system
  initializeRatingListeners();
  
  // 7. 🔧 ELECTRON FIX: Volume meters are started immediately after login
  // Don't auto-start them here - they're already running!
  // Starting them twice creates two Audio Output Controllers → CRASH
  // setTimeout(() => {
  //   autoStartVolumeMeters();
  // }, 1000);
  
  // 8. Initialize Discord Gateway after config is loaded
  console.log('🔧 Setting up Discord Gateway...');
  initializeDiscordClient();
  
  console.log("✅ Main initialization complete!");
}

// Make initializeFullApp globally available for setup wizard
(window as any).initializeFullApp = initializeFullApp;

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM fully loaded and parsed");
  
  // Initialize Electron titlebar if running in Electron
  initElectronTitlebar();
  
  // Check configuration and initialize accordingly
  await checkConfigurationAndInitialize();
  
  // Add scroll listener for lazy-loading waveform backgrounds
  let scrollTimeout: number;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = window.setTimeout(() => {
      loadVisibleSongWaveforms();
    }, 200);
  }, { passive: true });
  
  // Also trigger on resize
  window.addEventListener('resize', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = window.setTimeout(() => {
      loadVisibleSongWaveforms();
    }, 300);
  }, { passive: true });
});

// END OF MAIN APPLICATION INITIALIZATION
// Note: The code below runs after setup completion
  
  // Microphone Toggle Functionality
  const micBtn = document.getElementById("mic-toggle") as HTMLButtonElement;
  const micVolumeSlider = document.getElementById("mic-volume") as HTMLInputElement;
  let micActive = false; // Button state, but microphone is always recording
  
  // Set microphone volume to 100% by default
  if (micVolumeSlider) {
    micVolumeSlider.value = "100";
    console.log("🎤 Microphone volume slider set to 100% by default");
  }
  
  // Microphone Volume Control - always affects gain directly
  micVolumeSlider?.addEventListener("input", (e) => {
    const target = e.target as HTMLInputElement;
    const volume = parseInt(target.value) / 100;
    if (microphoneGain) {
      // Apply volume regardless of button state - slider controls actual volume
      microphoneGain.gain.value = volume;
      console.log(`🎤 Microphone volume: ${Math.round(volume * 100)}%`);
    }
  });

  // Microphone Device Selection
  const micDeviceSelect = document.getElementById("mic-device-select") as HTMLSelectElement;
  const micRefreshBtn = document.getElementById("mic-refresh-btn") as HTMLButtonElement;
  let selectedMicDeviceId: string | null = null;

  // 🔧 ELECTRON FIX: Add placeholder option for on-demand loading
  if (micDeviceSelect) {
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = '🎤 Click to load microphone devices...';
    placeholderOption.disabled = false;
    placeholderOption.selected = true;
    micDeviceSelect.appendChild(placeholderOption);
  }

  // Helper function to format microphone device names
  function formatMicrophoneName(label: string): string {
    // Common prefixes in different languages that should be replaced with mic icon
    const prefixes = [
      'Mikrofon',
      'Microphone',
      'Mic',
      'Mikro',
      'Audio Input',
      'Audioeingabe',
      'Audio Eingabe',
      'Line In',
      'Line-In'
    ];
    
    // Check if label starts with any of these prefixes (case-insensitive)
    for (const prefix of prefixes) {
      const regex = new RegExp(`^${prefix}\\s*[\\(\\-\\:]?\\s*`, 'i');
      if (regex.test(label)) {
        // Replace prefix with mic icon and keep the rest
        const deviceName = label.replace(regex, '').trim();
        return deviceName ? `🎤 ${deviceName}` : '🎤 ' + label;
      }
    }
    
    // If no prefix found, just add mic icon at the beginning
    return `🎤 ${label}`;
  }

  // ============================================================================
  // FACADE: Populate Microphone Devices (routes to MicManager - Phase 4)
  // ============================================================================
  async function populateMicrophoneDevices(): Promise<void> {
    // Route to new MicManager module
    await MicManager.populateMicrophoneDevices(micDeviceSelect);
  }

  // Device selection change handler
  micDeviceSelect.addEventListener('change', async (e) => {
    const target = e.target as HTMLSelectElement;
    selectedMicDeviceId = target.value;
    console.log(`🎤 Selected microphone device: ${target.options[target.selectedIndex].text}`);
    
    // Route device selection to MicManager
    await MicManager.selectMicrophoneDevice(target.value);
  });

  // Track if microphone devices have been loaded
  let micDevicesLoaded = false;
  
  // 🔧 ELECTRON FIX: Load microphone devices on-demand to prevent crash
  // Calling getUserMedia() at startup triggers a stream that crashes Electron when closed
  async function loadMicrophoneDevicesOnDemand() {
    if (!micDevicesLoaded) {
      console.log('🎤 Loading microphone devices on-demand...');
      await populateMicrophoneDevices();
      micDevicesLoaded = true;
    }
  }
  
  // Refresh button handler
  micRefreshBtn.addEventListener('click', async () => {
    console.log('🎤 Refreshing microphone device list...');
    await populateMicrophoneDevices();
    micDevicesLoaded = true;
  });
  
  // Load devices when dropdown is opened (on-demand loading)
  micDeviceSelect.addEventListener('focus', async () => {
    await loadMicrophoneDevicesOnDemand();
  }, { once: true }); // Only load once on first focus
  
  // 🔧 ELECTRON FIX: Don't load microphone devices at startup
  // This prevents the crash caused by getUserMedia permission stream cleanup
  // Devices will be loaded when user opens the dropdown or clicks refresh
  console.log('🎤 Microphone devices will be loaded on-demand (when dropdown is opened)');

  // Deck C+D Toggle Button Event Handler
  const deckToggleBtn = document.getElementById('deck-toggle-btn') as HTMLButtonElement;
  if (deckToggleBtn) {
    deckToggleBtn.addEventListener('click', () => {
      const currentlyVisible = deckConfig.getUserPreference();
      deckConfig.setUserPreference(!currentlyVisible);
      console.log(`🎛️ Deck C+D toggled: ${!currentlyVisible ? 'visible' : 'hidden'}`);
    });
  }

  // Radio Broadcast Processing Button Event Handlers
  const micCompressorBtn = document.getElementById('mic-compressor-btn');
  // Gate button removed - feature was ineffective
  const micEqBtn = document.getElementById('mic-eq-btn');
  const micLimiterBtn = document.getElementById('mic-limiter-btn');
  const micDeEsserBtn = document.getElementById('mic-deesser-btn');

  micCompressorBtn?.addEventListener('click', () => {
    toggleRadioProcessing('compressor');
    micCompressorBtn.classList.toggle('active', micProcessingState.compressor);
  });

  micEqBtn?.addEventListener('click', () => {
    toggleRadioProcessing('eq');
    micEqBtn.classList.toggle('active', micProcessingState.eq);
  });

  micLimiterBtn?.addEventListener('click', () => {
    toggleRadioProcessing('limiter');
    micLimiterBtn.classList.toggle('active', micProcessingState.limiter);
  });

  micDeEsserBtn?.addEventListener('click', () => {
    toggleRadioProcessing('deesser');
    micDeEsserBtn.classList.toggle('active', micProcessingState.deesser);
  });

  // AzuraCast Station Dropdown Initialization (Triggered by STREAM button)
  async function initializeStationDropdown(): Promise<void> {
    const streamButton = document.getElementById('stream-live-status') as HTMLButtonElement;
    const dropdownOverlay = document.getElementById('station-dropdown-overlay') as HTMLDivElement;
    const dropdownMenu = document.getElementById('station-dropdown-menu') as HTMLDivElement;
    const streamUsernameDisplay = document.getElementById('stream-username-display') as HTMLSpanElement;
    
    if (!streamButton || !dropdownOverlay || !dropdownMenu || !streamUsernameDisplay) return;

    let isOpen = false;
    let stations: any[] = [];
    let isStreamConnected = false; // Track if stream is connected

    // Handle STREAM button click based on current state
    const handleStreamButtonClick = async () => {
      console.log(`🔘 Stream button clicked - Current state: ${currentButtonState}, Station ID: ${currentStationId}`);
      
      switch (currentButtonState) {
        case StreamButtonState.SELECT_STATION:
          // Check if streaming is active - if so, block station selection
          if (isLiveStreaming) {
            console.log('🚫 Station selection blocked - streaming is active');
            alert('Cannot change station while streaming is active. Please stop the stream first.');
            return;
          }
          
          console.log('📋 Opening station selection dropdown');
          // Load stations if not already loaded
          if (stations.length === 0) {
            console.log('🔄 Loading stations for first time...');
            await loadStations();
          }
          // Open dropdown to select station
          isOpen = !isOpen;
          dropdownOverlay.classList.toggle('show', isOpen);
          break;
          
        case StreamButtonState.START_STREAMING:
          // If streaming is already active, show warning instead of triggering disconnect
          if (isLiveStreaming) {
            console.log('🚫 Stopping current stream to allow new stream');
            showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
            return;
          }
          
          console.log('🚀 Attempting to start streaming');
          // Start streaming to selected station
          await startStreamingToSelectedStation();
          break;
          
        case StreamButtonState.STREAMING_ACTIVE:
          console.log('⏹️ Stream active - use press and hold to disconnect');
          // Show warning instead of starting countdown via click
          showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
          break;
          
        default:
          console.warn(`⚠️ Unknown button state: ${currentButtonState}`);
          break;
      }
    };

    // Start streaming to the currently selected station
    const startStreamingToSelectedStation = async () => {
      console.log(`🔍 Checking streaming prerequisites - Station ID: ${currentStationId}, Shortcode: ${currentStationShortcode}, Server URL: ${currentServerUrl}`);
      
      if (!currentStationId || !currentStationShortcode || !currentServerUrl) {
        console.error('❌ No station selected for streaming - missing prerequisites');
        alert('Please select a station first before starting to stream.');
        return;
      }
      
      try {
        console.log(`🚀 Starting stream to station: ${currentStationId} (${currentStationShortcode})`);
        currentButtonState = StreamButtonState.STREAMING_ACTIVE;
        isStreamConnected = true;
        isLiveStreaming = true; // Set this for consistent streaming state
        updateStreamButton();
        
        // Start AzuraCast streaming with selected station
        await startAzuraCastStreaming();
        
      } catch (error) {
        console.error('❌ Failed to start streaming:', error);
        alert(`Failed to start streaming: ${error instanceof Error ? error.message : String(error)}`);
        currentButtonState = StreamButtonState.START_STREAMING;
        isStreamConnected = false;
        updateStreamButton();
      }
    };

    // Close dropdown when clicking outside
    const closeDropdown = (event: Event) => {
      if (!streamButton.contains(event.target as Node) && !dropdownOverlay.contains(event.target as Node)) {
        isOpen = false;
        dropdownOverlay.classList.remove('show');
      }
    };

    // Update STREAM button based on current state and selected station
    const updateStreamButton = (selectedStation?: any) => {
      console.log(`🔄 Updating stream button - State: ${currentButtonState}, Station: ${selectedStation?.name || 'none'}`);
      streamButton.classList.remove('occupied', 'connected', 'disconnected');
      const resetButton = document.getElementById('stream-reset-button') as HTMLButtonElement;
      
      switch (currentButtonState) {
        case StreamButtonState.SELECT_STATION:
          streamButton.classList.add('disconnected');
          streamUsernameDisplay.textContent = 'Select Station';
          if (resetButton) resetButton.style.display = 'none';
          break;
          
        case StreamButtonState.START_STREAMING:
          if (selectedStation?.live?.is_live && selectedStation.live.streamer_name) {
            // Station is occupied by another streamer
            streamButton.classList.add('occupied');
            streamUsernameDisplay.textContent = `${selectedStation.name} - ${selectedStation.live.streamer_name}`;
          } else {
            // Station available for streaming
            streamButton.classList.add('disconnected');
            streamUsernameDisplay.textContent = selectedStation?.name || 'Unknown';
          }
          if (resetButton) resetButton.style.display = 'block';
          break;
          
        case StreamButtonState.STREAMING_ACTIVE:
          streamButton.classList.add('connected');
          streamUsernameDisplay.textContent = selectedStation?.name || 'Streaming';
          if (resetButton) resetButton.style.display = 'block';
          break;
          
        default:
          console.warn(`⚠️ Unknown button state: ${currentButtonState}`);
          streamButton.classList.add('disconnected');
          streamUsernameDisplay.textContent = 'Select Station';
          if (resetButton) resetButton.style.display = 'none';
          break;
      }
      
      console.log(`✅ Button updated - Text: "${streamUsernameDisplay.textContent}", Classes: ${streamButton.className}`);
    };

    // Create station dropdown item
    const createStationItem = (station: any) => {
      const item = document.createElement('div');
      item.className = 'station-dropdown-item';
      item.setAttribute('data-station-id', station.id.toString());
      
      const isLive = station.live?.is_live;
      const streamerName = station.live?.streamer_name;
      
      // Add status classes
      if (isLive && streamerName) {
        item.classList.add('occupied');
      } else if (station.is_online) {
        item.classList.add('online');
      } else {
        item.classList.add('offline');
      }

      // Main station info
      const mainInfo = document.createElement('div');
      mainInfo.className = 'station-item-main';
      
      const statusDot = document.createElement('div');
      statusDot.className = 'station-status-dot';
      if (isLive && streamerName) {
        statusDot.classList.add('occupied');
      } else if (station.is_online) {
        statusDot.classList.add('online');
      }
      
      const stationName = document.createElement('span');
      stationName.textContent = station.name;
      
      mainInfo.appendChild(statusDot);
      mainInfo.appendChild(stationName);
      item.appendChild(mainInfo);

      // Streamer info if occupied
      if (isLive && streamerName) {
        const streamerInfo = document.createElement('div');
        streamerInfo.className = 'station-streamer-info';
        streamerInfo.textContent = `Live: ${streamerName}`;
        item.appendChild(streamerInfo);
      }

      // Click handler
      item.addEventListener('click', () => {
        // Remove previous selection
        dropdownMenu.querySelectorAll('.station-dropdown-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        
        // Find the full station data to get server URL
        const fullStationData = stations.find(s => s.station.id === station.id);
        
        // Update global state
        currentStationId = station.id.toString();
        currentStationShortcode = station.shortcode;
        currentServerUrl = fullStationData?.serverUrl;
        currentButtonState = StreamButtonState.START_STREAMING;
        
        // Update button appearance
        updateStreamButton(station);
        
        // Update AzuraCast configuration
        if (azuraCastWebcaster) {
          azuraCastWebcaster.updateConfig({ 
            stationId: station.id.toString(),
            stationShortcode: station.shortcode 
          });
        }
        
        console.log(`🎯 Selected station: ${station.name} (ID: ${station.id}, shortcode: ${station.shortcode})`);
        console.log(`📡 Station configured: ${station.listen_url}`);
        
        // Close dropdown
        isOpen = false;
        dropdownOverlay.classList.remove('show');
      });

      return item;
    };

    // Load stations from AzuraCast servers
    const loadStations = async (): Promise<void> => {
      try {
        const config = createAzuraCastConfig();
        console.log('🔍 Loading AzuraCast stations from all servers...');
        console.log('📡 Server URLs:', config.servers);
        
        // Load stations from all configured servers
        const allServersData = await fetchAllAzuraCastStations(config.servers);
        console.log('📋 Received server data:', allServersData);
        
        // Flatten all stations with server info
        stations = [];
        allServersData.forEach(serverData => {
          console.log(`📡 Processing server: ${serverData.serverUrl}, stations: ${serverData.stations.length}`);
          serverData.stations.forEach(stationData => {
            stations.push({
              ...stationData,
              serverUrl: serverData.serverUrl // Add server URL to each station
            });
          });
        });
        
        console.log(`✅ Loaded ${stations.length} stations total`);
        
        // Clear loading state
        dropdownMenu.innerHTML = '';
        
        if (stations.length === 0) {
          dropdownMenu.innerHTML = '<div class="station-dropdown-item">No stations available</div>';
          return;
        }
        
        // Create station items
        stations.forEach((stationData: any) => {
          // Merge station data with live info
          const stationWithLive = {
            ...stationData.station,
            live: stationData.live
          };
          const item = createStationItem(stationWithLive);
          dropdownMenu.appendChild(item);
        });
        
        // Set default station if configured
        if (config.stationId && config.stationId !== '0') {
          const defaultStationData = stations.find((s: any) => s.station.id.toString() === config.stationId);
          if (defaultStationData) {
            currentStationId = config.stationId;
            currentStationShortcode = defaultStationData.station.shortcode;
            
            const stationWithLive = {
              ...defaultStationData.station,
              live: defaultStationData.live
            };
            updateStreamButton(stationWithLive);
            
            // Mark as selected in dropdown
            const selectedItem = dropdownMenu.querySelector(`[data-station-id="${config.stationId}"]`);
            selectedItem?.classList.add('selected');
          }
        }
        
        console.log(`✅ Loaded ${stations.length} AzuraCast stations`);
        
      } catch (error) {
        console.error('❌ Failed to load AzuraCast stations:', error);
        
        // Show error in dropdown
        dropdownMenu.innerHTML = '<div class="station-dropdown-item">Fehler beim Laden der Stationen</div>';
      }
    };

    // Event listeners
    streamButton.addEventListener('click', handleStreamButtonClick);
    document.addEventListener('click', closeDropdown);
    
    // Reset button handler
    const resetButton = document.getElementById('stream-reset-button') as HTMLButtonElement;
    if (resetButton) {
      resetButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering stream button click
        
        // Block reset during live streaming
        if (isLiveStreaming) {
          console.log('🚫 Station reset blocked - live streaming is active');
          alert('Cannot reset station selection while live streaming is active. Please stop the stream first.');
          return;
        }
        
        // Reset station selection
        currentStationId = null;
        currentStationShortcode = null;
        currentServerUrl = null;
        currentButtonState = StreamButtonState.SELECT_STATION;
        
        // Clear dropdown selection
        dropdownMenu.querySelectorAll('.station-dropdown-item').forEach(i => i.classList.remove('selected'));
        
        // Update button appearance
        updateStreamButton();
        
        // Hide reset button
        resetButton.style.display = 'none';
        
        console.log('🔄 Station selection reset');
      });
    }
    
    // Initialize button state
    updateStreamButton();
    
    // Make updateStreamButton globally available for reset after streaming
    (window as any).__updateStreamButton = updateStreamButton;
    
    // Make streaming function globally available
    (window as any).__startAzuraCastStreaming = startAzuraCastStreaming;
  }

  // AzuraCast WebDJ Streaming Functions
  async function startAzuraCastStreaming(): Promise<void> {
    try {
      // Initialize audio mixing if not done yet
      if (!audioContext || !masterAudioDestination) {
        console.log('🔧 Initializing audio mixing for streaming...');
        const success = await initializeAudioMixing();
        if (!success || !masterAudioDestination) {
          console.error('❌ Failed to initialize audio system for streaming');
          alert('Audio system initialization failed. Please try again.');
          return;
        }
        console.log('✅ Audio system ready for streaming');
      }

      // Create AzuraCast webcaster with selected station ID, shortcode and server
      const config = createAzuraCastConfig(
        currentStationId || undefined, 
        currentStationShortcode || undefined,
        currentServerUrl || undefined,
        streamConfig.username,
        streamConfig.password
      );
      azuraCastWebcaster = new AzuraCastWebcaster(config);

      // Get master audio stream
      const masterStream = masterAudioDestination.stream;
      
      // Connect to AzuraCast
      const connected = await azuraCastWebcaster.connect(masterStream);
      
      if (connected) {
        isStreaming = true;
        isLiveStreaming = true; // Keep both streaming states in sync
        
        // Update UI
        const streamBtn = document.getElementById('stream-live-status') as HTMLButtonElement;
        const streamLabel = document.getElementById('stream-username-display') as HTMLElement;
        
        if (streamBtn) {
          streamBtn.classList.add('connected', 'live');
          streamBtn.classList.remove('disconnected');
        }
        
        if (streamLabel) {
          streamLabel.textContent = config.username;
        }
        
        updateUserStatus('stream', config.username, true);
        console.log('🔴 LIVE: Streaming to AzuraCast started!');
        
        // Register metadata provider function for continuous updates
        azuraCastWebcaster.setCurrentTrackProvider(() => getCurrentTrackMetadata());
        
        // Send initial metadata if current track is playing
        const currentTrack = getCurrentTrackMetadata();
        if (currentTrack) {
          azuraCastWebcaster.sendMetadata(currentTrack);
        }
        
        // Auto-remove blacklisted songs from decks when streaming starts
        let removedFromDecks = 0;
        const decks: Array<'a' | 'b' | 'c' | 'd'> = ['a', 'b', 'c', 'd'];
        
        console.log('🔍 Checking decks for blacklisted genres...');
        console.log('🔍 Blacklisted genres:', blacklistedGenres);
        
        for (const deck of decks) {
          const deckState = playerStates[deck];
          console.log(`🔍 Deck ${deck.toUpperCase()}: hasSong=${!!deckState.song}, genre=${deckState.song?.genre || 'none'}`);
          
          if (deckState.song && hasBlacklistedGenre(deckState.song)) {
            console.warn(`🚫 Removing blacklisted song from deck ${deck.toUpperCase()}: "${deckState.song.title}" (${deckState.song.genre})`);
            
            // Stop playback if playing
            const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
            if (audio && !audio.paused) {
              audio.pause();
            }
            
            // Clear the deck
            clearPlayerDeck(deck);
            removedFromDecks++;
          }
        }
        
        // Auto-remove blacklisted songs from queue when streaming starts
        const originalQueueLength = queue.length;
        queue = queue.filter(item => {
          if (isSongQueueItem(item)) {
            const hasBlacklisted = hasBlacklistedGenre(item.song);
            if (hasBlacklisted) {
              console.warn(`🚫 Removing blacklisted song from queue: "${item.song.title}" (${item.song.genre})`);
            }
            return !hasBlacklisted;
          }
          return true; // Keep non-song items (separators, etc.)
        });
        
        const removedFromQueue = originalQueueLength - queue.length;
        const totalRemoved = removedFromDecks + removedFromQueue;
        
        if (totalRemoved > 0) {
          console.log(`🧹 Removed ${totalRemoved} blacklisted song(s) when streaming started (${removedFromDecks} from decks, ${removedFromQueue} from queue)`);
          updateQueueDisplay();
          
          // Non-blocking notification
          let message = `🚫 ${totalRemoved} Song(s) mit blacklisted Genre entfernt`;
          if (removedFromDecks > 0 && removedFromQueue > 0) {
            message += ` (${removedFromDecks} von Decks, ${removedFromQueue} aus Queue)`;
          } else if (removedFromDecks > 0) {
            message += ` von Decks`;
          } else {
            message += ` aus Queue`;
          }
          
          showStatusMessage(message, 'info');
        }
        
      } else {
        throw new Error('Failed to connect to AzuraCast');
      }
      
    } catch (error) {
      console.error('❌ Failed to start AzuraCast streaming:', error);
      alert(`Failed to start streaming: ${error}`);
      isStreaming = false;
      azuraCastWebcaster = null;
    }
  }

  async function stopAzuraCastStreaming(): Promise<void> {
    try {
      if (azuraCastWebcaster) {
        azuraCastWebcaster.disconnect();
        azuraCastWebcaster = null;
      }
      
      isStreaming = false;
      
      // Update UI
      const streamBtn = document.getElementById('stream-live-status') as HTMLButtonElement;
      const streamLabel = document.getElementById('stream-username-display') as HTMLElement;
      
      if (streamBtn) {
        streamBtn.classList.add('disconnected');
        streamBtn.classList.remove('connected', 'live');
      }
      
      if (streamLabel) {
        streamLabel.textContent = '-';
      }
      
      updateUserStatus('stream', '', false);
      console.log('⏹️ AzuraCast streaming stopped');
      
    } catch (error) {
      console.error('❌ Error stopping AzuraCast streaming:', error);
    }
  }

  // Get current track metadata for AzuraCast - prioritize most recently started track
  function getCurrentTrackMetadata(): AzuraCastMetadata | null {
    console.log(`🔍 getCurrentTrackMetadata() called`);
    
    // Get all currently playing decks with their start times
    const playingDecks = ['a', 'b', 'c', 'd']
      .map(deck => {
        const deckState = playerStates[deck as keyof typeof playerStates];
        const isPlaying = deckState?.isPlaying || false;
        
        console.log(`🔍 Deck ${deck}: playing=${isPlaying}, startTime=${deckState?.startTime}, song=${!!deckSongs[deck as keyof typeof deckSongs]}`);
        
        return {
          deck,
          isPlaying,
          startTime: deckState?.startTime || 0,
          song: deckSongs[deck as keyof typeof deckSongs]
        };
      })
      .filter(info => info.isPlaying && info.song) // Only playing decks with songs
      .sort((a, b) => b.startTime - a.startTime); // Sort by start time DESC (most recent first)
    
    console.log(`🔍 Found ${playingDecks.length} playing decks with songs`);
    
    if (playingDecks.length > 0) {
      const mostRecentDeck = playingDecks[0];
      console.log(`🎵 Metadata priority: Deck ${mostRecentDeck.deck.toUpperCase()} (started: ${new Date(mostRecentDeck.startTime).toLocaleTimeString()})`);
      
      if (mostRecentDeck.song) {
        const metadata = {
          title: mostRecentDeck.song.title || 'Unknown Title',
          artist: mostRecentDeck.song.artist || 'Unknown Artist'
        };
        console.log(`🎵 Returning metadata: ${metadata.artist} - ${metadata.title}`);
        return metadata;
      }
    }
    
    console.log(`❌ No current track metadata available`);
    return null;
  }

  // Auto-update metadata when tracks start/stop (AzuraCast style - once per track)
  function updateStreamMetadata() {
    if (azuraCastWebcaster?.getConnectionStatus()) {
      // Use immediate update to force refresh metadata
      azuraCastWebcaster.updateMetadataImmediate();
      console.log(`📊 Triggered immediate metadata update`);
    }
  }
  
  micBtn?.addEventListener("click", async () => {
    micActive = !micActive;
    
    // Initialize microphone if not already done
    if (!microphoneStream) {
      // Audio-Mixing initialisieren falls nötig
      if (!audioContext) {
        await initializeAudioMixing();
      }
      
      // Ensure AudioContext is running
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
        console.log('🎤 AudioContext resumed for microphone activation');
      }
      
      // Mikrofon einrichten (nur einmal, läuft dann kontinuierlich)
      const micReady = await setupMicrophone();
      if (!micReady) {
        micActive = false;
        alert('Microphone access denied or not available');
        return;
      }
    }
    
    // Button controls volume, not stream
    if (micActive) {
      // Volume basierend auf Slider setzen
      const volume = parseInt(micVolumeSlider?.value || "100") / 100;
      setMicrophoneEnabled(true, volume);
      micBtn.classList.add("active");
      
      // Check if user is "doooni" and add special effects
      if (openSubsonicClient && openSubsonicClient.getUsername().toLowerCase() === 'doooni') {
        micBtn.classList.add("doooni-mode");
        console.log("🎉 DOOONI MODE ACTIVATED! 🎉");
      }
      
      micBtn.innerHTML = '<span class="material-icons">mic</span> MICROPHONE ON';
      console.log(`🎤 Microphone volume enabled: ${Math.round(volume * 100)}%`);
    } else {
      // Mute microphone but keep stream running
      setMicrophoneEnabled(false);
      micBtn.classList.remove("active");
      micBtn.classList.remove("doooni-mode"); // Remove doooni mode when deactivating
      micBtn.innerHTML = '<span class="material-icons">mic</span> MICROPHONE';
      console.log("🎤 Microphone muted (stream still active)");
      
      // Auto-resume queue if auto-queue is enabled and we have songs available
      const autoQueueEnabled = autoQueueConfig.deckPairAB || autoQueueConfig.deckPairCD;
      if (autoQueueEnabled && queue.length > 0) {
        // Check if all decks are stopped and we can resume auto-play
        const playingDecks = countPlayingDecks();
        if (playingDecks === 0) {
          console.log("🔄 Microphone deactivated - resuming auto-queue");
          
          // Resume auto-queue by starting the next available deck
          const nextAvailableDeck = getNextDeck(autoQueueConfig.lastPlayedDeck || 'a');
          if (nextAvailableDeck) {
            setTimeout(() => {
              startNextDeckWithNewTrack(nextAvailableDeck);
            }, 1000); // Small delay to ensure microphone is fully deactivated
          }
        }
      }
    }
  });

  // AzuraCast Station Selection Setup
  initializeStationDropdown();

  // Stream Live Button Event Listener - AzuraCast WebDJ Integration
  // NOTE: This handler is now handled by the station dropdown logic in initializeStationDropdown()
  // to ensure proper station selection before streaming
  const streamLiveBtn = document.getElementById('stream-live-status') as HTMLButtonElement;
  if (streamLiveBtn) {
    console.log('🔄 Stream button found - using station dropdown handler instead of direct streaming');
  }
  
// Audio-Mixing-System initialisieren
// Audio-Quellen zu Mixing-System hinzufügen

// CORS-Fehlermeldung anzeigen
function showCORSErrorMessage() {
  // Prüfen ob bereits eine Fehlermeldung angezeigt wird
  if (document.getElementById('cors-error-message')) return;
  
  const errorDiv = document.createElement('div');
  errorDiv.id = 'cors-error-message';
  errorDiv.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #ff4444 0%, #cc0000 100%);
    color: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
    max-width: 400px;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 14px;
    line-height: 1.4;
  `;
  
  errorDiv.innerHTML = `
    <div style="display: flex; align-items: center; margin-bottom: 10px;">
      <span class="material-icons" style="margin-right: 8px;">error</span>
      <strong>Streaming Connection Blocked</strong>
    </div>
    <p style="margin: 8px 0;">Browser-Security (CORS) verhindert direkte Verbindungen zu Shoutcast-Servern.</p>
    <div style="margin-top: 12px; font-size: 12px; opacity: 0.9;">
      <strong>Lösungen:</strong><br>
      • Proxy-Server verwenden<br>
      • Browser mit --disable-web-security starten<br>
      • Server CORS-Header konfigurieren
    </div>
    <button onclick="this.parentElement.remove()" style="
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      opacity: 0.7;
    ">&times;</button>
  `;
  
  document.body.appendChild(errorDiv);
  
  // Automatisch nach 10 Sekunden entfernen
  setTimeout(() => {
    if (errorDiv.parentElement) {
      errorDiv.remove();
    }
  }, 10000);
}

// Initialize radio broadcast processing chain
// ============================================================================
// FACADE: Radio Broadcast Processing (routes to MicManager - Phase 4)
// ============================================================================
async function initializeRadioProcessing(): Promise<void> {
  // Radio processing is now initialized automatically by MicManager.setupMicrophone()
  console.log('📻 Radio processing will be initialized by MicManager');
}

// ============================================================================
// FACADE: Toggle Radio Processing (routes to MicManager - Phase 4)
// ============================================================================
function toggleRadioProcessing(process: 'compressor' | 'eq' | 'limiter' | 'deesser'): void {
  // Route to new MicManager module
  MicManager.toggleProcessing(process);
}

// ============================================================================
// FACADE: Setup Microphone (routes to MicManager - Phase 4)
// ============================================================================
async function setupMicrophone() {
  // Route to new MicManager module
  return await MicManager.setupMicrophone();
}

// Crossfader-Position setzen (0 = A, 0.25 = B, 0.5 = C, 0.75 = D, 1 = alle)
// ============================================================================
// FACADE: Crossfader Position (routes to Mixer module - Phase 3)
// ============================================================================
function setCrossfaderPosition(position: number) {
  // Route to new Mixer module
  Mixer.setCrossfaderPosition(position);
}

// ============================================================================
// FACADE: Microphone Control (routes to Mixer module - Phase 3)
// ============================================================================
function setMicrophoneEnabled(enabled: boolean, volume: number = 1) {
  // Route to new Mixer module
  Mixer.setMicrophoneEnabled(enabled, volume);
}















// Streaming-Status anzeigen/verstecken






// Library Initialization
function initializeLibrary() {
  console.log('🎵 Initializing Music Library...');
  
  // Tab Navigation
  initializeTabs();
  
  // Search Funktionalität
  initializeSearch();
  
  // Queue Drag & Drop (permanent initialisieren)
  initializeQueuePermanent();
  
  // Complete Player System initialisieren
  initializePlayerSystem();
  
  // Rating-Event-Listeners initialisieren
  initializeRatingListeners();
}

// Musikbibliothek initialisieren
async function initializeMusicLibrary() {
  console.log("📚 initializeMusicLibrary started");
  
  try {
    // Initialize player system FIRST (creates audio elements and WaveSurfer)
    console.log("🎵 Initializing player system...");
    initializePlayerSystem();
    console.log("✅ Player system initialized");
    
    // Lade initial Songs
    console.log("🎵 Loading songs...");
    await loadSongs();
    
    // Lade Albums
    console.log("💿 Loading albums...");
    await loadAlbums();
    
    // Lade Artists
    console.log("👨‍🎤 Loading artists...");
    await loadArtists();
    
    // Initialize and show the unified library browser after login
    console.log("🌐 Calling enableLibraryAfterLogin...");
    enableLibraryAfterLogin();
    console.log("✅ Library browser initialized after login");
    
    // Re-initialize drop zones after library is loaded
    setTimeout(() => {
      console.log("🎯 Re-initializing drop zones after library load...");
      initializePlayerDropZones();
      setupQueueDropZone();
      console.log("🎯 Drop zones re-initialized after library load");
      
      // Re-initialize album cover drag & drop after library load
      setupAlbumCoverDragDrop();
      console.log("🎯 Album cover drag & drop re-initialized after library load");
      
      // Re-initialize player deck drag to queue after library load
      setupPlayerDeckDragToQueue();
      console.log("🎯 Player deck drag to queue re-initialized after library load");
    }, 1000);
    
  } catch (error) {
    console.error("❌ Error loading music library:", error);
    showError("Error loading music library: " + error);
  }
}

// Tab Navigation initialisieren
function initializeTabs() {
  const tabBtns = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  console.log(`Found ${tabBtns.length} tab buttons and ${tabContents.length} tab contents`);
  
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      console.log(`Switching to tab: ${tabName}`);
      
      // Alle Tabs deaktivieren
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(content => {
        content.classList.remove('active');
        (content as HTMLElement).style.display = 'none';
      });
      
      // Aktiven Tab aktivieren
      btn.classList.add('active');
      const activeContent = document.getElementById(`tab-${tabName}`);
      if (activeContent) {
        activeContent.classList.add('active');
        activeContent.style.display = 'flex';
        console.log(`Activated tab content: tab-${tabName}`);
        
        // Re-initialize listeners for the active tab if needed
        if (tabName === 'albums') {
          setTimeout(() => {
            const albumsContainer = document.getElementById('albums-grid');
            if (albumsContainer) {
              addAlbumClickListeners(albumsContainer);
              console.log('Re-added album click listeners after tab switch');
            }
          }, 100);
        } else if (tabName === 'artists') {
          setTimeout(() => {
            const artistsContainer = document.getElementById('artists-list');
            if (artistsContainer) {
              addArtistClickListeners(artistsContainer);
              console.log('Re-added artist click listeners after tab switch');
            }
          }, 100);
        }
      } else {
        console.error(`Tab content not found: tab-${tabName}`);
      }
    });
  });
}

// Suchfunktionalität initialisieren
function initializeSearch() {
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
  
  const performSearch = async () => {
    if (!openSubsonicClient) {
      showError('Not connected to OpenSubsonic');
      return;
    }
    
    // Clean query: remove standalone dashes (not attached to letters/numbers)
    const rawQuery = searchInput.value.trim();
    const query = rawQuery.replace(/\s-\s/g, ' ').replace(/\s+/g, ' ').trim();
    
    console.log(`🧹 Query cleaning: "${rawQuery}" → "${query}"`);
    
    // Wenn Suchfeld leer ist, zeige No Search State
    if (!query) {
      showNoSearchState();
      return;
    }
    
    console.log('Searching for:', query);
    
    try {
      showSearchLoading();
      const results = await openSubsonicClient.search(query);
      displaySearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      showError('Search failed: ' + error);
    }
  };
  
  searchBtn?.addEventListener('click', performSearch);
  searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      performSearch();
    }
  });

  // Bei Eingabeänderungen auch prüfen
  searchInput?.addEventListener('input', () => {
    // Wenn Feld geleert wird, zeige No Search State
    if (!searchInput.value.trim()) {
      showNoSearchState();
    }
  });
}

// Songs laden
async function loadSongs() {
  if (!openSubsonicClient) return;
  
  console.log('Loading songs...');
  const songsContainer = document.getElementById('songs-list');
  if (!songsContainer) return;
  
  try {
    currentSongs = await openSubsonicClient.getSongs(100);
    console.log(`Loaded ${currentSongs.length} songs`);
    
    // Erstelle Songs-Tabelle mit Header
    let html = '<div class="songs-table-header">';
    html += '<div class="header-cover">Cover</div>';
    html += '<div class="header-title">Title</div>';
    html += '<div class="header-artist">Artist</div>';
    html += '<div class="header-album">Album</div>';
    html += '<div class="header-rating">Rating</div>';
    html += '<div class="header-duration">Duration</div>';
    html += '</div>';
    // Use unified song container instead of HTML string
    const songsContainer = createUnifiedSongsContainer(currentSongs, 'album');
    const albumDetailsContainer = document.getElementById('album-details');
    if (albumDetailsContainer) {
      const existingSongsTable = albumDetailsContainer.querySelector('.songs-table, .unified-songs-container');
      if (existingSongsTable) {
        existingSongsTable.replaceWith(songsContainer);
      } else {
        albumDetailsContainer.appendChild(songsContainer);
      }
    }
    
    songsContainer.innerHTML = html;
    addDragListeners(songsContainer);
    addSongClickListeners(songsContainer);
  } catch (error) {
    console.error('Error loading songs:', error);
    songsContainer.innerHTML = '<div class="loading">Error loading songs</div>';
  }
}

// Albums laden
async function loadAlbums() {
  if (!openSubsonicClient) return;
  
  console.log('Loading albums...');
  const albumsContainer = document.getElementById('albums-grid');
  if (!albumsContainer) return;
  
  try {
    currentAlbums = await openSubsonicClient.getAlbums(50);
    console.log(`Loaded ${currentAlbums.length} albums`);
    
    albumsContainer.innerHTML = currentAlbums.map(album => createAlbumHTML(album)).join('');
    
    // Hinzufügen der Click Listener für Albums
    setTimeout(() => {
      addAlbumClickListeners(albumsContainer);
      console.log('Album click listeners added to albums grid');
    }, 50);
  } catch (error) {
    console.error('Error loading albums:', error);
    albumsContainer.innerHTML = '<div class="loading">Error loading albums</div>';
  }
}

// Artists laden
async function loadArtists() {
  if (!openSubsonicClient) return;
  
  console.log('Loading artists...');
  const artistsContainer = document.getElementById('artists-list');
  if (!artistsContainer) return;
  
  try {
    currentArtists = await openSubsonicClient.getArtists();
    console.log(`Loaded ${currentArtists.length} artists`);
    
    artistsContainer.innerHTML = currentArtists.map(artist => createArtistHTML(artist)).join('');
    
    // Hinzufügen der Click Listener für Artists
    setTimeout(() => {
      addArtistClickListeners(artistsContainer);
      console.log('Artist click listeners added to artists list');
    }, 50);
  } catch (error) {
    console.error('Error loading artists:', error);
    artistsContainer.innerHTML = '<div class="loading">Error loading artists</div>';
  }
}

// Song HTML erstellen
// Song HTML als Einzelner für einheitliche Darstellung erstellen

// Hilfsfunktion zum Erstellen von Artist-Links aus dem artists Array
function createArtistLinks(song: OpenSubsonicSong): string {
  // Verwende artists Array falls verfügbar, sonst Fallback auf artist string
  if (song.artists && song.artists.length > 0) {
    if (song.artists.length === 1) {
      const artist = song.artists[0];
      return `<span class="clickable-artist" draggable="false" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" title="View artist details">${escapeHtml(artist.name)}</span>`;
    } else {
      // Multiple Artists - jeder einzeln klickbar
      const artistLinks = song.artists.map(artist => 
        `<span class="clickable-artist" draggable="false" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}" title="View artist details">${escapeHtml(artist.name)}</span>`
      ).join('<span class="artist-separator"> • </span>');
      
      return `<span class="multi-artist">${artistLinks}</span>`;
    }
  } else {
    // Fallback für alte API oder wenn artists Array nicht verfügbar
    return `<span class="clickable-artist" draggable="false" data-artist-name="${escapeHtml(song.artist)}" title="View artist details">${escapeHtml(song.artist)}</span>`;
  }
}
// Kompakte Song-Darstellung für Queue (Stream-Button Style)
function createCompactQueueSongElement(song: OpenSubsonicSong): HTMLElement {
  const songButton = document.createElement('div');
  songButton.className = 'queue-song-button';
  songButton.dataset.songId = song.id;
  songButton.dataset.type = 'song';
  
  // Song-Informationen kompakt anzeigen
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
  
  // WICHTIG: Element selbst ist NICHT draggable, da der Wrapper das Drag-Event handelt
  // Dies verhindert doppelte DragStart-Events die sich gegenseitig überschreiben
  songButton.draggable = false;
  
  return songButton;
}

// Kompakte Mikrofon-Platzhalter-Darstellung für Queue (Stream-Button Style)
function createCompactQueueMicrophoneElement(): HTMLElement {
  const micButton = document.createElement('div');
  micButton.className = 'queue-mic-button';
  micButton.dataset.type = 'microphone';
  
  // Mikrofon-Platzhalter anzeigen
  micButton.innerHTML = `
    <span class="material-icons queue-mic-icon">mic</span>
    <div class="queue-mic-info">
      <div class="queue-mic-title">MICROPHONE</div>
      <div class="queue-mic-subtitle">Talk Break</div>
    </div>
  `;
  
  // WICHTIG: Element selbst ist NICHT draggable, da der Wrapper das Drag-Event handelt
  // Dies verhindert doppelte DragStart-Events die sich gegenseitig überschreiben
  micButton.draggable = false;
  
  return micButton;
}

// Einheitliche Song-Darstellung für alle Bereiche (Search, Album-Details, Queue)
function createUnifiedSongElement(song: OpenSubsonicSong, context: 'search' | 'album' | 'queue' = 'search'): HTMLElement {
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
  const coverUrl = song.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(song.coverArt, 40) : '';
  
  // Check if genre is blacklisted
  const isBlacklisted = hasBlacklistedGenre(song);
  const genreClass = isBlacklisted ? 'track-genre blacklisted' : 'track-genre';
  
  // Modern row layout für Song-Listen
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
  
  // Drag and Drop aktivieren
  trackItem.draggable = true;
  trackItem.addEventListener('dragstart', (e) => {
    console.log('🚀 DRAGSTART on track item:', song.title, 'by', song.artist);
    console.log('🚀 Song genre:', song.genre);
    console.log('🚀 Event target:', e.target);
    console.log('🚀 DataTransfer available:', !!e.dataTransfer);
    
    if (e.dataTransfer) {
      // Set JSON data (preferred)
      const dragData = {
        type: 'song',
        song: song,
        sourceUrl: openSubsonicClient?.getStreamUrl(song.id)
      };
      
      console.log('🚀 Setting drag data (song object):', {
        title: song.title,
        artist: song.artist,
        genre: song.genre,
        hasGenre: !!song.genre
      });
      
      e.dataTransfer.setData('application/json', JSON.stringify(dragData));
      // Set song ID as text/plain for fallback compatibility
      e.dataTransfer.setData('text/plain', song.id);
      e.dataTransfer.effectAllowed = 'copy';
      
      console.log('🚀 Drag data set successfully');
    } else {
      console.error('🚀 ERROR: No dataTransfer available!');
    }
  });
  
  return trackItem;
}

// Container function for song lists
function createUnifiedSongsContainer(songs: OpenSubsonicSong[], context: 'search' | 'album' | 'queue' = 'album'): HTMLElement {
  const container = document.createElement('div');
  container.className = 'songs-container';
  
  songs.forEach(song => {
    const songElement = createUnifiedSongElement(song, context);
    container.appendChild(songElement);
  });
  
  return container;
}

function createSongHTMLOneline(song: OpenSubsonicSong): string {
  const duration = formatDuration(song.duration);
  const coverUrl = song.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(song.coverArt, 60) : '';
  
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

// 5-Sterne Rating System erstellen
function createStarRating(currentRating: number, songId: string, useRatingStarClass: boolean = false): string {
  let starsHTML = '';
  const starClass = useRatingStarClass ? 'rating-star' : 'star';
  
  // Nur die tatsächlich bewerteten Sterne anzeigen (gefüllte Sterne)
  // Wenn Rating 0 ist, zeige mindestens 1 leeren Stern
  const starsToShow = currentRating > 0 ? currentRating : 1;
  
  for (let i = 1; i <= starsToShow; i++) {
    const filled = i <= currentRating ? 'filled' : '';
    starsHTML += `<span class="${starClass} ${filled}" data-rating="${i}" data-song-id="${songId}">★</span>`;
  }
  
  // Füge unsichtbare Sterne für Hover-Funktion hinzu (für Bewertung)
  // Diese sind nur beim Hovern sichtbar
  for (let i = starsToShow + 1; i <= 5; i++) {
    starsHTML += `<span class="${starClass} hidden-star" data-rating="${i}" data-song-id="${songId}">★</span>`;
  }
  
  return starsHTML;
}

// Rating setzen
async function setRating(songId: string, rating: number) {
  if (!openSubsonicClient) return;
  
  const success = await openSubsonicClient.setRating(songId, rating);
  if (success) {
    // Update UI
    updateRatingDisplay(songId, rating);
    console.log(`Rating set: ${rating} stars for song ${songId}`);
  }
}

// Rating Display aktualisieren
function updateRatingDisplay(songId: string, rating: number) {
  // ✅ 1. Update song objects in queue
  queue.forEach(queueItem => {
    if (isSongQueueItem(queueItem) && queueItem.song?.id === songId) {
      queueItem.song.userRating = rating;
    }
  });
  
  // ✅ 2. Update song objects in currentSongs array (library cache)
  currentSongs.forEach(song => {
    if (song.id === songId) {
      song.userRating = rating;
    }
  });
  
  // ✅ 3. Update HTML display
  // Suche nach Rating-Containern in zwei Varianten:
  // 1. .rating-stars innerhalb eines Elements mit data-song-id (Library-Ansicht)
  // 2. .rating-stars mit direktem data-song-id Attribut (Queue-Ansicht)
  const ratingContainers = document.querySelectorAll(
    `[data-song-id="${songId}"] .rating-stars, .rating-stars[data-song-id="${songId}"]`
  );
  ratingContainers.forEach(container => {
    container.innerHTML = createStarRating(rating, songId);
  });
  
  // ✅ 4. Update player rating if this song is currently playing (ALL DECKS)
  updatePlayerRating('a', songId, rating);
  updatePlayerRating('b', songId, rating);
  updatePlayerRating('c', songId, rating);
  updatePlayerRating('d', songId, rating);
}

// Player Rating aktualisieren
function updatePlayerRating(player: string, songId: string, rating: number) {
  const currentSongId = getCurrentSongId(player);
  if (currentSongId === songId) {
    const playerRating = document.getElementById(`player-rating-${player}`);
    if (playerRating) {
      playerRating.innerHTML = createStarRating(rating, songId, true);
    }
  }
}

// Aktuelle Song ID aus Player holen
function getCurrentSongId(player: string): string | null {
  const audio = document.getElementById(`audio-${player}`) as HTMLAudioElement;
  return audio?.dataset.songId || null;
}

// Album HTML erstellen
function createAlbumHTML(album: OpenSubsonicAlbum): string {
  const coverUrl = album.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(album.coverArt, 300) : '';
  const year = (album as any).year || (album as any).date ? 
    new Date((album as any).year || (album as any).date).getFullYear() : '';
  const songCount = album.songCount || 0;
  
  return `
    <div class="album-item-modern" draggable="true" data-album-id="${album.id}" data-type="album" data-cover-art="${album.coverArt || ''}">
      <div class="album-cover-container">
        <div class="album-cover-modern" style="background-image: url('${coverUrl}')">
          ${!coverUrl ? '<div class="album-no-cover"><span class="material-icons">album</span></div>' : ''}
          <div class="album-overlay">
            <div class="album-play-button">
              <span class="material-icons">play_arrow</span>
            </div>
            <div class="album-actions">
              <span class="album-song-count">${songCount} tracks</span>
              ${year ? `<span class="album-year">${year}</span>` : ''}
            </div>
          </div>
        </div>
      </div>
      <div class="album-info-modern">
        <div class="album-title-modern" title="${escapeHtml(album.name)}">${escapeHtml(album.name)}</div>
        <div class="album-artist-modern" title="${escapeHtml(album.artist)}">${escapeHtml(album.artist)}</div>
      </div>
    </div>
  `;
}

// Artist HTML erstellen
function createArtistHTML(artist: OpenSubsonicArtist): string {
  return `
    <div class="artist-item" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}">
      <div class="artist-name">${escapeHtml(artist.name)}</div>
      <div class="artist-info">${artist.albumCount} albums</div>
    </div>
  `;
}

// Search Results anzeigen mit MediaContainer
function displaySearchResults(results: any, addToHistory: boolean = true) {
  // FIRST: Switch to search tab to make elements accessible
  const searchTabBtn = document.querySelector('.tab-btn[data-tab="search"]') as HTMLElement;
  const browseTabBtn = document.querySelector('.tab-btn[data-tab="browse"]') as HTMLElement;
  const searchContent = document.getElementById('search-content');
  const browseContent = document.getElementById('browse-content');
  
  if (searchTabBtn && browseTabBtn && searchContent && browseContent) {
    // Switch to search tab
    browseTabBtn.classList.remove('active');
    searchTabBtn.classList.add('active');
    browseContent.classList.remove('active');
    searchContent.classList.add('active');
  }

  if (!searchContent) {
    console.error('Search content container not found');
    return;
  }

  // Speichere die aktuellen Suchergebnisse
  lastSearchResults = results;
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (searchInput) {
    lastSearchQuery = searchInput.value.trim();
  }
  
  // Clear previous content and use searchContent directly as universal container
  searchContent.innerHTML = '';
  
  let hasResults = false;
  
  // Artists mit MediaContainer
  if (results.artist && results.artist.length > 0) {
    hasResults = true;
    const artistsContainer = document.createElement('div');
    artistsContainer.innerHTML = '<h4>Artists</h4><div id="search-artists"></div>';
    searchContent.appendChild(artistsContainer);
    
    const artistItems: MediaItem[] = results.artist.map((artist: OpenSubsonicArtist) => ({
      id: artist.id,
      name: artist.name,
      type: 'artist' as const,
      coverArt: artist.coverArt,
      artistImageUrl: artist.artistImageUrl,
      albumCount: artist.albumCount
    }));

    const artistContainer = new MediaContainer({
      containerId: 'search-artists',
      items: artistItems,
      displayMode: 'grid',
      itemType: 'artist',
      showInfo: false,
      onItemClick: (item) => {
        const artist = results.artist.find((a: OpenSubsonicArtist) => a.id === item.id);
        if (artist) loadArtistAlbums(artist);
      }
    });

    artistContainer.render();
  }
  
  // Albums mit MediaContainer
  if (results.album && results.album.length > 0) {
    hasResults = true;
    const albumsContainer = document.createElement('div');
    albumsContainer.innerHTML = '<h4>Albums</h4><div id="search-albums"></div>';
    searchContent.appendChild(albumsContainer);
    
    const albumItems: MediaItem[] = results.album.map((album: OpenSubsonicAlbum) => ({
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }));

    const albumContainer = new MediaContainer({
      containerId: 'search-albums',
      items: albumItems,
      displayMode: 'grid',
      itemType: 'album',
      showInfo: false,
      onItemClick: (item) => {
        const album = results.album.find((a: OpenSubsonicAlbum) => a.id === item.id);
        if (album) loadAlbumTracks(album);
      }
    });

    albumContainer.render();
  }
  
  // Songs mit MediaContainer
  if (results.song && results.song.length > 0) {
    hasResults = true;
    const songsContainer = document.createElement('div');
    songsContainer.innerHTML = '<h4>Songs</h4><div id="search-songs"></div>';
    searchContent.appendChild(songsContainer);
    
    const songItems: MediaItem[] = results.song.map((song: OpenSubsonicSong) => ({
      id: song.id,
      name: song.title,
      type: 'song' as const,
      coverArt: song.coverArt,
      artist: song.artist,
      album: song.album,
      duration: song.duration
    }));

    const songContainer = new MediaContainer({
      containerId: 'search-songs',
      items: songItems,
      displayMode: 'list',
      itemType: 'song',
      showInfo: false,
      onItemClick: (item) => {
        const song = results.song.find((s: OpenSubsonicSong) => s.id === item.id);
        if (song) {
          console.log('Song selected:', song.title);
          // Feature implementation needed
        }
      }
    });

    songContainer.render();
  }
  
  if (!hasResults) {
    searchContent.innerHTML = '<div class="no-results">No results found</div>';
  }
  
  console.log('Search results displayed with MediaContainer');
  
  // Mark songs that are in queue or on deck
  setTimeout(() => markSongsInLibrary(), 100);
}

// Zurück zu den letzten Suchergebnissen
function returnToLastSearchResults() {
  if (lastSearchResults) {
    console.log('Returning to last search results:', lastSearchQuery);
    
    // Setze das Suchfeld auf die letzte Suchanfrage
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput && lastSearchQuery) {
      searchInput.value = lastSearchQuery;
    }
    
    // Zeige die gespeicherten Suchergebnisse wieder an
    displaySearchResults(lastSearchResults);
  } else {
    console.log('No previous search results found, showing no search state');
    showNoSearchState();
    
    // Zeige kurz eine Hinweismeldung
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) {
      const originalPlaceholder = searchInput.placeholder;
      searchInput.placeholder = 'No previous search to return to...';
      setTimeout(() => {
        searchInput.placeholder = originalPlaceholder;
      }, 2000);
    }
  }
}

// Drag & Drop Listeners hinzufügen
function addDragListeners(container: Element) {
  const trackItems = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  const albumItems = container.querySelectorAll('.album-item, .album-item-modern, .album-card.clickable');
  
  console.log(`Adding drag listeners to ${trackItems.length} track items and ${albumItems.length} album items`);
  
  trackItems.forEach((item, index) => {
    item.addEventListener('dragstart', (e: Event) => {
      const dragEvent = e as DragEvent;
      const target = e.target as HTMLElement;
      target.classList.add('dragging');
      console.log(`Drag started for track item ${index}, song ID: ${target.dataset.songId}`);
      
      if (dragEvent.dataTransfer) {
        // Set song ID as both text/plain and as JSON data for compatibility
        dragEvent.dataTransfer.setData('text/plain', target.dataset.songId || '');
        dragEvent.dataTransfer.effectAllowed = 'copy';
        
        // Also set JSON data if we have the song info
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
      console.log('Drag ended for track item');
    });
  });
  
  // Album drag functionality
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
      console.log('Drag ended for album item');
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
      
      // Build album object from dataset
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
        artistId: albumCard.dataset.artistId
      };
      
      showAlbumContextMenu(mouseEvent, album, apiClient, addToQueue, contextMenu);
    });
  });
}

// Song-interne Click Listeners hinzufügen (für Artist und Album in Songs)
function addSongClickListeners(container: Element) {
  console.log('Adding song click listeners to container:', container);
  
  // Artist Click Listeners
  const artistElements = container.querySelectorAll('.clickable-artist');
  console.log(`Found ${artistElements.length} clickable artists`);
  
  artistElements.forEach((element, index) => {
    const artistId = (element as HTMLElement).dataset.artistId;
    const artistName = (element as HTMLElement).dataset.artistName;
    console.log(`Setting up artist click ${index}: ${artistName} (ID: ${artistId})`);
    
    element.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Verhindert Drag-Start
      console.log(`Artist clicked from song: ${artistName} (ID: ${artistId})`);
      console.log('Click event details:', { target: e.target, currentTarget: e.currentTarget });
      
      if (artistId) {
        // Use the new LibraryBrowser system
        const artist: OpenSubsonicArtist = {
          id: artistId,
          name: artistName || 'Unknown Artist',
          albumCount: 0
        };
        if (libraryBrowser) {
          libraryBrowser.showArtist(artist);
        } else {
          console.error('LibraryBrowser not available');
        }
      } else if (artistName && openSubsonicClient) {
        // Fallback: Suche nach Artist by Name
        console.log(`No artist ID found, searching by name: ${artistName}`);
        try {
          const searchResults = await openSubsonicClient.search(artistName);
          if (searchResults.artist && searchResults.artist.length > 0) {
            // Finde exakten Match oder ersten Treffer
            const artist = searchResults.artist.find((a: any) => 
              a.name.toLowerCase().trim() === artistName.toLowerCase().trim()
            ) || searchResults.artist[0];
            
            if (artist) {
              console.log(`Found artist through search: ${artist.name} (ID: ${artist.id})`);
              if (libraryBrowser) {
                libraryBrowser.showArtist(artist);
              } else {
                console.error('LibraryBrowser not available');
              }
            } else {
              console.error('Artist not found in search results');
            }
          } else {
            console.error('No artists found for search term:', artistName);
          }
        } catch (error) {
          console.error('Error searching for artist:', error);
        }
      } else {
        console.error('No artist ID or name found, or OpenSubsonicClient not available');
      }
    });

    // Debug-Event für Mousedown
    element.addEventListener('mousedown', () => {
      console.log(`Artist mousedown: ${artistName}`);
    });
  });
  
  // Album Click Listeners
  const albumElements = container.querySelectorAll('.clickable-album');
  console.log(`Found ${albumElements.length} clickable albums`);
  
  albumElements.forEach((element, index) => {
    const albumId = (element as HTMLElement).dataset.albumId;
    const albumName = (element as HTMLElement).dataset.albumName;
    console.log(`Setting up album click ${index}: ${albumName} (ID: ${albumId})`);
    
    element.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Verhindert Drag-Start
      console.log(`Album clicked from song: ${albumName} (ID: ${albumId})`);
      
      if (albumId && albumId !== '') {
        await showAlbumSongs(albumId);
      } else if (albumName && openSubsonicClient) {
        console.log(`Album clicked from song (no ID): ${albumName}, searching...`);
        
        try {
          // Suche nach Album by Name
          const searchResults = await openSubsonicClient.search(albumName);
          if (searchResults.album && searchResults.album.length > 0) {
            // Finde exakten Match oder ersten Treffer
            const album = searchResults.album.find((a: any) => 
              a.name.toLowerCase().trim() === albumName.toLowerCase().trim()
            ) || searchResults.album[0];
            
            if (album) {
              await showAlbumSongs(album.id);
            } else {
              console.error('Album not found in search results');
            }
          } else {
            console.error('No albums found for search term:', albumName);
          }
        } catch (error) {
          console.error('Error searching for album:', error);
        }
      }
    });
    
    // Debug-Event für Mousedown
    element.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumName}`);
    });
  });
  
  // Direct Song Click Listeners (double-click to load to player)
  const songElements = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  console.log(`Found ${songElements.length} clickable songs`);
  
  songElements.forEach((element, index) => {
    const songId = (element as HTMLElement).dataset.songId;
    const songTitle = (element as HTMLElement).dataset.songTitle || 
                     (element as HTMLElement).querySelector('.track-title')?.textContent || 
                     'Unknown Song';
    
    console.log(`Setting up song click ${index}: ${songTitle} (ID: ${songId})`);
    
    // Double-click to add song to queue
    element.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!songId) {
        console.error('No song ID found for clicked song');
        return;
      }
      
      console.log(`Song double-clicked: ${songTitle} (ID: ${songId})`);
      
      // Check if song is already in queue
      if (isSongInQueue(songId)) {
        console.log(`⚠️ Song already in queue: ${songTitle}`);
        return;
      }
      
      // Check if song is already on a deck
      const deck = getSongDeck(songId);
      if (deck) {
        console.log(`⚠️ Song already on deck ${deck.toUpperCase()}: ${songTitle}`);
        return;
      }
      
      try {
        // Try to find song in current songs list first
        let song = findSongById(songId);
        
        // If not found, build song object from DOM element data
        if (!song) {
          console.log('Building song from DOM element data');
          const el = element as HTMLElement;
          const artist = el.dataset.songArtist || 
                        el.querySelector('.track-artist')?.textContent || 
                        'Unknown Artist';
          const album = el.dataset.songAlbum || 
                       el.querySelector('.track-album')?.textContent || 
                       'Unknown Album';
          const genre = el.dataset.songGenre || 
                       el.querySelector('.track-genre')?.textContent || 
                       undefined;
          const coverArt = el.dataset.coverArt;
          
          song = {
            id: songId,
            title: songTitle,
            artist: artist,
            album: album,
            genre: genre,
            duration: 0,
            size: 0,
            suffix: 'mp3',
            bitRate: 0,
            coverArt: coverArt
          };
        }
        
        // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
        if (azuraCastWebcaster?.getConnectionStatus() && hasBlacklistedGenre(song)) {
          console.warn(`🚫 Cannot add song with blacklisted genre to queue while streaming: "${song.title}" (${song.genre})`);
          showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
          return;
        }
        
        // Add song to end of queue
        queue.push(createSongQueueItem(song));
        updateQueueDisplay();
        
        console.log(`✓ Added to queue: ${song.title}`);
        
        // Fast update: Only update this specific song's element (instant!)
        updateSongStatus(songId, element as HTMLElement);
        
      } catch (error) {
        console.error('Error adding song to queue:', error);
      }
    });
    
    // Single click for selection feedback
    element.addEventListener('click', (e) => {
      // Only handle if not clicking on artist/album links
      const target = e.target as HTMLElement;
      if (target.classList.contains('clickable-artist') || target.classList.contains('clickable-album')) {
        return; // Let artist/album clicks handle normally
      }
      
      // Visual feedback for song selection
      const allSongs = container.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
      allSongs.forEach(song => song.classList.remove('selected'));
      element.classList.add('selected');
      
      console.log(`Song selected: ${songTitle} (Double-click to add to queue)`);
    });
    
    // Context menu for songs
    element.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      if (!songId) {
        console.error('No song ID found for right-clicked song');
        return;
      }
      
      // Try to find song in current songs list first
      let song = findSongById(songId);
      
      // If not found, build song object from DOM element data
      if (!song) {
        console.log('Building song from DOM element data for context menu');
        const el = element as HTMLElement;
        const artist = el.dataset.songArtist || 
                      el.querySelector('.track-artist')?.textContent || 
                      'Unknown Artist';
        const album = el.dataset.songAlbum || 
                     el.querySelector('.track-album')?.textContent || 
                     'Unknown Album';
        const genre = el.dataset.songGenre || 
                     el.querySelector('.track-genre')?.textContent || 
                     undefined;
        const coverArt = el.dataset.coverArt;
        
        song = {
          id: songId,
          title: songTitle,
          artist: artist,
          album: album,
          genre: genre,
          duration: 0,
          size: 0,
          suffix: 'mp3',
          bitRate: 0,
          coverArt: coverArt
        };
      }
      
      showSongContextMenu(e as MouseEvent, song, addToQueue, loadTrackToPlayer, contextMenu);
    });
  });
  
  // Mark songs after setting up listeners
  setTimeout(() => markSongsInLibrary(), 100);
}

// Album Click Listeners hinzufügen
function addAlbumClickListeners(container: Element) {
  // Support both modern library and legacy album items
  const albumItems = container.querySelectorAll('.album-item, .album-item-modern, .album-card.clickable');
  console.log(`Adding album click listeners to ${albumItems.length} albums in container:`, container);
  
  albumItems.forEach((item, index) => {
    const albumId = (item as HTMLElement).dataset.albumId;
    console.log(`Setting up album ${index}: ID=${albumId}`);
    
    // Check if the container is being dragged to prevent conflicts
    const scrollContainer = item.closest('.horizontal-scroll');
    
    // Entferne vorherige Listener falls vorhanden
    const clonedItem = item.cloneNode(true);
    item.parentNode?.replaceChild(clonedItem, item);
    
    clonedItem.addEventListener('click', async (e) => {
      // Don't handle click if we're in drag mode
      if (scrollContainer && scrollContainer.classList.contains('dragging')) {
        return;
      }
      
      // Check if clicked on play button - handle differently
      const target = e.target as HTMLElement;
      if (target.closest('.album-play-button')) {
        e.preventDefault();
        e.stopPropagation();
        console.log(`Album play button clicked: ${albumId}`);
        // Feature implementation needed
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      console.log(`Album clicked: ${albumId} (click event fired)`);
      
      if (albumId) {
        await showAlbumSongs(albumId);
      } else {
        console.error('Album ID not found on clicked element');
      }
    });
    
    // Zusätzlicher Debug-Event
    clonedItem.addEventListener('mousedown', () => {
      console.log(`Album mousedown: ${albumId}`);
    });
  });
}

// Artist Click Listeners hinzufügen
function addArtistClickListeners(container: Element) {
  const artistItems = container.querySelectorAll('.artist-item');
  console.log(`Adding artist click listeners to ${artistItems.length} artists`);
  
  artistItems.forEach((item, index) => {
    const artistId = (item as HTMLElement).dataset.artistId;
    const artistName = (item as HTMLElement).dataset.artistName;
    console.log(`Setting up artist ${index}: ID=${artistId}, Name=${artistName}`);
    
    // Entferne vorherige Listener falls vorhanden
    const clonedItem = item.cloneNode(true);
    item.parentNode?.replaceChild(clonedItem, item);
    
    clonedItem.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log(`Artist clicked from search results: ${artistId} (click event fired)`);
      console.log('Click event details:', { target: e.target, currentTarget: e.currentTarget });
      
      if (artistId) {
        console.log(`Calling showArtistDetails with ID: ${artistId} and name: ${artistName}`);
        await showArtistDetails(artistId, artistName);
      } else {
        console.error('Artist ID not found on clicked element');
      }
    });
    
    // Zusätzlicher Debug-Event
    clonedItem.addEventListener('mousedown', () => {
      console.log(`Artist mousedown: ${artistId}`);
    });
  });
}

// Album Songs anzeigen
async function showAlbumSongs(albumId: string, addToHistory: boolean = true) {
  if (!openSubsonicClient) return;
  
  try {
    console.log(`Loading songs for album ${albumId}`);
    
    // Versuche Album in currentAlbums zu finden
    let album = currentAlbums.find(a => a.id === albumId);
    
    // Falls nicht gefunden, lade Album-Info direkt von OpenSubsonic
    if (!album) {
      console.log('Album not in currentAlbums, fetching from OpenSubsonic...');
      try {
        const fetchedAlbum = await openSubsonicClient.getAlbumInfo(albumId);
        if (fetchedAlbum) {
          album = fetchedAlbum;
        }
      } catch (error) {
        console.error('Error fetching album info:', error);
      }
    }
    
    const albumSongs = await openSubsonicClient.getAlbumSongs(albumId);
    
    showAlbumSongsFromState({ albumId, album, songs: albumSongs });
    
  } catch (error) {
    console.error('Error loading album songs:', error);
    showError('Failed to load album songs');
  }
}

// Show album songs from state (without adding to history)
function showAlbumSongsFromState(data: { albumId: string, album: any, songs: OpenSubsonicSong[] }) {
  const { album, songs } = data;

    // Prüfen ob wir in Search-View sind oder in der normalen Songs-Liste
    const searchContent = document.getElementById('search-content');
    const songsContainer = document.getElementById('songs-list');
    const targetContainer = searchContent?.style.display !== 'none' ? searchContent : songsContainer;
    
    if (targetContainer) {
      const albumName = album ? album.name : 'Unknown Album';
      const albumArtist = album ? album.artist : 'Unknown Artist';
      
      let html = `
        <div class="album-header">
          <h3>Album: ${escapeHtml(albumName)} - ${escapeHtml(albumArtist)}</h3>
        </div>
      `;
      
      // Songs-Tabelle mit Header
      html += '<div class="songs-table-header">';
      html += '<div class="header-cover">Cover</div>';
      html += '<div class="header-title">Title</div>';
      html += '<div class="header-artist">Artist</div>';
      html += '<div class="header-album">Album</div>';
      html += '<div class="header-rating">Rating</div>';
      html += '<div class="header-duration">Duration</div>';
      html += '</div>';
      // Use unified song container for artist songs
      const songsContainer = createUnifiedSongsContainer(songs, 'album');
      const artistDetailsContainer = document.getElementById('artist-details');
      if (artistDetailsContainer) {
        const existingSongsTable = artistDetailsContainer.querySelector('.songs-table, .unified-songs-container');
        if (existingSongsTable) {
          existingSongsTable.replaceWith(songsContainer);
        } else {
          artistDetailsContainer.appendChild(songsContainer);
        }
      }
      
      targetContainer.innerHTML = html;
      addDragListeners(targetContainer);
      addSongClickListeners(targetContainer);
    }
}

// Artist Details anzeigen
async function showArtistDetails(artistId: string, artistName?: string, addToHistory: boolean = true) {
  if (!openSubsonicClient) {
    console.error('OpenSubsonic client not available');
    return;
  }
  
  try {
    console.log(`Loading artist details for ${artistId}`);
    const artistData = await openSubsonicClient.getArtistAlbums(artistId);
    
    // Add to browser history
    
    showArtistDetailsFromState({ artistId, artistName, artistData });
    
  } catch (error) {
    console.error('Error loading artist details:', error);
    showError('Failed to load artist details');
  }
}

// Show artist details from state (without adding to history)
function showArtistDetailsFromState(data: { artistId: string, artistName?: string, artistData: any }) {
  console.log('Showing artist details from state:', data);
  // For now, just go back to search - full artist view can be implemented later
  if (lastSearchResults) {
    displaySearchResults(lastSearchResults);
  }
}

// Hilfsfunktionen
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message: string) {
  console.error(message);
  // Hier könnte eine Benutzeroberfläche für Fehler implementiert werden
}

// Status-Nachrichten anzeigen (für Bridge-Feedback)
function showStatusMessage(message: string, type: 'success' | 'error' | 'info' = 'info') {
  console.log(`[${type.toUpperCase()}]`, message);
  
  // Temporäres Status-Element erstellen falls noch nicht vorhanden
  let statusElement = document.getElementById('status-message');
  if (!statusElement) {
    statusElement = document.createElement('div');
    statusElement.id = 'status-message';
    statusElement.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-weight: bold;
      z-index: 10000;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
    `;
    document.body.appendChild(statusElement);
  }
  
  // Style basierend auf Type
  statusElement.style.backgroundColor = 
    type === 'success' ? '#10b981' :
    type === 'error' ? '#ef4444' :
    '#3b82f6';
  
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  statusElement.style.opacity = '1';
  
  // Nach 5 Sekunden ausblenden
  setTimeout(() => {
    if (statusElement) {
      statusElement.style.opacity = '0';
      setTimeout(() => {
        statusElement.style.display = 'none';
      }, 300);
    }
  }, 5000);
}

// ========================================
// 🎆 SPARK EFFECT FOR QUEUE COOLDOWN
// ========================================

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  lifeDecay: number; // Individual decay rate per frame
  size: number;
  color: string;
}

const activeSparkElements = new WeakMap<HTMLElement, { canvas: HTMLCanvasElement; timer: number }>();

function cleanupSparkEffect(element: HTMLElement) {
  const existing = activeSparkElements.get(element);
  if (existing) {
    clearTimeout(existing.timer);
    if (existing.canvas.parentElement) {
      existing.canvas.remove();
    }
    activeSparkElements.delete(element);
  }
}

function scheduleRandomSparks(element: HTMLElement) {
  // Clean up any existing spark effect
  const existing = activeSparkElements.get(element);
  if (existing) {
    clearTimeout(existing.timer);
    existing.canvas.remove();
  }
  
  // Schedule next spark at random interval (0-2 seconds for very frequent sparks)
  const nextSparkDelay = Math.random() * 2000;
  
  const timer = window.setTimeout(() => {
    createSparkEffect(element);
    // Reschedule if element still has cooldown class
    if (element.classList.contains('artist-cooldown')) {
      scheduleRandomSparks(element);
    }
  }, nextSparkDelay);
  
  // Store timer reference
  if (existing) {
    existing.timer = timer;
  } else {
    activeSparkElements.set(element, { canvas: document.createElement('canvas'), timer });
  }
}

function createSparkEffect(element: HTMLElement) {
  try {
    // Find the artist name element within the queue item
    const artistElement = element.querySelector('.track-artist, .song-artist, .artist-name, .queue-song-artist') as HTMLElement;
    if (!artistElement) {
      return;
    }
    
    const artistText = artistElement.textContent?.trim() || '';
    if (!artistText) {
      return;
    }
    
    // Position canvas DIRECTLY over the artist element, not the whole queue item
    const rect = artistElement.getBoundingClientRect();
    
    // Check if element has valid dimensions
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    
    // Create canvas overlay positioned relative to the artist element
    const canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '100';
  canvas.width = rect.width;
  canvas.height = rect.height;
  
  // Make artist element position relative so canvas can be positioned absolutely within it
  const originalPosition = artistElement.style.position;
  artistElement.style.position = 'relative';
  artistElement.appendChild(canvas);
  
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  
  // Measure text to get actual text width (not element width which includes padding)
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return;
  
  // Get computed style to match font rendering
  const computedStyle = window.getComputedStyle(artistElement);
  tempCtx.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
  const textMetrics = tempCtx.measureText(artistText);
  const actualTextWidth = textMetrics.width;
  
  // Get text baseline position (approximate vertical center within the element)
  const textHeight = parseFloat(computedStyle.fontSize);
  const verticalCenter = rect.height / 2;
  
  // Get text alignment to calculate actual text position
  const textAlign = computedStyle.textAlign || 'left';
  const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
  const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
  const availableWidth = rect.width - paddingLeft - paddingRight;
  
  let textStartX: number;
  if (textAlign === 'center') {
    // Text is centered
    textStartX = paddingLeft + (availableWidth - actualTextWidth) / 2;
  } else if (textAlign === 'right') {
    // Text is right-aligned
    textStartX = paddingLeft + availableWidth - actualTextWidth;
  } else {
    // Text is left-aligned (default)
    textStartX = paddingLeft;
  }
  
  // Spawn within the actual text bounds
  const spawnX = textStartX + Math.random() * actualTextWidth;
  const spawnY = verticalCenter + (Math.random() * textHeight * 0.4) - (textHeight * 0.2); // Small vertical variance
  
  // Create sparks with varying intensity
  const sparks: Spark[] = [];
  const intensity = 0.3 + Math.random() * 0.7; // 0.3 to 1.0 (wider range for more variety)
  const sparkCount = Math.floor((2 + Math.random() * 8) * intensity); // 2-10 sparks based on intensity
  
  for (let i = 0; i < sparkCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (0.3 + Math.random() * 1.8) * intensity; // More speed variation
    
    // Each spark has its own random lifetime between 200ms and 1000ms
    // At 60fps: 1.0 life with decay of 0.001-0.005 per frame = 200-1000ms
    const lifetimeFrames = 12 + Math.random() * 48; // 12-60 frames = 200-1000ms at 60fps
    const lifeDecay = 1.0 / lifetimeFrames;
    
    // Color spectrum from deep orange to white (lava to hot white)
    const colorRand = Math.random();
    let sparkColor: string;
    if (colorRand < 0.3) {
      sparkColor = '#FF5722'; // Deep orange (lava)
    } else if (colorRand < 0.5) {
      sparkColor = '#FF7043'; // Orange
    } else if (colorRand < 0.7) {
      sparkColor = '#FF8A65'; // Light orange
    } else if (colorRand < 0.85) {
      sparkColor = '#FFAB91'; // Very light orange
    } else {
      sparkColor = '#FFFFFF'; // Hot white
    }
    
    sparks.push({
      x: spawnX,
      y: spawnY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.5, // slight upward bias
      life: 1.0,
      maxLife: 1.0,
      lifeDecay: lifeDecay, // Individual decay rate for each spark
      size: (1.0 + Math.random() * 2.5) * intensity, // Size varies with intensity
      color: sparkColor
    });
  }
  
  // Animate sparks
  let animationFrame: number;
  
  function animate() {
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    let allDead = true;
    
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      
      allDead = false;
      
      // Update position
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vy += 0.05; // gravity
      
      // Update life with individual decay rate (200-1000ms lifetime)
      spark.life -= spark.lifeDecay;
      
      // Draw spark
      const alpha = Math.max(0, spark.life / spark.maxLife);
      ctx.fillStyle = spark.color;
      ctx.globalAlpha = alpha;
      
      // Draw as small glowing circle
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
      ctx.fill();
      
      // Add glow
      ctx.shadowBlur = 8;
      ctx.shadowColor = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    
    if (allDead) {
      // Remove canvas after animation
      canvas.remove();
      cancelAnimationFrame(animationFrame);
    } else {
      animationFrame = requestAnimationFrame(animate);
    }
  }
  
  animationFrame = requestAnimationFrame(animate);
  
  } catch (err) {
    // Silently fail - effects are non-critical
  }
}

function showSearchLoading() {
  const searchContent = document.getElementById('search-content');
  
  if (searchContent) {
    searchContent.innerHTML = '<div class="loading">Searching...</div>';
  }
}

// No Search State anzeigen (leere Suchergebnisse)
function showNoSearchState() {
  const searchContent = document.getElementById('search-content');
  
  if (searchContent) {
    searchContent.innerHTML = '<div class="search-prompt"><span class="material-icons">search</span><h3>Search for music</h3><p>Enter a song, album or artist name to find music</p></div>';
  }
  
  // Lösche Suchhistorie, wenn zurück zum No Search State
  lastSearchResults = null;
  lastSearchQuery = '';
  console.log('Search history cleared');
}

// Queue initialisieren (permanent)
function initializeQueuePermanent() {
  // Alle Queue-Container finden
  const queueContainers = document.querySelectorAll('.queue-items');
  console.log(`Found ${queueContainers.length} queue containers for permanent setup`);
  
  queueContainers.forEach((queueContainer, index) => {
    console.log(`Setting up permanent queue container ${index}`);
    
    // Event Handler definieren
    const dragoverHandler = (e: Event) => {
      e.preventDefault();
      queueContainer.classList.add('drag-over');
      console.log('Queue dragover event');
    };
    
    const dragleaveHandler = (e: Event) => {
      // Nur entfernen wenn wirklich die Queue verlassen wird
      const rect = queueContainer.getBoundingClientRect();
      const mouseEvent = e as MouseEvent;
      if (mouseEvent.clientX < rect.left || mouseEvent.clientX > rect.right || 
          mouseEvent.clientY < rect.top || mouseEvent.clientY > rect.bottom) {
        queueContainer.classList.remove('drag-over');
        console.log('Queue dragleave event');
      }
    };
    
    const dropHandler = async (e: Event) => {
      e.preventDefault();
      queueContainer.classList.remove('drag-over');
      console.log('Queue drop event');
      
      const dragEvent = e as DragEvent;
      const songId = dragEvent.dataTransfer?.getData('text/plain');
      console.log('Dropped song ID:', songId);
      
      if (songId) {
        await addToQueue(songId);
      }
    };
    
    // Event Listener hinzufügen
    queueContainer.addEventListener('dragover', dragoverHandler);
    queueContainer.addEventListener('dragleave', dragleaveHandler);
    queueContainer.addEventListener('drop', dropHandler);
  });
}

// Song zur Queue hinzufügen
async function addToQueue(songId: string): Promise<void>;
async function addToQueue(song: OpenSubsonicSong): Promise<void>;
async function addToQueue(songOrId: string | OpenSubsonicSong): Promise<void> {
  let song: OpenSubsonicSong | undefined;
  
  if (typeof songOrId === 'string') {
    const songId = songOrId;
    console.log('Adding song to queue:', songId);
    
    // Finde Song in aktuellen Listen
    song = currentSongs.find(s => s.id === songId);
    
    if (!song) {
      // WWenn nicht gefunden, versuche über Search Results zu finden
      const searchResults = document.querySelectorAll('.track-item, .song-row, .unified-song-item');
      for (const item of searchResults) {
        const element = item as HTMLElement;
        if (element.dataset.songId === songId) {
          // Hier müsste der Song aus der API abgerufen werden
          // Für jetzt nehmen wir den ersten verfügbaren Song
          song = currentSongs[0];
          break;
        }
      }
    }
  } else {
    song = songOrId;
    console.log(`Adding song object to queue: "${song.title}"`);
  }
  
  if (song) {
    console.log('🔍 addToQueue - Song details:', {
      title: song.title,
      artist: song.artist,
      genre: song.genre,
      hasGenre: !!song.genre
    });
    console.log('🔍 addToQueue - Streaming status:', azuraCastWebcaster?.getConnectionStatus());
    console.log('🔍 addToQueue - Blacklisted genres:', blacklistedGenres);
    
    // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
    if (azuraCastWebcaster?.getConnectionStatus() && hasBlacklistedGenre(song)) {
      console.warn(`🚫 Cannot add song with blacklisted genre to queue while streaming: "${song.title}" (${song.genre})`);
      showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
      return;
    }
    
    // ========================================
    // 🎯 CHECK SONG LOCATION - PREVENT DUPLICATES
    // ========================================
    const existingLocation = getSongLocation(song.id);
    if (existingLocation && existingLocation.type !== 'nowhere') {
      if (existingLocation.type === 'deck') {
        console.warn(`❌ [SongRegistry] Song "${song.title}" is already on deck ${existingLocation.deck.toUpperCase()}!`);
        showStatusMessage(`⚠️ "${song.title}" bereits auf Deck ${existingLocation.deck.toUpperCase()}`, 'info');
        return; // PREVENT DUPLICATE!
      }
      if (existingLocation.type === 'queue') {
        console.warn(`❌ [SongRegistry] Song "${song.title}" is already in queue!`);
        showStatusMessage(`⚠️ "${song.title}" bereits in Queue`, 'info');
        return; // PREVENT DUPLICATE!
      }
    }
    
    // ENHANCED: Check if song already exists in queue - prevent duplicates (legacy check, should be covered by registry)
    const existingIndex = queue.findIndex(item => isSongQueueItem(item) && item.song?.id === song.id);
    if (existingIndex !== -1) {
      const existingItem = queue[existingIndex];
      console.log(`⚠️ Song "${song.title}" already exists in queue at position ${existingIndex + 1}`);
      
      // If song is already assigned to a deck, don't add duplicate
      if (existingItem.assignedToDeck) {
        console.log(`❌ Cannot add duplicate - song is assigned to deck ${existingItem.assignedToDeck.toUpperCase()}`);
        return;
      }
      
      // If unassigned, remove existing and add new one at end
      console.log(`🔄 Moving unassigned duplicate to end of queue`);
      queue.splice(existingIndex, 1);
    }
    
    // Create new queue item (not assigned to any deck yet)
    const queueItem = createSongQueueItem(song);
    
    queue.push(queueItem);
    
    // ========================================
    // 🎯 REGISTER SONG IN QUEUE
    // ========================================
    registerSongLocation(song.id, { type: 'queue', queueIndex: queue.length - 1 });
    
    updateQueueDisplay();
    
    // Fast update: Only update this specific song's status (no full re-render)
    updateSongStatus(song.id);
    
    console.log(`➕ Song "${song.title}" added to queue. Queue length: ${queue.length}`);
  }
}

// Queue Anzeige aktualisieren
function updateQueueDisplay() {
  // Alle Queue-Container aktualisieren
  const queueContainers = document.querySelectorAll('.queue-items');
  
  queueContainers.forEach(queueContainer => {
    // Cleanup any existing spark effects before clearing
    const oldWrappers = queueContainer.querySelectorAll('.queue-item-wrapper');
    oldWrappers.forEach(wrapper => {
      if (wrapper instanceof HTMLElement) {
        cleanupSparkEffect(wrapper);
      }
    });
    
    // Clear container
    queueContainer.innerHTML = '';
    
    // Add queue items if any exist
    queue.forEach((queueItem, index) => {
      // Add queue-specific wrapper
      const queueWrapper = document.createElement('div');
      queueWrapper.className = 'queue-item-wrapper';
      queueWrapper.dataset.queueIndex = index.toString();
      
      // Add deck indicator if assigned
      if (queueItem.assignedToDeck) {
        queueWrapper.classList.add('assigned-to-deck');
        queueWrapper.dataset.assignedDeck = queueItem.assignedToDeck;
      }
      
      // Create appropriate element based on type
      let itemElement: HTMLElement;
      if (isSongQueueItem(queueItem)) {
        itemElement = createCompactQueueSongElement(queueItem.song);
        // Double-click on queue song -> load to first free visible deck (A,B,C,D)
        itemElement.addEventListener('dblclick', async (e) => {
          try {
            const qi = queue[index];
            if (!qi || !isSongQueueItem(qi)) return;
            // If already assigned, do nothing
            if (qi.assignedToDeck) return;

            const deckOrder: ('a'|'b'|'c'|'d')[] = ['a','b','c','d'];
            for (const d of deckOrder) {
              const playerEl = document.getElementById(`player-${d}`);
              if (!playerEl) continue;
              // Skip if deck is hidden
              const styleDisplay = (playerEl as HTMLElement).style.display;
              const isVisible = styleDisplay !== 'none' && (playerEl as HTMLElement).offsetParent !== null;
              if (!isVisible) continue;

              // Check if deck already has a loaded song
              const loaded = getCurrentLoadedSong(d);
              if (!loaded) {
                // Load track to this deck without autoplay
                if (qi.song) {
                  await loadTrackToPlayer(d, qi.song, false);
                  // Mark queue item as assigned to deck
                  qi.assignedToDeck = d;
                  queue[index] = qi;
                  updateQueueDisplay();
                  console.log(`✅ Loaded queue song "${qi.song.title}" to first free deck ${d.toUpperCase()}`);
                }
                return; // stop after first free deck
              }
            }
            // No free deck found -> do nothing
            console.log('ℹ️ No free deck available to load queue song via dblclick');
          } catch (err) {
            console.error('Error handling queue dblclick load:', err);
          }
        });
        
        // Context menu for queue songs
        itemElement.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const qi = queue[index];
          if (qi && isSongQueueItem(qi) && qi.song) {
            showSongContextMenu(e as MouseEvent, qi.song, addToQueue, loadTrackToPlayer, contextMenu);
          }
        });
      } else if (isMicrophoneQueueItem(queueItem)) {
        itemElement = createCompactQueueMicrophoneElement();
      } else {
        console.warn('Unknown queue item type:', queueItem);
        return;
      }
      
      // Create remove button in stream-button style
      const removeButton = document.createElement('button');
      removeButton.className = 'queue-song-remove';
      removeButton.innerHTML = '<span class="material-icons">delete</span>';
      removeButton.title = 'Remove from queue';
      removeButton.onclick = () => removeFromQueue(index);
      
      // Create container in stream-button-container style
      const itemContainer = document.createElement('div');
      itemContainer.className = isMicrophoneQueueItem(queueItem) ? 'queue-mic-container' : 'queue-song-container';
      itemContainer.appendChild(itemElement);
      itemContainer.appendChild(removeButton);
      
      // Assemble wrapper
      queueWrapper.appendChild(itemContainer);
      
      // Check if artist is on cooldown (recently played within 1 hour)
      if (isSongQueueItem(queueItem)) {
        const song = queueItem.song;
        const artistName = song.artist?.trim();
        if (artistName) {
          const hoursSinceArtist = getTimeSinceArtistPlayed(artistName);
          if (hoursSinceArtist !== null && hoursSinceArtist < 1) {
            queueWrapper.classList.add('artist-cooldown');
            // Add random spark effects
            scheduleRandomSparks(queueWrapper);
          }
        }
      }
      
      // Setup drag for queue item
      setupQueueItemDrag(queueWrapper, index);
      
      // Setup drop zone for reordering
      setupQueueItemDropZone(queueWrapper, index);
      
      queueContainer.appendChild(queueWrapper);
    });
  });
  
  // Auto-prepare decks when queue gets new songs
  checkAndPrepareDecksAfterQueueUpdate();
  
  // Update library markers to show queued/playing songs
  markSongsInLibrary();
}

// Check and prepare decks automatically when queue is updated
function checkAndPrepareDecksAfterQueueUpdate() {
  // Only proceed if queue has songs
  if (queue.length === 0) {
    return;
  }
  
  // Check all decks for opportunities to prepare
  const allDecks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  for (const deck of allDecks) {
    // Skip if auto-queue is not active for this deck
    if (!isAutoQueueActiveForDeck(deck)) {
      continue;
    }
    
    // Note: Preparation now happens automatically in handleAutoQueue
    // No need for manual preparation here
  }
}

function setupQueueItemDrag(wrapper: HTMLElement, index: number) {
  // Make the wrapper draggable
  wrapper.draggable = true;
  
  wrapper.addEventListener('dragstart', (e) => {
    const queueItem = queue[index];
    if (!queueItem) return;
    
    // Add visual feedback
    wrapper.style.opacity = '0.5';
    wrapper.classList.add('dragging');
    
    if (e.dataTransfer) {
      // WICHTIG: Kombinierte Drag-Daten für Queue-Reordering UND Deck-Drop
      if (isSongQueueItem(queueItem)) {
        // Für Songs: Nutze IDENTISCHES Format wie Library-Songs (type: 'song')
        // PLUS zusätzlich queueIndex für Queue-Reordering
        const dragData = {
          type: 'song',              // IDENTISCH zu Library-Songs für Deck-Kompatibilität
          song: queueItem.song,      // Song-Objekt für Deck-Drop
          sourceUrl: openSubsonicClient?.getStreamUrl(queueItem.song.id),
          queueIndex: index          // EXTRA: Für Queue-Reordering
        };
        
        e.dataTransfer.setData('application/json', JSON.stringify(dragData));
        e.dataTransfer.setData('text/plain', queueItem.song.id); // Fallback: Song-ID
        console.log('🎵 Queue song draggable (as library song):', queueItem.song.title, '| Queue Index:', index);
      } else if (isMicrophoneQueueItem(queueItem)) {
        // Für Mikrofon: Nur Queue-Reordering
        const dragData = {
          type: 'queue-microphone',
          queueIndex: index,
          queueItem: queueItem
        };
        
        e.dataTransfer.setData('application/json', JSON.stringify(dragData));
        e.dataTransfer.setData('text/plain', 'microphone');
        console.log('� Queue microphone draggable | Index:', index);
      }
      
      e.dataTransfer.effectAllowed = 'copy';
    }
  });
  
  wrapper.addEventListener('dragend', () => {
    wrapper.style.opacity = '1';
    wrapper.classList.remove('dragging');
    // Remove all drop indicators
    document.querySelectorAll('.queue-item-wrapper.drop-before, .queue-item-wrapper.drop-after').forEach(el => {
      el.classList.remove('drop-before', 'drop-after');
    });
  });
}

// Setup drop zones for queue reordering
function setupQueueItemDropZone(wrapper: HTMLElement, index: number) {
  wrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragEvent = e as DragEvent;
    
    // Handle both queue reordering AND library songs
    const data = dragEvent.dataTransfer?.getData('application/json');
    if (!data) return;
    
    try {
      const dragData = JSON.parse(data);
      
      // Akzeptiere: 
      // 1. Queue-Songs (type='song' mit queueIndex)
      // 2. Queue-Microphone (type='queue-microphone')
      // 3. Library-Songs (type='song' OHNE queueIndex) - NEU!
      const isQueueSong = dragData.type === 'song' && dragData.queueIndex !== undefined;
      const isQueueMic = dragData.type === 'queue-microphone';
      const isLibrarySong = dragData.type === 'song' && dragData.queueIndex === undefined;
      
      if (!isQueueSong && !isQueueMic && !isLibrarySong) return;
      
      // Don't allow dropping on self (nur für Queue-Items relevant)
      if (isQueueSong && dragData.queueIndex === index) return;
      
      // Determine drop position based on mouse position
      const rect = wrapper.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const dropBefore = dragEvent.clientY < midpoint;
      
      // Clear previous indicators
      document.querySelectorAll('.queue-item-wrapper.drop-before, .queue-item-wrapper.drop-after').forEach(el => {
        el.classList.remove('drop-before', 'drop-after');
      });
      
      // Add appropriate indicator
      if (dropBefore) {
        wrapper.classList.add('drop-before');
      } else {
        wrapper.classList.add('drop-after');
      }
      
      dragEvent.dataTransfer!.dropEffect = isLibrarySong ? 'copy' : 'move';
    } catch (error) {
      console.error('Error parsing drag data:', error);
    }
  });
  
  wrapper.addEventListener('dragleave', (e) => {
    // Remove indicators when leaving
    wrapper.classList.remove('drop-before', 'drop-after');
  });
  
  wrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragEvent = e as DragEvent;
    
    const data = dragEvent.dataTransfer?.getData('application/json');
    if (!data) return;
    
    try {
      const dragData = JSON.parse(data);
      
      // Akzeptiere Queue-Songs, Microphone UND Library-Songs
      const isQueueSong = dragData.type === 'song' && dragData.queueIndex !== undefined;
      const isQueueMic = dragData.type === 'queue-microphone';
      const isLibrarySong = dragData.type === 'song' && dragData.queueIndex === undefined;
      
      if (!isQueueSong && !isQueueMic && !isLibrarySong) return;
      
      // Determine target position
      const rect = wrapper.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const dropBefore = dragEvent.clientY < midpoint;
      
      let targetIndex = dropBefore ? index : index + 1;
      
      // Handle Library Song Drop (insert into queue at position)
      if (isLibrarySong) {
        console.log(`📥 Dropping library song at queue position ${targetIndex}`);
        insertLibrarySongIntoQueue(dragData.song, targetIndex);
        wrapper.classList.remove('drop-before', 'drop-after');
        return;
      }
      
      // Handle Queue Reordering
      const sourceIndex = dragData.queueIndex;
      if (sourceIndex === index) return; // Can't drop on self
      
      // Adjust target index if moving from before to after
      if (sourceIndex < targetIndex) {
        targetIndex--;
      }
      
      console.log(`🔄 Reordering queue: moving item from position ${sourceIndex} to ${targetIndex}`);
      
      // Perform the reordering
      reorderQueueItem(sourceIndex, targetIndex);
      
      // Clear indicators
      wrapper.classList.remove('drop-before', 'drop-after');
      
    } catch (error) {
      console.error('Error handling queue drop:', error);
    }
  });
}

// Reorder queue items and recalculate deck assignments  
function reorderQueueItem(sourceIndex: number, targetIndex: number) {
  console.log(`\n🔄 ═══════════════════════════════════════════════════════════`);
  console.log(`📝 QUEUE REORDER STARTED`);
  console.log(`   Source Index: ${sourceIndex} → Target Index: ${targetIndex}`);
  
  if (sourceIndex === targetIndex || sourceIndex < 0 || targetIndex < 0) {
    console.log(`   ⏭️ Skipping: No change needed`);
    return; // No change needed
  }
  
  if (sourceIndex >= queue.length || targetIndex > queue.length) {
    console.error(`   ❌ Invalid queue indices for reordering`);
    return;
  }
  
  // Log current queue state
  console.log(`   Current Queue (${queue.length} items):`);
  queue.forEach((item, idx) => {
    const name = getQueueItemDisplayName(item);
    const deck = isSongQueueItem(item) ? item.assignedToDeck : null;
    console.log(`      ${idx}: "${name}" ${deck ? `→ Deck ${deck.toUpperCase()}` : '(unassigned)'}`);
  });
  
  // Check if we're trying to move an item before a currently playing song
  const protection = protectCurrentlyPlayingSong(sourceIndex, targetIndex);
  if (protection.blocked) {
    console.log(`   🚫 Reorder blocked: ${protection.reason}`);
    targetIndex = protection.adjustedTarget;
  }
  
  // Perform the reordering
  const [movedItem] = queue.splice(sourceIndex, 1);
  const movedName = getQueueItemDisplayName(movedItem);
  queue.splice(targetIndex, 0, movedItem);
  
  console.log(`   ✅ Moved: "${movedName}" from position ${sourceIndex} → ${targetIndex}`);
  
  // Log new queue state
  console.log(`   New Queue Order:`);
  queue.forEach((item, idx) => {
    const name = getQueueItemDisplayName(item);
    console.log(`      ${idx}: "${name}"`);
  });
  
  // Recalculate deck assignments and reorganize decks to match new queue order
  console.log(`   🔄 Recalculating deck assignments...`);
  recalculateDeckAssignments();
  
  // Trigger immediate queue sync
  console.log(`   🎯 Triggering immediate queue sync...`);
  triggerQueueSync('reorder');
  
  // Update display
  updateQueueDisplay();
  console.log(`🔄 ═══════════════════════════════════════════════════════════\n`);
}

/**
 * Insert a library song into the queue at a specific position
 * Handles deck reorganization if needed
 */
function insertLibrarySongIntoQueue(song: OpenSubsonicSong, targetIndex: number) {
  console.log(`\n➕ ═══════════════════════════════════════════════════════════`);
  console.log(`📝 QUEUE INSERT STARTED`);
  console.log(`   Song: "${song.title}"`);
  console.log(`   Target Position: ${targetIndex}`);
  
  // Check if song is already in queue
  if (isSongInQueue(song.id)) {
    console.log(`   ⚠️ Song is already in queue - ABORT`);
    return;
  }
  
  // Check if song is already on a deck
  const deck = getSongDeck(song.id);
  if (deck) {
    console.log(`   ⚠️ Song is already on deck ${deck.toUpperCase()} - ABORT`);
    return;
  }
  
  // Create queue item
  const newItem = createSongQueueItem(song);
  
  // Check protection: can't insert before currently playing song
  const protection = protectCurrentlyPlayingSong(-1, targetIndex);
  if (protection.blocked) {
    console.log(`   🚫 Insert blocked: ${protection.reason}`);
    targetIndex = protection.adjustedTarget;
  }
  
  // Insert at position
  queue.splice(targetIndex, 0, newItem);
  
  console.log(`   ✅ Inserted at position ${targetIndex}`);
  console.log(`   New Queue (${queue.length} items):`);
  queue.forEach((item, idx) => {
    const name = getQueueItemDisplayName(item);
    console.log(`      ${idx}: "${name}"`);
  });
  
  // Recalculate deck assignments - songs after this position need to be reassigned
  console.log(`   🔄 Recalculating deck assignments...`);
  recalculateDeckAssignments();
  
  // Trigger immediate queue sync
  console.log(`   🎯 Triggering immediate queue sync...`);
  triggerQueueSync('insert');
  
  // Update display
  updateQueueDisplay();
  
  // Update library markers
  markSongsInLibrary();
  
  console.log(`➕ ═══════════════════════════════════════════════════════════\n`);
}

// Setup queue drop zones for reordering
function setupQueueDropZones() {
  const queueContainer = document.getElementById('queue-items');
  if (!queueContainer) return;
  
  // Add drop zones between queue items
  const addDropZones = () => {
    // Remove existing drop zones
    queueContainer.querySelectorAll('.queue-drop-zone').forEach(zone => zone.remove());
    
    const queueItems = queueContainer.children;
    
    // Add drop zone at the beginning (unless auto-queue is active and first item is playing)
    if (!isAutoQueueActive() || queue.length === 0) {
      const topDropZone = document.createElement('div');
      topDropZone.className = 'queue-drop-zone';
      topDropZone.dataset.dropIndex = '0';
      queueContainer.insertBefore(topDropZone, queueContainer.firstChild);
    }
    
    // Add drop zones between items and at the end
    for (let i = 0; i < queueItems.length; i++) {
      const dropZone = document.createElement('div');
      dropZone.className = 'queue-drop-zone';
      dropZone.dataset.dropIndex = (i + 1).toString();
      
      if (i === queueItems.length - 1) {
        // Last drop zone (at the end)
        queueContainer.appendChild(dropZone);
      } else {
        // Drop zone between items
        queueContainer.insertBefore(dropZone, queueItems[i + 1]);
      }
      
      // Add drop event listeners
      dropZone.addEventListener('dragover', handleQueueDragOver);
      dropZone.addEventListener('dragleave', handleQueueDragLeave);
      dropZone.addEventListener('drop', handleQueueDrop);
    }
  };
  
  // Initial setup
  addDropZones();
  
  // Update drop zones when queue changes
  const observer = new MutationObserver(() => {
    setTimeout(addDropZones, 10); // Small delay to ensure DOM updates are complete
  });
  
  observer.observe(queueContainer, { childList: true });
}

// Queue drag & drop event handlers
function handleQueueDragOver(e: DragEvent) {
  e.preventDefault();
  const dropZone = e.currentTarget as HTMLElement;
  dropZone.classList.add('drag-over');
}

function handleQueueDragLeave(e: DragEvent) {
  const dropZone = e.currentTarget as HTMLElement;
  dropZone.classList.remove('drag-over');
}

function handleQueueDrop(e: DragEvent) {
  e.preventDefault();
  const dropZone = e.currentTarget as HTMLElement;
  dropZone.classList.remove('drag-over');
  
  const draggedIndex = parseInt(e.dataTransfer?.getData('text/queue-index') || '-1');
  const targetIndex = parseInt(dropZone.dataset.dropIndex || '-1');
  
  if (draggedIndex >= 0 && targetIndex >= 0 && draggedIndex !== targetIndex) {
    // Adjust target index if dragging downward
    const adjustedTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;
    reorderQueueItem(draggedIndex, adjustedTargetIndex);
  }
}

// Protect currently playing songs from being reordered
function protectCurrentlyPlayingSong(sourceIndex: number, targetIndex: number): {blocked: boolean, reason?: string, adjustedTarget: number} {
  // If auto-queue is not active, no protection needed
  if (!autoQueueConfig.deckPairAB && !autoQueueConfig.deckPairCD) {
    return { blocked: false, adjustedTarget: targetIndex };
  }
  
  // Find currently playing song in queue
  const currentlyPlayingQueueIndex = findCurrentlyPlayingQueueIndex();
  
  if (currentlyPlayingQueueIndex === -1) {
    // No currently playing song found in queue, no protection needed
    return { blocked: false, adjustedTarget: targetIndex };
  }
  
  // Prevent moving items before the currently playing song (position 0 in effective queue)
  if (targetIndex <= currentlyPlayingQueueIndex && sourceIndex > currentlyPlayingQueueIndex) {
    return { 
      blocked: true, 
      reason: `Cannot move item before currently playing song. Moving to position ${currentlyPlayingQueueIndex + 1} instead.`,
      adjustedTarget: currentlyPlayingQueueIndex + 1 
    };
  }
  
  // Prevent moving the currently playing song itself
  if (sourceIndex === currentlyPlayingQueueIndex) {
    return { 
      blocked: true, 
      reason: `Cannot move currently playing song. Keeping at position ${currentlyPlayingQueueIndex}.`,
      adjustedTarget: currentlyPlayingQueueIndex 
    };
  }
  
  return { blocked: false, adjustedTarget: targetIndex };
}

// Find the index of currently playing song in the queue
function findCurrentlyPlayingQueueIndex(): number {
  // Check all decks for currently playing songs
  const playingDecks = ['a', 'b', 'c', 'd'].filter(deck => {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    return audio && !audio.paused && audio.currentTime > 0;
  });
  
  if (playingDecks.length === 0) {
    return -1; // No song currently playing
  }
  
  // Find the queue item assigned to one of the playing decks
  for (let i = 0; i < queue.length; i++) {
    const queueItem = queue[i];
    if (queueItem.assignedToDeck && playingDecks.includes(queueItem.assignedToDeck)) {
      return i;
    }
  }
  
  return -1; // Playing song not found in queue (manually loaded)
}

// Recalculate deck assignments after queue reordering
function recalculateDeckAssignments() {
  console.log(`\n🧮 ═══════════════════════════════════════════════════════════`);
  console.log(`📊 RECALCULATING DECK ASSIGNMENTS`);
  
  // Clear all existing assignments first
  queue.forEach((item, idx) => {
    const oldDeck = item.assignedToDeck;
    item.assignedToDeck = null;
    if (oldDeck && isSongQueueItem(item)) {
      console.log(`   Cleared: "${item.song?.title}" was on Deck ${oldDeck.toUpperCase()}`);
    }
  });
  
  // Only reassign if auto-queue is active
  if (!autoQueueConfig.deckPairAB && !autoQueueConfig.deckPairCD) {
    console.log(`   ⏸️ Auto-queue inactive, no assignments needed`);
    console.log(`🧮 ═══════════════════════════════════════════════════════════\n`);
    return;
  }
  
  // Get rotation order based on active pairs
  const rotationOrder = getActiveRotationOrder();
  
  if (rotationOrder.length === 0) {
    console.log(`   ⚠️ No active deck pairs`);
    console.log(`🧮 ═══════════════════════════════════════════════════════════\n`);
    return;
  }
  
  console.log(`   Active Rotation: [${rotationOrder.map(d => d.toUpperCase()).join(' → ')}]`);
  
  // Assign songs to decks following rotation order, skipping microphone placeholders
  let deckIndex = 0;
  for (let i = 0; i < queue.length; i++) {
    const queueItem = queue[i];
    
    // Skip microphone placeholders for deck assignment
    if (isMicrophoneQueueItem(queueItem)) {
      console.log(`   🎤 Position ${i}: Microphone (skipped)`);
      continue;
    }
    
    // Assign to next deck in rotation
    const targetDeck = rotationOrder[deckIndex % rotationOrder.length];
    queueItem.assignedToDeck = targetDeck;
    
    const songName = isSongQueueItem(queueItem) ? queueItem.song?.title : getQueueItemDisplayName(queueItem);
    console.log(`   ✅ Position ${i}: "${songName}" → Deck ${targetDeck.toUpperCase()}`);
    
    deckIndex++;
  }
  
  console.log(`   📊 Total Assigned: ${deckIndex} songs to ${rotationOrder.length} decks`);
  console.log(`🧮 ═══════════════════════════════════════════════════════════\n`);
}

/**
 * Calculate the queue position that corresponds to a specific deck
 * Takes into account rotation order and currently playing songs
 */
function calculateQueuePositionForDeck(targetDeck: 'a' | 'b' | 'c' | 'd'): number | null {
  const rotationOrder = getActiveRotationOrder();
  
  if (!rotationOrder.includes(targetDeck)) {
    console.log(`⚠️ Deck ${targetDeck.toUpperCase()} is not in active rotation`);
    return null;
  }
  
  // Find the index of target deck in rotation
  const deckIndexInRotation = rotationOrder.indexOf(targetDeck);
  
  // Find currently playing deck
  const playingDeck = getCurrentPlayingDeck();
  
  // Count number of song queue items (skip microphone placeholders)
  let songQueueItems = 0;
  let targetPosition = deckIndexInRotation;
  
  // If there's a playing deck, adjust position
  if (playingDeck) {
    const playingDeckIndex = rotationOrder.indexOf(playingDeck);
    
    if (playingDeckIndex !== -1) {
      // Target deck comes after playing deck in rotation
      if (deckIndexInRotation > playingDeckIndex) {
        // Position = (deckIndex - playingDeckIndex)
        // This accounts for the playing song being at position 0
        targetPosition = deckIndexInRotation - playingDeckIndex;
      } else {
        // Target deck comes before playing deck in rotation
        // Can't insert before playing song, so insert after
        targetPosition = 1 + deckIndexInRotation;
      }
    }
  }
  
  // Count actual position in queue considering microphone placeholders
  let actualQueuePosition = 0;
  let songCount = 0;
  
  for (let i = 0; i < queue.length; i++) {
    if (isSongQueueItem(queue[i])) {
      if (songCount === targetPosition) {
        actualQueuePosition = i;
        break;
      }
      songCount++;
    }
  }
  
  // If we didn't find enough songs, append at end
  if (songCount < targetPosition) {
    actualQueuePosition = queue.length;
  }
  
  console.log(`📍 Calculated queue position for deck ${targetDeck.toUpperCase()}: ${actualQueuePosition} (rotation index: ${deckIndexInRotation}, playing: ${playingDeck?.toUpperCase() || 'none'})`);
  
  return actualQueuePosition;
}

// Get display name for queue item (for logging)
function getQueueItemDisplayName(queueItem: QueueItem): string {
  if (isSongQueueItem(queueItem) && queueItem.song) {
    return `${queueItem.song.title} - ${queueItem.song.artist}`;
  } else if (isMicrophoneQueueItem(queueItem)) {
    return 'Microphone Placeholder';
  }
  return 'Unknown Item';
}

// Setup Queue as Drop Zone
function setupQueueDropZone() {
  const queuePanel = document.querySelector('.queue-panel');
  const queueList = document.getElementById('queue-list');
  
  if (!queuePanel || !queueList) {
    console.warn('Queue panel or list not found');
    return;
  }
  
  // Make queue panel a drop zone
  queuePanel.addEventListener('dragover', (e) => {
    const dragEvent = e as DragEvent;
    dragEvent.preventDefault();
    queuePanel.classList.add('drag-over');
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.dropEffect = 'copy';
    }
  });
  
  queuePanel.addEventListener('dragleave', (e) => {
    const dragEvent = e as DragEvent;
    // Only remove highlight if we're leaving the queue panel completely
    if (!queuePanel.contains(dragEvent.relatedTarget as Node)) {
      queuePanel.classList.remove('drag-over');
    }
  });
  
  queuePanel.addEventListener('drop', async (e) => {
    const dragEvent = e as DragEvent;
    dragEvent.preventDefault();
    queuePanel.classList.remove('drag-over');
    
    if (!dragEvent.dataTransfer) return;
    
    try {
      // Try to get JSON data first (from search results or queue items)
      const jsonData = dragEvent.dataTransfer.getData('application/json');
      if (jsonData) {
        const dragData = JSON.parse(jsonData);
        console.log('Dropped on queue:', dragData);
        
        if (dragData.type === 'song' && dragData.song) {
          await addToQueue(dragData.song);
        } else if (dragData.type === 'track' && dragData.track) {
          await addToQueue(dragData.track);
        } else if (dragData.type === 'queue-song' && dragData.song) {
          // Moving within queue - just add to end and remove from original position
          await addToQueue(dragData.song);
          // Don't remove original as addToQueue handles duplicates
        } else if (dragData.type === 'deck-song' && dragData.song) {
          // Dragging from deck to queue
          console.log(`🎵 Adding track from deck ${dragData.sourceDeck?.toUpperCase()} to queue: "${dragData.song.title}"`);
          await addToQueue(dragData.song);
        }
        return;
      }
      
      // Fallback to deck data (from album cover drag)
      const deckSide = dragEvent.dataTransfer.getData('text/plain') as 'a' | 'b' | 'c' | 'd';
      if (deckSide && ['a', 'b', 'c', 'd'].includes(deckSide)) {
        const song = deckSongs[deckSide];
        if (song) {
          console.log(`🎵 Adding track from deck ${deckSide.toUpperCase()} to queue: "${song.title}"`);
          await addToQueue(song);
        } else {
          console.warn(`No song found on deck ${deckSide}`);
        }
        return;
      }
      
      // Fallback to song ID
      const songId = dragEvent.dataTransfer.getData('text/plain');
      if (songId) {
        await addToQueue(songId);
      }
      
    } catch (error) {
      console.error('Error processing queue drop:', error);
    }
  });
}

// Setup Auto-Queue Controls
function setupAutoQueueControls() {
  const abButton = document.getElementById('auto-queue-ab') as HTMLButtonElement;
  const cdButton = document.getElementById('auto-queue-cd') as HTMLButtonElement;
  
  if (!abButton || !cdButton) {
    console.warn('Auto-queue buttons not found');
    return;
  }
  
  // ✅ CRITICAL FIX: Remove existing event listeners before adding new ones
  // This prevents multiple listeners from being attached on re-initialization (e.g., after login)
  const newAbButton = abButton.cloneNode(true) as HTMLButtonElement;
  const newCdButton = cdButton.cloneNode(true) as HTMLButtonElement;
  abButton.parentNode?.replaceChild(newAbButton, abButton);
  cdButton.parentNode?.replaceChild(newCdButton, cdButton);
  
  // Use the new buttons for event listeners
  const abBtn = newAbButton;
  const cdBtn = newCdButton;
  
  // Update button states based on current config
  const updateButtonStates = () => {
    abBtn.classList.toggle('active', autoQueueConfig.deckPairAB);
    cdBtn.classList.toggle('active', autoQueueConfig.deckPairCD);
    
    // Icons bleiben konstant - nur CSS-Klassen ändern sich für Styling
    // Kein Text-Update nötig, da A+B und C+D konstant bleiben sollen
    
    console.log(`Auto-Queue Config: A+B=${autoQueueConfig.deckPairAB}, C+D=${autoQueueConfig.deckPairCD}`);
  };
  
  // A+B Button Click Handler
  abBtn.addEventListener('click', () => {
    autoQueueConfig.deckPairAB = !autoQueueConfig.deckPairAB;
    updateButtonStates();
    
    if (autoQueueConfig.deckPairAB) {
      console.log('🎵 Auto-Queue enabled for Deck A+B');
      // Synchronize loaded deck tracks with queue
      synchronizeDecksWithQueue(['a', 'b']);
      // Immediate preparation: check if A or B is playing and prepare the other
      prepareDecksOnActivation(['a', 'b']);
      
      // Validate and fix rotation immediately
      setTimeout(() => {
        validateAndFixRotation();
        checkAndFillEmptyDecks();
      }, 100);
    } else {
      console.log('⏸️ Auto-Queue disabled for Deck A+B');
      // Reset deck assignments for A+B when disabled
      resetDeckAssignments(['a', 'b']);
      
      // Reorganize remaining decks
      if (autoQueueConfig.deckPairCD) {
        setTimeout(() => {
          validateAndFixRotation();
          checkAndFillEmptyDecks();
        }, 100);
      }
    }
  });
  
  // C+D Button Click Handler  
  cdBtn.addEventListener('click', () => {
    autoQueueConfig.deckPairCD = !autoQueueConfig.deckPairCD;
    updateButtonStates();
    
    if (autoQueueConfig.deckPairCD) {
      console.log('🎵 Auto-Queue enabled for Deck C+D');
      // Synchronize loaded deck tracks with queue
      synchronizeDecksWithQueue(['c', 'd']);
      // Immediate preparation: check if C or D is playing and prepare the other
      prepareDecksOnActivation(['c', 'd']);
      
      // Validate and fix rotation immediately
      setTimeout(() => {
        validateAndFixRotation();
        checkAndFillEmptyDecks();
      }, 100);
    } else {
      console.log('⏸️ Auto-Queue disabled for Deck C+D');
      // Reset deck assignments for C+D when disabled
      resetDeckAssignments(['c', 'd']);
      
      // Reorganize remaining decks
      if (autoQueueConfig.deckPairAB) {
        setTimeout(() => {
          validateAndFixRotation();
          checkAndFillEmptyDecks();
        }, 100);
      }
    }
  });
  
  // Initial state update
  updateButtonStates();
  
  // Start the Auto-Queue Watcher
  startAutoQueueWatcher();
  
  // Start the Play History Update Watcher
  startPlayHistoryUpdateWatcher();
  
  // Microphone Add Button
  const micAddButton = document.getElementById('queue-mic-add-btn') as HTMLButtonElement;
  micAddButton?.addEventListener('click', () => {
    addMicrophoneToQueue();
  });
}

// ENHANCED: Synchronize loaded deck tracks with queue when auto-queue is enabled
function synchronizeDecksWithQueue(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  console.log(`🔄 Enhanced synchronization for decks: [${deckPair.join(', ').toUpperCase()}]`);
  
  deckPair.forEach(deck => {
    const loadedSong = getCurrentLoadedSong(deck);
    if (loadedSong) {
      console.log(`🔍 Checking deck ${deck.toUpperCase()} loaded song: "${loadedSong.title}"`);
      
      // Check if this song already exists in queue
      const existingQueueItemIndex = queue.findIndex(item => 
        isSongQueueItem(item) && 
        item.song?.id === loadedSong.id
      );
      
      if (existingQueueItemIndex !== -1) {
        const queueItem = queue[existingQueueItemIndex];
        console.log(`📌 Found "${loadedSong.title}" in queue at position ${existingQueueItemIndex + 1}`);
        
        // Update assignment to current deck
        const oldAssignment = queueItem.assignedToDeck;
        queueItem.assignedToDeck = deck;
        queueItem.loadedAt = new Date();
        
        // Move to correct position based on deck state
        const deckState = getDeckState(deck);
        if (deckState === 'playing') {
          console.log(`▶️ Moving currently playing song to top of queue`);
          const item = queue.splice(existingQueueItemIndex, 1)[0];
          queue.unshift(item);
        }
        
        console.log(`✅ Synchronized "${loadedSong.title}" with deck ${deck.toUpperCase()}${oldAssignment ? ` (was assigned to ${oldAssignment.toUpperCase()})` : ''}`);
      } else {
        // Song not in queue - add it if we want to track all loaded songs
        console.log(`⚠️ Loaded song "${loadedSong.title}" not found in queue`);
        
        // Optional: Add loaded song to queue for consistency
        // const newSongItem = createSongQueueItem(loadedSong);
        // newSongItem.assignedToDeck = deck;
        // newSongItem.loadedAt = new Date();
        // queue.unshift(newSongItem); // Add at top since it's currently loaded
        // console.log(`➕ Added loaded song "${loadedSong.title}" to queue`);
      }
    }
  });
  
  // Remove any duplicate assignments and clean up
  removeDuplicateQueueAssignments();
  
  // Reassign remaining unassigned songs optimally
  reassignQueueToDecks();
  
  // Prepare any available decks
  prepareAllAvailableDecks();
  
  // Update queue display to show new assignments
  updateQueueDisplay();
}

// Remove duplicate queue assignments - ensure each song is only assigned once
function removeDuplicateQueueAssignments() {
  const assignedSongs = new Set<string>();
  
  queue.forEach(item => {
    if (isSongQueueItem(item) && item.song && item.assignedToDeck) {
      const songId = item.song.id;
      
      if (assignedSongs.has(songId)) {
        // Duplicate found - remove assignment from this item
        console.log(`🔄 Removing duplicate assignment for "${item.song.title}" from deck ${item.assignedToDeck.toUpperCase()}`);
        item.assignedToDeck = null;
      } else {
        assignedSongs.add(songId);
      }
    }
  });
}

// Reassign all unassigned queue items to optimal deck positions
function reassignQueueToDecks() {
  console.log(`🎯 Reassigning unassigned queue items to optimal deck positions`);
  
  // Get all active deck pairs
  const availableDecks: ('a' | 'b' | 'c' | 'd')[] = [];
  if (autoQueueConfig.deckPairAB) {
    availableDecks.push('a', 'b');
  }
  if (autoQueueConfig.deckPairCD) {
    availableDecks.push('c', 'd');
  }
  
  if (availableDecks.length === 0) {
    console.log('⏸️ No active deck pairs for reassignment');
    return;
  }
  
  // Get unassigned song items
  const unassignedSongs = queue.filter(item => 
    isSongQueueItem(item) && 
    item.song && 
    item.assignedToDeck === null
  );
  
  console.log(`📋 Found ${unassignedSongs.length} unassigned songs to reassign`);
  
  // Assign songs to decks in alternating pattern
  let deckIndex = 0;
  unassignedSongs.forEach((songItem, index) => {
    const targetDeck = availableDecks[deckIndex % availableDecks.length];
    songItem.assignedToDeck = targetDeck;
    
    const songTitle = songItem.song?.title || 'Unknown';
    console.log(`📌 Reassigned "${songTitle}" to deck ${targetDeck.toUpperCase()}`);
    
    deckIndex++;
  });
  
  console.log(`✅ Reassigned ${unassignedSongs.length} songs to decks`);
}

// Reset deck assignments when queue pair is disabled
function resetDeckAssignments(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  console.log(`🔄 Resetting deck assignments for: [${deckPair.join(', ').toUpperCase()}]`);
  
  // Clear assignments for the specified decks
  queue.forEach(queueItem => {
    if (queueItem.assignedToDeck && deckPair.includes(queueItem.assignedToDeck)) {
      const songTitle = isSongQueueItem(queueItem) && queueItem.song ? queueItem.song.title : 'Item';
      console.log(`🔄 Clearing assignment: ${songTitle} from Deck ${queueItem.assignedToDeck.toUpperCase()}`);
      queueItem.assignedToDeck = null;
    }
  });
  
  // Update queue display to remove coloring
  updateQueueDisplay();
}

// Prepare decks immediately when auto-queue is activated
async function prepareDecksOnActivation(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  console.log(`🎵 Preparing decks on activation: [${deckPair.join(', ').toUpperCase()}]`);
  
  // Check if any deck in the pair is currently playing
  let hasPlayingDeck = false;
  for (const deck of deckPair) {
    const deckState = playerStates[deck as keyof typeof playerStates];
    if (deckState?.isPlaying) {
      console.log(`🎵 Deck ${deck.toUpperCase()} is already playing`);
      hasPlayingDeck = true;
      break;
    }
  }
  
  // Check if any deck has a loaded track (but not a radio stream)
  let hasLoadedDeck = false;
  for (const deck of deckPair) {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    const isRadioStream = audio && audio.getAttribute('data-stream-type') === 'live';
    
    if (audio && audio.src && audio.readyState >= 1) {
      if (isRadioStream) {
        console.log(`📻 Deck ${deck.toUpperCase()} has a radio stream loaded (excluding from auto-queue)`);
      } else {
        console.log(`🎵 Deck ${deck.toUpperCase()} has a track loaded`);
        hasLoadedDeck = true;
        break;
      }
    }
  }
  
  // If no decks are prepared and we have queue items, prepare them
  if (!hasPlayingDeck && !hasLoadedDeck && queue.length > 0) {
    console.log(`📋 Auto-filling empty decks from queue (${queue.length} items available)`);
    
    // Find first unassigned song in queue for this deck pair
    const firstAvailableSong = queue.find(item => !item.assignedToDeck);
    const firstDeck = deckPair[0];
    
    if (firstAvailableSong && isSongQueueItem(firstAvailableSong) && firstAvailableSong.song) {
      try {
        console.log(`📋 Loading first available song to Deck ${firstDeck.toUpperCase()}: ${firstAvailableSong.song.title}`);
        
        // Load the song to the deck
        loadTrackToPlayer(firstDeck, firstAvailableSong.song, false);
        
        // Mark as assigned to deck
        firstAvailableSong.assignedToDeck = firstDeck;
        
        // ========================================
        // 🔒 WAIT FOR FIRST DECK TO FINISH LOADING
        // ========================================
        // Wait for the first deck to be ready before loading second deck
        // This prevents simultaneous loading which causes issues
        console.log(`⏳ [LoadingLock] Waiting for Deck ${firstDeck.toUpperCase()} to finish loading...`);
        
        // Wait for loading lock to be released (with timeout)
        const maxWaitTime = 15000; // 15 seconds max wait
        const startWait = Date.now();
        
        while (isDeckLoading(firstDeck) && (Date.now() - startWait) < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
        }
        
        if (isDeckLoading(firstDeck)) {
          console.warn(`⚠️ [LoadingLock] Timeout waiting for Deck ${firstDeck.toUpperCase()} - proceeding anyway`);
        } else {
          console.log(`✅ [LoadingLock] Deck ${firstDeck.toUpperCase()} ready - proceeding to second deck`);
        }
        
        // Auto-start playback if no other deck is playing
        if (!hasPlayingDeck) {
          console.log(`🎵 Auto-starting playback on Deck ${firstDeck.toUpperCase()}`);
          const playButton = document.querySelector(`[data-deck="${firstDeck}"] .play-pause-btn`) as HTMLButtonElement;
          if (playButton) {
            playButton.click();
          }
        }
        
        // Update queue display
        updateQueueDisplay();
        
      } catch (error) {
        console.error(`❌ Failed to auto-load song to deck ${firstDeck.toUpperCase()}:`, error);
      }
    }
  }
  
  // If we have more queued songs, prepare the next deck in the pair
  const secondDeck = deckPair[1];
  const secondAvailableSong = queue.find(item => !item.assignedToDeck);
  
  if (secondAvailableSong && isSongQueueItem(secondAvailableSong) && secondAvailableSong.song) {
    // Check if second deck is empty
    const secondAudio = document.getElementById(`audio-${secondDeck}`) as HTMLAudioElement;
    const secondDeckEmpty = !secondAudio || !secondAudio.src || secondAudio.readyState < 1;
    
    if (secondDeckEmpty) {
      try {
        console.log(`📋 Pre-loading next song to Deck ${secondDeck.toUpperCase()}: ${secondAvailableSong.song.title}`);
        loadTrackToPlayer(secondDeck, secondAvailableSong.song, false);
        secondAvailableSong.assignedToDeck = secondDeck;
        updateQueueDisplay();
      } catch (error) {
        console.error(`❌ Failed to pre-load song to deck ${secondDeck.toUpperCase()}:`, error);
      }
    }
  }
}

// Update radio stream display with station info
function updateRadioStreamDisplay(deck: string, station: any) {
  console.log(`📻 Updating radio display for deck ${deck.toUpperCase()}:`, {
    stationName: station.name,
    isLive: station.live?.is_live,
    streamerName: station.live?.streamer_name,
    nowPlaying: station.now_playing?.song
  });
  
  // Update waveform album cover with current track art
  const albumCoverElement = document.getElementById(`album-cover-${deck}`) as HTMLElement;
  if (albumCoverElement) {
    const nowPlaying = station.now_playing?.song;
    if (nowPlaying?.art) {
      albumCoverElement.innerHTML = `<img src="${nowPlaying.art}" alt="Album Cover" style="width: 100%; height: 100%; object-fit: cover;">`;
    } else {
      // Default radio icon when no cover available
      albumCoverElement.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: rgba(255,255,255,0.1); border-radius: 8px;">
          <span class="material-icons" style="font-size: 48px; color: rgba(255,255,255,0.7);">radio</span>
        </div>
      `;
    }
  }
}

// Update radio stream display from WebSocket data
function updateRadioStreamFromWebSocket(deck: string, station: any, data: AzuraCastNowPlayingData) {
  console.log(`📻 WebSocket update for deck ${deck.toUpperCase()}:`, data);
  
  // Validate that we have song data
  if (!data.now_playing?.song) {
    console.warn(`⚠️ No song data in WebSocket update for deck ${deck}`);
    return;
  }
  
  // Ensure deck is lowercase for element IDs
  const deckLower = deck.toLowerCase();
  
  // Update waveform info overlay (visible metadata display)
  const waveformInfo = document.getElementById(`waveform-info-${deckLower}`);
  
  console.log(`📻 Looking for element: waveform-info-${deckLower}, found:`, !!waveformInfo);
  
  if (!waveformInfo) {
    console.error(`❌ waveform-info-${deckLower} not found - deck may not be loaded yet`);
    // Try again after a short delay in case the deck is still loading
    setTimeout(() => {
      const retryWaveformInfo = document.getElementById(`waveform-info-${deckLower}`);
      if (retryWaveformInfo) {
        console.log(`✅ Retry successful: found waveform-info-${deckLower}`);
        updateRadioStreamFromWebSocket(deck, station, data);
      } else {
        console.error(`❌ Retry failed: waveform-info-${deckLower} still not found`);
      }
    }, 1000);
    return;
  }
  
  // Get child elements within waveform info
  const titleElement = waveformInfo.querySelector('.track-title') as HTMLElement;
  const artistElement = waveformInfo.querySelector('.track-artist') as HTMLElement;
  const albumElement = waveformInfo.querySelector('.track-album') as HTMLElement;
  
  console.log(`📻 WebSocket elements found for deck ${deck}:`, {
    titleElement: !!titleElement,
    artistElement: !!artistElement,
    albumElement: !!albumElement
  });
  
  // Extract short radio name (before " - ") and description (after " - ")
  const fullName = station.name || '';
  const nameParts = fullName.split(' - ');
  const shortRadioName = nameParts[0] || fullName;
  const radioDescription = station.description || nameParts[1] || '';
  
  // Update waveform title with real-time track info
  if (titleElement) {
    const newTitle = data.now_playing?.song?.title || station.name;
    console.log(`📻 Setting title for deck ${deck}: "${newTitle}"`);
    titleElement.textContent = newTitle;
  } else {
    console.error(`❌ Title element not found in waveform-info-${deck}`);
  }
  
  // Update waveform artist with current song artist (or fallback to "Live Radio")
  if (artistElement) {
    const songArtist = data.now_playing?.song?.artist || 'Live Radio';
    artistElement.textContent = songArtist;
  } else {
    console.error(`Artist element not found`);
  }
  
  // Update album field with short radio name
  if (albumElement) {
    albumElement.textContent = shortRadioName;
  }
  
  // Update LIVE badge/duration element with streamer info (only if live)
  const durationLineElement = waveformInfo.querySelector('.track-duration-line') as HTMLElement;
  if (data.live?.is_live) {
    // If there's already a duration line element, update it
    if (durationLineElement) {
      const liveBadge = data.live?.streamer_name ? `🔴 LIVE: ${data.live.streamer_name}` : '🔴 LIVE';
      durationLineElement.textContent = liveBadge;
      durationLineElement.style.color = '#ff4444';
    } else {
      // If no duration line element exists, create it (should not happen with new HTML structure)
      const bottomLeft = waveformInfo.querySelector('.track-details-bottom-left');
      if (bottomLeft) {
        const liveBadge = data.live?.streamer_name ? `🔴 LIVE: ${data.live.streamer_name}` : '🔴 LIVE';
        const newDurationLine = document.createElement('div');
        newDurationLine.className = 'track-duration-line';
        newDurationLine.style.color = '#ff4444';
        newDurationLine.style.marginTop = '4px';
        newDurationLine.textContent = liveBadge;
        bottomLeft.appendChild(newDurationLine);
      }
    }
  } else {
    // If not live, remove the duration line element
    if (durationLineElement) {
      durationLineElement.remove();
    }
  }
  
  // Also update hidden metadata elements (for compatibility)
  const hiddenTitle = document.getElementById(`track-title-${deck}`);
  const hiddenArtist = document.getElementById(`track-artist-${deck}`);
  if (hiddenTitle) {
    hiddenTitle.textContent = data.now_playing?.song?.title || `📻 ${station.name}`;
  }
  if (hiddenArtist) {
    const newArtist = data.now_playing?.song?.artist || 
                      (data.live?.is_live && data.live?.streamer_name ? `🔴 Live: ${data.live.streamer_name}` : `${station.name} - Live Radio`);
    hiddenArtist.textContent = newArtist;
  }
  
  // Update waveform album cover automatically when it changes
  const albumCoverElement = document.getElementById(`album-cover-${deck}`) as HTMLElement;
  if (albumCoverElement) {
    const newCoverUrl = data.now_playing?.song?.art;
    const currentCover = albumCoverElement.querySelector('img');
    const currentSrc = currentCover?.src;
    
    if (newCoverUrl && currentSrc !== newCoverUrl) {
      console.log(`🖼️ Updating album cover for deck ${deck.toUpperCase()}: ${newCoverUrl}`);
      
      // Add smooth transition for cover changes
      albumCoverElement.style.opacity = '0.5';
      setTimeout(() => {
        albumCoverElement.innerHTML = `<img src="${newCoverUrl}" alt="Album Cover" style="width: 100%; height: 100%; object-fit: cover;">`;
        albumCoverElement.style.opacity = '1';
      }, 200);
    } else if (!newCoverUrl && currentCover) {
      // Switch back to radio icon when no cover available
      albumCoverElement.style.opacity = '0.5';
      setTimeout(() => {
        albumCoverElement.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: rgba(255,255,255,0.1); border-radius: 8px;">
            <span class="material-icons" style="font-size: 48px; color: rgba(255,255,255,0.7);">radio</span>
          </div>
        `;
        albumCoverElement.style.opacity = '1';
      }, 200);
    }
  }
  
  // Update stored radio track info for consistency
  const radioTrack = (window as any)[`radioTrack_${deck}`];
  if (radioTrack && data.now_playing?.song) {
    radioTrack.title = data.now_playing.song.title;
    radioTrack.artist = data.now_playing.song.artist;
    radioTrack.coverArt = data.now_playing.song.art;
    
    // Also update deckSongs for drag & drop
    const deckType = deck as 'a' | 'b' | 'c' | 'd';
    if (deckSongs[deckType]) {
      deckSongs[deckType].title = data.now_playing.song.title;
      deckSongs[deckType].artist = data.now_playing.song.artist;
      deckSongs[deckType].coverArt = data.now_playing.song.art;
    }
  }
}

// Setup Radio Stream Selector
function setupRadioStreamSelector() {
  const radioBtn = document.getElementById('radio-stream-btn') as HTMLButtonElement;
  const dropdown = document.getElementById('radio-stream-dropdown') as HTMLDivElement;
  const loadingDiv = document.getElementById('radio-stream-loading') as HTMLDivElement;
  const streamList = document.getElementById('radio-stream-list') as HTMLDivElement;
  
  if (!radioBtn || !dropdown || !loadingDiv || !streamList) {
    console.warn('Radio stream elements not found');
    return;
  }
  
  let isDropdownOpen = false;
  let radioStations: any[] = [];
  let listenerUpdateInterval: NodeJS.Timeout | null = null;
  // Store original parent for portal restore
  const dropdownPlaceholder = document.createComment('radio-dropdown-placeholder');
  let originalDropdownParent: Node | null = null;
  
  // Toggle dropdown
  const toggleDropdown = async () => {
    if (isDropdownOpen) {
      // close
      dropdown.classList.remove('show');
      radioBtn.classList.remove('active');
      restoreDropdown(dropdown, dropdownPlaceholder, originalDropdownParent);
      isDropdownOpen = false;
      
      // Stop listener updates
      stopListenerUpdates();
    } else {
      // open: Show dropdown first so it has dimensions, THEN portal and position it
      dropdown.classList.add('show');
      radioBtn.classList.add('active');
      // Use setTimeout to ensure DOM has updated and element has dimensions
      setTimeout(() => {
        originalDropdownParent = portalDropdownToBody(dropdown, dropdownPlaceholder, radioBtn);
      }, 0);
      isDropdownOpen = true;
      
      // Load radio stations if not already loaded
      if (radioStations.length === 0) {
        await loadRadioStations();
      }
      
      // Start periodic listener count updates
      startListenerUpdates();
    }
  };
  
  // Load radio stations from AzuraCast
  const loadRadioStations = async () => {
    try {
      loadingDiv.style.display = 'block';
      streamList.style.display = 'none';
      
      console.log('📻 Loading radio stations...');
      
      // Get AzuraCast servers from environment
      const serverUrls = getConfigValue('VITE_AZURACAST_SERVERS')?.split(',').map((url: string) => url.trim()) || [];
      
      if (serverUrls.length === 0) {
        throw new Error('No AzuraCast servers configured');
      }
      
      // Import and use the AzuraCast client
      const { fetchAllAzuraCastStations } = await import('./azuracast');
      const allServersData = await fetchAllAzuraCastStations(serverUrls);
      
      // Flatten all stations with server info
      radioStations = [];
      allServersData.forEach(serverData => {
        serverData.stations.forEach(stationResponse => {
          // Each station response has a 'station' property with the actual station data
          const station = stationResponse.station || stationResponse;
          radioStations.push({
            ...station,
            serverUrl: serverData.serverUrl,
            // Add live info, listeners, and now_playing from the response root level
            live: stationResponse.live || station.live,
            listeners: stationResponse.listeners || station.listeners,
            now_playing: stationResponse.now_playing || station.now_playing
          });
        });
      });
      
      console.log(`📻 Loaded ${radioStations.length} radio stations from ${allServersData.length} servers`);
      
      // Populate dropdown
      populateRadioDropdown(radioStations);
      
      loadingDiv.style.display = 'none';
      streamList.style.display = 'block';
      
    } catch (error) {
      console.error('❌ Error loading radio stations:', error);
      loadingDiv.innerHTML = `
        <span class="material-icons">error</span>
        Error loading stations
      `;
    }
  };
  
  // Populate dropdown with stations
  const populateRadioDropdown = (stations: any[]) => {
    streamList.innerHTML = '';
    
    stations.forEach(station => {
      const stationItem = document.createElement('div');
      const isLive = station.live?.is_live;
      const streamerName = station.live?.streamer_name;
      const nowPlaying = station.now_playing?.song;
      
      // Add live class for styling
      stationItem.className = `radio-stream-item ${isLive ? 'live-stream' : ''}`;
      
      // Listener counts with compact layered badge display
      const uniqueListeners = station.listeners?.unique || 0;
      const totalListeners = station.listeners?.current || 0;
      const extraConnections = totalListeners - uniqueListeners;
      
      // Compact badge: listeners (top) | diff (middle-right) | name (bottom)
      let badgeHtml = '<span class="station-badge-stack">';
      
      // Top layer: Listener count
      badgeHtml += `<span class="badge-listeners">👥${uniqueListeners}</span>`;
      
      // Middle-right layer: Extra connections (if any)
      if (extraConnections > 0) {
        badgeHtml += `<span class="badge-extra">+${extraConnections}</span>`;
      }
      
      // Bottom layer: Station name
      badgeHtml += `<span class="badge-name">`;
      if (isLive && streamerName) {
        badgeHtml += `${streamerName} - ${station.name}`;
      } else {
        badgeHtml += `${station.name}`;
      }
      badgeHtml += `</span>`;
      
      badgeHtml += '</span>'; // close station-badge-stack
      
      let firstLine = badgeHtml;
      
      // Second line: Always the current song
      let secondLine = '';
      if (nowPlaying) {
        secondLine = `🎵 ${nowPlaying.artist} - ${nowPlaying.title}`;
      } else {
        secondLine = station.description || 'Radio Stream';
      }
      
      stationItem.innerHTML = `
        <div class="radio-stream-info">
          <div class="radio-stream-name">${firstLine}</div>
          <div class="radio-stream-description">${secondLine}</div>
        </div>
        <div class="radio-stream-deck-buttons">
          <button class="radio-deck-btn" data-deck="a" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">A</button>
          <button class="radio-deck-btn" data-deck="b" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">B</button>
          <button class="radio-deck-btn" data-deck="c" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">C</button>
          <button class="radio-deck-btn" data-deck="d" data-station-id="${station.id}" data-server-url="${station.serverUrl}" data-shortcode="${station.shortcode}">D</button>
        </div>
      `;
      
      // Add data attributes for easier updates
      stationItem.setAttribute('data-station-key', `${station.serverUrl}:${station.shortcode}`);
      stationItem.setAttribute('data-listener-count', uniqueListeners.toString());
      
      streamList.appendChild(stationItem);
    });
    
    // Add event listeners for deck buttons
    streamList.addEventListener('click', (e) => {
      const target = e.target as HTMLButtonElement;
      if (target.classList.contains('radio-deck-btn')) {
        const deck = target.dataset.deck;
        const stationId = target.dataset.stationId;
        const serverUrl = target.dataset.serverUrl;
        const shortcode = target.dataset.shortcode;
        const station = stations.find(s => s.id == stationId && s.serverUrl === serverUrl && s.shortcode === shortcode);
        
        if (deck && station) {
          loadRadioStreamToDeck(deck, station);
          toggleDropdown(); // Close dropdown after selection
        }
      }
    });
  };
  
  // Start periodic listener count updates
  const startListenerUpdates = () => {
    // Clear any existing interval
    stopListenerUpdates();
    
    // Update listener counts every 30 seconds when dropdown is open
    listenerUpdateInterval = setInterval(async () => {
      if (isDropdownOpen && radioStations.length > 0) {
        await updateListenerCounts();
      }
    }, 30000);
    
    // Also subscribe to WebSocket updates for all stations to get real-time updates
    radioStations.forEach(station => {
      azuraCastWebSocket.subscribe(station.serverUrl, station.shortcode, (data: AzuraCastNowPlayingData) => {
        updateStationFromWebSocket(station, data);
      });
    });
    
    console.log('🔄 Started listener count updates for radio streams');
  };
  
  // Stop listener count updates
  const stopListenerUpdates = () => {
    if (listenerUpdateInterval) {
      clearInterval(listenerUpdateInterval);
      listenerUpdateInterval = null;
      console.log('⏹️ Stopped listener count updates');
    }
    
    // Unsubscribe from WebSocket updates for all stations
    radioStations.forEach(station => {
      azuraCastWebSocket.unsubscribeAll(station.serverUrl, station.shortcode);
    });
  };
  
  // Update station info from WebSocket data (including listener counts)
  const updateStationFromWebSocket = (station: any, data: AzuraCastNowPlayingData) => {
    if (!isDropdownOpen) return; // Only update if dropdown is open
    
    const stationKey = `${station.serverUrl}:${station.shortcode}`;
    const stationItem = streamList.querySelector(`[data-station-key="${stationKey}"]`);
    
    if (stationItem) {
      const nameEl = stationItem.querySelector('.radio-stream-name');
      const descriptionEl = stationItem.querySelector('.radio-stream-description');
      
      if (nameEl && descriptionEl) {
        const isLive = data.live?.is_live;
        const streamerName = data.live?.streamer_name;
        const nowPlaying = data.now_playing?.song;
        
        // Listener counts with compact layered badge display
        const uniqueListeners = data.listeners?.unique || 0;
        const totalListeners = data.listeners?.current || 0;
        const extraConnections = totalListeners - uniqueListeners;
        
        // Compact badge: listeners (top) | diff (middle-right) | name (bottom)
        let badgeHtml = '<span class="station-badge-stack">';
        
        // Top layer: Listener count
        badgeHtml += `<span class="badge-listeners">👥${uniqueListeners}</span>`;
        
        // Middle-right layer: Extra connections (if any)
        if (extraConnections > 0) {
          badgeHtml += `<span class="badge-extra">+${extraConnections}</span>`;
        }
        
        // Bottom layer: Station name
        badgeHtml += `<span class="badge-name">`;
        if (isLive && streamerName) {
          badgeHtml += `${streamerName} - ${station.name}`;
          stationItem.classList.add('live-stream');
        } else {
          badgeHtml += `${station.name}`;
          stationItem.classList.remove('live-stream');
        }
        badgeHtml += `</span>`;
        
        badgeHtml += '</span>'; // close station-badge-stack
        
        nameEl.innerHTML = badgeHtml;
        
        // Second line: Always the current song
        let secondLine = '';
        if (nowPlaying) {
          secondLine = `🎵 ${nowPlaying.artist} - ${nowPlaying.title}`;
        } else {
          secondLine = station.description || 'Radio Stream';
        }
        
        descriptionEl.textContent = secondLine;
        stationItem.setAttribute('data-listener-count', uniqueListeners.toString());
      }
    }
  };
  
  // Update listener counts for all visible stations
  const updateListenerCounts = async () => {
    try {
      console.log('📊 Updating listener counts...');
      
      // Get server URLs for current stations
      const serverUrls = [...new Set(radioStations.map(station => station.serverUrl))];
      
      // Fetch fresh nowplaying data for all servers
      const { fetchAllAzuraCastStations } = await import('./azuracast');
      const allServersData = await fetchAllAzuraCastStations(serverUrls);
      
      // Update listener counts in DOM - via WebSocket updates (no need to update description anymore)
      allServersData.forEach(serverData => {
        serverData.stations.forEach(stationResponse => {
          const station = stationResponse.station || stationResponse;
          const listeners = stationResponse.listeners || station.listeners;
          const stationKey = `${serverData.serverUrl}:${station.shortcode}`;
          
          // Find the station item in DOM and update data attribute
          const stationItem = streamList.querySelector(`[data-station-key="${stationKey}"]`);
          if (stationItem && listeners) {
            const uniqueListeners = listeners.unique || listeners.current || 0;
            // Update data attribute only (badges are updated via WebSocket)
            stationItem.setAttribute('data-listener-count', uniqueListeners.toString());
          }
        });
      });
      
      console.log('✅ Listener counts updated');
    } catch (error) {
      console.warn('⚠️ Failed to update listener counts:', error);
    }
  };
  
  // Load radio stream to specified deck
  // Setup robust error handling and auto-reconnect for radio streams
  const setupRadioStreamErrorHandling = (
    audio: HTMLAudioElement, 
    deckType: 'a' | 'b' | 'c' | 'd', 
    station: any, 
    streamUrls: string[]
  ) => {
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let wasPlaying = false;
    
    // Track if user manually paused
    let manuallyPaused = false;
    audio.addEventListener('pause', () => {
      if (!audio.ended) {
        manuallyPaused = true;
        console.log(`⏸️ Deck ${deckType.toUpperCase()}: User manually paused`);
      }
    });
    
    audio.addEventListener('play', () => {
      manuallyPaused = false;
      reconnectAttempts = 0; // Reset reconnect counter on successful play
    });
    
    const attemptReconnect = () => {
      if (manuallyPaused) {
        console.log(`⏸️ Deck ${deckType.toUpperCase()}: Skip reconnect (manually paused)`);
        return;
      }
      
      if (reconnectAttempts >= maxReconnectAttempts) {
        console.error(`❌ Deck ${deckType.toUpperCase()}: Max reconnect attempts reached for ${station.name}`);
        // Show user notification
        const fileInfo = document.querySelector(`#file-info-${deckType} .file-path-display`);
        if (fileInfo) {
          fileInfo.textContent = `⚠️ ${station.name} - Connection failed`;
        }
        return;
      }
      
      reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000); // Exponential backoff, max 10s
      
      console.log(`🔄 Deck ${deckType.toUpperCase()}: Reconnect attempt ${reconnectAttempts}/${maxReconnectAttempts} in ${delay}ms`);
      
      const fileInfo = document.querySelector(`#file-info-${deckType} .file-path-display`);
      if (fileInfo) {
        fileInfo.textContent = `🔄 ${station.name} - Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`;
      }
      
      reconnectTimeout = setTimeout(() => {
        const currentUrlIndex = reconnectAttempts % streamUrls.length;
        const reconnectUrl = streamUrls[currentUrlIndex];
        const freshUrl = `${reconnectUrl}?reconnect=${Date.now()}&attempt=${reconnectAttempts}`;
        
        console.log(`🔗 Deck ${deckType.toUpperCase()}: Trying ${freshUrl}`);
        
        // Store playback state
        wasPlaying = !audio.paused;
        
        // Reload stream
        audio.src = freshUrl;
        audio.load();
        
        // Try to resume playback if it was playing before
        if (wasPlaying) {
          audio.play().catch(err => {
            console.warn(`⚠️ Deck ${deckType.toUpperCase()}: Auto-play failed, user interaction may be needed:`, err);
          });
        }
      }, delay);
    };
    
    // Handle network errors
    audio.addEventListener('error', (e) => {
      // Ignore errors if stream is actually playing fine
      if (!audio.paused && audio.readyState >= 2) {
        console.log(`⚠️ Deck ${deckType.toUpperCase()}: Error event but stream is playing, ignoring`);
        return;
      }
      
      console.error(`❌ Deck ${deckType.toUpperCase()}: Stream error for ${station.name}:`, e);
      attemptReconnect();
    });
    
    // Handle stalled streams (buffering issues)
    audio.addEventListener('stalled', () => {
      // Ignore stalled if stream is actually playing fine
      if (!audio.paused && audio.readyState >= 2) {
        console.log(`⚠️ Deck ${deckType.toUpperCase()}: Stalled event but stream is playing, ignoring`);
        return;
      }
      
      console.warn(`⚠️ Deck ${deckType.toUpperCase()}: Stream stalled for ${station.name}`);
      attemptReconnect();
    });
    
    // Handle waiting for data
    let waitingTimeout: NodeJS.Timeout | null = null;
    audio.addEventListener('waiting', () => {
      console.warn(`⏳ Deck ${deckType.toUpperCase()}: Waiting for data from ${station.name}`);
      
      // If waiting too long (5 seconds), try reconnect
      if (waitingTimeout) clearTimeout(waitingTimeout);
      waitingTimeout = setTimeout(() => {
        if (audio.readyState < 3) { // HAVE_FUTURE_DATA
          console.warn(`⏰ Deck ${deckType.toUpperCase()}: Waiting timeout, attempting reconnect`);
          attemptReconnect();
        }
      }, 5000);
    });
    
    // Clear waiting timeout when playback resumes
    audio.addEventListener('playing', () => {
      if (waitingTimeout) {
        clearTimeout(waitingTimeout);
        waitingTimeout = null;
      }
      
      // Reset reconnect counter on successful playback
      if (reconnectAttempts > 0) {
        console.log(`✅ Deck ${deckType.toUpperCase()}: Stream recovered after ${reconnectAttempts} attempts`);
        reconnectAttempts = 0;
        
        const fileInfo = document.querySelector(`#file-info-${deckType} .file-path-display`);
        if (fileInfo) {
          fileInfo.textContent = `📻 ${station.name}`;
        }
      }
    });
    
    // Cleanup on deck clear
    (window as any)[`radioReconnectCleanup_${deckType}`] = () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (waitingTimeout) clearTimeout(waitingTimeout);
      reconnectAttempts = 0;
    };
  };

  const loadRadioStreamToDeck = async (deck: string, station: any) => {
    try {
      console.log(`📻 Loading ${station.name} to Deck ${deck.toUpperCase()}`);
      
      // ✅ CLEAR DECK COMPLETELY before loading radio stream
      // This removes any previous local files, OpenSubsonic tracks, or other radio streams
      const deckType = deck as 'a' | 'b' | 'c' | 'd';
      clearPlayerDeck(deckType);
      
      // Get the audio element for the deck (using getAudioElement instead of getElementById)
      const audio = getAudioElement(deckType);
      
      if (!audio) {
        console.error(`❌ Audio element for deck ${deck} not found`);
        return;
      }
      
      // Function to try loading stream URLs with fallback
      const tryLoadRadioStream = async (urls: string[], urlIndex = 0): Promise<void> => {
        if (urlIndex >= urls.length) {
          throw new Error('All stream URLs failed to load');
        }
        
        const currentUrl = urls[urlIndex];
        console.log(`📻 Trying Stream URL ${urlIndex + 1}/${urls.length}: ${currentUrl}`);
        
        return new Promise((resolve, reject) => {
          const testAudio = new Audio();
          testAudio.crossOrigin = 'anonymous';
          testAudio.preload = 'none'; // No caching for test audio
          
          const cleanup = () => {
            testAudio.removeEventListener('canplay', onCanPlay);
            testAudio.removeEventListener('error', onError);
            testAudio.removeEventListener('abort', onError);
          };
          
          const onCanPlay = () => {
            cleanup();
            console.log(`✅ Stream URL ${urlIndex + 1} works: ${currentUrl}`);
            
            // Create radio track object with working URL (add cache-busting parameters)
            const noCacheUrl = `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}t=${Date.now()}&nocache=1`;
            
            const radioTrack = {
              id: `radio-${station.id}`,
              title: station.name,
              artist: 'Live Radio Stream',
              album: station.description || station.name,
              duration: 0,
              genre: station.genre || 'Radio',
              year: new Date().getFullYear(),
              track: 0,
              discNumber: 0,
              coverArt: station.now_playing?.song?.art || null,
              suffix: 'mp3',
              bitRate: station.bitrate || 128,
              path: noCacheUrl,
              isStream: true,
              isRadio: true,
              stationId: station.id,
              shortcode: station.shortcode,
              serverUrl: station.serverUrl
            };
            
            // Store radio track info for this deck (for WebSocket updates)
            (window as any)[`radioTrack_${deck}`] = radioTrack;
            
            // Store radio track in deckSongs for drag & drop support
            deckSongs[deck as 'a' | 'b' | 'c' | 'd'] = radioTrack as any;
            
            // Configure audio element to prevent caching
            audio.preload = 'none'; // Don't preload anything
            audio.crossOrigin = 'anonymous';
            
            // Set cache-control attributes for radio streams
            if (audio.setAttribute) {
              audio.setAttribute('data-no-cache', 'true');
              audio.setAttribute('data-stream-type', 'live');
            }
            
            // Load the working stream URL with cache-busting
            audio.src = noCacheUrl;
            audio.load();
            
            resolve();
          };
          
          const onError = () => {
            cleanup();
            console.warn(`❌ Stream URL ${urlIndex + 1} failed: ${currentUrl}`);
            
            // Try next URL
            tryLoadRadioStream(urls, urlIndex + 1)
              .then(resolve)
              .catch(reject);
          };
          
          testAudio.addEventListener('canplay', onCanPlay);
          testAudio.addEventListener('error', onError);
          testAudio.addEventListener('abort', onError);
          
          // Set source with cache-busting parameter and trigger loading
          const testUrl = `${currentUrl}${currentUrl.includes('?') ? '&' : '?'}test=${Date.now()}`;
          testAudio.src = testUrl;
          testAudio.load();
          
          // Timeout after 10 seconds
          setTimeout(() => {
            if (testAudio.readyState === 0) {
              cleanup();
              onError();
            }
          }, 10000);
        });
      };
      
      // Primary URL: Standard format that works for most stations
      const primaryStreamUrl = `${station.serverUrl}/listen/${station.shortcode}/radio.mp3`;
      // Fallback URL: Official AzuraCast format from API or constructed format
      const fallbackStreamUrl = station.listen_url || `${station.serverUrl}/listen/${station.shortcode}/${station.shortcode}`;
      
      // Try URLs in order: primary first, then fallback
      const streamUrls = [primaryStreamUrl];
      if (fallbackStreamUrl !== primaryStreamUrl) {
        streamUrls.push(fallbackStreamUrl);
      }
      
      // Try loading the stream with fallback
      await tryLoadRadioStream(streamUrls);
      
      // Setup periodic cache-busting for live streams
      const refreshStreamUrl = () => {
        const radioTrack = (window as any)[`radioTrack_${deck}`];
        if (radioTrack && radioTrack.isRadio && audio.src) {
          const baseUrl = radioTrack.path.split('?')[0]; // Remove existing parameters
          const freshUrl = `${baseUrl}?t=${Date.now()}&live=1`;
          
          // Only refresh if audio is not currently playing or loading
          if (audio.paused && audio.readyState >= 2) {
            console.log(`🔄 Refreshing radio stream URL for deck ${deck.toUpperCase()}`);
            audio.src = freshUrl;
            radioTrack.path = freshUrl;
          }
        }
      };
      
      // Refresh stream URL every 2 minutes to prevent stale cache
      const refreshInterval = setInterval(refreshStreamUrl, 120000);
      
      // Store refresh interval to clean up later if needed
      (window as any)[`radioRefreshInterval_${deck}`] = refreshInterval;
      
      // Reset waveform first (before loading new stream)
      resetWaveform(deckType);
      
      // Update initial display
      updateRadioStreamDisplay(deck, station);
      
      // Update waveform info overlay for radio stream with initial station data
      // Pass station.now_playing as third parameter to show initial metadata
      updateWaveformInfoForRadio(deckType, station, station);
      
      // For radio streams, create a simple live waveform visualization
      createLiveWaveformForRadio(deckType, audio);
      
      // Subscribe to WebSocket updates for this station
      console.log(`🔌 Setting up WebSocket subscription for ${station.shortcode} on ${station.serverUrl}`);
      azuraCastWebSocket.subscribe(station.serverUrl, station.shortcode, (data: AzuraCastNowPlayingData) => {
        console.log(`📻 WebSocket data received for deck ${deck}:`, data);
        updateRadioStreamFromWebSocket(deck, station, data);
        // Note: updateRadioStreamFromWebSocket already updates all metadata
        // No need to call updateWaveformInfoForRadio again as it would overwrite the changes
      });
      
      // Immediate test: Check if we can get current data
      setTimeout(() => {
        const currentData = azuraCastWebSocket.getCurrentData(station.serverUrl, station.shortcode);
        console.log(`📻 Current WebSocket data for deck ${deck}:`, currentData);
        if (currentData) {
          updateRadioStreamFromWebSocket(deck, station, currentData);
        } else {
          console.warn(`⚠️ No WebSocket data available for deck ${deck}, setting up HTTP fallback`);
          // Fallback: Manual polling every 30 seconds
          const pollInterval = setInterval(async () => {
            try {
              const response = await fetch(`${station.serverUrl}/api/nowplaying/${station.shortcode}`);
              const nowPlayingData = await response.json();
              console.log(`📻 HTTP fallback data for deck ${deck}:`, nowPlayingData);
              if (nowPlayingData.now_playing?.song) {
                updateRadioStreamFromWebSocket(deck, station, nowPlayingData);
              }
            } catch (error) {
              console.error(`❌ HTTP fallback failed for deck ${deck}:`, error);
            }
          }, 30000);
          
          // Store interval for cleanup
          (window as any)[`radioPollInterval_${deck}`] = pollInterval;
        }
      }, 2000); // Check after 2 seconds
      
      // Setup audio event listeners for radio streams
      setupAudioEventListeners(audio, deckType);
      
      // Setup robust error handling and auto-reconnect for radio streams
      setupRadioStreamErrorHandling(audio, deckType, station, streamUrls);
      
      // Update file info display
      const fileInfo = document.querySelector(`#file-info-${deck} .file-path-display`);
      if (fileInfo) {
        fileInfo.textContent = `📻 ${station.name}`;
      }
      
      console.log(`✅ Radio stream loaded to Deck ${deck.toUpperCase()}`);
      
      // Find and show visual feedback on the clicked button
      const deckButton = document.querySelector(`[data-deck="${deck}"][data-station-id="${station.id}"]`) as HTMLButtonElement;
      if (deckButton) {
        deckButton.style.background = 'rgba(100, 255, 218, 0.3)';
        deckButton.style.borderColor = '#64FFDA';
        deckButton.style.color = '#64FFDA';
        
        setTimeout(() => {
          deckButton.style.background = '';
          deckButton.style.borderColor = '';
          deckButton.style.color = '';
        }, 2000);
      }
      
    } catch (error) {
      console.error(`❌ Error loading radio stream to deck ${deck}:`, error);
    }
  };
  
  // Make loadRadioStreamToDeck globally available for drag & drop
  (window as any).loadRadioStreamToDeck = loadRadioStreamToDeck;
  
  // Event listeners
  radioBtn.addEventListener('click', toggleDropdown);
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (isDropdownOpen && !radioBtn.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
      toggleDropdown();
    }
  });
  
  console.log('📻 Radio stream selector initialized');
}

  // Helper: move dropdown to document.body and position it
  function portalDropdownToBody(el: HTMLElement, placeholder: Comment, anchor: HTMLElement): Node | null {
    try {
      const parent = el.parentNode;
      if (!parent) return null;
      // Insert placeholder where element was
      parent.replaceChild(placeholder, el);
      // Append to body
      document.body.appendChild(el);
      // Position fixed (already set in CSS, but enforce it)
      const rect = anchor.getBoundingClientRect();
      el.style.position = 'fixed';
      el.style.zIndex = '9999';
      
      // Slight offset below button: 5px spacing
      let top = rect.bottom + 5;
      
      const viewportHeight = window.innerHeight;
      const dropdownWidth = el.offsetWidth;
      const dropdownHeight = el.offsetHeight;
      
      console.log('🔧 Portal Dropdown Debug:', {
        buttonRect: rect,
        dropdownWidth,
        dropdownHeight,
        viewportWidth: window.innerWidth,
        viewportHeight
      });
      
      // Position dropdown: right edge aligned with button's right edge, extending left
      // This makes it open towards the library (to the left)
      let left = rect.right - dropdownWidth;
      
      console.log(`📍 Initial left calculation: ${rect.right} - ${dropdownWidth} = ${left}`);
      
      // Ensure dropdown doesn't go off left edge (minimum 10px margin)
      if (left < 10) {
        console.log(`⚠️ Left clamped from ${left} to 10`);
        left = 10;
      }
      
      // Prevent overflow bottom
      if (top + dropdownHeight > viewportHeight) {
        // Position above the button instead
        top = rect.top - dropdownHeight - 5;
        console.log(`⬆️ Moved above button: top = ${top}`);
      }
      // Prevent overflow top
      if (top < 10) {
        top = 10;
        console.log(`⚠️ Top clamped to 10`);
      }
      
      console.log(`✅ Final position: top=${top}px, left=${left}px`);
      
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
      el.style.right = 'auto';
      
      console.log('📦 Applied styles:', {
        position: el.style.position,
        top: el.style.top,
        left: el.style.left,
        right: el.style.right,
        zIndex: el.style.zIndex
      });
      
      return parent;
    } catch (e) {
      console.error('Failed to portal dropdown', e);
      return null;
    }
  }

  // Helper: restore dropdown back to original parent
  function restoreDropdown(el: HTMLElement, placeholder: Comment, originalParent: Node | null) {
    try {
      // Remove absolute positioning
      el.style.position = '';
      el.style.top = '';
      el.style.left = '';
      el.style.right = '';
      el.style.zIndex = '';
      if (placeholder.parentNode) {
        placeholder.parentNode.replaceChild(el, placeholder);
      } else if (originalParent) {
        originalParent.appendChild(el);
      }
    } catch (e) {
      console.error('Failed to restore dropdown', e);
    }
  }

// Handle Auto-Queue Logic when a track ends
function handleAutoQueue(finishedDeck: 'a' | 'b' | 'c' | 'd') {
  console.log(`🎯 Auto-Queue triggered: Deck ${finishedDeck.toUpperCase()} finished`);
  
  // IMPORTANT: Remove the finished track from queue first
  const finishedSong = getCurrentLoadedSong(finishedDeck);
  if (finishedSong) {
    removeQueueItemBySong(finishedSong);
    console.log(`🗑️ Removed finished song from queue: ${finishedSong.title}`);
  }
  
  // 🎤 CRITICAL: Check if microphone is next in queue BEFORE continuing auto-play
  const microphoneItem = shouldActivateMicrophoneNow();
  if (microphoneItem) {
    console.log(`🎤 Microphone placeholder found at queue position - activating microphone and pausing auto-play`);
    
    // Mark microphone item as processed and remove from queue
    const micIndex = queue.findIndex(item => item.id === microphoneItem.id);
    if (micIndex !== -1) {
      queue.splice(micIndex, 1);
      updateQueueDisplay();
      console.log(`🗑️ Removed microphone placeholder from queue`);
    }
    
    // Stop auto-queue to pause playback until microphone is deactivated
    autoQueueConfig.isAutoPlaying = false;
    console.log(`⏸️ Auto-play paused for microphone activation`);
    
    // Activate microphone automatically if not already active
    if (!micActive) {
      const micBtn = document.getElementById("mic-toggle") as HTMLButtonElement;
      if (micBtn) {
        micBtn.click(); // Trigger the microphone activation
        console.log(`🎤 Microphone automatically activated`);
      }
    } else {
      console.log(`🎤 Microphone already active`);
    }
    
    // Do NOT continue with auto-queue - wait for microphone to be deactivated
    return;
  }
  
  // Prevent multiple simultaneous auto-plays
  if (autoQueueConfig.isAutoPlaying) {
    console.log('🔄 Auto-play already in progress, skipping');
    return;
  }
  
  // Check if we should try to start the next track
  if (!isAutoQueueActiveForDeck(finishedDeck)) {
    console.log(`⏸️ Auto-queue not active for deck ${finishedDeck.toUpperCase()}`);
    return;
  }
  
  // Determine next deck based on configuration
  const nextDeck = getNextDeck(finishedDeck);
  if (!nextDeck) {
    console.log('⏸️ No valid next deck found (all deck pairs disabled)');
    return;
  }
  
  autoQueueConfig.isAutoPlaying = true;
  autoQueueConfig.lastPlayedDeck = finishedDeck;
  
  console.log(`🎯 Auto-Queue: ${finishedDeck.toUpperCase()} → ${nextDeck.toUpperCase()}`);
  
  // Check if next deck is ready to play or needs a new track
  const nextDeckState = getDeckState(nextDeck);
  console.log(`🔍 Next deck ${nextDeck.toUpperCase()} state: ${nextDeckState}`);
  
  try {
    if (nextDeckState === 'ready') {
      // Deck already has a track loaded, just start playing it
      console.log(`▶️ Starting prepared track on deck ${nextDeck.toUpperCase()}`);
      simulatePlayButtonClick(nextDeck);
    } else {
      // Deck needs a new track loaded
      console.log(`🔄 Loading new track to deck ${nextDeck.toUpperCase()}`);
      startNextDeckWithNewTrack(nextDeck);
    }
    
    // Prepare the deck after the next deck (for seamless transitions)
    setTimeout(() => {
      const playingCount = countPlayingDecks();
      console.log(`🔢 Playing decks after starting ${nextDeck.toUpperCase()}: ${playingCount}`);
      
      if (playingCount <= 1) {
        prepareNextDeckInSequence(nextDeck);
      } else {
        console.log('⚠️ Multiple decks playing, skipping preparation');
      }
      
      autoQueueConfig.isAutoPlaying = false;
    }, 1000); // 1 second delay
    
  } catch (error) {
    console.error('❌ Error in Auto-Queue:', error);
    autoQueueConfig.isAutoPlaying = false;
  }
}

// Stop all decks except the specified one (REMOVED - was causing issues with deck alternation)
// The auto-queue system should work by natural deck alternation, not by forcibly stopping other decks

// Count how many decks are currently playing
function countPlayingDecks(): number {
  const allDecks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  let playingCount = 0;
  
  allDecks.forEach(deck => {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    if (audio && !audio.paused && !audio.ended) {
      playingCount++;
      console.log(`🎵 Deck ${deck.toUpperCase()} is playing`);
    }
  });
  
  console.log(`🔢 Total playing decks: ${playingCount}`);
  return playingCount;
}

// Get next available song from queue (not assigned to any deck)
function getNextAvailableQueueItem(): QueueItem | null {
  return queue.find(item => item.assignedToDeck === null) || null;
}

// Get the next item in queue order (respecting sequence)
function getNextQueueItemInOrder(): QueueItem | null {
  // Find the first unassigned item in queue order
  return queue.find(item => item.assignedToDeck === null) || null;
}

// Check if the next item in queue is a microphone placeholder that should be activated now
function shouldActivateMicrophoneNow(): QueueItem | null {
  // Get the first item in queue order (not necessarily unassigned)
  const nextItemInOrder = getNextQueueItemInOrder();
  
  if (nextItemInOrder && isMicrophoneQueueItem(nextItemInOrder)) {
    const microphoneIndex = queue.findIndex(item => item.id === nextItemInOrder.id);
    console.log(`🎤 Next item in queue order is microphone at position ${microphoneIndex + 1} - ready to activate`);
    return nextItemInOrder;
  }
  
  // Also check if the very next item after assigned items is a microphone
  const nextUnassignedItem = queue.find(item => item.assignedToDeck === null);
  if (nextUnassignedItem && isMicrophoneQueueItem(nextUnassignedItem)) {
    // Check if all items before this microphone are already assigned/finished
    const microphoneIndex = queue.findIndex(item => item.id === nextUnassignedItem.id);
    const itemsBeforeMic = queue.slice(0, microphoneIndex);
    const playingDecks = countPlayingDecks();
    
    console.log(`🎤 Checking microphone at position ${microphoneIndex + 1}: ${itemsBeforeMic.length} items before, ${playingDecks} decks playing`);
    
    // If no decks are playing and all items before microphone are processed, activate
    if (playingDecks === 0) {
      console.log(`🎤 No decks playing - microphone at position ${microphoneIndex + 1} ready to activate`);
      return nextUnassignedItem;
    }
  }
  
  return null;
}

// Mark queue item as assigned to a deck
function assignQueueItemToDeck(queueItem: QueueItem, deck: 'a' | 'b' | 'c' | 'd') {
  queueItem.assignedToDeck = deck;
  queueItem.loadedAt = new Date();
  const itemTitle = isSongQueueItem(queueItem) && queueItem.song ? queueItem.song.title : 'Item';
  console.log(`📌 Assigned "${itemTitle}" to deck ${deck.toUpperCase()}`);
  updateQueueDisplay();
}

// Remove queue item by song (when track finishes or gets ejected)
function removeQueueItemBySong(song: OpenSubsonicSong) {
  const index = queue.findIndex(item => isSongQueueItem(item) && item.song?.id === song.id);
  if (index !== -1) {
    const removedItem = queue.splice(index, 1)[0];
    const itemTitle = isSongQueueItem(removedItem) && removedItem.song ? removedItem.song.title : 'Item';
    console.log(`🗑️ Removed "${itemTitle}" from queue`);
    
    // ========================================
    // 🎯 UNREGISTER SONG FROM LOCATION REGISTRY
    // ========================================
    if (isSongQueueItem(removedItem) && removedItem.song) {
      unregisterSongLocation(removedItem.song.id);
      console.log(`📍 [SongRegistry] Unregistered song ${removedItem.song.id} from queue`);
    }
    
    // CRITICAL: Auto-adjust queue order after removal
    autoAdjustQueueOrder();
    
    updateQueueDisplay();
    return removedItem;
  }
  return null;
}

// Auto-adjust queue order when songs are removed - reassign affected deck tracks
function autoAdjustQueueOrder() {
  console.log(`🔄 Auto-adjusting queue order after song removal`);
  
  // Get all active deck pairs
  const availableDecks: ('a' | 'b' | 'c' | 'd')[] = [];
  if (autoQueueConfig.deckPairAB) {
    availableDecks.push('a', 'b');
  }
  if (autoQueueConfig.deckPairCD) {
    availableDecks.push('c', 'd');
  }
  
  if (availableDecks.length === 0) {
    console.log('⏸️ No active deck pairs - no adjustment needed');
    return;
  }
  
  // Reset assignments for all non-playing/loading decks
  queue.forEach(item => {
    if (item.assignedToDeck) {
      const deckState = getDeckState(item.assignedToDeck);
      // Only reset if deck is not playing or loading - preserve active assignments
      if (deckState === 'empty' || deckState === 'ended' || deckState === 'error') {
        const oldDeck = item.assignedToDeck;
        item.assignedToDeck = null;
        console.log(`🔄 Reset assignment for deck ${oldDeck?.toUpperCase()} (state: ${deckState})`);
      }
    }
  });
  
  // Reassign songs to decks in optimal order
  reassignQueueToDecks();
  
  // Try to prepare any newly available decks
  prepareAllAvailableDecks();
}

// Start next deck with a new track from queue
function startNextDeckWithNewTrack(targetDeck: 'a' | 'b' | 'c' | 'd') {
  // Note: Microphone check is now handled in handleAutoQueue() BEFORE this function is called
  
  // Get next available song item (not assigned to any deck)
  const nextQueueItem = getNextQueueItemInOrder();
  if (!nextQueueItem) {
    console.log(`📭 No available items in queue to load onto deck ${targetDeck.toUpperCase()}`);
    return;
  }
  
  // Microphone placeholders are handled in handleAutoQueue() before this function is called
  
  // Ensure we have a song item with a valid song
  if (!isSongQueueItem(nextQueueItem) || !nextQueueItem.song) {
    console.error(`❌ Invalid song queue item for deck ${targetDeck.toUpperCase()}`);
    return;
  }
  
  // 🚫 DUPLICATE CHECK: Verify song is not already loaded on another deck (using registry)
  const songOnOtherDeck = isSongOnAnyDeck(nextQueueItem.song.id);
  if (songOnOtherDeck && songOnOtherDeck !== targetDeck) {
    console.warn(`⚠️ [SongRegistry] "${nextQueueItem.song.title}" already loaded on deck ${songOnOtherDeck.toUpperCase()}, skipping and trying next song`);
    
    // Remove this item from queue to avoid retrying
    const itemIndex = queue.findIndex(item => item.id === nextQueueItem.id);
    if (itemIndex !== -1) {
      queue.splice(itemIndex, 1);
      updateQueueDisplay();
      console.log(`🗑️ Removed duplicate queue item`);
    }
    
    // Try next song in queue
    setTimeout(() => {
      startNextDeckWithNewTrack(targetDeck);
    }, 100);
    return;
  }
  
  // Check if target deck is actually available for new content
  if (!isDeckAvailableForNewTrack(targetDeck)) {
    const targetState = getDeckState(targetDeck);
    console.log(`⚠️ Target deck ${targetDeck.toUpperCase()} not available (state: ${targetState})`);
    
    // If deck is still playing, wait for it to end
    if (targetState === 'playing') {
      console.log(`⏸️ Waiting for deck ${targetDeck.toUpperCase()} to finish before loading new track`);
      return;
    }
    
    // If deck ended, clear it first
    if (targetState === 'ended') {
      console.log(`🔄 Clearing ended deck ${targetDeck.toUpperCase()} before loading new track`);
      clearPlayerDeck(targetDeck);
    }
  }
  
  // Double-check that no other deck is playing before starting
  const playingCount = countPlayingDecks();
  if (playingCount > 0) {
    console.log(`⚠️ ${playingCount} deck(s) still playing, waiting before starting ${targetDeck.toUpperCase()}`);
    
    // Try again after a short delay
    setTimeout(() => {
      startNextDeckWithNewTrack(targetDeck);
    }, 1000);
    return;
  }
  
  console.log(`🔄 Loading and starting "${nextQueueItem.song.title}" on deck ${targetDeck.toUpperCase()}`);
  
  // Mark queue item as assigned to this deck
  assignQueueItemToDeck(nextQueueItem, targetDeck);
  
  // Load track with auto-play
  loadTrackToPlayer(targetDeck, nextQueueItem.song, true);
  
  console.log(`✅ Successfully started deck ${targetDeck.toUpperCase()}`);
}

// Prepare the next deck in sequence for seamless transitions - IMPROVED VERSION
function prepareNextDeckInSequence(currentDeck: 'a' | 'b' | 'c' | 'd') {
  console.log(`🎯 Starting deck preparation after ${currentDeck.toUpperCase()}`);
  
  // Use the comprehensive preparation function to maximize deck usage
  prepareAllAvailableDecks();
}

// IMPROVED: Prepare all available decks with maximum efficiency
async function prepareAllAvailableDecks() {
  console.log(`🎵 Comprehensive deck preparation - maximizing deck usage`);
  
  // Get all active deck pairs
  const availableDecks: ('a' | 'b' | 'c' | 'd')[] = [];
  if (autoQueueConfig.deckPairAB) {
    availableDecks.push('a', 'b');
  }
  if (autoQueueConfig.deckPairCD) {
    availableDecks.push('c', 'd');
  }
  
  if (availableDecks.length === 0) {
    console.log('⏸️ No active deck pairs for preparation');
    return;
  }
  
  // Get all songs that need preparation (skip microphones, get assigned but not loaded songs)
  const songsNeedingPreparation = queue.filter(item => 
    isSongQueueItem(item) && 
    item.song && 
    (item.assignedToDeck === null || (item.assignedToDeck && !getCurrentLoadedSong(item.assignedToDeck)))
  );
  
  console.log(`📋 Found ${songsNeedingPreparation.length} songs needing preparation`);
  
  // Find available decks (empty, ended, or error state)
  const availableForPreparation = availableDecks.filter(deck => isDeckAvailableForNewTrack(deck));
  
  console.log(`🛠️ Available decks for preparation: [${availableForPreparation.map(d => d.toUpperCase()).join(', ')}]`);
  
  // ========================================
  // 🔒 PREPARE DECKS SEQUENTIALLY, NOT IN PARALLEL
  // ========================================
  // This prevents multiple simultaneous loads which cause issues
  let preparationCount = 0;
  for (let i = 0; i < Math.min(availableForPreparation.length, songsNeedingPreparation.length); i++) {
    const deck = availableForPreparation[i];
    const songItem = songsNeedingPreparation[i];
    
    if (songItem.song) {
      // 🚫 DUPLICATE CHECK: Skip if song already loaded on another deck (using registry)
      const songOnOtherDeck = isSongOnAnyDeck(songItem.song.id);
      if (songOnOtherDeck && songOnOtherDeck !== deck) {
        console.warn(`⚠️ [SongRegistry] "${songItem.song.title}" already on deck ${songOnOtherDeck.toUpperCase()}, skipping preparation`);
        continue; // Skip this song, try next one
      }
      
      console.log(`🔄 Preparing "${songItem.song.title}" on deck ${deck.toUpperCase()}`);
      
      // Assign and load
      assignQueueItemToDeck(songItem, deck);
      loadTrackToPlayer(deck, songItem.song, false);
      preparationCount++;
      
      // ========================================
      // ⏳ WAIT FOR DECK TO FINISH LOADING
      // ========================================
      console.log(`⏳ [LoadingLock] Waiting for Deck ${deck.toUpperCase()} to finish loading...`);
      
      const maxWaitTime = 15000; // 15 seconds max wait
      const startWait = Date.now();
      
      while (isDeckLoading(deck) && (Date.now() - startWait) < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
      }
      
      if (isDeckLoading(deck)) {
        console.warn(`⚠️ [LoadingLock] Timeout waiting for Deck ${deck.toUpperCase()} - proceeding anyway`);
      } else {
        console.log(`✅ [LoadingLock] Deck ${deck.toUpperCase()} ready - proceeding to next deck`);
      }
    }
  }
  
  console.log(`✅ Prepared ${preparationCount} decks successfully (sequential loading)`);
}

// Get the next song item for deck preparation (skipping microphone placeholders)
function getNextSongForPreparation(): QueueItem | null {
  // Look for the next unassigned song item in queue order
  for (const item of queue) {
    if (item.assignedToDeck === null && isSongQueueItem(item) && item.song) {
      return item;
    }
  }
  return null;
}

// Determine the next deck based on configuration and rotation
function getNextDeck(finishedDeck: 'a' | 'b' | 'c' | 'd'): 'a' | 'b' | 'c' | 'd' | null {
  // Check which deck pairs are active
  const isABActive = autoQueueConfig.deckPairAB;
  const isCDActive = autoQueueConfig.deckPairCD;
  
  // If no deck pairs are active, return null
  if (!isABActive && !isCDActive) {
    return null;
  }
  
  // If only one deck pair is active, alternate within that pair
  if (isABActive && !isCDActive) {
    return finishedDeck === 'a' ? 'b' : 'a';
  }
  
  if (isCDActive && !isABActive) {
    return finishedDeck === 'c' ? 'd' : 'c';
  }
  
  // Both deck pairs are active - use full rotation A→B→C→D→A
  const rotationMap: Record<'a' | 'b' | 'c' | 'd', 'a' | 'b' | 'c' | 'd'> = {
    'a': 'b',
    'b': 'c', 
    'c': 'd',
    'd': 'a'
  };
  
  return rotationMap[finishedDeck];
}

// Simulate play button click to ensure all UI updates work correctly
function simulatePlayButtonClick(deck: 'a' | 'b' | 'c' | 'd'): boolean {
  const playPauseBtn = document.getElementById(`play-pause-${deck}`) as HTMLButtonElement;
  if (playPauseBtn) {
    playPauseBtn.click();
    console.log(`🎮 Simulated play button click for deck ${deck.toUpperCase()}`);
    return true;
  }
  console.error(`❌ Play button not found for deck ${deck.toUpperCase()}`);
  return false;
}

// Check if auto-queue is active (either deck pair)
function isAutoQueueActive(): boolean {
  return autoQueueConfig.deckPairAB || autoQueueConfig.deckPairCD;
}

// Check if auto-queue is active for a specific deck
function isAutoQueueActiveForDeck(deck: 'a' | 'b' | 'c' | 'd'): boolean {
  switch (deck) {
    case 'a':
    case 'b':
      return autoQueueConfig.deckPairAB;
    case 'c':
    case 'd':
      return autoQueueConfig.deckPairCD;
    default:
      return false;
  }
}

/**
 * Continuous Auto-Queue Watcher
 * Monitors all decks and automatically fills empty ones when auto-queue is active
 * Ensures queue order is always respected and maintained
 */
let autoQueueWatcherInterval: number | null = null;

function startAutoQueueWatcher() {
  if (autoQueueWatcherInterval !== null) {
    console.log('🔄 Auto-Queue Watcher already running');
    return;
  }
  
  console.log('👁️ Starting Auto-Queue Watcher...');
  
  // Check every 2 seconds
  autoQueueWatcherInterval = window.setInterval(() => {
    checkAndFillEmptyDecks();
  }, 2000);
  
  // Also start Queue Sync Watcher
  startQueueSyncWatcher();
}

function stopAutoQueueWatcher() {
  if (autoQueueWatcherInterval !== null) {
    console.log('⏹️ Stopping Auto-Queue Watcher');
    clearInterval(autoQueueWatcherInterval);
    autoQueueWatcherInterval = null;
  }
  
  // Also stop Queue Sync Watcher
  stopQueueSyncWatcher();
}

/**
 * Queue Sync Watcher
 * Continuously monitors that decks match the queue order
 * Protects playing songs from being ejected
 * Runs independently from fill watcher
 */
let queueSyncWatcherInterval: number | null = null;
let queueSyncTrigger: { pending: boolean; reason: string; timestamp: number } = { 
  pending: false, 
  reason: '', 
  timestamp: 0 
};

function startQueueSyncWatcher() {
  if (queueSyncWatcherInterval !== null) {
    return;
  }
  
  console.log('🔄 Starting Queue Sync Watcher...');
  
  // Check every 500ms for pending syncs (more responsive)
  queueSyncWatcherInterval = window.setInterval(() => {
    if (queueSyncTrigger.pending) {
      const now = Date.now();
      const elapsed = now - queueSyncTrigger.timestamp;
      
      // Wait at least 200ms before executing (debounce)
      if (elapsed >= 200) {
        console.log(`⚡ Queue Sync Watcher: Executing pending sync (reason: ${queueSyncTrigger.reason})`);
        validateAndFixRotation();
        queueSyncTrigger.pending = false;
      }
    }
  }, 500);
}

function stopQueueSyncWatcher() {
  if (queueSyncWatcherInterval !== null) {
    console.log('⏹️ Stopping Queue Sync Watcher');
    clearInterval(queueSyncWatcherInterval);
    queueSyncWatcherInterval = null;
    queueSyncTrigger.pending = false;
  }
}

// ========================================
// 🎵 PLAY HISTORY UPDATE WATCHER
// ========================================
// Updates recently-played scribbles every 30 seconds for smooth fade effect

let playHistoryUpdateInterval: number | null = null;

function startPlayHistoryUpdateWatcher() {
  if (playHistoryUpdateInterval !== null) {
    console.log('⚠️ Play History Update Watcher already running');
    return;
  }
  
  console.log('▶️ Starting Play History Update Watcher (30s interval)');
  
  playHistoryUpdateInterval = window.setInterval(() => {
    // Silently update library markers to reflect fading scribbles
    markSongsInLibrary();
  }, 30000); // 30 seconds
}

function stopPlayHistoryUpdateWatcher() {
  if (playHistoryUpdateInterval !== null) {
    console.log('⏹️ Stopping Play History Update Watcher');
    clearInterval(playHistoryUpdateInterval);
    playHistoryUpdateInterval = null;
  }
}

/**
 * Trigger a queue sync (debounced)
 * This is called after queue changes to ensure decks match queue order
 */
function triggerQueueSync(reason: string) {
  console.log(`🎯 Queue Sync Triggered: ${reason}`);
  queueSyncTrigger = {
    pending: true,
    reason: reason,
    timestamp: Date.now()
  };
}

/**
 * Check all decks and fill empty ones with tracks from queue
 * Respects the rotation order: A→B→C→D→A
 * ENSURES CORRECT ROTATION BY REORGANIZING IF NEEDED
 */
/**
 * ========================================
 * 🎯 NEW ARCHITECTURE: CHECK AND LET EMPTY DECKS REQUEST SONGS
 * ========================================
 * This function checks which decks are empty and in active rotation,
 * then lets THEM request songs from the queue (PULL architecture)
 * 
 * ⚠️ IMPORTANT: Only fills decks if at least one deck is playing
 *    This prevents auto-filling when user is just building queue
 * 
 * ⚠️ CRITICAL CHANGE: Decks are NOT auto-filled just because they're empty!
 *    Songs are only loaded when explicitly requested via handleAutoQueue()
 *    This function ONLY validates existing songs and clears invalid ones
 * 
 * This is the main auto-queue watcher function
 */
function checkAndFillEmptyDecks() {
  // Only run if auto-queue is active for at least one deck pair
  if (!isAutoQueueActive()) {
    return;
  }
  
  // Skip if no queue items available
  if (queue.length === 0) {
    return;
  }
  
  // ========================================
  // 🎯 CRITICAL: Only auto-fill if at least one deck is playing
  // ========================================
  // This prevents auto-filling when user is just building the queue
  // Songs should only be loaded when playback is active
  const playingCount = countPlayingDecks();
  if (playingCount === 0) {
    console.log(`⏸️ [Auto-Queue] No decks playing - skipping auto-fill (user is building queue)`);
    return;
  }
  
  // FIRST: Validate and fix rotation if needed
  validateAndFixRotation();
  
  // Define rotation order based on active deck pairs
  const rotationOrder = getActiveRotationOrder();
  
  // ========================================
  // 🎯 NEW BEHAVIOR: ONLY VALIDATE, DON'T AUTO-FILL
  // ========================================
  // We no longer auto-fill empty decks here
  // Songs are ONLY loaded via explicit calls from handleAutoQueue()
  console.log(`🔍 [Auto-Queue] Validating decks (${playingCount} deck(s) playing)...`);
  
  for (const deck of rotationOrder) {
    const deckState = getDeckState(deck);
    const currentSong = getCurrentLoadedSong(deck);
    
    // ========================================
    // ✅ ONLY VALIDATE: Check if deck has invalid song
    // ========================================
    if (currentSong) {
      // ❌ CRITICAL FIX: NEVER clear a deck that is playing or paused!
      // Playing/paused decks are actively in use and should NEVER be touched
      const audio = getAudioElement(deck);
      const isPlaying = audio && !audio.paused;
      
      if (deckState === 'playing' || deckState === 'paused' || isPlaying) {
        console.log(`🎵 [Auto-Queue] Deck ${deck.toUpperCase()} is ${deckState} "${currentSong.title}" - PROTECTED`);
        continue; // Skip this deck completely - it's in active use!
      }
      
      // ✅ NEW: Use Song Location Registry instead of checking queue
      // Songs are MOVED from queue to deck, so they won't be in queue anymore
      // But they're still registered in the location registry as being on this deck
      const songLocation = getSongLocation(currentSong.id);
      
      if (!songLocation || songLocation.type === 'nowhere') {
        // Song is not registered anywhere - this shouldn't happen but clear deck to be safe
        console.log(`🔄 [Auto-Queue] Deck ${deck.toUpperCase()} has unregistered song - clearing deck`);
        clearPlayerDeck(deck);
      } else if (songLocation.type === 'deck' && songLocation.deck === deck) {
        // Song is correctly registered on this deck - everything is fine!
        console.log(`✅ [Auto-Queue] Deck ${deck.toUpperCase()} has valid song "${currentSong.title}" (${deckState})`);
      } else {
        // Song is registered elsewhere - this is a sync error, clear the deck
        console.warn(`⚠️ [Auto-Queue] Deck ${deck.toUpperCase()} has song registered on ${songLocation.type} - clearing deck`);
        clearPlayerDeck(deck);
      }
    } else {
      // Deck is empty - that's OK, don't auto-fill
      console.log(`⚪ [Auto-Queue] Deck ${deck.toUpperCase()} is ${deckState} - waiting for explicit request`);
    }
  }
}

/**
 * Get active rotation order based on which deck pairs are active
 */
function getActiveRotationOrder(): ('a' | 'b' | 'c' | 'd')[] {
  const isABActive = autoQueueConfig.deckPairAB;
  const isCDActive = autoQueueConfig.deckPairCD;
  
  if (isABActive && isCDActive) {
    // Both active: A→B→C→D
    return ['a', 'b', 'c', 'd'];
  } else if (isABActive) {
    // Only A+B: A→B
    return ['a', 'b'];
  } else if (isCDActive) {
    // Only C+D: C→D
    return ['c', 'd'];
  }
  
  return [];
}

/**
 * Validate rotation and fix if songs are on wrong decks
 * This ensures the queue order matches the deck rotation
 * PROTECTS PLAYING SONGS - they will NEVER be ejected
 */
function validateAndFixRotation() {
  console.log(`\n🔍 ═══════════════════════════════════════════════════════════`);
  console.log(`🎯 VALIDATING DECK ROTATION`);
  
  const rotationOrder = getActiveRotationOrder();
  
  if (rotationOrder.length === 0) {
    console.log(`   ⏸️ No active decks - SKIP`);
    console.log(`🔍 ═══════════════════════════════════════════════════════════\n`);
    return; // No active decks
  }
  
  console.log(`   Active Rotation: [${rotationOrder.map(d => d.toUpperCase()).join(' → ')}]`);
  
  // Log current deck states
  console.log(`   Current Deck States:`);
  for (const deck of rotationOrder) {
    const currentSong = getCurrentLoadedSong(deck);
    const deckState = getDeckState(deck);
    const isPlaying = isDeckPlaying(deck);
    
    if (currentSong) {
      console.log(`      Deck ${deck.toUpperCase()}: "${currentSong.title}" [${deckState}${isPlaying ? ', PLAYING' : ''}]`);
    } else {
      console.log(`      Deck ${deck.toUpperCase()}: Empty [${deckState}]`);
    }
  }
  
  // Get all songs currently assigned to decks (in queue order)
  const assignedSongs: Array<{ queueItem: QueueItem; expectedDeck: 'a' | 'b' | 'c' | 'd' | null; currentDeck: 'a' | 'b' | 'c' | 'd' | null }> = [];
  
  let rotationIndex = 0;
  
  console.log(`   Expected Deck Assignments (from queue):`);
  for (const item of queue) {
    if (!isSongQueueItem(item) || !item.song) continue;
    
    // Expected deck based on rotation order
    const expectedDeck = rotationOrder[rotationIndex % rotationOrder.length];
    
    // Current deck assignment (handle both null and undefined)
    const currentDeck = item.assignedToDeck ?? null;
    
    console.log(`      Position ${rotationIndex}: "${item.song.title}" → Should be on Deck ${expectedDeck.toUpperCase()} (currently: ${currentDeck ? `Deck ${currentDeck.toUpperCase()}` : 'unassigned'})`);
    
    assignedSongs.push({
      queueItem: item,
      expectedDeck: expectedDeck,
      currentDeck: currentDeck
    });
    
    rotationIndex++;
  }
  
  // Check if any song is on the wrong deck and fix it
  let needsReorganization = false;
  
  console.log(`   Checking for mismatches...`);
  for (const assignment of assignedSongs) {
    if (assignment.currentDeck !== null && 
        assignment.expectedDeck !== null &&
        assignment.expectedDeck !== assignment.currentDeck &&
        rotationOrder.includes(assignment.currentDeck)) {
      
      needsReorganization = true;
      console.log(`      ❌ MISMATCH: "${assignment.queueItem.song?.title}" on Deck ${assignment.currentDeck.toUpperCase()} but should be on ${assignment.expectedDeck.toUpperCase()}`);
    }
  }
  
  if (!needsReorganization) {
    console.log(`      ✅ All assignments correct`);
  }
  
  if (needsReorganization) {
    console.log(`   🔄 Reorganization needed - triggering...`);
    reorganizeDecksToMatchRotation(assignedSongs, rotationOrder);
  } else {
    console.log(`   ✅ No reorganization needed`);
  }
  
  console.log(`🔍 ═══════════════════════════════════════════════════════════\n`);
}

/**
 * Reorganize decks to match correct rotation order
 * Ejects songs from wrong decks and reassigns them
 * PROTECTS PLAYING SONGS - they will NEVER be ejected
 * PREVENTS EJECT-LOAD LOOPS by checking if song is already correct
 */
function reorganizeDecksToMatchRotation(
  assignedSongs: Array<{ queueItem: QueueItem; expectedDeck: 'a' | 'b' | 'c' | 'd' | null; currentDeck: 'a' | 'b' | 'c' | 'd' | null }>,
  rotationOrder: ('a' | 'b' | 'c' | 'd')[]
) {
  console.log(`\n🔧 ═══════════════════════════════════════════════════════════`);
  console.log(`🔄 REORGANIZING DECKS TO MATCH QUEUE ORDER`);
  
  // Step 0: Identify playing decks (MUST BE PROTECTED!)
  const playingDecks = new Set<'a' | 'b' | 'c' | 'd'>();
  for (const deck of rotationOrder) {
    if (isDeckPlaying(deck)) {
      const playingSong = getCurrentLoadedSong(deck);
      playingDecks.add(deck);
      console.log(`   🛡️ PROTECTED: Deck ${deck.toUpperCase()} is playing "${playingSong?.title}" - will NOT be ejected`);
    }
  }
  
  // Step 1: Build a map of what SHOULD be on each deck
  console.log(`   Step 1: Building expected deck content map...`);
  const expectedDeckContent = new Map<'a' | 'b' | 'c' | 'd', string | null>();
  for (const deck of rotationOrder) {
    expectedDeckContent.set(deck, null);
  }
  
  for (const assignment of assignedSongs) {
    if (assignment.expectedDeck && assignment.queueItem.song) {
      const expectedSongId = assignment.queueItem.song.id;
      expectedDeckContent.set(assignment.expectedDeck, expectedSongId);
      console.log(`      Deck ${assignment.expectedDeck.toUpperCase()} should have: "${assignment.queueItem.song.title}" (ID: ${expectedSongId})`);
    }
  }
  
  // Step 2: Find ALL decks that need changes (eject OR load)
  console.log(`   Step 2: Checking which decks need changes...`);
  const decksToEject = new Set<'a' | 'b' | 'c' | 'd'>();
  
  // Check all active decks for mismatches
  for (const deck of rotationOrder) {
    const currentSong = getCurrentLoadedSong(deck);
    const expectedSongId = expectedDeckContent.get(deck);
    
    // CRITICAL: Never eject playing decks!
    if (playingDecks.has(deck)) {
      console.log(`      Deck ${deck.toUpperCase()}: PLAYING - skipping (protected)`);
      continue;
    }
    
    // Deck has a song but shouldn't have it OR has wrong song
    if (currentSong) {
      if (expectedSongId === null || currentSong.id !== expectedSongId) {
        const expectedSongName = assignedSongs.find(a => a.expectedDeck === deck)?.queueItem.song?.title || 'empty';
        console.log(`      Deck ${deck.toUpperCase()}: Has "${currentSong.title}" but should have "${expectedSongName}" → EJECT`);
        decksToEject.add(deck);
      } else {
        console.log(`      Deck ${deck.toUpperCase()}: Has correct song "${currentSong.title}" → KEEP`);
      }
    }
    // Deck is empty but should have a song
    else if (expectedSongId !== null) {
      const expectedSongName = assignedSongs.find(a => a.expectedDeck === deck)?.queueItem.song?.title || 'unknown';
      console.log(`      Deck ${deck.toUpperCase()}: Empty but should have "${expectedSongName}" → LOAD`);
      // Don't add to eject set, we'll load it in step 4
    } else {
      console.log(`      Deck ${deck.toUpperCase()}: Empty and should be empty → OK`);
    }
  }
  
  // If no decks need ejecting, check if any need loading
  if (decksToEject.size === 0) {
    console.log(`   No decks need ejecting, checking if any need loading...`);
    // Check if all expected songs are loaded
    let allCorrect = true;
    for (const deck of rotationOrder) {
      const currentSong = getCurrentLoadedSong(deck);
      const expectedSongId = expectedDeckContent.get(deck);
      
      if (expectedSongId !== null && (!currentSong || currentSong.id !== expectedSongId)) {
        allCorrect = false;
        break;
      }
    }
    
    if (allCorrect) {
      console.log(`   ✅ All decks already correct, no action needed`);
      console.log(`🔧 ═══════════════════════════════════════════════════════════\n`);
      return;
    }
  }
  
  // Step 3: Eject songs from wrong decks (PROTECTED songs are already filtered out)
  console.log(`   Step 3: Ejecting wrong songs from decks...`);
  for (const deck of decksToEject) {
    const loadedSong = getCurrentLoadedSong(deck);
    if (loadedSong) {
      console.log(`      �️ Ejecting "${loadedSong.title}" from Deck ${deck.toUpperCase()}`);
      clearPlayerDeck(deck);
      
      // Unassign the song in queue
      const queueItem = queue.find(item => 
        isSongQueueItem(item) && item.song?.id === loadedSong.id
      );
      if (queueItem) {
        queueItem.assignedToDeck = null;
        console.log(`         Unassigned "${loadedSong.title}" from queue`);
      }
    }
  }
  
  // Step 4: Load correct songs to decks (only if different from current)
  console.log(`   Step 4: Loading correct songs to decks...`);
  for (const assignment of assignedSongs) {
    if (assignment.expectedDeck && assignment.queueItem.song) {
      const deckState = getDeckState(assignment.expectedDeck);
      const currentSong = getCurrentLoadedSong(assignment.expectedDeck);
      
      // Skip if this deck is playing (protected)
      if (playingDecks.has(assignment.expectedDeck)) {
        console.log(`      Deck ${assignment.expectedDeck.toUpperCase()}: Playing - skipping load (protected)`);
        continue;
      }
      
      // Only load if deck is empty OR has a different song
      if (deckState === 'empty' || !currentSong) {
        console.log(`      📥 Loading "${assignment.queueItem.song.title}" to Deck ${assignment.expectedDeck.toUpperCase()}`);
        assignment.queueItem.assignedToDeck = assignment.expectedDeck;
        loadTrackToPlayer(assignment.expectedDeck, assignment.queueItem.song, false);
      } else if (currentSong.id === assignment.queueItem.song.id) {
        // Song is already correct, just update assignment
        console.log(`      ✓ Deck ${assignment.expectedDeck.toUpperCase()} already has "${currentSong.title}", updating assignment only`);
        assignment.queueItem.assignedToDeck = assignment.expectedDeck;
      } else {
        console.log(`      ⚠️ Deck ${assignment.expectedDeck.toUpperCase()} has "${currentSong.title}" but should have "${assignment.queueItem.song.title}" - was this missed?`);
      }
    }
  }
  
  updateQueueDisplay();
  console.log(`   ✅ Reorganization complete`);
  console.log(`🔧 ═══════════════════════════════════════════════════════════\n`);
}

/**
 * Get the currently playing deck
 */
function getCurrentPlayingDeck(): 'a' | 'b' | 'c' | 'd' | null {
  const decks: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
  
  for (const deck of decks) {
    const state = getDeckState(deck);
    if (state === 'playing') {
      return deck;
    }
  }
  
  return null;
}

/**
 * ========================================
 * 🎯 NEW ARCHITECTURE: PULL-BASED SONG REQUEST
 * ========================================
 * Deck requests a song from the queue when it's empty
 * This is the ONLY way decks should get songs in auto-play mode
 * 
 * @param deck - The deck requesting a song
 * @returns true if song was loaded, false if not available
 */
function requestSongForDeck(deck: 'a' | 'b' | 'c' | 'd'): boolean {
  console.log(`🎯 [PULL] Deck ${deck.toUpperCase()} requesting song from queue`);
  
  // ========================================
  // 1️⃣ CHECK: Is deck in active rotation?
  // ========================================
  const rotationOrder = getActiveRotationOrder();
  if (!rotationOrder.includes(deck)) {
    console.log(`⚠️ [PULL] Deck ${deck.toUpperCase()} is not in active rotation - request denied`);
    return false;
  }
  
  // ========================================
  // 2️⃣ CHECK: Does deck already have a song?
  // ========================================
  const currentSong = getCurrentLoadedSong(deck);
  if (currentSong) {
    console.log(`⚠️ [PULL] Deck ${deck.toUpperCase()} already has song "${currentSong.title}" - request denied`);
    return false;
  }
  
  // ========================================
  // 3️⃣ CHECK: Is deck truly empty?
  // ========================================
  const deckState = getDeckState(deck);
  if (deckState !== 'empty' && deckState !== 'ended' && deckState !== 'error') {
    console.log(`⚠️ [PULL] Deck ${deck.toUpperCase()} is not empty (state: ${deckState}) - request denied`);
    return false;
  }
  
  // ========================================
  // 4️⃣ FIND: Get next available song for this deck position
  // ========================================
  const deckIndex = rotationOrder.indexOf(deck);
  
  // Count how many songs are already assigned before this deck position
  let songsBeforeThisDeck = 0;
  for (let i = 0; i < deckIndex; i++) {
    const priorDeck = rotationOrder[i];
    const hasSong = queue.some(item => 
      isSongQueueItem(item) && item.assignedToDeck === priorDeck
    );
    if (hasSong) {
      songsBeforeThisDeck++;
    }
  }
  
  // Find the Nth unassigned song in queue (where N = songsBeforeThisDeck + 1)
  let unassignedCount = 0;
  let targetSongItem: QueueItem | null = null;
  
  for (const item of queue) {
    if (!isSongQueueItem(item) || !item.song) continue;
    
    if (item.assignedToDeck === null) {
      // Skip blacklisted genres during streaming
      if (azuraCastWebcaster?.getConnectionStatus() && hasBlacklistedGenre(item.song)) {
        console.warn(`🚫 [PULL] Skipping blacklisted song: "${item.song.title}" (${item.song.genre})`);
        continue;
      }
      
      if (unassignedCount === songsBeforeThisDeck) {
        targetSongItem = item;
        break;
      }
      unassignedCount++;
    }
  }
  
  // Fallback: If no song found at exact position, take first available
  if (!targetSongItem) {
    targetSongItem = queue.find(item => {
      if (!isSongQueueItem(item) || item.assignedToDeck !== null || !item.song) {
        return false;
      }
      
      // Skip blacklisted genres during streaming
      if (azuraCastWebcaster?.getConnectionStatus() && hasBlacklistedGenre(item.song)) {
        console.warn(`🚫 [PULL] Skipping blacklisted song in fallback: "${item.song.title}" (${item.song.genre})`);
        return false;
      }
      
      return true;
    }) || null;
  }
  
  if (!targetSongItem || !isSongQueueItem(targetSongItem) || !targetSongItem.song) {
    console.log(`⚠️ [PULL] No available songs in queue for deck ${deck.toUpperCase()}`);
    return false;
  }
  
  // ========================================
  // 5️⃣ CHECK: Is song already on another deck? (should never happen with registry)
  // ========================================
  const songOnOtherDeck = isSongOnAnyDeck(targetSongItem.song.id);
  if (songOnOtherDeck && songOnOtherDeck !== deck) {
    console.error(`❌ [PULL] Song "${targetSongItem.song.title}" already on deck ${songOnOtherDeck.toUpperCase()} - REGISTRY ERROR!`);
    
    // Mark this song as already assigned to prevent retrying
    targetSongItem.assignedToDeck = songOnOtherDeck;
    updateQueueDisplay();
    return false;
  }
  
  // ========================================
  // 6️⃣ LOAD: Assign and load song to deck
  // ========================================
  console.log(`✅ [PULL] Loading "${targetSongItem.song.title}" to deck ${deck.toUpperCase()}`);
  
  targetSongItem.assignedToDeck = deck;
  loadTrackToPlayer(deck, targetSongItem.song, false);
  updateQueueDisplay();
  
  return true;
}

/**
/**
 * [DEPRECATED] Old push-based fill function - kept for compatibility
 * Use requestSongForDeck() instead for pull-based architecture
 */
function fillDeckFromQueue(deck: 'a' | 'b' | 'c' | 'd') {
  console.warn(`⚠️ [DEPRECATED] fillDeckFromQueue() called - use requestSongForDeck() instead`);
  return requestSongForDeck(deck);
}

function addMicrophoneToQueue() {
  const micItem = createMicrophoneQueueItem();
  queue.push(micItem);
  console.log('🎤 Microphone placeholder added to queue');
  updateQueueDisplay();
}

// Song aus Queue entfernen (manual removal by user)
function removeFromQueue(index: number) {
  if (index >= 0 && index < queue.length) {
    const removedItem = queue.splice(index, 1)[0];
    updateQueueDisplay();
    if (isSongQueueItem(removedItem)) {
      console.log(`Song "${removedItem.song.title}" removed from queue`);
    } else if (isMicrophoneQueueItem(removedItem)) {
      console.log('🎤 Microphone placeholder removed from queue');
    }
  }
}

// Move a queue item to the end of the queue (used when manually ejecting from deck)
// If song is not in queue, add it
function moveQueueItemToEnd(song: OpenSubsonicSong, animated: boolean = true) {
  const index = queue.findIndex(item => isSongQueueItem(item) && item.song?.id === song.id);
  
  if (index === -1) {
    // Song not in queue, add it to the end
    console.log(`➕ Adding song "${song.title}" to queue (was not in queue)`);
    const newItem = createSongQueueItem(song);
    queue.push(newItem);
    updateQueueDisplay();
    return;
  }
  
  // Don't move if already at the end
  if (index === queue.length - 1) {
    console.log(`📌 Song "${song.title}" already at end of queue`);
    return;
  }
  
  // Get the item and reset its deck assignment
  const item = queue[index];
  if (isSongQueueItem(item)) {
    item.assignedToDeck = null;
  }
  
  // Remove from current position
  const [movedItem] = queue.splice(index, 1);
  
  // Add to end
  queue.push(movedItem);
  
  console.log(`🔄 Moved "${song.title}" to end of queue (animated: ${animated})`);
  
  // Update display with animation
  if (animated) {
    // Add a CSS class to trigger animation
    updateQueueDisplay();
    
    // Find the moved item in the DOM and add animation class
    setTimeout(() => {
      const queueContainer = document.getElementById('queue-items');
      if (queueContainer) {
        const items = queueContainer.querySelectorAll('.queue-item-wrapper');
        const lastItem = items[items.length - 1];
        if (lastItem) {
          lastItem.classList.add('queue-item-moved-to-end');
          setTimeout(() => {
            lastItem.classList.remove('queue-item-moved-to-end');
          }, 600);
        }
      }
    }, 50);
  } else {
    updateQueueDisplay();
  }
}

// Globale Funktion für HTML onclick
(window as any).removeFromQueue = removeFromQueue;

// OpenSubsonic Login initialisieren - Dynamic field visibility
function initializeOpenSubsonicLogin() {
  console.log('🔐 Initializing dynamic login form...');
  
  const loginBtn = document.getElementById('OpenSubsonic-login-btn') as HTMLButtonElement;
  const loginForm = document.getElementById('OpenSubsonic-login') as HTMLElement;
  const djControls = document.getElementById('dj-controls') as HTMLElement;
  
  // Get environment configuration
  const envOpenSubsonicUrl = getConfigValue('VITE_OPENSUBSONIC_URL');
  const envAzuraCastServers = getConfigValue('VITE_AZURACAST_SERVERS');
  const useUnifiedLogin = getConfigValue('VITE_USE_UNIFIED_LOGIN') === 'true';
  
  // Get UI elements
  const unifiedLoginSection = document.getElementById('unified-login-section') as HTMLElement;
  const individualLoginSections = document.getElementById('individual-login-sections') as HTMLElement;
  const unifiedUsernameInput = document.getElementById('unified-username') as HTMLInputElement;
  const unifiedPasswordInput = document.getElementById('unified-password') as HTMLInputElement;
  
  // Individual form elements
  const serverInput = document.getElementById('OpenSubsonic-server') as HTMLInputElement;
  const usernameInput = document.getElementById('OpenSubsonic-username') as HTMLInputElement;
  const passwordInput = document.getElementById('OpenSubsonic-password') as HTMLInputElement;
  const streamServerInput = document.getElementById('stream-server-url') as HTMLInputElement;
  const streamUsernameInput = document.getElementById('stream-username') as HTMLInputElement;
  const streamPasswordInput = document.getElementById('stream-password') as HTMLInputElement;
  
  console.log(`🔧 Login Mode: ${useUnifiedLogin ? 'Unified' : 'Individual'}`);
  
  if (useUnifiedLogin) {
    // Show unified login interface
    if (unifiedLoginSection) unifiedLoginSection.style.display = 'block';
    if (individualLoginSections) individualLoginSections.style.display = 'none';
    
    // Check server-side if unified credentials are configured for auto-login
    console.log('🔑 Checking unified login configuration on server...');
    
    (async () => {
      try {
        const response = await fetch('/api/unified-login/check');
        const loginConfig = response.ok ? await response.json() : { canAutoLogin: false };
        
        console.log('🔑 Unified Auto-Login Check:', {
          enabled: loginConfig.enabled,
          configured: loginConfig.configured,
          canAutoLogin: loginConfig.canAutoLogin,
          hasUrl: !!envOpenSubsonicUrl
        });
        
        // Auto-login if credentials are configured server-side and URL is available
        if (loginConfig.canAutoLogin && envOpenSubsonicUrl) {
          console.log('🚀 Unified Auto-Login: Server-side credentials configured, attempting auto-login...');
          
          // Hide login form immediately and show DJ controls
          if (loginForm) loginForm.style.display = 'none';
          if (djControls) djControls.style.display = 'flex';
          
          // Perform auto-login - fetch credentials from server
          setTimeout(async () => {
            autoLoginInProgress = true;
            
            try {
              // Fetch credentials from server-side
              const authResponse = await fetch('/api/opensubsonic/auth', { method: 'POST' });
              if (!authResponse.ok) {
                throw new Error('Failed to fetch server-side credentials');
              }
              
              const authData = await authResponse.json();
              
              openSubsonicClient = new SubsonicApiClient({
                serverUrl: authData.serverUrl,
                username: authData.username,
                password: '' // Not needed, we have token+salt from server
              });
              
              // Set pre-generated token and salt from server
              (openSubsonicClient as any).token = authData.token;
              (openSubsonicClient as any).salt = authData.salt;
          
          const authenticated = await openSubsonicClient.authenticate();
          
          if (authenticated) {
            console.log("✅ Unified Auto-Login successful!");
            
            isOpenSubsonicLoggedIn = true;
            autoLoginInProgress = false;
            
            updateUserStatus('opensubsonic', authData.username, true);
            
            // Reveal only the mixer-area wishbox (frame) if decks C+D are visible
            try {
              if (wishboxFrame && deckConfig.getUserPreference()) wishboxFrame.style.display = '';
            } catch (e) {
              if (wishboxFrame) wishboxFrame.style.display = '';
            }
            
            // Configure streaming with unified credentials
            if (envAzuraCastServers) {
              streamConfig.username = authData.username;
              streamConfig.password = authData.password || '';
              updateUserStatus('stream', authData.username, true);
            }
            // Mark body as logged-in so CSS can reveal auth-only UI
            try { document.body.classList.add('logged-in'); } catch (e) {}
            
            // Initialize systems
            initializeLiveStreaming();
            
            // Auto-initialize microphone
            try {
              if (!audioContext) await initializeAudioMixing();
              if (audioContext && audioContext.state === 'suspended') await audioContext.resume();
              
              const micReady = await setupMicrophone();
              if (micReady) {
                setMicrophoneEnabled(false);
                // Volume meter is automatically initialized via initializeVolumeMeters()
              }
            } catch (error) {
              console.warn("⚠️ Microphone auto-initialization failed:", error);
            }
            
            // Initialize music library
            await initializeMusicLibrary();
            
          } else {
            console.error("❌ Unified Auto-Login failed - showing login form");
            autoLoginInProgress = false;
            if (loginForm) loginForm.style.display = 'flex';
            if (djControls) djControls.style.display = 'none';
          }
          
        } catch (error) {
          console.error("❌ Unified Auto-Login error:", error);
          autoLoginInProgress = false;
          if (loginForm) loginForm.style.display = 'flex';
          if (djControls) djControls.style.display = 'none';
        }
      }, 100);
        
      } else {
        console.log('ℹ️ Unified Auto-Login skipped - credentials not configured server-side');
      }
      
      } catch (error) {
        console.error('❌ Failed to check unified login configuration:', error);
      }
    })(); // End of async IIFE
    
    console.log('✅ Unified login interface activated');
  } else {
    // Show individual login interface
    if (unifiedLoginSection) unifiedLoginSection.style.display = 'none';
    if (individualLoginSections) individualLoginSections.style.display = 'block';
    
    // Pre-fill URLs if available (but keep them editable)
    if (serverInput && envOpenSubsonicUrl) serverInput.value = envOpenSubsonicUrl;
    if (streamServerInput && envAzuraCastServers) streamServerInput.value = envAzuraCastServers;
    
    console.log('✅ Individual login interface activated');
  }
  
  // Clean up any existing unified info
  const existingUnifiedInfo = loginForm.querySelector('.unified-login-info');
  if (existingUnifiedInfo) {
    existingUnifiedInfo.remove();
  }
  
  // Internal login function
  const performLogin = async (serverUrl: string, username: string, password: string) => {
    if (!username || !password) {
      console.log('❌ Please enter username and password');
      return;
    }
    
    try {
      console.log('🔄 Connecting to OpenSubsonic...');
      if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';
      }
      
      // Create OpenSubsonic Client with credentials
      openSubsonicClient = new SubsonicApiClient({
        serverUrl: serverUrl,
        username: username,
        password: password
      });
      
      const authenticated = await openSubsonicClient.authenticate();
      
      if (authenticated) {
        console.log("✅ OpenSubsonic connected successfully!");
        
        // Update login state
        isOpenSubsonicLoggedIn = true;
        autoLoginInProgress = false;
        
        // Update OpenSubsonic user status
        updateUserStatus('opensubsonic', username, true);
        
        // Reveal only the mixer-area wishbox (frame) if decks C+D are visible
        try {
          if (wishboxFrame && deckConfig.getUserPreference()) wishboxFrame.style.display = '';
        } catch (e) {
          if (wishboxFrame) wishboxFrame.style.display = '';
        }
        // Mark body as logged-in so CSS can reveal auth-only UI
        try { document.body.classList.add('logged-in'); } catch (e) {}
        
        // Configure streaming with unified or individual credentials
        if (useUnifiedLogin && envAzuraCastServers) {
          // Unified login: use the same credentials for streaming
          streamConfig.username = username;
          streamConfig.password = password;
          console.log(`🎙️ Stream configuration updated with unified credentials for: ${username}`);
          updateUserStatus('stream', username, true);
        } else {
          console.log('ℹ️ Stream configuration: Individual login mode or no AzuraCast servers configured');
        }
        
        // Hide login form, show DJ controls
        loginForm.style.display = 'none';
        djControls.style.display = 'flex';
        
        // 🔧 ELECTRON FIX: Initialize AudioContext BEFORE any track loading
        // This prevents the race condition crash that occurs when AudioContext is created
        // at the same time as audio streams are being loaded
        console.log("🎵 Pre-initializing AudioContext to prevent Electron crash...");
        try {
          if (!audioContext) {
            await initializeAudioMixing();
            console.log("✅ AudioContext pre-initialized successfully");
          }
        } catch (error) {
          console.error("⚠️ AudioContext pre-initialization failed:", error);
        }
        
        // Initialize Live Streaming functionality (after DJ controls are visible)
        initializeLiveStreaming();
        
        // 🔧 ELECTRON FIX: Don't auto-initialize microphone after login
        // The getUserMedia() call crashes Electron when combined with track loading
        // User must manually activate microphone by clicking the microphone button
        console.log("🎤 Microphone initialization deferred - user must activate manually");
        console.log("🎤 Click the microphone button to activate microphone input");
        // The microphone setup button handler will call setupMicrophone() when clicked
        
        // Initialize music library
        console.log("🎵 About to call initializeMusicLibrary...");
        await initializeMusicLibrary();
        console.log("🎵 Finished calling initializeMusicLibrary");
        
        console.log("📊 Final state check:");
        console.log("  - libraryBrowser exists:", !!libraryBrowser);
        console.log("  - browse-content element:", !!document.getElementById('browse-content'));
        console.log("  - openSubsonicClient exists:", !!openSubsonicClient);
        console.log("  - streamConfig:", streamConfig);
        
      } else {
        console.log('❌ Login failed - Wrong username or password');
        // Reset login state
        isOpenSubsonicLoggedIn = false;
        autoLoginInProgress = false;
        
        // Reset user status indicators
        updateUserStatus('opensubsonic', '-', false);
        // Stream status removed (streaming functionality removed)
        
        if (loginBtn) {
          loginBtn.textContent = 'Login Failed';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
  // Ensure mixer-area wishbox remains hidden on failed login
  if (wishboxFrame) wishboxFrame.style.display = 'none';
  try { document.body.classList.remove('logged-in'); } catch (e) {}
      }
      
    } catch (error) {
      console.error("❌ OpenSubsonic connection error:", error);
      // Reset login state on error
      isOpenSubsonicLoggedIn = false;
      autoLoginInProgress = false;
      
      // Reset user status indicators on error
      updateUserStatus('opensubsonic', '-', false);
      // Stream status removed (streaming functionality removed)
      
      if (loginBtn) {
        loginBtn.textContent = 'Connection Error';
        setTimeout(() => {
          loginBtn.textContent = 'Connect';
          loginBtn.disabled = false;
        }, 2000);
      }
  // Ensure mixer-area wishbox remains hidden on error
  if (wishboxFrame) wishboxFrame.style.display = 'none';
  try { document.body.classList.remove('logged-in'); } catch (e) {}
    }
  };
  
  // Define login handler based on mode
  const performLoginFromForm = async () => {
    if (useUnifiedLogin) {
      // Unified login: get credentials from unified form, URLs from environment
      const username = unifiedUsernameInput?.value.trim();
      const password = unifiedPasswordInput?.value.trim();
      const serverUrl = envOpenSubsonicUrl;
      
      if (!username || !password) {
        console.log('❌ Please enter username and password');
        if (loginBtn) {
          loginBtn.textContent = 'Credentials Required';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      if (!serverUrl) {
        console.log('❌ OpenSubsonic server URL not configured');
        if (loginBtn) {
          loginBtn.textContent = 'Server Not Configured';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      await performLogin(serverUrl, username, password);
      
    } else {
      // Individual login: get all values from individual form
      const username = usernameInput?.value.trim();
      const password = passwordInput?.value.trim();
      const serverUrl = serverInput?.value.trim();
      
      if (!serverUrl) {
        console.log('❌ Please enter server URL');
        if (loginBtn) {
          loginBtn.textContent = 'Server URL Required';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      if (!username || !password) {
        console.log('❌ Please enter username and password');
        if (loginBtn) {
          loginBtn.textContent = 'Credentials Required';
          setTimeout(() => {
            loginBtn.textContent = 'Connect';
            loginBtn.disabled = false;
          }, 2000);
        }
        return;
      }
      
      await performLogin(serverUrl, username, password);
    }
  };
  
  // Handle both click and form submit events for better browser compatibility
  loginBtn?.addEventListener('click', (e) => {
    e.preventDefault(); // Prevent form submission for click events
    performLoginFromForm();
  });
  
  // Handle form submission (for better browser password manager support)
  const loginFormElement = document.querySelector('.login-form') as HTMLFormElement;
  loginFormElement?.addEventListener('submit', (e) => {
    e.preventDefault(); // Prevent actual form submission
    performLoginFromForm();
  });
  
  // Enter key in password fields (still support legacy behavior)
  passwordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performLoginFromForm();
    }
  });
  
  streamPasswordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performLoginFromForm();
    }
  });
  
  unifiedPasswordInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performLoginFromForm();
    }
  });
}

// Audio Player Setup
function setupAudioPlayer(side: 'a' | 'b' | 'c' | 'd', audio: HTMLAudioElement) {
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const ejectBtn = document.getElementById(`eject-${side}`) as HTMLButtonElement;
  const restartBtn = document.getElementById(`restart-${side}`) as HTMLButtonElement;
  const volumeSlider = document.getElementById(`volume-${side}`) as HTMLInputElement;
  const progressContainer = document.getElementById(`waveform-${side}`) as HTMLElement;
  const playerDeck = document.getElementById(`player-${side}`) as HTMLElement;
  
  // Audio Event Listeners
  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      // Zeit-Anzeige aktualisieren
      updateTimeDisplay(side, audio.currentTime, audio.duration);
      
      // 📊 PLAY HISTORY: Track songs played >50%
      const progress = audio.currentTime / audio.duration;
      if (progress >= 0.5 && !audio.paused) {
        const currentSong = getCurrentLoadedSong(side);
        if (currentSong && !songsMarkedAsPlayed[side].has(currentSong.id)) {
          songsMarkedAsPlayed[side].add(currentSong.id);
          addSongToPlayHistory(currentSong, progress);
        }
      }
      
      // 🎵 INTELLIGENT CUE-IN: Check if we should start next track based on waveform analysis
      if (!audio.paused && isAutoQueueActiveForDeck(side)) {
        checkAndTriggerSmartCrossfade(side, audio.currentTime);
      }
      
      // ⭐ CENTER WAVEFORM: Keep playhead centered in zoom view (DJ mode)
      const waveformZoomInstance = waveformsZoom[side];
      if (waveformZoomInstance && waveformZoom[side] > 1.0) {
        const progress = audio.currentTime / audio.duration;
        const containerZoom = document.getElementById(`waveform-${side}-zoom`);
        
        if (containerZoom) {
          // Get the waveform wrapper (scrollable element)
          const waveformWrapper = containerZoom.querySelector('wave') as HTMLElement;
          
          if (waveformWrapper) {
            const containerWidth = containerZoom.clientWidth;
            const waveformWidth = waveformWrapper.scrollWidth;
            
            // Calculate scroll position to center the playhead
            // Center position = current progress position - half container width
            const targetScrollPosition = (progress * waveformWidth) - (containerWidth / 2);
            
            // Clamp to valid scroll range
            const maxScroll = waveformWidth - containerWidth;
            const clampedScroll = Math.max(0, Math.min(targetScrollPosition, maxScroll));
            
            waveformWrapper.scrollLeft = clampedScroll;
          }
        }
      }
      
      // ⭐ EXPLOSION SYSTEM: Check for track ending (last 15 seconds)
      // Only trigger blinking if track is actually playing (not paused/stopped)
      const timeRemaining = audio.duration - audio.currentTime;
      if (timeRemaining <= 15 && timeRemaining > 0 && !audio.paused) {
        handleTrackEnding(side, timeRemaining);
      } else if (timeRemaining > 15 || audio.paused) {
        // Clear blinking if we're not near the end or if paused
        clearWaveformBlinking(side);
      }
      
      // WaveSurfer progress is automatically synced
    }
  });
  
  audio.addEventListener('play', () => {
    console.log(`▶️ Player ${side.toUpperCase()} started playing`);
    if (playerDeck) {
      playerDeck.classList.add('playing');
    }
    
    // PLAYER STATE: Track is now playing
    const song = getCurrentLoadedSong(side);
    if (song) {
      setPlayerState(side, song, true);
    }
    
    // Auto-Queue preparation now handled in handleAutoQueue
    
    // Broadcast current metadata to stream
    setTimeout(() => broadcastCurrentMetadata(true), 100);
  });
  
  audio.addEventListener('pause', () => {
    console.log(`⏸️ Player ${side.toUpperCase()} paused`);
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    // PLAYER STATE: Track is paused
    const song = getCurrentLoadedSong(side);
    if (song) {
      setPlayerState(side, song, false);
    }
    
    // Broadcast current metadata to stream (might fall back to username@SubCaster if no tracks playing)
    setTimeout(() => broadcastCurrentMetadata(true), 100);
  });
  
  audio.addEventListener('ended', () => {
    console.log(`🏁 Player ${side} finished playing`);
    
    // Remove finished song from queue BEFORE clearing deck
    const finishedSong = getCurrentLoadedSong(side);
    if (finishedSong) {
      removeQueueItemBySong(finishedSong);
      console.log(`🗑️ Removed finished song "${finishedSong.title}" from queue`);
    }
    
    // PLAYER STATE: Track finished - clear player
    setPlayerState(side, null, false);
    
    // Auto-Queue Logic: Handle automatic playback
    handleAutoQueue(side);
    
    // Clear deck completely when track ends
    clearPlayerDeck(side);
    
    // Update play button state
    const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
    
    // Broadcast current metadata to stream (will probably fall back to username@SubCaster)
    setTimeout(() => broadcastCurrentMetadata(true), 100);
    
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    // Auto-Queue functionality (legacy - new system uses handleAutoQueue)
    if (autoQueueEnabled) {
      const availableItem = getNextAvailableQueueItem();
      if (availableItem && isSongQueueItem(availableItem) && availableItem.song) {
        console.log(`⚠️ Legacy Auto-Queue system bypassed - using new handleAutoQueue system instead`);
        // Disabled to prevent conflicts with new auto-queue system
      } else {
        console.log(`📭 Auto-Queue: No available song tracks in queue for Player ${side.toUpperCase()}`);
      }
    } else {
      console.log(`? Auto-Queue disabled on Player ${side.toUpperCase()}`);
    }
  });
  
  audio.addEventListener('loadstart', () => {
    console.log(`?? Player ${side} loading...`);
  });
  
  audio.addEventListener('canplay', () => {
    console.log(`? Player ${side} ready to play`);
  });
  
  audio.addEventListener('error', (e) => {
    console.error(`? Player ${side} error:`, e);
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    showError(`Audio error on Player ${side.toUpperCase()}`);
  });
  
  // Control Button Event Listeners
  playPauseBtn?.addEventListener('click', () => {
    const wavesurferZoom = waveformsZoom[side];
    const wavesurferOverview = waveformsOverview[side];
    
    // HTML Audio controls playback, WaveSurfer follows for visualization
    if (audio.paused) {
      // Check for blacklisted genre before playing during stream
      const currentSong = playerStates[side].song;
      if (azuraCastWebcaster?.getConnectionStatus() && currentSong && hasBlacklistedGenre(currentSong)) {
        console.warn(`🚫 Cannot play song with blacklisted genre while streaming: "${currentSong.title}" (${currentSong.genre})`);
        showStatusMessage(`🚫 "${currentSong.title}" kann nicht gespielt werden - Genre: ${currentSong.genre}`, 'error');
        return;
      }
      
      if (audio.src) {
        audio.play().catch(e => {
          console.error(`? Play error on Player ${side}:`, e);
          showError(`Cannot play on Player ${side.toUpperCase()}: ${e.message}`);
        });
        
        // Sync both waveform visualizations if available
        const waveformZoomInstance = waveformsZoom[side];
        const waveformOverviewInstance = waveformsOverview[side];
        
        if (waveformZoomInstance) {
          try {
            waveformZoomInstance.play();
          } catch (e) {
            console.warn(`⚠️ Waveform sync error on Player ${side}:`, e);
          }
        }
        if (waveformOverviewInstance) {
          try {
            waveformOverviewInstance.play();
          } catch (e) {
            console.warn(`⚠️ Waveform Overview sync error on Player ${side}:`, e);
          }
        }
        
        const icon = playPauseBtn.querySelector('.material-icons');
        if (icon) icon.textContent = 'pause';
        playPauseBtn.classList.add('playing');
      } else {
        console.log(`? No track loaded on Player ${side}`);
        showError(`No track loaded on Player ${side.toUpperCase()}`);
      }
    } else {
      audio.pause();
      
      // Sync both waveform visualizations if available
      const waveformZoomInstance = waveformsZoom[side];
      const waveformOverviewInstance = waveformsOverview[side];
      
      if (waveformZoomInstance) {
        try {
          waveformZoomInstance.pause();
        } catch (e) {
          console.warn(`⚠️ Waveform sync error on Player ${side}:`, e);
        }
      }
      if (waveformOverviewInstance) {
        try {
          waveformOverviewInstance.pause();
        } catch (e) {
          console.warn(`⚠️ Waveform Overview sync error on Player ${side}:`, e);
        }
      }
      
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
  });
  
  ejectBtn?.addEventListener('click', () => {
    console.log(`⏏️ Player ${side.toUpperCase()} manual eject button pressed`);
    
    // Manual eject: Move song to end of queue instead of removing it
    const ejectedSong = getCurrentLoadedSong(side);
    if (ejectedSong) {
      moveQueueItemToEnd(ejectedSong, true);
      console.log(`🔄 Moved ejected song "${ejectedSong.title}" to end of queue`);
    }
    
    // Complete deck clearing including metadata update
    clearPlayerDeck(side);
    
    // Reset UI elements
    if (playPauseBtn) {
      const icon = playPauseBtn.querySelector('.material-icons');
      if (icon) icon.textContent = 'play_arrow';
      playPauseBtn.classList.remove('playing');
    }
    if (playerDeck) {
      playerDeck.classList.remove('playing');
    }
    
    console.log(`?? Player ${side.toUpperCase()} ejected`);
    
    // Immediately check if we need to fill this deck from queue
    setTimeout(() => {
      checkAndFillEmptyDecks();
    }, 100);
  });

  restartBtn?.addEventListener('click', () => {
    if (audio.src) {
      audio.currentTime = 0;
      
      // Reset both waveform visualizations
      const waveformZoomInstance = waveformsZoom[side];
      const waveformOverviewInstance = waveformsOverview[side];
      
      if (waveformZoomInstance) {
        try {
          waveformZoomInstance.seekTo(0);
          console.log(`🌊 Waveform Zoom ${side.toUpperCase()} reset to position 0`);
        } catch (e) {
          console.warn(`⚠️ Waveform Zoom reset error on Player ${side}:`, e);
        }
      }
      if (waveformOverviewInstance) {
        try {
          waveformOverviewInstance.seekTo(0);
          console.log(`🌊 Waveform Overview ${side.toUpperCase()} reset to position 0`);
        } catch (e) {
          console.warn(`⚠️ Waveform Overview reset error on Player ${side}:`, e);
        }
      }
      
      console.log(`🔄 Player ${side.toUpperCase()} restarted`);
    } else {
      console.log(`❌ No track loaded on Player ${side}`);
      showError(`No track loaded on Player ${side.toUpperCase()}`);
    }
  });
  
  // Volume Control - steuert Web Audio API GainNodes UND HTML Audio Element
  volumeSlider?.addEventListener('input', () => {
    const volume = parseInt(volumeSlider.value) / 100;
    
    // Web Audio API Gain steuern (für Streaming)
    if (side === 'a' && aPlayerGain) {
      aPlayerGain.gain.value = volume;
    } else if (side === 'b' && bPlayerGain) {
      bPlayerGain.gain.value = volume;
    } else if (side === 'c' && cPlayerGain) {
      cPlayerGain.gain.value = volume;
    } else if (side === 'd' && dPlayerGain) {
      dPlayerGain.gain.value = volume;
    }

    // HTML Audio Element auch setzen (für direkte Abhörung ohne Web Audio)
    audio.volume = volume;
    
    // NUR EINMAL loggen
    console.log(`??? ${side} player volume: ${Math.round(volume * 100)}%`);
  });
  
  // Progress Bar Click Seeking
  progressContainer?.addEventListener('click', (e) => {
    if (audio.duration) {
      const rect = progressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;
      const seekTime = (clickX / width) * audio.duration;
      audio.currentTime = seekTime;
      console.log(`Player ${side} seek to: ${seekTime}s`);
    }
  });
  
  // Initial volume setting - sowohl für HTML Audio als auch Web Audio API
  if (volumeSlider) {
    const initialVolume = parseInt(volumeSlider.value) / 100;
    audio.volume = initialVolume;
    
    // Auch Web Audio API Gain setzen
    if (side === 'a' && aPlayerGain) {
      aPlayerGain.gain.value = initialVolume;
    } else if (side === 'b' && bPlayerGain) {
      bPlayerGain.gain.value = initialVolume;
    } else if (side === 'c' && cPlayerGain) {
      cPlayerGain.gain.value = initialVolume;
    } else if (side === 'd' && dPlayerGain) {
      dPlayerGain.gain.value = initialVolume;
    }
    
    console.log(`??? ${side} player initial volume: ${Math.round(initialVolume * 100)}%`);
  }
  
  // Setup CRT disturbances for this player
  setupCRTDisturbances(side);
  
  // Setup audio mixing event listeners (only once during player setup)
  setupAudioEventListeners(audio, side);
}

// CRT Disturbance Effects for Waveforms
function setupCRTDisturbances(side: 'a' | 'b' | 'c' | 'd') {
  const waveformContainer = document.getElementById(`waveform-${side}`)?.parentElement;
  if (!waveformContainer) return;
  
  // Random CRT glitches every 15-45 seconds
  const scheduleNextGlitch = () => {
    const randomDelay = 15000 + Math.random() * 30000; // 15-45 seconds
    setTimeout(() => {
      triggerRandomCRTEffect(waveformContainer, side);
      scheduleNextGlitch(); // Schedule next glitch
    }, randomDelay);
  };
  
  // Random neon jitter effects every 20-60 seconds (rarer than CRT glitches)
  const scheduleNextJitter = () => {
    const randomDelay = 20000 + Math.random() * 40000; // 20-60 seconds
    setTimeout(() => {
      triggerNeonJitter(side);
      scheduleNextJitter(); // Schedule next jitter
    }, randomDelay);
  };
  
  scheduleNextGlitch();
  scheduleNextJitter();
}

function triggerRandomCRTEffect(container: HTMLElement, side: 'a' | 'b' | 'c' | 'd') {
  // Only trigger if player is actually playing
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck?.classList.contains('playing')) return;
  
  // Random selection of different CRT effects
  const effects = ['crt-glitch', 'crt-scanline-jump', 'crt-horizontal-hold', 'crt-signal-loss'];
  const randomEffect = effects[Math.floor(Math.random() * effects.length)];
  
  // Add intensive effect class
  container.classList.add(randomEffect);
  
  // Different durations for different effects
  let effectDuration;
  switch (randomEffect) {
    case 'crt-scanline-jump':
      effectDuration = 150 + Math.random() * 100; // Very short
      break;
    case 'crt-horizontal-hold':
      effectDuration = 300 + Math.random() * 200; // Medium
      break;
    case 'crt-signal-loss':
      effectDuration = 100 + Math.random() * 150; // Very short
      break;
    default: // crt-glitch
      effectDuration = 200 + Math.random() * 600; // Original duration
  }
  
  setTimeout(() => {
    container.classList.remove(randomEffect);
  }, effectDuration);
  
  console.log(`📺 CRT ${randomEffect} on Player ${side.toUpperCase()} for ${Math.round(effectDuration)}ms`);
}

function triggerNeonJitter(side: 'a' | 'b' | 'c' | 'd') {
  // Only trigger if player is actually playing
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck?.classList.contains('playing')) return;
  
  // Add neon jitter class
  playerDeck.classList.add('neon-jitter');
  
  // Remove after short duration (100-300ms)
  const jitterDuration = 100 + Math.random() * 200;
  setTimeout(() => {
    playerDeck.classList.remove('neon-jitter');
  }, jitterDuration);
  
  console.log(`✨ Neon jitter on Player ${side.toUpperCase()} for ${Math.round(jitterDuration)}ms`);
}

// Track in Player laden
// Update waveform info overlay with track information
function updateWaveformInfo(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong) {
  const waveformInfo = document.getElementById(`waveform-info-${side}`);
  if (!waveformInfo) return;

  const titleElement = waveformInfo.querySelector('.track-title') as HTMLElement;
  const artistElement = waveformInfo.querySelector('.track-artist') as HTMLElement;
  const albumElement = waveformInfo.querySelector('.track-album') as HTMLElement;

  if (titleElement) titleElement.textContent = song.title;
  if (artistElement) artistElement.textContent = song.artist;
  if (albumElement) albumElement.textContent = song.album;
}

// Clear waveform info overlay
function clearWaveformInfo(side: 'a' | 'b' | 'c' | 'd') {
  const waveformInfo = document.getElementById(`waveform-info-${side}`);
  if (!waveformInfo) return;

  const titleElement = waveformInfo.querySelector('.track-title') as HTMLElement;
  const artistElement = waveformInfo.querySelector('.track-artist') as HTMLElement;
  const albumElement = waveformInfo.querySelector('.track-album') as HTMLElement;

  if (titleElement) titleElement.textContent = '';
  if (artistElement) artistElement.textContent = '';
  if (albumElement) albumElement.textContent = '';
}

function loadTrackToPlayer(side: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong, autoPlay: boolean = false) {
  if (!openSubsonicClient) {
    console.error('OpenSubsonic client not initialized');
    return;
  }
  
  console.log(`Loading "${song.title}" to Player ${side.toUpperCase()}${autoPlay ? ' (auto-play)' : ''}`);
  
  // ========================================
  // 🔒 CHECK LOADING LOCK - PREVENT SIMULTANEOUS LOADS
  // ========================================
  if (isDeckLoading(side)) {
    console.warn(`⚠️ [LoadingLock] Deck ${side.toUpperCase()} is already loading - cannot load "${song.title}"`);
    return;
  }
  
  // Acquire loading lock BEFORE any modifications
  if (!acquireDeckLoadingLock(side, song.id)) {
    console.error(`❌ [LoadingLock] Failed to acquire lock for Deck ${side.toUpperCase()}`);
    return;
  }
  
  // ========================================
  // 🎯 CHECK SONG LOCATION - PREVENT DUPLICATES
  // ========================================
  const existingLocation = getSongLocation(song.id);
  if (existingLocation && existingLocation.type !== 'nowhere') {
    if (existingLocation.type === 'deck') {
      console.error(`❌ [SongRegistry] Song "${song.title}" is already loaded on deck ${existingLocation.deck.toUpperCase()}!`);
      releaseDeckLoadingLock(side); // Release lock before returning
      return; // PREVENT DUPLICATE!
    }
    if (existingLocation.type === 'queue') {
      console.log(`🚚 [SongRegistry] Moving song "${song.title}" from queue to deck ${side.toUpperCase()}`);
      // Will be removed from queue below
    }
  }
  
  // ✅ CLEAR DECK COMPLETELY before loading new track
  // This removes any previous local files, radio streams, or other track data
  clearPlayerDeck(side);
  
  // ========================================
  // 🎯 REGISTER SONG ON DECK & REMOVE FROM QUEUE
  // ========================================
  registerSongLocation(song.id, { type: 'deck', deck: side });
  
  // Remove song from queue if it exists there
  const queueIndex = queue.findIndex(item => 
    isSongQueueItem(item) && item.song?.id === song.id
  );
  if (queueIndex !== -1) {
    queue.splice(queueIndex, 1);
    updateQueueDisplay();
    console.log(`🗑️ [SongRegistry] Removed "${song.title}" from queue (moved to deck ${side.toUpperCase()})`);
  }
  
  // 📊 Reset play history tracking for this deck
  songsMarkedAsPlayed[side].clear();
  
  // Get audio element AFTER clearing (in case it was replaced)
  const audio = getAudioElement(side);
  
  if (!audio) {
    console.error(`Audio element not found for player ${side}`);
    return;
  }
  
  // Get UI elements (after clearing to ensure they exist)
  const titleElement = document.getElementById(`track-title-${side}`);
  const artistElement = document.getElementById(`track-artist-${side}`);
  
  // Check if this is a Discord message (direct audio URL)
  let streamUrl: string;
  if ((song as any).isDiscordMessage && (song as any).streamUrl) {
    // Discord audio: use direct URL
    streamUrl = (song as any).streamUrl;
    console.log(`🎵 Discord audio URL (direct): ${streamUrl}`);
  } else {
    // OpenSubsonic track: use stream proxy
    streamUrl = openSubsonicClient.getStreamUrl(song.id);
  }
  
  // PLAYER STATE: Track loaded but not playing yet
  setPlayerState(side, song, false);
  
  // Store song data for drag & drop functionality
  deckSongs[side] = song;
  
  // Neuen Track laden
  audio.src = streamUrl;
  
  // ========================================
  // 🔓 RELEASE LOADING LOCK WHEN READY
  // ========================================
  // Release lock when audio is loaded and ready to play
  const releaseLockOnLoad = () => {
    releaseDeckLoadingLock(side);
    console.log(`✅ [LoadingLock] Deck ${side.toUpperCase()} ready - lock released`);
  };
  
  // Release lock on successful load
  audio.addEventListener('loadeddata', releaseLockOnLoad, { once: true });
  
  // Also release on error (with longer delay to prevent rapid retries)
  audio.addEventListener('error', () => {
    setTimeout(() => {
      releaseDeckLoadingLock(side);
      console.error(`❌ [LoadingLock] Deck ${side.toUpperCase()} load error - lock released`);
    }, 2000); // 2 second delay before allowing retry
  }, { once: true });
  
  // Track Info anzeigen
  if (titleElement) {
    titleElement.textContent = song.title;
  }
  if (artistElement) {
    artistElement.textContent = `${song.artist} - ${song.album}`;
  }

  // Waveform Info Overlay aktualisieren
  updateWaveformInfo(side, song);
  
  // Album Cover aktualisieren
  updateAlbumCover(side, song);

  // Play-Button zurücksetzen (Track ist gestoppt)
  const playPauseBtn = document.getElementById(`play-pause-${side}`) as HTMLButtonElement;
  const icon = playPauseBtn?.querySelector('.material-icons');
  if (icon) icon.textContent = 'play_arrow';
  
  // Load new waveform using WaveSurfer (lädt automatisch neue Waveform)
  loadWaveform(side, audio.src, song.duration);
  
  // Audio-Event-Listener werden NICHT bei jedem Track-Load neu hinzugefügt
  // Sie werden nur einmal beim Setup hinzugefügt (setupAudioPlayer)
  // setupAudioEventListeners(audio, side); // REMOVED - causes duplicate listeners
  
  // Update drag functionality for this deck after loading
  setTimeout(() => {
    const albumCover = document.getElementById(`album-cover-${side}`);
    if (albumCover) {
      // Trigger dragability update
      const updateEvent = new Event('loadeddata');
      audio.dispatchEvent(updateEvent);
      console.log(`🎵 Updated drag functionality for deck ${side} after loading track`);
    }
  }, 100);
  
  // Note: We don't sync WaveSurfer with audio to avoid double playback
  // WaveSurfer handles playback directly via play button
  
  // Song ID für Rating-System speichern
  audio.dataset.songId = song.id;
  
  // Rating anzeigen (async laden)
  const playerRating = document.getElementById(`player-rating-${side}`);
  if (playerRating) {
    playerRating.innerHTML = createStarRating(song.userRating || 0, song.id, true);

    // Rating async nachladen für bessere Performance
    loadRatingAsync(song.id);
  }

  // Auto-Play wenn gewünscht
  if (autoPlay) {
    // Warte bis Track geladen ist, dann spiele ab
    audio.addEventListener('loadeddata', () => {
      console.log(`▶️ Auto-playing "${song.title}" on Player ${side.toUpperCase()} via play button simulation`);
      
      // Simulate play button click to ensure all UI updates work correctly
      simulatePlayButtonClick(side);
      
    }, { once: true }); // Event listener nur einmal ausführen
  }
  
  // REMOVED: applyCrossfader() - Crossfader removed, all decks route directly at full volume
  console.log(`Player ${side.toUpperCase()}: "${song.title}" loaded successfully`);
  
  // Fast update: Only update this specific song's status
  updateSongStatus(song.id);
}

// REMOVED: applyCrossfader() - Crossfader removed, all decks now route directly at full volume via Mixer.ts

// Player Drop Zones initialisieren
function initializePlayerDropZones() {
  console.log('🎯 Initializing all player drop zones...');
  
  // Debug: Check if elements exist
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    console.log(`🎯 Player ${side} deck:`, deck ? 'FOUND' : 'NOT FOUND', deck);
  });
  
  // Ensure body allows drop events
  document.body.addEventListener('dragover', (e) => {
    console.log('🌐 Body dragover event fired');
    e.preventDefault(); // Allow drop
  });
  
  document.body.addEventListener('drop', (e) => {
    console.log('🌐 Body drop event fired');
    e.preventDefault(); // Prevent default file handling
  });
  
  // Test: Add a global drag detection and cleanup
  document.addEventListener('dragstart', (e) => {
    console.log('🚀 GLOBAL DRAGSTART detected:', e.target);
    console.log('🚀 Draggable element:', e.target);
    console.log('🚀 DataTransfer available:', !!e.dataTransfer);
    
    // Clean up any lingering drag classes from previous operations
    const allDecks = ['a', 'b', 'c', 'd'];
    allDecks.forEach(deckSide => {
      const deck = document.getElementById(`player-${deckSide}`);
      if (deck) {
        deck.classList.remove('drag-over', 'drop-blocked');
      }
    });
  });
  
  // Global dragend cleanup
  document.addEventListener('dragend', (e) => {
    console.log('🏁 GLOBAL DRAGEND detected');
    
    // Clean up all drag-related classes when drag operation ends
    const allDecks = ['a', 'b', 'c', 'd'];
    allDecks.forEach(deckSide => {
      const deck = document.getElementById(`player-${deckSide}`);
      if (deck) {
        deck.classList.remove('drag-over', 'drop-blocked');
      }
    });
  });
  
  initializePlayerDropZone('a');
  initializePlayerDropZone('b');
  initializePlayerDropZone('c');
  initializePlayerDropZone('d');
  
  console.log('🎯 All player drop zones initialized');
  
  // Debug: Test all current draggable elements
  setTimeout(() => {
    debugDraggableElements();
  }, 2000);
}

/**
 * Load local audio file to deck (from desktop drag & drop)
 */
async function loadLocalFileToDeck(deck: 'a' | 'b' | 'c' | 'd', file: File): Promise<void> {
  try {
    console.log(`📁 Loading local file to deck ${deck.toUpperCase()}: ${file.name}`);
    
    // Validate audio format
    if (!isValidAudioFile(file)) {
      console.error(`❌ Unsupported file format: ${file.type || 'unknown'}`);
      showFileFormatError(deck, file.name, file.type || 'unknown');
      return;
    }
    
    // ✅ CLEAR DECK COMPLETELY before loading local file
    // This removes any previous OpenSubsonic tracks, radio streams, or other local files
    clearPlayerDeck(deck);
    
    // Get audio element (after clearing)
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    if (!audio) {
      console.error(`❌ Audio element for deck ${deck} not found`);
      return;
    }
    
    // Create object URL for the file
    const objectUrl = URL.createObjectURL(file);
    
    // Extract metadata from file (reuse the objectUrl we just created)
    const metadata = await extractFileMetadata(file, objectUrl);
    
    // Create a track object for the local file
    const localTrack = {
      id: `local-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      title: metadata.title || file.name.replace(/\.[^/.]+$/, ''), // Remove extension
      artist: metadata.artist || 'Local File',
      album: metadata.album || 'Local Files',
      duration: metadata.duration || 0,
      genre: metadata.genre || 'Unknown',
      year: metadata.year || new Date().getFullYear(),
      track: 0,
      discNumber: 0,
      coverArt: metadata.coverArt || null,
      suffix: file.name.split('.').pop()?.toLowerCase() || 'mp3',
      bitRate: metadata.bitRate || 0,
      path: objectUrl,
      isLocal: true,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type
    };
    
    // Store local track info for this deck (for cleanup)
    (window as any)[`localTrack_${deck}`] = localTrack;
    (window as any)[`localObjectUrl_${deck}`] = objectUrl;
    
    // Reset waveform first (before loading new track)
    resetWaveform(deck);
    
    // Load the local file
    audio.src = objectUrl;
    audio.load();
    
    // Update display with local file info
    updateLocalFileDisplay(deck, localTrack);
    
    // Update waveform info overlay
    updateWaveformInfoForLocalFile(deck, localTrack);
    
    // Load waveform for local file
    loadWaveform(deck, objectUrl, metadata.duration);
    
    // Setup audio event listeners (needed for waveform sync)
    setupAudioEventListeners(audio, deck);
    
    // Update deck visual state
    const playerDeck = document.getElementById(`player-${deck}`);
    if (playerDeck) {
      playerDeck.classList.add('loaded', 'has-track');
      playerDeck.classList.remove('loading');
    }
    
    console.log(`✅ Local file loaded to Deck ${deck.toUpperCase()}: "${localTrack.title}"`);
    
  } catch (error) {
    console.error(`❌ Error loading local file to deck ${deck}:`, error);
    showFileLoadError(deck, file.name);
  }
}

/**
 * Validate if file is a supported audio format
 */
function isValidAudioFile(file: File): boolean {
  const supportedTypes = [
    'audio/mpeg',     // .mp3
    'audio/wav',      // .wav
    'audio/wave',     // .wav (alternative)
    'audio/flac',     // .flac
    'audio/ogg',      // .ogg
    'audio/mp4',      // .m4a
    'audio/aac',      // .aac
    'audio/webm',     // .webm
    'audio/x-flac'    // .flac (alternative)
  ];
  
  const supportedExtensions = ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.webm'];
  
  // Check MIME type
  if (file.type && supportedTypes.includes(file.type)) {
    return true;
  }
  
  // Check file extension as fallback
  const extension = '.' + file.name.split('.').pop()?.toLowerCase();
  return supportedExtensions.includes(extension);
}

/**
 * Extract metadata from audio file using multiple methods
 */
async function extractFileMetadata(file: File, objectUrl?: string): Promise<any> {
  // First try basic filename parsing
  const filename = file.name.replace(/\.[^/.]+$/, ''); // Remove extension
  let parsedMetadata = parseFilenameMetadata(filename);
  
  // Then try HTML5 Audio for duration (reuse objectUrl if provided)
  const audioMetadata = await extractAudioMetadata(file, objectUrl);
  
  // Combine results - prefer parsed filename data over null values
  return {
    duration: audioMetadata.duration || 0,
    title: parsedMetadata.title || filename,
    artist: parsedMetadata.artist || 'Unknown Artist',
    album: parsedMetadata.album || 'Local Files',
    genre: 'Local File',
    year: new Date().getFullYear(),
    coverArt: null,
    bitRate: 0
  };
}

/**
 * Check if any audio deck is currently playing
 */
function isAnyDeckPlaying(): boolean {
  const decks = ['a', 'b', 'c', 'd'];
  
  for (const deck of decks) {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    if (audio && !audio.paused && audio.currentTime > 0) {
      return true;
    }
  }
  
  return false;
}

/**
 * Parse metadata from filename using common patterns
 */
function parseFilenameMetadata(filename: string): any {
  const metadata = {
    title: null as string | null,
    artist: null as string | null,
    album: null as string | null
  };
  
  // Common patterns:
  // "Artist - Title"
  // "Artist - Album - Title" 
  // "01 - Artist - Title"
  // "Artist_Title"
  
  // Remove track numbers at start
  let cleanName = filename.replace(/^\d+[\s\-_\.]*/, '');
  
  // Pattern: "Artist - Title"
  if (cleanName.includes(' - ')) {
    const parts = cleanName.split(' - ');
    if (parts.length >= 2) {
      metadata.artist = parts[0].trim();
      metadata.title = parts[1].trim();
      if (parts.length >= 3) {
        metadata.album = parts[1].trim();
        metadata.title = parts[2].trim();
      }
    }
  }
  // Pattern: "Artist_Title" or "Artist Title"
  else if (cleanName.includes('_') || cleanName.includes(' ')) {
    const separator = cleanName.includes('_') ? '_' : ' ';
    const parts = cleanName.split(separator);
    if (parts.length >= 2) {
      // Try to detect artist vs title (heuristic)
      const midPoint = Math.floor(parts.length / 2);
      metadata.artist = parts.slice(0, midPoint).join(' ').trim();
      metadata.title = parts.slice(midPoint).join(' ').trim();
    }
  }
  
  return metadata;
}

/**
 * Extract basic audio metadata using HTML5 Audio
 */
async function extractAudioMetadata(file: File, reuseObjectUrl?: string): Promise<any> {
  return new Promise((resolve) => {
    const tempAudio = new Audio();
    let objectUrl: string;
    let shouldCleanupUrl = false;
    
    // Reuse existing objectUrl if provided, otherwise create new one
    if (reuseObjectUrl) {
      objectUrl = reuseObjectUrl;
    } else {
      objectUrl = URL.createObjectURL(file);
      shouldCleanupUrl = true;
    }
    
    const cleanup = () => {
      // Only revoke URL if we created it ourselves
      if (shouldCleanupUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      tempAudio.src = '';
    };
    
    tempAudio.addEventListener('loadedmetadata', () => {
      const metadata = {
        duration: tempAudio.duration || 0
      };
      cleanup();
      resolve(metadata);
    });
    
    tempAudio.addEventListener('error', () => {
      cleanup();
      resolve({ duration: 0 });
    });
    
    // Timeout after 5 seconds
    setTimeout(() => {
      cleanup();
      resolve({ duration: 0 });
    }, 5000);
    
    tempAudio.src = objectUrl;
  });
}

/**
 * Update display for local file
 */
function updateLocalFileDisplay(deck: 'a' | 'b' | 'c' | 'd', track: any): void {
  // Update waveform info overlay (visible metadata display)
  const waveformInfo = document.getElementById(`waveform-info-${deck}`);
  if (waveformInfo) {
    const titleElement = waveformInfo.querySelector('.track-title') as HTMLElement;
    const artistElement = waveformInfo.querySelector('.track-artist') as HTMLElement;
    const albumElement = waveformInfo.querySelector('.track-album') as HTMLElement;
    
    if (titleElement) titleElement.textContent = track.title;
    if (artistElement) artistElement.textContent = track.artist;
    if (albumElement) albumElement.textContent = track.album || 'Local Files';
  }
  
  // Also update hidden metadata elements (for compatibility)
  const hiddenTitle = document.getElementById(`track-title-${deck}`);
  const hiddenArtist = document.getElementById(`track-artist-${deck}`);
  if (hiddenTitle) hiddenTitle.textContent = track.title;
  if (hiddenArtist) hiddenArtist.textContent = track.artist;
  
  // Update album cover (show file icon for local files)
  const albumCover = document.getElementById(`album-cover-${deck}`) as HTMLElement;
  if (albumCover) {
    albumCover.innerHTML = `
      <div class="local-file-cover">
        <span class="material-icons">audio_file</span>
        <div class="file-info">
          <div class="file-name">${track.fileName}</div>
          <div class="file-size">${formatFileSize(track.fileSize)}</div>
        </div>
      </div>
    `;
  }
  
  // Update file info display
  const fileInfo = document.querySelector(`#file-info-${deck} .file-path-display`);
  if (fileInfo) {
    fileInfo.textContent = `📁 ${track.fileName}`;
  }
  
  // Clear rating for local files
  const playerRating = document.getElementById(`player-rating-${deck}`);
  if (playerRating) {
    playerRating.innerHTML = `
      <div class="local-file-indicator">
        <span class="material-icons">folder</span>
        <span>Local File</span>
      </div>
    `;
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Show file format error
 */
function showFileFormatError(deck: 'a' | 'b' | 'c' | 'd', fileName: string, fileType: string): void {
  const titleElement = document.getElementById(`track-title-${deck}`);
  const artistElement = document.getElementById(`track-artist-${deck}`);
  
  if (titleElement) titleElement.textContent = `❌ Unsupported Format`;
  if (artistElement) artistElement.textContent = `${fileName} (${fileType})`;
  
  // Clear after 3 seconds
  setTimeout(() => {
    if (titleElement) titleElement.textContent = 'No Track Loaded';
    if (artistElement) artistElement.textContent = '';
  }, 3000);
}

/**
 * Update waveform info overlay for local file
 */
function updateWaveformInfoForLocalFile(deck: 'a' | 'b' | 'c' | 'd', track: any): void {
  const waveformInfo = document.getElementById(`waveform-info-${deck}`);
  if (waveformInfo) {
    waveformInfo.innerHTML = `
      <div class="track-title">${track.title}</div>
      <div class="track-artist">${track.artist}</div>
      <div class="track-album">${track.album}</div>
      <div class="track-duration">${formatDuration(track.duration)}</div>
      <div class="local-file-badge">📁 Local File</div>
    `;
  }
}

/**
 * Update waveform info overlay for radio stream
 */
function updateWaveformInfoForRadio(deck: 'a' | 'b' | 'c' | 'd', station: any, nowPlaying?: any): void {
  const waveformInfo = document.getElementById(`waveform-info-${deck}`);
  if (waveformInfo) {
    // Handle both station data and WebSocket data formats
    // When called initially: nowPlaying = station (with station.now_playing.song)
    // When called from WebSocket: nowPlaying = data (with data.now_playing.song)
    const currentSong = nowPlaying?.now_playing?.song || nowPlaying?.song;
    const isLive = nowPlaying?.live?.is_live || station.live?.is_live;
    const streamerName = nowPlaying?.live?.streamer_name || station.live?.streamer_name;
    
    console.log(`📻 updateWaveformInfoForRadio for deck ${deck}:`, {
      currentSong,
      isLive,
      streamerName,
      nowPlayingData: nowPlaying
    });
    
    // Determine LIVE badge text (only show if actually live)
    let liveBadgeHtml = '';
    if (isLive) {
      const liveBadge = streamerName ? `🔴 LIVE: ${streamerName}` : '🔴 LIVE';
      liveBadgeHtml = `
        <div class="track-duration-line" style="color: #ff4444; margin-top: 4px;">
          ${liveBadge}
        </div>`;
    }
    
    // Extract short radio name (before " - ") and description (after " - ")
    const fullName = station.name || '';
    const nameParts = fullName.split(' - ');
    const shortRadioName = nameParts[0] || fullName;
    const radioDescription = station.description || nameParts[1] || '';
    
    // Use same structure as OpenSubsonic songs
    waveformInfo.innerHTML = `
      <!-- Large centered title -->
      <div class="track-title-large">
        <span class="track-title">${currentSong?.title || station.name}</span>
      </div>
      <!-- Bottom left: artist and album stacked -->
      <div class="track-details-bottom-left">
        <div class="track-artist-line">
          <span class="track-artist">${currentSong?.artist || 'Live Radio'}</span>
        </div>
        <div class="track-album-line">
          <span class="track-album">${shortRadioName}</span>
        </div>
        ${liveBadgeHtml}
      </div>
    `;
  }
}

/**
 * Create live waveform visualization for radio streams
 */
function createLiveWaveformForRadio(deck: 'a' | 'b' | 'c' | 'd', audio: HTMLAudioElement): void {
  try {
    const container = document.getElementById(`waveform-${deck}`);
    if (!container) {
      console.warn(`Waveform container not found for deck ${deck}`);
      return;
    }
    
    // Clear existing waveform
    container.innerHTML = '';
    
    // Create live radio waveform visualization
    container.innerHTML = `
      <div class="live-radio-waveform">
        <div class="live-indicator">
          <span class="live-dot"></span>
          <span class="live-text">LIVE</span>
        </div>
        <div class="radio-bars">
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
          <div class="radio-bar"></div>
        </div>
        <div class="radio-info">
          <span class="radio-frequency">📻 Radio Stream</span>
        </div>
      </div>
    `;
    
    // Add live animation when playing
    const startLiveAnimation = () => {
      const bars = container.querySelectorAll('.radio-bar');
      bars.forEach((bar, index) => {
        const element = bar as HTMLElement;
        element.style.animationDelay = `${index * 0.1}s`;
        element.classList.add('animated');
      });
      
      const liveDot = container.querySelector('.live-dot') as HTMLElement;
      if (liveDot) {
        liveDot.classList.add('pulsing');
      }
    };
    
    const stopLiveAnimation = () => {
      const bars = container.querySelectorAll('.radio-bar');
      bars.forEach(bar => {
        const element = bar as HTMLElement;
        element.classList.remove('animated');
      });
      
      const liveDot = container.querySelector('.live-dot') as HTMLElement;
      if (liveDot) {
        liveDot.classList.remove('pulsing');
      }
    };
    
    // Listen to audio events for animation control
    audio.addEventListener('play', startLiveAnimation);
    audio.addEventListener('pause', stopLiveAnimation);
    audio.addEventListener('ended', stopLiveAnimation);
    
    console.log(`📻 Live radio waveform created for deck ${deck.toUpperCase()}`);
    
  } catch (error) {
    console.error(`❌ Error creating live radio waveform for deck ${deck}:`, error);
  }
}

/**
 * Show file load error
 */
function showFileLoadError(deck: 'a' | 'b' | 'c' | 'd', fileName: string): void {
  const titleElement = document.getElementById(`track-title-${deck}`);
  const artistElement = document.getElementById(`track-artist-${deck}`);
  
  if (titleElement) titleElement.textContent = `❌ Load Error`;
  if (artistElement) artistElement.textContent = fileName;
  
  // Clear after 3 seconds
  setTimeout(() => {
    if (titleElement) titleElement.textContent = 'No Track Loaded';
    if (artistElement) artistElement.textContent = '';
  }, 3000);
}

// Debug function to test all draggable elements
function debugDraggableElements() {
  console.log('🔍 DEBUGGING DRAGGABLE ELEMENTS:');
  
  const draggableElements = document.querySelectorAll('[draggable="true"]');
  console.log(`🔍 Found ${draggableElements.length} draggable elements:`);
  
  draggableElements.forEach((element, index) => {
    console.log(`🔍 Draggable ${index + 1}:`, element);
    console.log(`  - Tag: ${element.tagName}`);
    console.log(`  - Classes: ${element.className}`);
    console.log(`  - ID: ${element.id}`);
    console.log(`  - Has dragstart listener:`, element.hasAttribute('ondragstart') || element.addEventListener.length > 0);
  });
  
  // Test drop zones
  console.log('🔍 DEBUGGING DROP ZONES:');
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    if (deck) {
      console.log(`🔍 Drop zone ${side}:`, deck);
      console.log(`  - Has drag-over class:`, deck.classList.contains('drag-over'));
      console.log(`  - Style display:`, getComputedStyle(deck).display);
      console.log(`  - Style visibility:`, getComputedStyle(deck).visibility);
      console.log(`  - Style pointer-events:`, getComputedStyle(deck).pointerEvents);
      console.log(`  - Style z-index:`, getComputedStyle(deck).zIndex);
      console.log(`  - Style position:`, getComputedStyle(deck).position);
    }
  });
  
  // Check for overlapping elements
  console.log('🔍 CHECKING FOR OVERLAPPING ELEMENTS:');
  const overlays = document.querySelectorAll('[style*="position: fixed"], [style*="position: absolute"], .disconnect-timer-overlay, .stream-config-panel');
  overlays.forEach((overlay, index) => {
    const computed = getComputedStyle(overlay);
    console.log(`🔍 Overlay ${index + 1}:`, overlay);
    console.log(`  - Display:`, computed.display);
    console.log(`  - Visibility:`, computed.visibility);
    console.log(`  - Z-index:`, computed.zIndex);
    console.log(`  - Pointer-events:`, computed.pointerEvents);
    console.log(`  - Classes:`, overlay.className);
  });
}

// Global debug function - call this from browser console
(window as any).debugDragDrop = function() {
  console.log('🔧 MANUAL DRAG & DROP DEBUG STARTED');
  debugDraggableElements();
  
  // Test if we can manually trigger drag events
  const firstDraggable = document.querySelector('[draggable="true"]');
  if (firstDraggable) {
    console.log('🔧 Testing manual drag event on:', firstDraggable);
    
    const dragEvent = new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: new DataTransfer()
    });
    
    const result = firstDraggable.dispatchEvent(dragEvent);
    console.log('🔧 Manual drag event result:', result);
  }
  
  // Test drop zones
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    if (deck) {
      console.log(`🔧 Testing drop zone ${side}`);
      
      const dragOverEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer()
      });
      
      const result = deck.dispatchEvent(dragOverEvent);
      console.log(`🔧 Drop zone ${side} dragover result:`, result);
    }
  });
};

console.log('🔧 Debug function ready! Call debugDragDrop() from browser console to test.');

function initializePlayerDropZone(side: 'a' | 'b' | 'c' | 'd') {
  const playerDeck = document.getElementById(`player-${side}`);
  if (!playerDeck) {
    console.warn(`Player deck ${side} not found for drop zone setup`);
    return;
  }
  
  console.log(`🎯 Setting up drop zone for player ${side}`);
  
  playerDeck.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🎯 Dragover on player ${side}`);
    
    // Block drops only on THIS deck if it's playing
    const thisAudio = getAudioElement(side);
    const thisPlayerIsPlaying = thisAudio && !thisAudio.paused && thisAudio.currentTime > 0;
    
    if (thisPlayerIsPlaying) {
      // Block drops only on this specific playing deck
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'none';
      }
      playerDeck.classList.add('drop-blocked');
      playerDeck.classList.remove('drag-over');
      console.log(`🚫 Blocking drop on player ${side} - deck is playing`);
      return;
    }
    
    if (e.dataTransfer) {
      // Check if it's a deck-to-deck move
      const jsonData = e.dataTransfer.getData('application/json');
      if (jsonData) {
        try {
          const dragData = JSON.parse(jsonData);
          if (dragData.type === 'deck-song') {
            e.dataTransfer.dropEffect = 'move'; // Move operation for deck songs
          } else {
            e.dataTransfer.dropEffect = 'copy'; // Copy operation for library songs
          }
        } catch {
          e.dataTransfer.dropEffect = 'copy'; // Fallback
        }
      } else {
        e.dataTransfer.dropEffect = 'copy'; // Fallback
      }
    }
    playerDeck.classList.add('drag-over');
    playerDeck.classList.remove('drop-blocked');
  });
  
  playerDeck.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🎯 Dragenter on player ${side}`);
  });
  
  playerDeck.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(`🎯 Dragleave on player ${side}`);
    
    // Use setTimeout to ensure dragleave is real and not just hovering over child elements
    setTimeout(() => {
      // Check if we're really leaving - not just moving over a child element
      if (!playerDeck.matches(':hover')) {
        playerDeck.classList.remove('drag-over');
        playerDeck.classList.remove('drop-blocked');
        console.log(`🎯 Cleared drag classes on player ${side}`);
      }
    }, 50);
  });
  
  playerDeck.addEventListener('drop', async (e) => {
    console.log(`🎯 DROP EVENT on player ${side}!`);
    e.preventDefault();
    
    // CRITICAL: Clean up ALL drag visual states immediately
    playerDeck.classList.remove('drag-over', 'drop-blocked');
    playerDeck.style.opacity = '1';
    
    // Clean up ALL other decks as well
    const allSides: ('a' | 'b' | 'c' | 'd')[] = ['a', 'b', 'c', 'd'];
    allSides.forEach(deckSide => {
      const deck = document.getElementById(`player-${deckSide}`);
      if (deck) {
        deck.classList.remove('drag-over', 'drop-blocked');
        deck.style.opacity = '1';
      }
    });
    
    const dragEvent = e as DragEvent;
    
    // Block drops only on THIS deck if it's playing
    const thisAudio = getAudioElement(side);
    const thisPlayerIsPlaying = thisAudio && !thisAudio.paused && thisAudio.currentTime > 0;
    
    if (thisPlayerIsPlaying) {
      console.log(`🚫 Drop blocked on player ${side.toUpperCase()} - this deck is playing`);
      return;
    }
    
    // Check for local files first (from desktop drag & drop)
    if (dragEvent.dataTransfer?.files && dragEvent.dataTransfer.files.length > 0) {
      console.log(`📁 Local file(s) dropped on player ${side.toUpperCase()}`);
      const file = dragEvent.dataTransfer.files[0]; // Take first file
      
      // Load local file to deck
      await loadLocalFileToDeck(side, file);
      return; // Exit early for local files
    }
    
    // Try to get JSON data (OpenSubsonic songs)
    let songData: any = null;
    let songId: string | null = null;
    let song: OpenSubsonicSong | null = null;
    
    try {
      const jsonData = dragEvent.dataTransfer?.getData('application/json');
      if (jsonData) {
        songData = JSON.parse(jsonData);
        console.log('Parsed drag data:', songData);
        
        if (songData.type === 'song' && songData.song) {
          song = songData.song;
          songId = song?.id || null;
          
          console.log('🔍 Deck drop - Song details:', {
            title: song?.title,
            artist: song?.artist,
            genre: song?.genre,
            hasGenre: !!song?.genre
          });
          console.log('🔍 Deck drop - Streaming status:', azuraCastWebcaster?.getConnectionStatus());
          console.log('🔍 Deck drop - Blacklisted genres:', blacklistedGenres);
          
          // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
          if (azuraCastWebcaster?.getConnectionStatus() && song && hasBlacklistedGenre(song)) {
            console.warn(`🚫 Cannot load song with blacklisted genre while streaming: "${song.title}" (${song.genre})`);
            showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
            return;
          }
        } else if (songData.type === 'track' && songData.track) {
          song = songData.track;
          songId = song?.id || null;
          
          // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
          if (azuraCastWebcaster?.getConnectionStatus() && song && hasBlacklistedGenre(song)) {
            console.warn(`🚫 Cannot load song with blacklisted genre while streaming: "${song.title}" (${song.genre})`);
            showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
            return;
          }
        } else if (songData.type === 'queue-song' && songData.song) {
          song = songData.song;
          songId = song?.id || null;
          const queueIndex = songData.queueIndex;
          
          // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
          if (azuraCastWebcaster?.getConnectionStatus() && song && hasBlacklistedGenre(song)) {
            console.warn(`🚫 Cannot load song with blacklisted genre while streaming: "${song.title}" (${song.genre})`);
            showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
            return;
          }
          
          if (song) {
            console.log(`🎯 Queue song dropped on deck ${side.toUpperCase()}: "${song.title}" (queue position ${queueIndex})`);
            
            // Calculate target queue position based on deck
            const targetQueuePosition = calculateQueuePositionForDeck(side);
            
            if (targetQueuePosition !== null && queueIndex !== undefined && queueIndex !== targetQueuePosition) {
              console.log(`📋 Moving song from queue position ${queueIndex} to ${targetQueuePosition} for deck ${side.toUpperCase()}`);
              reorderQueueItem(queueIndex, targetQueuePosition);
            } else if (queueIndex !== undefined) {
              // Song is already at correct position, just ensure it's loaded on this deck
              console.log(`✓ Song already at correct queue position for deck ${side.toUpperCase()}`);
              const queueItem = queue[queueIndex];
              if (queueItem && isSongQueueItem(queueItem)) {
                queueItem.assignedToDeck = side;
                loadTrackToPlayer(side, song, false);
              }
            }
            return; // Exit early since we handled the queue song
          }
        } else if (songData.type === 'song' && songData.queueIndex !== undefined) {
          // Handle queue songs with type='song' (from queue drag)
          song = songData.song;
          songId = song?.id || null;
          const queueIndex = songData.queueIndex;
          
          if (song) {
            console.log(`🎯 Queue item (type=song) dropped on deck ${side.toUpperCase()}: "${song.title}" (queue position ${queueIndex})`);
            
            // Calculate target queue position based on deck
            const targetQueuePosition = calculateQueuePositionForDeck(side);
            
            if (targetQueuePosition !== null && queueIndex !== undefined && queueIndex !== targetQueuePosition) {
              console.log(`📋 Moving song from queue position ${queueIndex} to ${targetQueuePosition} for deck ${side.toUpperCase()}`);
              reorderQueueItem(queueIndex, targetQueuePosition);
            } else if (queueIndex !== undefined) {
              // Song is already at correct position, just ensure it's loaded on this deck
              console.log(`✓ Song already at correct queue position for deck ${side.toUpperCase()}`);
              const queueItem = queue[queueIndex];
              if (queueItem && isSongQueueItem(queueItem)) {
                queueItem.assignedToDeck = side;
                loadTrackToPlayer(side, song, false);
              }
            }
            return; // Exit early since we handled the queue song
          }
        } else if (songData.type === 'deck-song' && songData.song) {
          song = songData.song;
          songId = song?.id || null;
          const sourceDeck = songData.sourceDeck;
          console.log(`🎵 Detected deck-song drop: from ${sourceDeck} to ${side}, song:`, song);
          
          // Prüfe ob Song blacklisted Genre hat (nur wenn Streaming aktiv)
          if (azuraCastWebcaster?.getConnectionStatus() && song && hasBlacklistedGenre(song)) {
            console.warn(`🚫 Cannot load song with blacklisted genre while streaming: "${song.title}" (${song.genre})`);
            showStatusMessage(`🚫 "${song.title}" blockiert - Genre: ${song.genre}`, 'error');
            return;
          }
          
          if (song) {
            // Check if this is a radio stream
            const isRadio = (song as any).isRadio === true;
            
            if (isRadio) {
              console.log(`📻 Moving radio stream from ${sourceDeck?.toUpperCase()} to ${side.toUpperCase()}: "${song.title}"`);
              
              // For radio streams, we need to load the station again
              const stationId = (song as any).stationId;
              const shortcode = (song as any).shortcode;
              const serverUrl = (song as any).serverUrl;
              
              if (stationId && shortcode && serverUrl) {
                // Reconstruct station object for loading
                const station = {
                  id: stationId,
                  shortcode: shortcode,
                  serverUrl: serverUrl,
                  name: song.title,
                  description: song.album,
                  genre: song.genre
                };
                
                // Load radio stream to target deck
                const loadRadioStreamToDeckFunc = (window as any).loadRadioStreamToDeck;
                if (loadRadioStreamToDeckFunc) {
                  await loadRadioStreamToDeckFunc(side, station);
                  console.log(`✅ Radio stream moved to Player ${side.toUpperCase()}`);
                  
                  // Clear the source deck
                  if (sourceDeck && sourceDeck !== side) {
                    console.log(`🗑️ Clearing source deck ${sourceDeck.toUpperCase()}`);
                    clearPlayerDeck(sourceDeck as 'a' | 'b' | 'c' | 'd');
                  }
                } else {
                  console.error(`❌ loadRadioStreamToDeck function not found`);
                }
              } else {
                console.error(`❌ Missing radio station data for move operation`);
              }
              return; // Exit early since we handled the radio move
            } else {
              // Regular OpenSubsonic song
              console.log(`🎵 Moving deck song from ${sourceDeck?.toUpperCase()} to ${side.toUpperCase()}: "${song.title}"`);
              
              // Load track to target deck
              if (song && songId) {
                console.log(`⬇️ Moving song ${songId} from Player ${sourceDeck?.toUpperCase()} to Player ${side.toUpperCase()}`);
                
                // Load track to target deck WITHOUT auto-play
                loadTrackToPlayer(side, song, false);
                console.log(`✅ Track "${song.title}" moved to Player ${side.toUpperCase()}`);
                
                // Clear the source deck (move operation)
                if (sourceDeck && sourceDeck !== side) {
                  console.log(`🗑️ About to clear source deck ${sourceDeck.toUpperCase()}`);
                  try {
                    clearPlayerDeck(sourceDeck as 'a' | 'b' | 'c' | 'd');
                    console.log(`✅ Source deck ${sourceDeck.toUpperCase()} cleared successfully`);
                  } catch (error) {
                    console.error(`❌ Error clearing source deck ${sourceDeck.toUpperCase()}:`, error);
                  }
                } else {
                  console.log(`ℹ️ Not clearing source deck (same as target or invalid): source=${sourceDeck}, target=${side}`);
                }
                return; // Exit early since we handled the move
              } else {
                console.error(`❌ Missing song or songId for move operation`);
              }
            }
          } else {
            console.error(`❌ No song data in deck-song drop`);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to parse JSON drag data');
    }
    
    // Fallback to text/plain and search for the song
    if (!song && !songId) {
      songId = dragEvent.dataTransfer?.getData('text/plain') || null;
      if (songId) {
        song = findSongById(songId);
      }
    }
    
    if (song && songId) {
      console.log(`⬇️ Dropping song ${songId} on Player ${side.toUpperCase()}`);
      
      // Load track WITHOUT auto-play
      loadTrackToPlayer(side, song, false);
      console.log(`✅ Track "${song.title}" loaded on Player ${side.toUpperCase()} (ready to play)`);
    } else {
      console.error(`❌ Song with ID ${songId || 'unknown'} not found`);
      showError(`Track not found. Please try searching or reloading the library.`);
    }
  });
}

// Song nach ID in allen verfügbaren Listen finden
function findSongById(songId: string): OpenSubsonicSong | null {
  // Suche in aktuellen Songs
  let song = currentSongs.find(s => s.id === songId);
  if (song) return song;
  
  // Suche in Search Results (DOM) - sowohl alte als auch neue Track-Items
  const searchResults = document.querySelectorAll('.track-item, .track-item-oneline, .song-row, .unified-song-item');
  for (const item of searchResults) {
    const element = item as HTMLElement;
    if (element.dataset.songId === songId) {

      // Für neue einzeilige Track-Items
      if (element.classList.contains('track-item-oneline')) {
        const titleElement = element.querySelector('.track-title');
        const artistElement = element.querySelector('.track-artist');
        const albumElement = element.querySelector('.track-album');
        const coverArt = element.dataset.coverArt || undefined;
        
        if (titleElement && artistElement && albumElement) {
          return {
            id: songId,
            title: titleElement.textContent || 'Unknown',
            artist: artistElement.textContent || 'Unknown Artist',
            album: albumElement.textContent || 'Unknown Album',
            duration: 0,
            size: 0,
            suffix: 'mp3',
            bitRate: 0,
            coverArt: coverArt // Cover Art aus DOM extrahieren
          };
        }
      }

      // Für alte Track-Items (Fallback)
      const titleElement = element.querySelector('h4');
      const infoElement = element.querySelector('p');
      const coverArt = element.dataset.coverArt || undefined;
      
      if (titleElement && infoElement) {
        const title = titleElement.textContent || 'Unknown';
        const info = infoElement.textContent || '';
        const [artist, album] = info.split(' - ');
        
        return {
          id: songId,
          title: title,
          artist: artist || 'Unknown Artist',
          album: album || 'Unknown Album',
          duration: 0,
          size: 0,
          suffix: 'mp3',
          bitRate: 0,
          coverArt: coverArt // Cover Art auch für alte Items
        };
      }
    }
  }
  
  // Nicht gefunden
  return null;
}

// Rating-Event-Listeners initialisieren
function initializeRatingListeners() {
  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star') || target.classList.contains('rating-star')) {
      let rating = parseInt(target.dataset.rating || '0');
      let songId = target.dataset.songId;
      
      // Fallback: Wenn kein data-song-id, prüfe ob es ein Player-Rating ist
      if (!songId) {
        const playerRatingContainer = target.closest('[id^="player-rating-"]');
        if (playerRatingContainer) {
          const playerId = playerRatingContainer.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
          const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
          songId = audio?.dataset.songId;
          
          // Rating über Position im Container ermitteln
          if (!rating) {
            const stars = Array.from(playerRatingContainer.querySelectorAll('.star, .rating-star'));
            rating = stars.indexOf(target) + 1;
          }
        }
      }
      
      if (songId && rating > 0) {
        await setRating(songId, rating);
        
        // Async Rating laden für bessere Performance
        loadRatingAsync(songId);
      }
    }
  });
  
  // Hover-Effekte für Sterne
  document.addEventListener('mouseover', (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star') || target.classList.contains('rating-star')) {
      let rating = parseInt(target.dataset.rating || '0');
      let songId = target.dataset.songId;
      
      // Fallback: Wenn kein data-song-id, prüfe ob es ein Player-Rating ist
      if (!songId) {
        const playerRatingContainer = target.closest('[id^="player-rating-"]');
        if (playerRatingContainer) {
          const playerId = playerRatingContainer.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
          const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
          songId = audio?.dataset.songId;
          
          // Rating über Position im Container ermitteln
          if (!rating) {
            const stars = Array.from(playerRatingContainer.querySelectorAll('.star, .rating-star'));
            rating = stars.indexOf(target) + 1;
          }
        }
      }
      
      if (songId && rating > 0) {
        highlightStars(songId, rating);
      }
    }
  });
  
  document.addEventListener('mouseout', (event) => {
    const target = event.target as HTMLElement;
    
    if (target.classList.contains('star') || target.classList.contains('rating-star')) {
      let songId = target.dataset.songId;
      
      // Fallback: Wenn kein data-song-id, prüfe ob es ein Player-Rating ist
      if (!songId) {
        const playerRatingContainer = target.closest('[id^="player-rating-"]');
        if (playerRatingContainer) {
          const playerId = playerRatingContainer.id.split('-')[2]; // z.B. "a" aus "player-rating-a"
          const audio = document.getElementById(`audio-${playerId}`) as HTMLAudioElement;
          songId = audio?.dataset.songId;
        }
      }
      
      if (songId) {
        resetStarHighlight(songId);
      }
    }
  });
}

// Sterne für Hover-Effekt hervorheben
function highlightStars(songId: string, rating: number) {
  // Alle Rating-Container für diesen Song finden
  // Variante 1: Container mit data-song-id (Library-Elemente haben data-song-id am Parent)
  const parentContainers = document.querySelectorAll(`[data-song-id="${songId}"]`);
  parentContainers.forEach(container => {
    // Alle Sterne in diesem Container (sowohl .star als auch .rating-star)
    const stars = container.querySelectorAll('.star, .rating-star');
    
    stars.forEach((star, index) => {
      const starElement = star as HTMLElement;
      if (index < rating) {
        starElement.classList.add('hover-preview');
      } else {
        starElement.classList.remove('hover-preview');
      }
    });
  });
  
  // Variante 2: Rating-Container mit direktem data-song-id (Queue-Elemente)
  const directContainers = document.querySelectorAll(`.rating-stars[data-song-id="${songId}"]`);
  directContainers.forEach(container => {
    const stars = container.querySelectorAll('.star, .rating-star');
    
    stars.forEach((star, index) => {
      const starElement = star as HTMLElement;
      if (index < rating) {
        starElement.classList.add('hover-preview');
      } else {
        starElement.classList.remove('hover-preview');
      }
    });
  });
  
  // Auch Player-Rating-Container für diesen Song hervorheben
  const playerRatings = document.querySelectorAll(`[id^="player-rating-"]`);
  playerRatings.forEach(playerRating => {
    const stars = playerRating.querySelectorAll('.star, .rating-star');
    // Prüfen ob dieser Player den Song hat
    const playerId = playerRating.id.split('-')[2] as 'a' | 'b' | 'c' | 'd'; // z.B. "a" aus "player-rating-a"
    const audio = getAudioElement(playerId);
    
    if (audio && audio.dataset.songId === songId) {
      stars.forEach((star, index) => {
        const starElement = star as HTMLElement;
        if (index < rating) {
          starElement.classList.add('hover-preview');
        } else {
          starElement.classList.remove('hover-preview');
        }
      });
    }
  });
}

// Stern-Highlight zurücksetzen
function resetStarHighlight(songId: string) {
  // Variante 1: Alle Rating-Container für diesen Song finden (Parent hat data-song-id)
  const parentContainers = document.querySelectorAll(`[data-song-id="${songId}"]`);
  parentContainers.forEach(container => {
    const stars = container.querySelectorAll('.star, .rating-star');
    stars.forEach(star => {
      star.classList.remove('hover-preview');
    });
  });
  
  // Variante 2: Rating-Container mit direktem data-song-id (Queue-Elemente)
  const directContainers = document.querySelectorAll(`.rating-stars[data-song-id="${songId}"]`);
  directContainers.forEach(container => {
    const stars = container.querySelectorAll('.star, .rating-star');
    stars.forEach(star => {
      star.classList.remove('hover-preview');
    });
  });
  
  // Auch Player-Rating-Container für diesen Song zurücksetzen
  const playerRatings = document.querySelectorAll(`[id^="player-rating-"]`);
  playerRatings.forEach(playerRating => {
    const stars = playerRating.querySelectorAll('.star, .rating-star');
    // Prüfen ob dieser Player den Song hat
    const playerId = playerRating.id.split('-')[2] as 'a' | 'b' | 'c' | 'd'; // z.B. "a" aus "player-rating-a"
    const audio = getAudioElement(playerId);
    
    if (audio && audio.dataset.songId === songId) {
      stars.forEach(star => {
        star.classList.remove('hover-preview');
      });
    }
  });
}

// Rating asynchron laden (für bessere Performance)
async function loadRatingAsync(songId: string) {
  if (!openSubsonicClient) return;
  
  try {
    const rating = await openSubsonicClient.getRating(songId);
    if (rating !== null) {
      updateRatingDisplay(songId, rating);
    }
  } catch (error) {
    console.warn(`Failed to load rating for song ${songId}:`, error);
  }
}

// 🎵 Facade to new SourceNodeCache module
// This ensures all calls route through the centralized cache
function getOrCreateSourceNode(audioElement: HTMLAudioElement): MediaElementAudioSourceNode | null {
  if (!audioContext) {
    console.warn('⚠️ AudioContext not available');
    return null;
  }
  
  // Route to new SourceNodeCache module
  return getOrCreateSourceNodeNew(audioElement, audioContext);
}

/**
 * @deprecated LEGACY: Replaced by VolumeMeters module (Phase 6)
 * This function is no longer needed - meters are now managed by initializeVolumeMeters()
 * Kept for backwards compatibility but should not be called.
 */
function startVolumeMeter(side: 'a' | 'b' | 'c' | 'd' | 'mic' | 'deck-master' | 'stream-output') {
  console.warn(`⚠️ startVolumeMeter('${side}') is DEPRECATED - now handled by VolumeMeters module`);
  return; // No-op: All meters are initialized via initializeVolumeMeters()
}

function updateVolumeMeter(meterId: string, level: number) {
  const meterElement = document.getElementById(meterId);
  if (!meterElement) return;
  
  // Support für beide Meter-Typen: kompakt und regular
  const bars = meterElement.querySelectorAll('.meter-bar-compact, .meter-bar');
  
  // Sicherheitscheck: Stelle sicher, dass bars existieren und nicht leer sind
  if (!bars || bars.length === 0) {
    // console.warn(`⚠️ No meter bars found for ${meterId}`);
    return;
  }
  
  // Zusätzlicher Sicherheitscheck: Stelle sicher, dass level im gültigen Bereich ist
  const safeLevel = Math.max(0, Math.min(bars.length, level));
  
  try {
    bars.forEach((bar, index) => {
      // Sicherheitscheck für jedes Element
      if (!bar || typeof bar.classList === 'undefined') {
        return; // Überspringe ungültige Elemente
      }
      
      // Entferne alle aktiven Klassen
      bar.classList.remove('active', 'active-1', 'active-2', 'active-3', 'active-4', 'active-5', 'active-6', 'active-7', 'active-8');
      
      if (index < safeLevel) {
        // Setze die entsprechende aktive Klasse basierend auf dem Index
        bar.classList.add(`active-${index + 1}`);
      }
    });
  } catch (error) {
    console.warn(`⚠️ Error updating volume meter ${meterId}:`, error);
  }
}

// Audio Event Listeners Setup
function setupAudioEventListeners(audio: HTMLAudioElement, side: 'a' | 'b' | 'c' | 'd') {
  // Audio zu Mixing-System hinzufügen für Live-Streaming
  audio.addEventListener('loadeddata', () => {
    console.log(`?? TRACK LOADED: ${side} player audio element src: ${audio.src}`);
    
    // Ensure Web Audio API connection when track is loaded
    setTimeout(async () => {
      if (!audioContext) {
        // Audio-Mixing automatisch initialisieren wenn erster Track geladen wird
        console.log("??? Initializing audio mixing...");
        const success = await initializeAudioMixing();
        if (success) {
          console.log(`?? Connecting ${side} player to mixer (first time)`);
          const connected = connectAudioToMixer(audio, side);
          console.log(`?? Connection result for ${side}: ${connected}`);
        } else {
          console.error(`? Failed to initialize audio mixing for ${side}`);
        }
      } else {
        // Always try to connect/reconnect on loadeddata
        console.log(`?? Ensuring ${side} player is connected to mixer`);
        const connected = connectAudioToMixer(audio, side);
        console.log(`?? Connection result for ${side}: ${connected}`);
      }
    }, 50); // Small delay to ensure audio element is fully ready
  });

  // Zusätzlich: Sicherstellen dass Verbindung bei Play-Event existiert
  audio.addEventListener('play', () => {
    console.log(`🎵 PLAY EVENT: ${side} player starting playback`);
    
    // Always ensure connection on play
    if (audioContext && (aPlayerGain || bPlayerGain || cPlayerGain || dPlayerGain)) {
      if (!(audio as any)._isConnectedToMixer || (audio as any)._pendingMixerConnection) {
        console.log(`? ${side} player not connected - establishing connection NOW`);
        // Clear pending flag
        delete (audio as any)._pendingMixerConnection;
        const connected = connectAudioToMixer(audio, side);
        if (connected) {
          console.log(`? ${side} player audio routing established`);
        } else {
          console.error(`? ${side} player audio routing FAILED`);
        }
      } else {
        console.log(`? ${side} player already connected - playback ready`);
      }
    } else {
      console.warn(`? ${side} player: audioContext or gain nodes not ready yet`);
    }
  });
  
  // Add canplaythrough event as additional safety net
  audio.addEventListener('canplaythrough', () => {
    console.log(`✅ ${side} player: audio can play through`);
    
    // Final connection check before playback
    if (audioContext && !(audio as any)._isConnectedToMixer) {
      console.log(`🔧 ${side} player: Last-chance connection attempt`);
      connectAudioToMixer(audio, side);
    }
  }, { once: false }); // Keep listening for each track
}

/**
 * @deprecated LEGACY: Replaced by initializeVolumeMeters() in AudioManager init
 * All volume meters are now automatically initialized via VolumeMeters module.
 */
function autoStartVolumeMeters() {
  console.warn('⚠️ autoStartVolumeMeters() is DEPRECATED - now handled by initializeVolumeMeters()');
  return; // No-op: Meters are initialized in initializeAudioMixing()
}

// Live Streaming State
let isLiveStreaming = false;
let liveStreamStartTime: number = 0;

// Initialize Live Streaming Click Handler
function initializeLiveStreaming() {
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  
  if (streamLiveButton) {
    console.log('🔴 Live streaming button found and event listeners added');
    
    // Add click listener for normal clicks (station selection and streaming start)
    // Note: This handles single clicks, while mousedown/mouseup handle press-and-hold disconnect
    streamLiveButton.addEventListener('click', async (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔘 [${timestamp}] CLICK EVENT - Current state: ${currentButtonState}, Station ID: ${currentStationId}, isLiveStreaming: ${isLiveStreaming}`);
      
      switch (currentButtonState) {
        case StreamButtonState.SELECT_STATION:
          // Check if streaming is active - if so, block station selection
          if (isLiveStreaming) {
            console.log('🚫 Station selection blocked - streaming is active');
            alert('Cannot change station while streaming is active. Please stop the stream first.');
            return;
          }
          
          console.log('📋 Opening station selection dropdown');
          // This should be handled by the dropdown logic - let it bubble up
          break;
          
        case StreamButtonState.START_STREAMING:
          // If streaming is already active, show warning instead of triggering disconnect
          if (isLiveStreaming) {
            console.log(`🔴 [${timestamp}] CLICK blocked - stream is already active`);
            showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
            return;
          }
          
          console.log(`🚀 [${timestamp}] Starting streaming via CLICK event`);
          // Start streaming directly
          await startLiveStreaming();
          break;
          
        case StreamButtonState.STREAMING_ACTIVE:
          console.log(`⏹️ [${timestamp}] CLICK on active stream - showing press-and-hold message`);
          // Show warning instead of starting countdown via click
          showWarningMessage("stream is active!<br>press and hold for 5 seconds to disconnect");
          break;
          
        default:
          console.warn(`⚠️ Unknown button state: ${currentButtonState}`);
      }
    });

    // Add mousedown/mouseup listeners for press-and-hold disconnect functionality
    streamLiveButton.addEventListener('mousedown', (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔴 [${timestamp}] MOUSEDOWN EVENT - Current state: ${currentButtonState}, isLiveStreaming: ${isLiveStreaming}`);
      
      // Only handle mousedown for DISCONNECT when streaming is active
      if (currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
        console.log(`📋 [${timestamp}] MOUSEDOWN ignored - not in streaming mode`);
        return;
      }
      
      // Only start disconnect countdown when streaming is active
      if (isLiveStreaming) {
        console.log(`⏹️ [${timestamp}] Starting disconnect countdown (MOUSEDOWN - press and hold)`);
        startDisconnectCountdown();
      }
    });
    
    streamLiveButton.addEventListener('mouseup', (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔴 [${timestamp}] MOUSEUP EVENT - Current state: ${currentButtonState}, isLiveStreaming: ${isLiveStreaming}`);
      
      // Only handle mouseup for DISCONNECT when streaming is active
      if (currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
        console.log(`📋 [${timestamp}] MOUSEUP ignored - not in streaming mode`);
        return;
      }
      
      // Stop disconnect countdown if streaming is active
      if (isLiveStreaming) {
        console.log(`⏹️ [${timestamp}] Stopping disconnect countdown (MOUSEUP - mouse released)`);
        handleStreamButtonRelease();
      }
    });
    
    streamLiveButton.addEventListener('mouseleave', (e) => {
      const timestamp = Date.now();
      e.preventDefault();
      console.log(`🔴 [${timestamp}] MOUSELEAVE EVENT - Current state: ${currentButtonState}, isLiveStreaming: ${isLiveStreaming}`);
      
      // Only handle mouseleave for DISCONNECT when streaming is active
      if (currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
        console.log(`📋 [${timestamp}] MOUSELEAVE ignored - not in streaming mode`);
        return;
      }
      
      // Stop disconnect countdown if streaming is active
      if (isLiveStreaming) {
        console.log(`⏹️ [${timestamp}] Stopping disconnect countdown (MOUSELEAVE - mouse left)`);
        handleStreamButtonRelease();
      }
    });
    
    // Prevent context menu
    streamLiveButton.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  } else {
    console.log('❌ Live streaming button not found');
  }
}

// Handle stream button press (mousedown) - Only for disconnect countdown
function handleStreamButtonPress() {
  console.log(`🔘 handleStreamButtonPress - Current state: ${currentButtonState}, Station ID: ${currentStationId}`);
  
  // Only handle disconnect countdown when streaming is active
  if (!isLiveStreaming || currentButtonState !== StreamButtonState.STREAMING_ACTIVE) {
    console.log('🔘 Not streaming or wrong state - press ignored');
    return;
  }
  
  // Start disconnect countdown for live streaming
  console.log('⏹️ Starting disconnect countdown (streaming is active)');
  startDisconnectCountdown();
}

// Handle stream button release (mouseup/mouseleave)
function handleStreamButtonRelease() {
  const timestamp = Date.now();
  console.log(`⏹️ [${timestamp}] handleStreamButtonRelease() CALLED - isDisconnecting: ${isDisconnecting}, isLiveStreaming: ${isLiveStreaming}`);
  
  if (isDisconnecting) {
    // Stop countdown and show warning only if already connected
    console.log(`🛑 [${timestamp}] Stopping disconnect countdown`);
    stopDisconnectCountdown();
    if (isLiveStreaming) {
      // Only show warning if stream has been live for more than 1 second
      const streamDuration = Date.now() - liveStreamStartTime;
      console.log(`⏰ [${timestamp}] Stream duration: ${streamDuration}ms`);
      if (streamDuration > 1000) {
        console.log(`⚠️ [${timestamp}] Showing safety warning`);
        showWarningMessage("safety mechanism active!<br>press and hold for 5 seconds to disconnect");
      }
    }
  }
}

// Variables for disconnect timer
let disconnectTimer: NodeJS.Timeout | null = null;
let disconnectStartTime: number = 0;
let isDisconnecting: boolean = false;
const DISCONNECT_DURATION = 5000; // 5 seconds in milliseconds

// Toggle Live Streaming with Hold-to-Disconnect
function toggleLiveStreaming() {
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  
  if (!streamLiveButton) return;
  
  if (!isLiveStreaming) {
    // Start Live Streaming (instant)
    startLiveStreaming();
  } else {
    // Stop Live Streaming requires hold-to-disconnect (only if connected)
    if (isLiveStreaming) {
      // Only show warning if stream has been live for more than 1 second
      const streamDuration = Date.now() - liveStreamStartTime;
      if (streamDuration > 1000) {
        showWarningMessage("safety mechanism active!<br>press and hold for 5 seconds to disconnect");
      }
    }
  }
}

// Start Live Streaming with actual AzuraCast connection
async function startLiveStreaming() {
  const timestamp = Date.now();
  console.log(`🚀 [${timestamp}] startLiveStreaming() CALLED - Entry point`);
  
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  if (!streamLiveButton) {
    console.error(`❌ [${timestamp}] startLiveStreaming() - button not found`);
    return;
  }
  
  // Check prerequisites
  if (!currentStationId || !currentStationShortcode || !currentServerUrl) {
    console.error(`❌ [${timestamp}] startLiveStreaming() - prerequisites missing - Station ID: ${currentStationId}, Shortcode: ${currentStationShortcode}, Server: ${currentServerUrl}`);
    alert('Please select a station first before starting to stream.');
    return;
  }
  
  console.log(`🔴 STARTING LIVE STREAMING to station: ${currentStationId} (${currentStationShortcode})`);
  
  try {
    // Show loading status
    streamLiveButton.textContent = 'Connecting...';
    streamLiveButton.classList.add('connecting');
    
    // Start the actual AzuraCast streaming
    const startStreamingFunc = (window as any).__startAzuraCastStreaming;
    if (!startStreamingFunc) {
      throw new Error('AzuraCast streaming function not available');
    }
    await startStreamingFunc();
    
    // Update streaming state and UI
    isLiveStreaming = true;
    liveStreamStartTime = Date.now();
    currentButtonState = StreamButtonState.STREAMING_ACTIVE;
    
    streamLiveButton.classList.remove('connecting');
    streamLiveButton.classList.add('live');
    streamLiveButton.textContent = 'LIVE';
    
    // 🔥 Funken-Effekt für die ersten 10 Sekunden
    streamLiveButton.classList.add('sparks-effect');
    setTimeout(() => {
      streamLiveButton.classList.remove('sparks-effect');
    }, 10000);
    
    console.log('✅ LIVE STREAMING STARTED SUCCESSFULLY!');
    
  } catch (error) {
    console.error('❌ Failed to start live streaming:', error);
    alert(`Failed to start streaming: ${error instanceof Error ? error.message : String(error)}`);
    
    // Reset UI on error
    streamLiveButton.classList.remove('connecting', 'live');
    streamLiveButton.textContent = currentStationShortcode || 'ERROR';
    currentButtonState = StreamButtonState.START_STREAMING;
  }
}

// GLOBALE FUNKTION: Alle Disconnect-Effekte sofort stoppen
function clearAllDisconnectEffects() {
  console.log('🛑 CLEARING ALL DISCONNECT EFFECTS...');
  
  // Alle CSS-Klassen entfernen
  document.querySelectorAll('*').forEach(el => {
    el.classList.remove('global-flicker-weak', 'global-flicker-medium', 'global-flicker-extreme', 
                        'global-shake-weak', 'global-shake-medium', 'global-shake-crazy', 
                        'global-disco-flash', 'mixer-crt-flicker', 'mixer-crt-blur', 
                        'mixer-crt-scanlines', 'mixer-crt-static');
  });
  
  // Zusätzlich: CSS-Override einfügen um Animationen zu stoppen
  let overrideStyle = document.getElementById('disconnect-effects-override');
  if (!overrideStyle) {
    overrideStyle = document.createElement('style');
    overrideStyle.id = 'disconnect-effects-override';
    document.head.appendChild(overrideStyle);
  }
  
  overrideStyle.textContent = `
    .global-flicker-weak,
    .global-flicker-medium,
    .global-flicker-extreme,
    .global-shake-weak,
    .global-shake-medium,
    .global-shake-crazy,
    .global-disco-flash,
    .mixer-crt-flicker,
    .mixer-crt-blur,
    .mixer-crt-scanlines,
    .mixer-crt-static {
      animation: none !important;
      transform: none !important;
      filter: none !important;
      opacity: 1 !important;
      background-color: initial !important;
      box-shadow: none !important;
      background-image: none !important;
    }
  `;
  
  // Style-Override nach 500ms wieder entfernen um normale Animationen zu erlauben
  setTimeout(() => {
    if (overrideStyle && overrideStyle.parentNode) {
      overrideStyle.remove();
    }
    console.log('✅ Disconnect effects cleanup complete - normal animations restored');
  }, 500);
}

// THREE.JS EXPLOSIONS-SYSTEM
let explosionScene: THREE.Scene | null = null;
let explosionRenderer: THREE.WebGLRenderer | null = null;
let explosionCamera: THREE.PerspectiveCamera | null = null;
let explosionParticles: THREE.Points[] = [];
let smokeClouds: THREE.Points[] = [];
let animationId: number | null = null;

function initExplosionSystem() {
  // Scene erstellen
  explosionScene = new THREE.Scene();
  
  // Camera erstellen
  explosionCamera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  explosionCamera.position.z = 5;
  
  // Renderer erstellen (transparent für Overlay)
  explosionRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  explosionRenderer.setSize(window.innerWidth, window.innerHeight);
  explosionRenderer.setClearColor(0x000000, 0); // Transparenter Hintergrund
  
  // Canvas als Overlay hinzufügen
  const canvas = explosionRenderer.domElement;
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '9999';
  canvas.id = 'explosion-canvas';
  
  document.body.appendChild(canvas);
  
  console.log('🎆 Three.js explosion system initialized');
}

function createExplosion(element: Element) {
  if (!explosionScene || !explosionRenderer || !explosionCamera) return;
  
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Weltkoordinaten berechnen
  const worldX = (centerX / window.innerWidth) * 2 - 1;
  const worldY = -(centerY / window.innerHeight) * 2 + 1;
  
  // Partikel-Geometrie für Explosion
  const particles = new THREE.BufferGeometry();
  const particleCount = 100;
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  
  for (let i = 0; i < particleCount; i++) {
    const i3 = i * 3;
    
    // Startposition (Container-Position)
    positions[i3] = worldX * 2;
    positions[i3 + 1] = worldY * 2;
    positions[i3 + 2] = 0;
    
    // Zufällige Geschwindigkeit in alle Richtungen
    velocities[i3] = (Math.random() - 0.5) * 0.4;
    velocities[i3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;
    
    // Orange/Rot/Gelb Explosion-Farben
    colors[i3] = 1.0; // R
    colors[i3 + 1] = Math.random() * 0.8; // G
    colors[i3 + 2] = 0.0; // B
  }
  
  particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particles.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
  particles.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  // Partikel-Material
  const material = new THREE.PointsMaterial({
    size: 0.1,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending
  });
  
  const particleSystem = new THREE.Points(particles, material);
  particleSystem.userData = { life: 1.0, decay: 0.02 };
  
  explosionScene.add(particleSystem);
  explosionParticles.push(particleSystem);
  
  console.log(`💥 Explosion created at (${centerX}, ${centerY})`);
}

function createSmokeCloud(element: Element) {
  if (!explosionScene || !explosionRenderer || !explosionCamera) return;
  
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  // Weltkoordinaten berechnen
  const worldX = (centerX / window.innerWidth) * 2 - 1;
  const worldY = -(centerY / window.innerHeight) * 2 + 1;
  
  // Rauch-Partikel
  const smoke = new THREE.BufferGeometry();
  const smokeCount = 50;
  const positions = new Float32Array(smokeCount * 3);
  const velocities = new Float32Array(smokeCount * 3);
  const colors = new Float32Array(smokeCount * 3);
  
  for (let i = 0; i < smokeCount; i++) {
    const i3 = i * 3;
    
    // Startposition mit leichter Streuung
    positions[i3] = worldX * 2 + (Math.random() - 0.5) * 0.5;
    positions[i3 + 1] = worldY * 2 + (Math.random() - 0.5) * 0.3;
    positions[i3 + 2] = 0;
    
    // Langsame Aufwärtsbewegung
    velocities[i3] = (Math.random() - 0.5) * 0.02;
    velocities[i3 + 1] = Math.random() * 0.05 + 0.02;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.01;
    
    // Grau-Rauch-Farben
    const gray = 0.3 + Math.random() * 0.4;
    colors[i3] = gray;
    colors[i3 + 1] = gray;
    colors[i3 + 2] = gray;
  }
  
  smoke.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  smoke.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
  smoke.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  
  // Rauch-Material
  const material = new THREE.PointsMaterial({
    size: 0.15,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    blending: THREE.NormalBlending
  });
  
  const smokeSystem = new THREE.Points(smoke, material);
  smokeSystem.userData = { life: 5.0, decay: 0.004 }; // 5 Sekunden Lebensdauer
  
  explosionScene.add(smokeSystem);
  smokeClouds.push(smokeSystem);
  
  console.log(`💨 Smoke cloud created at (${centerX}, ${centerY})`);
}

function animateExplosions() {
  if (!explosionScene || !explosionRenderer || !explosionCamera) return;
  
  // Explosions-Partikel updaten
  for (let i = explosionParticles.length - 1; i >= 0; i--) {
    const particles = explosionParticles[i];
    const positions = particles.geometry.attributes.position;
    const velocities = particles.geometry.attributes.velocity;
    const material = particles.material as THREE.PointsMaterial;
    
    // Partikel bewegen
    for (let j = 0; j < positions.count; j++) {
      const j3 = j * 3;
      positions.array[j3] += velocities.array[j3];
      positions.array[j3 + 1] += velocities.array[j3 + 1];
      positions.array[j3 + 2] += velocities.array[j3 + 2];
      
      // Gravitation simulieren
      velocities.array[j3 + 1] -= 0.005;
    }
    
    positions.needsUpdate = true;
    
    // Lebensdauer reduzieren
    particles.userData.life -= particles.userData.decay;
    material.opacity = particles.userData.life;
    
    // Tote Partikel entfernen
    if (particles.userData.life <= 0) {
      explosionScene.remove(particles);
      explosionParticles.splice(i, 1);
    }
  }
  
  // Rauch-Partikel updaten
  for (let i = smokeClouds.length - 1; i >= 0; i--) {
    const smoke = smokeClouds[i];
    const positions = smoke.geometry.attributes.position;
    const velocities = smoke.geometry.attributes.velocity;
    const material = smoke.material as THREE.PointsMaterial;
    
    // Rauch bewegen
    for (let j = 0; j < positions.count; j++) {
      const j3 = j * 3;
      positions.array[j3] += velocities.array[j3];
      positions.array[j3 + 1] += velocities.array[j3 + 1];
      positions.array[j3 + 2] += velocities.array[j3 + 2];
    }
    
    positions.needsUpdate = true;
    
    // Lebensdauer reduzieren
    smoke.userData.life -= smoke.userData.decay;
    material.opacity = smoke.userData.life * 0.7; // Maximal 0.7 Opacity
    
    // Toten Rauch entfernen
    if (smoke.userData.life <= 0) {
      explosionScene.remove(smoke);
      smokeClouds.splice(i, 1);
    }
  }
  
  // Szene rendern
  explosionRenderer.render(explosionScene, explosionCamera);
  
  // Animation fortsetzen wenn Partikel vorhanden
  if (explosionParticles.length > 0 || smokeClouds.length > 0) {
    animationId = requestAnimationFrame(animateExplosions);
  } else {
    animationId = null;
  }
}

function explodeAllContainers() {
  console.log('💥🚀 EXPLODING ALL CONTAINERS! 🚀💥');
  
  // Three.js System initialisieren falls noch nicht geschehen
  if (!explosionScene) {
    initExplosionSystem();
  }
  
  // Alle Container finden (außer Mixer)
  const containers = document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library');
  
  containers.forEach((container, index) => {
    // Container verstecken mit zeitversetzter Explosion
    setTimeout(() => {
      // Explosion erstellen
      createExplosion(container);
      
      // Container ausblenden
      (container as HTMLElement).style.transition = 'opacity 0.1s ease';
      (container as HTMLElement).style.opacity = '0';
      
      // Nach kurzer Verzögerung Rauchwolke erstellen
      setTimeout(() => {
        createSmokeCloud(container);
      }, 200);
      
    }, index * 100); // Gestaffelte Explosionen
  });
  
  // Animation starten
  if (!animationId) {
    animateExplosions();
  }
  
  // Nach 5 Sekunden Container wieder einblenden
  setTimeout(() => {
    fadeInContainers();
  }, 5000);
}

function fadeInContainers() {
  console.log('✨ Fading containers back in...');
  
  const containers = document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library');
  
  containers.forEach((container, index) => {
    setTimeout(() => {
      (container as HTMLElement).style.transition = 'opacity 1s ease';
      (container as HTMLElement).style.opacity = '1';
    }, index * 100); // Gestaffelte Wiedereinblendung
  });
  
  // Explosions-System nach weiteren 2 Sekunden aufräumen
  setTimeout(cleanupExplosionSystem, 2000);
}

function cleanupExplosionSystem() {
  console.log('🧹 Cleaning up explosion system...');
  
  // Animation stoppen
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  
  // Arrays leeren
  explosionParticles.length = 0;
  smokeClouds.length = 0;
  
  // Canvas entfernen
  const canvas = document.getElementById('explosion-canvas');
  if (canvas) {
    canvas.remove();
  }
  
  // Three.js Objekte aufräumen
  if (explosionRenderer) {
    explosionRenderer.dispose();
    explosionRenderer = null;
  }
  
  explosionScene = null;
  explosionCamera = null;
  
  console.log('✅ Explosion system cleaned up');
}

// Stop Live Streaming (only after successful disconnect countdown)
function stopLiveStreaming() {
  const timestamp = Date.now();
  console.log(`⏹️ [${timestamp}] stopLiveStreaming() CALLED - WHO CALLED ME?`);
  console.trace(`📍 [${timestamp}] STACK TRACE for stopLiveStreaming()`);
  
  const streamLiveButton = document.getElementById('stream-live-status') as HTMLButtonElement;
  const streamUsernameDisplay = document.getElementById('stream-username-display') as HTMLSpanElement;
  if (!streamLiveButton) {
    console.error(`❌ [${timestamp}] stopLiveStreaming() - button not found`);
    return;
  }
  
  console.log(`⏹️ [${timestamp}] STOPPING LIVE STREAMING UI EFFECTS...`);
  
  // 🔌 WICHTIG: AzuraCast-Verbindung trennen!
  console.log(`🔌 [${timestamp}] Disconnecting from AzuraCast...`);
  if (azuraCastWebcaster) {
    try {
      azuraCastWebcaster.disconnect();
      console.log(`✅ [${timestamp}] AzuraCast webcaster disconnected successfully`);
    } catch (error) {
      console.error(`❌ [${timestamp}] Error disconnecting AzuraCast:`, error);
    }
    azuraCastWebcaster = null;
  } else {
    console.warn(`⚠️ [${timestamp}] No AzuraCast webcaster to disconnect`);
  }
  
  isLiveStreaming = false;
  isStreaming = false; // Auch den allgemeinen Streaming-Status zurücksetzen
  streamLiveButton.classList.remove('live', 'connecting');
  streamLiveButton.textContent = 'STREAM';
  
  // Reset button state to station selection after disconnect
  currentButtonState = StreamButtonState.SELECT_STATION;
  currentStationId = null;  
  currentStationShortcode = null;
  currentServerUrl = null;
  
  // Hide reset button since no station is selected
  const resetButton = document.getElementById('stream-reset-button') as HTMLButtonElement;
  if (resetButton) {
    resetButton.style.display = 'none';
  }
  
  // Update button appearance using the proper update function
  const updateStreamButton = (window as any).__updateStreamButton;
  if (typeof updateStreamButton === 'function') {
    console.log('🔄 Calling global updateStreamButton to reset UI');
    updateStreamButton();
  } else {
    // Fallback: manual button update
    console.log('🔄 Using fallback UI update');
    streamLiveButton.classList.remove('occupied', 'connected');
    streamLiveButton.classList.add('disconnected');
    if (streamUsernameDisplay) {
      streamUsernameDisplay.textContent = 'Select Station';
    }
  }  // 🛑 SOFORTIGE EFFEKT-BEREINIGUNG!
  clearAllDisconnectEffects();
  
  console.log('⏹️ LIVE STREAMING UI EFFECTS STOPPED - ALL EFFECTS CLEANED UP!');
  console.log('🔄 Button state reset to SELECT_STATION');
}

// Show warning message for short clicks
function showWarningMessage(message: string) {
  const overlay = document.getElementById('disconnect-timer-overlay');
  const warningMessage = document.getElementById('timer-warning-message');
  const timerDisplay = document.getElementById('digital-timer-display');
  
  if (!overlay || !warningMessage || !timerDisplay) return;
  
  // Reset any previous animations
  overlay.classList.remove('crt-poweroff', 'crt-poweroff-warning');
  
  // Hide timer display, show only warning
  timerDisplay.style.display = 'none';
  warningMessage.innerHTML = message;
  warningMessage.style.display = 'block';
  
  overlay.classList.add('active');
  
  // Hide warning after 4 seconds with CRT power-off effect
  setTimeout(() => {
    overlay.classList.add('crt-poweroff-warning');
    
    // Actually hide after animation completes
    setTimeout(() => {
      overlay.classList.remove('active', 'crt-poweroff-warning');
      timerDisplay.style.display = 'block';
      warningMessage.style.display = 'block';
    }, 400); // Match new faster animation duration
  }, 4000);
}

// Start disconnect countdown
function startDisconnectCountdown() {
  const timestamp = Date.now();
  console.log(`⏰ [${timestamp}] startDisconnectCountdown() CALLED - isDisconnecting: ${isDisconnecting}`);
  
  if (isDisconnecting) {
    console.log(`⚠️ [${timestamp}] Already disconnecting - ignoring startDisconnectCountdown()`);
    return;
  }
  
  const overlay = document.getElementById('disconnect-timer-overlay');
  const timerDisplay = document.getElementById('digital-timer-display');
  
  if (!overlay || !timerDisplay) {
    console.error(`❌ [${timestamp}] Missing overlay or timer display elements`);
    return;
  }
  
  // WICHTIG: Erst alles vorbereiten, dann Timer starten!
  console.log(`🔥 [${timestamp}] Starting disconnect countdown`);
  isDisconnecting = true;
  overlay.classList.add('active');
  
  // Warten bis Overlay definitiv sichtbar ist, dann Timer starten
  requestAnimationFrame(() => {
    // Jetzt erst den Timer starten wenn alles bereit ist
    disconnectStartTime = Date.now();
    
    // Start countdown animation
    disconnectTimer = setInterval(() => {
      const elapsed = Date.now() - disconnectStartTime;
      const remaining = Math.max(0, DISCONNECT_DURATION - elapsed);
      const seconds = remaining / 1000;
      
      // Update timer display with 5 decimal places
      timerDisplay.textContent = `disconnecting in: ${seconds.toFixed(5)}`;
      
      // Apply progressive effects based on remaining time
      applyProgressiveTimerEffects(overlay, seconds);
      
      if (remaining <= 0) {
        // Countdown complete - SOFORT alle Effekte stoppen!
        clearInterval(disconnectTimer!);
        disconnectTimer = null;
        isDisconnecting = false;
        
        // 🛑 SOFORT alle globalen Effekte entfernen BEVOR irgendwas anderes passiert!
        clearAllDisconnectEffects();
        
        // 💥 CONTAINER EXPLOSION FINALE! 💥
        explodeAllContainers();
        
        // Start CRT power-off animation
        overlay.classList.add('crt-poweroff');
        
        // Remove all timer effects
        overlay.classList.remove('timer-shake-1', 'timer-shake-2', 'timer-shake-3', 'timer-shake-4', 'timer-shake-extreme');
        
        // Actually disconnect and hide after animation completes
        setTimeout(() => {
          overlay.classList.remove('active', 'crt-poweroff');
          overlay.className = 'disconnect-timer-overlay';
          
          // Actually disconnect
          stopLiveStreaming();
        }, 300); // Match new faster animation duration
      }
    }, 10); // Update every 10ms for smooth countdown
  }); // Close requestAnimationFrame
}

// Stop disconnect countdown
function stopDisconnectCountdown() {
  const timestamp = Date.now();
  console.log(`🛑 [${timestamp}] stopDisconnectCountdown() CALLED - isDisconnecting: ${isDisconnecting}, has timer: ${!!disconnectTimer}`);
  
  if (disconnectTimer) {
    console.log(`⏰ [${timestamp}] Clearing disconnect timer`);
    clearInterval(disconnectTimer);
    disconnectTimer = null;
  }
  
  console.log(`🔄 [${timestamp}] Setting isDisconnecting = false`);
  isDisconnecting = false;
  
  const overlay = document.getElementById('disconnect-timer-overlay');
  if (overlay) {
    console.log(`🎭 [${timestamp}] Hiding disconnect overlay`);
    overlay.classList.remove('active');
    // Remove all timer effects
    overlay.className = 'disconnect-timer-overlay';
  }
  
  // 🛑 SOFORTIGE EFFEKT-BEREINIGUNG!
  clearAllDisconnectEffects();
  
  // 🧹 Explosions-System aufräumen falls aktiv
  if (explosionScene || explosionRenderer) {
    cleanupExplosionSystem();
  }
  
  console.log('🛑 All global disconnect effects STOPPED!');
}

// Apply progressive timer effects based on remaining time
function applyProgressiveTimerEffects(overlay: HTMLElement, seconds: number) {
  const timerDisplay = document.getElementById('digital-timer-display');
  if (!timerDisplay) return;
  
  // Remove all previous effect classes first
      overlay.classList.remove('timer-shake-1', 'timer-shake-2', 'timer-shake-3', 'timer-shake-4');
      timerDisplay.classList.remove('timer-color-urgent', 'timer-color-critical');  // IMMER alle globalen Effekte von allen Elementen entfernen
  document.querySelectorAll('*').forEach(el => {
    el.classList.remove('global-flicker-weak', 'global-flicker-medium', 'global-flicker-extreme', 
                        'global-shake-weak', 'global-shake-medium', 'global-shake-crazy', 
                        'global-disco-flash', 'mixer-crt-flicker', 'mixer-crt-blur', 
                        'mixer-crt-scanlines', 'mixer-crt-static');
  });
  
  if (seconds > 4.0) {
    // 5.0 - 4.0 seconds: Minimal effects
    overlay.classList.add('timer-shake-1');
  } else if (seconds > 3.0) {
    // 4.0 - 3.0 seconds: Light effects + schwache globale Effekte
    overlay.classList.add('timer-shake-2');
    timerDisplay.classList.add('timer-color-urgent');
    
    // SCHWACHE globale Effekte für wichtige UI-Elemente + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .music-library').forEach(el => {
      el.classList.add('global-flicker-weak', 'global-shake-weak');
    });
    
    // Spezielle CRT-Effekte für Mixer (ohne Bewegung)
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker');
    });
    
  } else if (seconds > 2.0) {
    // 3.0 - 2.0 seconds: Moderate effects + mittlere globale Effekte
    overlay.classList.add('timer-shake-3');
    timerDisplay.classList.add('timer-color-critical');
    
    // MITTLERE globale Effekte für mehr Elemente + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .music-library').forEach(el => {
      el.classList.add('global-flicker-medium', 'global-shake-medium');
    });
    
    // Mittlere CRT-Effekte für Mixer
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker', 'mixer-crt-blur');
    });
    
  } else if (seconds > 1.0) {
    // 2.0 - 1.0 seconds: Heavy effects + starke globale Effekte
    overlay.classList.add('timer-shake-4');
    timerDisplay.classList.add('timer-color-critical');
    
    // STARKE globale Effekte + erste Disco-Blitze + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library').forEach(el => {
      el.classList.add('global-flicker-extreme', 'global-shake-crazy');
      if (Math.random() > 0.7) el.classList.add('global-disco-flash');
    });
    
    // Starke CRT-Effekte für Mixer
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker', 'mixer-crt-blur', 'mixer-crt-scanlines');
    });
    
  } else {
    // 1.0 - 0.0 seconds: Finale intensive Effekte (aber kontrolliert)
    overlay.classList.add('timer-shake-4');
    timerDisplay.classList.add('timer-color-critical');
    
    // Intensive Effekte nur für wichtige Bereiche + Music Library
    document.querySelectorAll('.player-deck, .breadcrumb-bar, .crossfader-container, .volume-meter, .mic-controls, .queue-container, .content-section, .music-library').forEach(el => {
      el.classList.add('global-flicker-extreme', 'global-shake-crazy');
      if (Math.random() > 0.5) el.classList.add('global-disco-flash');
    });
    
    // MAXIMALE CRT-Effekte für Mixer (immer noch ohne Bewegung)
    document.querySelectorAll('.mixer-section').forEach(el => {
      el.classList.add('mixer-crt-flicker', 'mixer-crt-blur', 'mixer-crt-scanlines', 'mixer-crt-static');
    });
    
    console.log('🚨 FINAL COUNTDOWN - MAXIMUM INTENSITY! 🚨');
  }
}

// Recent Albums Funktion entfernt - wird nicht mehr benötigt

// ======= MEDIA LIBRARY FUNCTIONS =======

// Initialize Media Library with Unified Browser
function initializeMediaLibrary() {
  console.log("🎵 LIBRARY DEBUG: initializeMediaLibrary() called");
  
  // Check if auto-login credentials are available
  const envUrl = getConfigValue('VITE_OPENSUBSONIC_URL');
  const envUsername = getConfigValue('VITE_OPENSUBSONIC_USERNAME');
  const envPassword = getConfigValue('VITE_OPENSUBSONIC_PASSWORD');
  
  console.log("🎵 LIBRARY DEBUG: Environment variables:", {
    envUrl: !!envUrl,
    envUsername: !!envUsername,
    envPassword: !!envPassword,
    actualUrl: envUrl
  });
  
  // Unified Login Configuration
  const useUnifiedLogin = getConfigValue('VITE_USE_UNIFIED_LOGIN') === 'true';
  
  // Note: Unified credentials are stored server-side only (UNIFIED_USERNAME/UNIFIED_PASSWORD)
  // They are never exposed to frontend for security
  
  // Determine final credentials based on login type
  const finalUsername = envUsername; // Direct login uses VITE_OPENSUBSONIC_USERNAME
  const finalPassword = envPassword; // Direct login uses VITE_OPENSUBSONIC_PASSWORD
  
  console.log("🎵 LIBRARY DEBUG: Final credentials:", {
    finalUsername: !!finalUsername,
    finalPassword: !!finalPassword,
    useUnifiedLogin,
    note: useUnifiedLogin ? 'Unified credentials stored server-side only' : 'Using direct credentials'
  });
  
  // Check if we have all required credentials for login
  const hasRequiredCredentials = envUrl && finalUsername && finalPassword;
  
  console.log("🔒 UNIFIED LOGIN DEBUG:", {
    envUrl: !!envUrl,
    useUnifiedLogin,
    note: 'Unified credentials are server-side only (UNIFIED_USERNAME/UNIFIED_PASSWORD)',
    envUsername: !!envUsername,
    envPassword: !!envPassword,
    finalUsername: !!finalUsername,
    finalPassword: !!finalPassword,
    hasRequiredCredentials
  });
  
  // If credentials are available, delay showing login hint to allow auto-login to complete
  if (hasRequiredCredentials) {
    console.log("🔄 Auto-login credentials detected, waiting for auto-login...");
    
    // Wait for auto-login with multiple checks
    let checkCount = 0;
    const maxChecks = 10; // Max 5 seconds
    
    const checkAutoLogin = () => {
      checkCount++;
      console.log(`🎵 LIBRARY DEBUG: Auto-login check ${checkCount}/${maxChecks}:`, {
        isOpenSubsonicLoggedIn,
        autoLoginInProgress,
        libraryBrowser: !!libraryBrowser
      });
      
      if (isOpenSubsonicLoggedIn) {
        console.log("🎵 LIBRARY DEBUG: Auto-login successful!");
        // Login successful, library should already be initialized
        return;
      }
      
      if (!autoLoginInProgress && checkCount >= maxChecks) {
        console.log("🎵 LIBRARY DEBUG: Auto-login timeout, showing login hint");
        showLoginHintForLibrary();
        return;
      }
      
      if (autoLoginInProgress || checkCount < maxChecks) {
        // Still in progress or not enough time passed, check again
        setTimeout(checkAutoLogin, 500);
      }
    };
    
    // Start checking after a short delay
    setTimeout(checkAutoLogin, 500);
  } else {
    console.log("🎵 LIBRARY DEBUG: Missing required credentials, showing login hint immediately");
    console.log("🔒 MISSING:", {
      url: !envUrl ? "OpenSubsonic URL" : null,
      username: !finalUsername ? (useUnifiedLogin ? "Unified Username" : "OpenSubsonic Username") : null,
      password: !finalPassword ? (useUnifiedLogin ? "Unified Password" : "OpenSubsonic Password") : null
    });
    // Missing required credentials, show login hint immediately
    showLoginHintForLibrary();
  }
}

// Zeige Login-Hinweis für Media Library
function showLoginHintForLibrary() {
  console.log("🔒 showLoginHintForLibrary called");
  
  // Show login hint in the browser content
  const browseContent = document.getElementById('browse-content');
  if (browseContent) {
    console.log("📦 Setting login hint in browse-content");
    browseContent.innerHTML = `
      <div class="library-login-hint">
        <div class="login-prompt">
          <span class="material-icons">lock</span>
          <h3>Login Required</h3>
          <p>Please login to your OpenSubsonic server to browse and play music</p>
        </div>
      </div>
    `;
  } else {
    console.error("❌ browse-content not found for login hint");
  }
}

// Aktiviere Media Library nach erfolgreichem Login
function enableLibraryAfterLogin() {
  console.log("🔓 LIBRARY DEBUG: enableLibraryAfterLogin called!");
  console.log("📡 LIBRARY DEBUG: openSubsonicClient available:", !!openSubsonicClient);
  
  const browseContent = document.getElementById('browse-content');
  console.log("📦 LIBRARY DEBUG: browse-content element found:", !!browseContent);
  
  if (!browseContent) {
    console.error("❌ LIBRARY DEBUG: browse-content element not found!");
    return;
  }
  
  // Initialize and show the library browser with content
  // Queue the initialization to run after all classes are defined
  const initLibraryBrowser = () => {
    try {
      console.log("🚀 LIBRARY DEBUG: Creating new LibraryBrowser...");
      console.log("🚀 LIBRARY DEBUG: pendingInitializations queue length:", pendingInitializations.length);
      libraryBrowser = new LibraryBrowser();
      console.log("✅ LIBRARY DEBUG: LibraryBrowser created successfully");
    } catch (error) {
      console.error("❌ LIBRARY DEBUG: Error initializing LibraryBrowser:", error);
      showLoginHintForLibrary();
    }
  };
  
  // Add to pending initializations queue and trigger immediate execution
  console.log("🔄 LIBRARY DEBUG: Adding initLibraryBrowser to pending queue");
  pendingInitializations.push(initLibraryBrowser);
  console.log("🔄 LIBRARY DEBUG: Queue length after adding:", pendingInitializations.length);
  
  // Trigger execution immediately since we know we're logged in
  setTimeout(() => {
    console.log("🚀 LIBRARY DEBUG: Executing pending initializations immediately");
    if (pendingInitializations.length > 0) {
      const initFns = [...pendingInitializations]; // Copy the array
      pendingInitializations = []; // Clear the queue
      initFns.forEach((initFn, index) => {
        try {
          initFn();
          console.log(`✅ Immediate pending initialization ${index + 1} completed`);
        } catch (error) {
          console.error(`❌ Immediate pending initialization ${index + 1} failed:`, error);
        }
      });
    }
  }, 50); // Very short delay to ensure DOM is ready
}

// Load content for Browse tab
async function loadBrowseContent() {
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for browse content');
    return;
  }

  console.log('Starting to load browse content...');

  try {
    // Load all sections in parallel
    await Promise.all([
      loadRecentAlbums(),
      loadRandomAlbums(),
      loadRandomArtists()
    ]);
    
    console.log('✅ All browse content loaded successfully');
  } catch (error) {
    console.error('Failed to load browse content:', error);
  }
}

// Legacy function wrappers - delegate to MediaContainer for consistency
function createAlbumCard(album: OpenSubsonicAlbum): HTMLElement {
  // Create temporary container for legacy compatibility
  const tempContainer = document.createElement('div');
  tempContainer.id = 'temp-album-container-' + Date.now();
  document.body.appendChild(tempContainer);
  
  const mediaContainer = new MediaContainer({
    containerId: tempContainer.id,
    items: [{
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }],
    displayMode: 'grid',
    itemType: 'album',
    onItemClick: () => loadAlbumTracks(album)
  });
  
  mediaContainer.render();
  const element = tempContainer.firstElementChild as HTMLElement;
  document.body.removeChild(tempContainer);
  return element || document.createElement('div');
}

function createArtistCard(artist: OpenSubsonicArtist): HTMLElement {
  // Create temporary container for legacy compatibility  
  const tempContainer = document.createElement('div');
  tempContainer.id = 'temp-artist-container-' + Date.now();
  document.body.appendChild(tempContainer);
  
  const mediaContainer = new MediaContainer({
    containerId: tempContainer.id,
    items: [{
      id: artist.id,
      name: artist.name,
      type: 'artist' as const,
      coverArt: artist.coverArt
    }],
    displayMode: 'grid', 
    itemType: 'artist',
    onItemClick: () => loadArtistAlbums(artist)
  });
  
  mediaContainer.render();
  const element = tempContainer.firstElementChild as HTMLElement;
  document.body.removeChild(tempContainer);
  return element || document.createElement('div');
}

// Load tracks from an album and display results
async function loadAlbumTracks(album: OpenSubsonicAlbum) {
  if (!openSubsonicClient) return;

  try {
    console.log(`Loading tracks for album: ${album.name}`);
    
    // Load album tracks
    const tracks = await openSubsonicClient.getAlbumTracks(album.id);
    
    // Show album detail view in browse tab
    showAlbumDetailView(album, tracks);
  } catch (error) {
    console.error('Failed to load album tracks:', error);
  }
}

// Load albums from an artist and display in detail view
async function loadArtistAlbums(artist: OpenSubsonicArtist) {
  if (!openSubsonicClient) return;

  try {
    console.log(`Loading albums for artist: ${artist.name}`);
    
    // Load artist albums
    const albums = await openSubsonicClient.getArtistAlbums(artist.id);
    
    // Show artist detail view in browse tab
    showArtistDetailView(artist, albums);
  } catch (error) {
    console.error('Failed to load artist albums:', error);
  }
}

// Generate star rating HTML
function generateStarRating(rating: number): string {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= rating ? 'filled' : '';
    stars.push(`<span class="star ${filled}" data-rating="${i}">★</span>`);
  }
  return stars.join('');
}

// Update track rating
async function updateTrackRating(trackId: string, rating: number) {
  if (!openSubsonicClient) return;
  
  try {
    // Update rating via OpenSubsonic API
    await openSubsonicClient.setRating(trackId, rating);
    console.log(`Rated track ${trackId}: ${rating} stars`);
    
    // Update all star rating displays for this track
    updateAllStarDisplays(trackId, rating);
  } catch (error) {
    console.error('Failed to update track rating:', error);
  }
}

// Update all star rating displays for a track
function updateAllStarDisplays(trackId: string, rating: number) {
  // Find all star rating containers for this track (handles both data-song-id and data-track-id)
  const starContainers = document.querySelectorAll(`[data-track-id="${trackId}"] .star-rating, [data-song-id="${trackId}"] .star-rating, [data-song-id="${trackId}"] .rating-stars`);
  
  starContainers.forEach(container => {
    const stars = container.querySelectorAll('.star');
    stars.forEach((star, index) => {
      star.classList.toggle('filled', index < rating);
    });
  });
}

// Show album detail view
function showAlbumDetailView(album: OpenSubsonicAlbum, tracks: OpenSubsonicSong[]) {
  const browseContent = document.getElementById('browse-content');
  if (!browseContent) return;

  // Hide all sections
  const sections = browseContent.querySelectorAll('.media-section');
  sections.forEach(section => {
    (section as HTMLElement).style.display = 'none';
  });

  // Remove existing detail view
  const existingDetail = browseContent.querySelector('.detail-view');
  if (existingDetail) {
    existingDetail.remove();
  }

  // Create album detail view
  const detailView = document.createElement('div');
  detailView.className = 'detail-view';
  
  const coverUrl = album.coverArt 
    ? openSubsonicClient.getCoverArtUrl(album.coverArt, 300)
    : '';

  detailView.innerHTML = `
    <div class="album-detail">
      <div class="album-info">
        <button class="back-btn" onclick="showBrowseView()">
          <span class="material-icons">arrow_back</span> Back
        </button>
        <div class="album-info-content">
          <div class="album-cover-large">
            ${coverUrl 
              ? `<img src="${coverUrl}" alt="${album.name}">`
              : '<span class="material-icons">album</span>'
            }
          </div>
          <div class="album-meta">
            <h2>${album.name}</h2>
            <h3>${album.artist || 'Unknown Artist'}</h3>
            ${album.year ? `<p>Year: ${album.year}</p>` : ''}
            <p>${tracks.length} tracks</p>
          </div>
        </div>
      </div>
      <div class="track-list">
        <h4>Tracks</h4>
        <div class="tracks" id="album-tracks-container">
        </div>
      </div>
    </div>
  `;

  browseContent.appendChild(detailView);
  
  // Create unified song elements for tracks
  const tracksContainer = detailView.querySelector('#album-tracks-container');
  if (tracksContainer) {
    tracks.forEach(track => {
      const songElement = createUnifiedSongElement(track, 'album');
      tracksContainer.appendChild(songElement);
    });
  }
  
  // Load waveform backgrounds for tracks asynchronously
  requestAnimationFrame(() => {
    setTimeout(() => {
      console.log('🌊 [AlbumView] Loading waveforms for album tracks...');
      loadVisibleSongWaveforms(detailView);
    }, 150);
  });
  
  // Add rating handlers
  const ratingContainers = detailView.querySelectorAll('.track-rating');
  ratingContainers.forEach(container => {
    const trackId = container.getAttribute('data-track-id');
    const stars = container.querySelectorAll('.star');
    
    stars.forEach((star, index) => {
      const starElement = star as HTMLElement;
      
      // Hover effects
      starElement.addEventListener('mouseenter', () => {
        stars.forEach((s, i) => {
          s.classList.toggle('hover', i <= index);
        });
      });
      
      starElement.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hover'));
      });
      
      // Click to rate
      starElement.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rating = parseInt(starElement.getAttribute('data-rating') || '0');
        await updateTrackRating(trackId!, rating);
      });
    });
  });
}

// Show artist detail view
function showArtistDetailView(artist: OpenSubsonicArtist, albums: OpenSubsonicAlbum[]) {
  const browseContent = document.getElementById('browse-content');
  if (!browseContent) return;

  // Hide all sections
  const sections = browseContent.querySelectorAll('.media-section');
  sections.forEach(section => {
    (section as HTMLElement).style.display = 'none';
  });

  // Remove existing detail view
  const existingDetail = browseContent.querySelector('.detail-view');
  if (existingDetail) {
    existingDetail.remove();
  }

  // Create artist detail view
  const detailView = document.createElement('div');
  detailView.className = 'detail-view';
  
  const artistImageUrl = getArtistImageUrl(artist.artistImageUrl, 300) 
    || (artist.coverArt ? openSubsonicClient.getCoverArtUrl(artist.coverArt, 300) : '');

  detailView.innerHTML = `
    <div class="detail-header">
      <button class="back-btn" onclick="showBrowseView()">
        <span class="material-icons">arrow_back</span> Back to Browse
      </button>
    </div>
    <div class="artist-detail">
      <div class="artist-info">
        <div class="artist-image-large">
          ${artistImageUrl 
            ? `<img src="${artistImageUrl}" alt="${artist.name}">`
            : '<span class="material-icons">person</span>'
          }
        </div>
        <div class="artist-meta">
          <h2>${artist.name}</h2>
          ${artist.albumCount ? `<p>${artist.albumCount} albums</p>` : ''}
        </div>
      </div>
      <div class="albums-section">
        <h3>Albums</h3>
        <div class="albums-grid" id="artist-albums">
          <!-- Albums will be rendered here -->
        </div>
      </div>
    </div>
  `;

  browseContent.appendChild(detailView);
  
  // Render albums using the same modern card style as homepage
  const albumsGrid = document.getElementById('artist-albums');
  if (albumsGrid) {
    albums.forEach((album: OpenSubsonicAlbum) => {
      const albumHTML = createAlbumHTML(album);
      albumsGrid.insertAdjacentHTML('beforeend', albumHTML);
    });
    
    // Add click listeners to album cards
    const albumCards = albumsGrid.querySelectorAll('.album-item-modern');
    albumCards.forEach((card) => {
      card.addEventListener('click', () => {
        const albumId = card.getAttribute('data-album-id');
        const album = albums.find((a: OpenSubsonicAlbum) => a.id === albumId);
        if (album) loadAlbumTracks(album);
      });
    });
  }
}

// Helper function to generate clickable multi-artist HTML for albums
function getAlbumArtistHtml(album: OpenSubsonicAlbum): string {
  // Check for albumArtists or artists array (multi-artist support)
  const artistsArray = album.albumArtists || album.artists;
  
  if (artistsArray && artistsArray.length > 1) {
    // Multiple artists - render as clickable links separated by bullet
    return artistsArray.map(artist => 
      `<span class="clickable-artist" data-artist-id="${artist.id}" data-artist-name="${escapeHtml(artist.name)}">${escapeHtml(artist.name)}</span>`
    ).join(' <span class="artist-separator">•</span> ');
  } else if (artistsArray && artistsArray.length === 1) {
    // Single artist from array
    return `<span class="clickable-artist" data-artist-id="${artistsArray[0].id}" data-artist-name="${escapeHtml(artistsArray[0].name)}">${escapeHtml(artistsArray[0].name)}</span>`;
  } else {
    // Fallback to single artist string
    return `<span class="clickable-artist" data-artist-id="${album.artistId || ''}" data-artist-name="${escapeHtml(album.artist)}">${escapeHtml(album.artist)}</span>`;
  }
}

// Unified Library Browser System
interface BrowseContext {
  type: 'home' | 'artist' | 'album' | 'search' | 'wizard' | 'playlist';
  data?: any;
  breadcrumbs: BreadcrumbItem[];
}

interface BreadcrumbItem {
  label: string;
  type: 'home' | 'artist' | 'album' | 'wizard' | 'playlist';
  id?: string;
  action: () => void;
  multipleArtists?: OpenSubsonicArtistRef[];  // For multi-artist albums
}

class LibraryBrowser {
  private currentContext: BrowseContext = {
    type: 'home',
    breadcrumbs: [{ label: 'Library', type: 'home', action: () => this.showHome() }]
  };

  private container: HTMLElement;
  private navigationHistory: NavigationHistory;

  constructor() {
    console.log("🏗️ LibraryBrowser constructor called");
    this.container = document.getElementById('browse-content')!;
    
    // Create navigation history instance
    if (!navigationHistory) {
      navigationHistory = new NavigationHistory();
    }
    this.navigationHistory = navigationHistory;
    
    if (!this.container) {
      console.error("❌ browse-content container not found in LibraryBrowser constructor!");
      throw new Error("Container 'browse-content' not found");
    }
    
    console.log("📦 Container found:", this.container);
    console.log("🔧 Initializing browser...");
    this.initializeBrowser();
    console.log("✅ LibraryBrowser initialization complete");
  }

  private initializeBrowser() {
    // Create compact navigation header with tilted breadcrumbs and search
    const header = document.createElement('div');
    header.className = 'library-header';
    header.innerHTML = `
      <div class="compact-nav-container">
        <div class="tilted-breadcrumbs" id="breadcrumbs"></div>
        <div class="tilted-search-container">
          <input type="text" id="search-input" placeholder="Search...">
          <button id="search-btn"><span class="material-icons">search</span></button>
        </div>
      </div>
    `;

    // Create content area
    const content = document.createElement('div');
    content.className = 'library-content';
    content.id = 'library-content';

    this.container.innerHTML = '';
    this.container.appendChild(header);
    this.container.appendChild(content);

    this.updateBreadcrumbs();
    
    // Only show home content if we have an authenticated client
    if (openSubsonicClient) {
      this.showHome();
    } else {
      content.innerHTML = '<div class="loading-placeholder">Initializing library...</div>';
    }

    // Setup search
    this.setupSearch();
  }

  private updateBreadcrumbs() {
    const breadcrumbContainer = document.getElementById('breadcrumbs')!;
    breadcrumbContainer.innerHTML = this.currentContext.breadcrumbs
      .map((item, index) => {
        const isLast = index === this.currentContext.breadcrumbs.length - 1;
        
        // Check if this breadcrumb has multiple artists
        const multipleArtists = (item as any).multipleArtists as OpenSubsonicArtistRef[] | undefined;
        
        if (multipleArtists && multipleArtists.length > 1) {
          // Render multiple clickable artists separated by bullet
          const artistsHtml = multipleArtists.map((artist, artistIndex) => {
            return `<span class="breadcrumb-artist clickable" onclick="libraryBrowser.navigateToArtistById('${artist.id}', '${escapeHtml(artist.name).replace(/'/g, '\\\'')}')">${escapeHtml(artist.name)}</span>`;
          }).join(' <span class="artist-separator">•</span> ');
          
          return `<div class="tilted-breadcrumb-item ${isLast ? 'active' : 'clickable'}">
                    ${artistsHtml}
                  </div>`;
        } else {
          // Single breadcrumb item
          return `<div class="tilted-breadcrumb-item ${isLast ? 'active' : 'clickable'}" 
                        ${!isLast ? `onclick="libraryBrowser.navigateToBreadcrumb(${index})"` : ''}>
                    ${item.label}
                  </div>`;
        }
      })
      .join('');
  }

  navigateToBreadcrumb(index: number) {
    const breadcrumb = this.currentContext.breadcrumbs[index];
    breadcrumb.action();
  }

  navigateToArtistById(artistId: string, artistName: string) {
    this.showArtist({ id: artistId, name: artistName } as OpenSubsonicArtist);
  }

  private async loadHausaufgabenContent(playlist: OpenSubsonicPlaylist) {
    const content = document.getElementById('library-content')!;
    content.innerHTML = `
      <div class="album-header">
        <div class="album-info">
          <div class="album-cover-large">
            <div class="playlist-cover-large">
              <span class="material-icons" style="font-size: 120px; color: #ff6b6b;">school</span>
              <div class="playlist-overlay-large">Playlist</div>
            </div>
          </div>
          <div class="album-details">
            <h1 class="album-name">${escapeHtml(playlist.name)}</h1>
            <p class="album-artist">Hausaufgaben Playlist</p>
            <p class="album-year">${playlist.songCount} Songs • ${Math.floor((playlist.duration || 0) / 60)} Minutes</p>
          </div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="section-title">Songs</h3>
        <div class="songs-container" id="playlist-songs">
          <div class="loading-placeholder">Loading playlist...</div>
        </div>
      </div>
    `;

    // Load playlist songs
    try {
      const playlistDetails = await openSubsonicClient.getPlaylist(playlist.id);
      
      const songsContainer = document.getElementById('playlist-songs')!;
      if (playlistDetails && playlistDetails.entry && playlistDetails.entry.length > 0) {
        const songsListContainer = createUnifiedSongsContainer(playlistDetails.entry, 'album');
        songsContainer.innerHTML = '';
        songsContainer.className = 'songs-container';
        songsContainer.appendChild(songsListContainer);
        
        // Add click listeners for artist and album links in songs
        addSongClickListeners(songsContainer);
      } else {
        songsContainer.innerHTML = '<p class="no-items">No songs found in playlist</p>';
      }

    } catch (error) {
      console.error('Error loading hausaufgaben playlist content:', error);
      const songsContainer = document.getElementById('playlist-songs')!;
      songsContainer.innerHTML = '<p class="no-items">Error loading playlist</p>';
    }
  }

  showHome() {
    this.currentContext = {
      type: 'home',
      breadcrumbs: [{ label: 'Library', type: 'home', action: () => this.showHome() }]
    };
    
    // Add to navigation history
    this.navigationHistory.push({ type: 'home' });
    
    this.updateBreadcrumbs();
    this.loadHomeContent();
  }

  showArtist(artist: OpenSubsonicArtist, addToHistory: boolean = true) {
    this.currentContext = {
      type: 'artist',
      data: artist,
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: artist.name, type: 'artist', id: artist.id, action: () => this.showArtist(artist) }
      ]
    };
    
    // Add to navigation history
    this.navigationHistory.push({ type: 'artist', data: artist });
    
    this.updateBreadcrumbs();
    this.loadArtistContent(artist);
  }

  showAlbum(album: OpenSubsonicAlbum, addToHistory: boolean = true) {
    // Create album display name with year if available
    const albumDisplayName = album.year ? `${album.name} (${album.year})` : album.name;
    
    // Build breadcrumbs with multi-artist support
    const breadcrumbs: BreadcrumbItem[] = [
      { label: 'Library', type: 'home', action: () => this.showHome() }
    ];
    
    // Check if album has multiple artists (albumArtists or artists array)
    const artistsArray = album.albumArtists || album.artists;
    if (artistsArray && artistsArray.length > 1) {
      // Multiple artists - create a combined breadcrumb with clickable artists
      breadcrumbs.push({
        label: '', // Will be rendered differently in updateBreadcrumbs
        type: 'artist',
        action: () => {}, // No action for combined breadcrumb
        multipleArtists: artistsArray // Store artists array for rendering
      } as any);
    } else if (artistsArray && artistsArray.length === 1) {
      // Single artist from array
      breadcrumbs.push({
        label: artistsArray[0].name,
        type: 'artist',
        id: artistsArray[0].id,
        action: () => this.showArtist({ id: artistsArray[0].id, name: artistsArray[0].name } as OpenSubsonicArtist)
      });
    } else {
      // Fallback to single artist string
      breadcrumbs.push({
        label: album.artist,
        type: 'artist',
        action: () => this.showArtist({ id: album.artistId, name: album.artist } as OpenSubsonicArtist)
      });
    }
    
    breadcrumbs.push({
      label: albumDisplayName,
      type: 'album',
      id: album.id,
      action: () => this.showAlbum(album)
    });
    
    this.currentContext = {
      type: 'album',
      data: album,
      breadcrumbs
    };
    
    // Add to navigation history
    this.navigationHistory.push({ type: 'album', data: album });
    
    this.updateBreadcrumbs();
    this.loadAlbumContent(album);
  }

  showHausaufgabenPlaylist(playlist: OpenSubsonicPlaylist) {
    this.currentContext = {
      type: 'playlist',
      data: playlist,
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: playlist.name, type: 'playlist', id: playlist.id, action: () => this.showHausaufgabenPlaylist(playlist) }
      ]
    };
    
    this.updateBreadcrumbs();
    this.loadHausaufgabenContent(playlist);
  }

  showWizardResults(songs: OpenSubsonicSong[], songTitle: string, artist: string) {
    this.currentContext = {
      type: 'wizard',
      data: { songs, songTitle, artist },
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: 'Wizard', type: 'wizard', action: () => this.showWizardResults(songs, songTitle, artist) }
      ]
    };
    
    this.updateBreadcrumbs();
    this.loadWizardContent(songs);
  }

  private loadWizardContent(songs: OpenSubsonicSong[]) {
    const content = document.getElementById('library-content')!;
    
    // Use the existing unified songs container
    const songsContainer = createUnifiedSongsContainer(songs, 'album');
    content.innerHTML = '';
    content.appendChild(songsContainer);
    
    // Add all the standard click listeners
    addSongClickListeners(content);
    addAlbumClickListeners(content);
    addArtistClickListeners(content);
    
    // Load waveform backgrounds for wizard songs asynchronously
    setTimeout(() => loadVisibleSongWaveforms(content), 100);
    
    console.log(`✅ Displayed ${songs.length} wizard songs in library-content`);
  }

  private async loadHomeContent() {
    const content = document.getElementById('library-content')!;
    content.innerHTML = `
      <div class="media-section">
        <h3 class="section-title">recently added albums</h3>
        <div class="horizontal-scroll" id="recent-albums">
          <div class="loading-placeholder">Loading recently added albums...</div>
        </div>
      </div>

      <div class="media-section">
        <h3 class="section-title">most played albums</h3>
        <div class="horizontal-scroll" id="most-played-albums">
          <div class="loading-placeholder">Loading most played albums...</div>
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

    // Load content
    await this.loadBrowseData();
  }

  private async loadArtistContent(artist: OpenSubsonicArtist) {
    const content = document.getElementById('library-content')!;
    
    // Hole vollständige Artist-Daten
    const [fullArtist, artistInfo] = await Promise.all([
      openSubsonicClient.getArtist(artist.id),
      openSubsonicClient.getArtistInfo(artist.id)
    ]);
    
    console.log('Full Artist Data:', fullArtist);
    console.log('Artist Info:', artistInfo);
    
    // Nutze die Daten aus fullArtist für albumCount
    const albumCount = fullArtist?.albumCount || artist.albumCount || 0;
    const rawArtistImageUrl = fullArtist?.artistImageUrl || artistInfo?.largeImageUrl || artistInfo?.mediumImageUrl;
    const artistImageUrl = getArtistImageUrl(rawArtistImageUrl, 300);
    let biography = artistInfo?.biography || '';
    
    // Biografie bereinigen: HTML-Links erlauben aber sicher machen
    if (biography && biography !== 'Empty biography') {
      // Kürze auf 300 Zeichen, aber behalte HTML-Links
      if (biography.length > 300) {
        // Schneide bei 300 ab, aber nicht mitten im Link
        const linkMatch = biography.substring(0, 300).lastIndexOf('<a ');
        const linkEnd = biography.indexOf('</a>', linkMatch);
        if (linkMatch !== -1 && linkEnd > 300) {
          // Link geht über 300 hinaus, nimm den ganzen Link mit
          biography = biography.substring(0, linkEnd + 4) + '...';
        } else {
          biography = biography.substring(0, 300) + '...';
        }
      }
    }
    
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
            ${biography && biography !== 'Empty biography' ? `<p class="artist-biography">${biography}</p>` : ''}
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
    try {
      const [albums, songs, appearsOnAlbums] = await Promise.all([
        openSubsonicClient.getArtistAlbums(artist.id),
        openSubsonicClient.getArtistSongs(artist.id),
        openSubsonicClient.getAllAlbumsWithArtist(artist.name)
      ]);

      // Similar Artists anzeigen wenn vorhanden
      if (artistInfo?.similarArtist && artistInfo.similarArtist.length > 0) {
        const similarSection = document.getElementById('similar-artists-section');
        if (similarSection) {
          similarSection.style.display = 'block';
          const similarContainer = document.getElementById('similar-artists');
          if (similarContainer) {
            const artistsHtml = artistInfo.similarArtist.map((simArtist: any) => `
          <div class="artist-card clickable" data-artist-id="${simArtist.id}">
            <div class="artist-image" data-artist-id="${simArtist.id}">
              <div class="no-cover">🎤</div>
            </div>
            <h4 class="artist-name">${escapeHtml(simArtist.name)}</h4>
          </div>
        `).join('');
            
            similarContainer.className = 'horizontal-scroll';
            similarContainer.innerHTML = artistsHtml;
            
            // Add drag scrolling
            addDragScrollingToContainer(similarContainer);
            
            // Load artist images asynchronously
            this.loadArtistImages(similarContainer, artistInfo.similarArtist);
            
            // Add click events
            similarContainer.querySelectorAll('[data-artist-id]').forEach(card => {
              card.addEventListener('click', () => {
                const artistId = card.getAttribute('data-artist-id');
                const simArtist = artistInfo.similarArtist.find((a: any) => a.id === artistId);
                if (simArtist) {
                  const clickedArtist: OpenSubsonicArtist = {
                    id: simArtist.id,
                    name: simArtist.name,
                    albumCount: simArtist.albumCount || 0
                  };
                  console.log(`🎤 Similar Artist clicked: "${simArtist.name}"`);
                  libraryBrowser.showArtist(clickedArtist);
                }
              });
            });
          }
        }
      }

      // Filter appears-on albums (exclude albums where artist is album artist)
      const albumArtistIds = new Set(albums.map(a => a.id));
      const appearsOn = appearsOnAlbums.filter(album => !albumArtistIds.has(album.id));

      // Separate singles (1 track) from albums (2+ tracks)
      const actualAlbums = albums.filter(album => album.songCount > 1);
      const singles = albums.filter(album => album.songCount === 1);

      // Store albums and singles for sorting
      let currentAlbums = [...actualAlbums];
      let currentSingles = [...singles];
      let currentAlbumsSortByDate = true; // Start with date sorting (newest first)
      let currentSinglesSortByDate = true; // Start with date sorting (newest first)

      // Function to render albums
      const renderAlbums = (albumsToRender: OpenSubsonicAlbum[], containerId: string) => {
        const albumsContainer = document.getElementById(containerId)!;
        if (albumsToRender.length > 0) {
          const albumsHtml = albumsToRender.map(album => `
            <div class="album-card clickable" data-album-id="${album.id}">
              <div class="album-image">
                <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" draggable="false" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
              </div>
              <h4 class="album-title">${escapeHtml(album.name)}</h4>
              <p class="album-year">${album.year || 'Unknown Year'}</p>
            </div>
          `).join('');
          
          albumsContainer.className = 'horizontal-scroll';
          albumsContainer.innerHTML = albumsHtml;
          
          // Add drag scrolling to container
          this.addDragScrolling(albumsContainer as HTMLElement);
          
          // Add event listeners for album cards
          albumsContainer.querySelectorAll('[data-album-id]').forEach(card => {
            card.addEventListener('click', (e) => {
              // Nur klicken wenn nicht gedraggt wird
              if (!albumsContainer.classList.contains('dragging')) {
                const albumId = card.getAttribute('data-album-id');
                const album = albumsToRender.find(a => a.id === albumId);
                if (album) {
                  libraryBrowser.showAlbum(album);
                }
              }
            });
          });
          
          // Add drag listeners for context menu support
          addDragListeners(albumsContainer);
        } else {
          albumsContainer.innerHTML = '<p class="no-items">No albums found</p>';
        }
      };

      // Function to sort items (albums or singles)
      const sortItems = (items: OpenSubsonicAlbum[], sortByDate: boolean): OpenSubsonicAlbum[] => {
        const sorted = [...items];
        
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
      };

      // Initial render with date sorting (newest first)
      renderAlbums(sortItems(currentAlbums, true), 'artist-albums');

      // Add sort toggle button listener for albums
      const albumSortToggle = document.getElementById('album-sort-toggle') as HTMLButtonElement;
      if (albumSortToggle) {
        albumSortToggle.addEventListener('click', () => {
          currentAlbumsSortByDate = !currentAlbumsSortByDate;
          
          // Update icon
          const icon = albumSortToggle.querySelector('.material-icons')!;
          icon.textContent = currentAlbumsSortByDate ? 'calendar_month' : 'sort_by_alpha';
          albumSortToggle.title = currentAlbumsSortByDate ? 'Sort by name' : 'Sort by date';
          
          // Re-render with new sort
          renderAlbums(sortItems(currentAlbums, currentAlbumsSortByDate), 'artist-albums');
        });
      }

      // Render and setup singles section if there are any
      if (singles.length > 0) {
        const singlesSection = document.getElementById('singles-section')!;
        singlesSection.style.display = 'block';
        
        // Initial render with date sorting (newest first)
        renderAlbums(sortItems(currentSingles, true), 'artist-singles');
        
        // Add sort toggle button listener for singles
        const singlesSortToggle = document.getElementById('singles-sort-toggle') as HTMLButtonElement;
        if (singlesSortToggle) {
          singlesSortToggle.addEventListener('click', () => {
            currentSinglesSortByDate = !currentSinglesSortByDate;
            
            // Update icon
            const icon = singlesSortToggle.querySelector('.material-icons')!;
            icon.textContent = currentSinglesSortByDate ? 'calendar_month' : 'sort_by_alpha';
            singlesSortToggle.title = currentSinglesSortByDate ? 'Sort by name' : 'Sort by date';
            
            // Re-render with new sort
            renderAlbums(sortItems(currentSingles, currentSinglesSortByDate), 'artist-singles');
          });
        }
      }

      // Render appears-on albums if any
      if (appearsOn.length > 0) {
        const appearsOnSection = document.getElementById('appears-on-section')!;
        appearsOnSection.style.display = 'block';
        
        const appearsOnContainer = document.getElementById('appears-on-albums')!;
        const appearsOnHtml = appearsOn.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="album-image">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" draggable="false" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-year">${album.year || 'Unknown Year'}</p>
          </div>
        `).join('');
        
        appearsOnContainer.className = 'horizontal-scroll';
        appearsOnContainer.innerHTML = appearsOnHtml;
        
        // Add drag scrolling
        this.addDragScrolling(appearsOnContainer as HTMLElement);
        
        // Add click listeners
        appearsOnContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            if (!appearsOnContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = appearsOn.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
      }

      // Load songs
      const songsContainer = document.getElementById('artist-songs')!;
      if (songs.length > 0) {
        const songsListContainer = createUnifiedSongsContainer(songs, 'album');
        songsContainer.innerHTML = '';
        songsContainer.className = 'songs-container';
        songsContainer.appendChild(songsListContainer);
        
        // Add click listeners for artist and album links in songs
        addSongClickListeners(songsContainer);
        
        // Load waveform backgrounds for top songs asynchronously
        setTimeout(() => loadVisibleSongWaveforms(songsContainer), 100);
      } else {
        songsContainer.innerHTML = '<p class="no-items">No songs found</p>';
      }

    } catch (error) {
      console.error('Error loading artist content:', error);
    }
  }

  private async loadAlbumContent(album: OpenSubsonicAlbum) {
    const content = document.getElementById('library-content')!;
    
    // Generate artist HTML with multi-artist support
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
    
    content.innerHTML = `
      <div class="album-header">
        <div class="album-info">
          <div class="album-cover-large">
            <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${album.name}" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
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

    // Load album songs
    try {
      const songs = await openSubsonicClient.getAlbumSongs(album.id);
      
      const songsContainer = document.getElementById('album-songs')!;
      if (songs.length > 0) {
        const songsListContainer = createUnifiedSongsContainer(songs, 'album');
        songsContainer.innerHTML = '';
        songsContainer.className = 'songs-container';
        songsContainer.appendChild(songsListContainer);
        
        // Add click listeners for artist and album links in songs
        addSongClickListeners(songsContainer);
        
        // Load waveform backgrounds for album tracks asynchronously
        setTimeout(() => loadVisibleSongWaveforms(songsContainer), 100);
      } else {
        songsContainer.innerHTML = '<p class="no-items">No tracks found</p>';
      }

    } catch (error) {
      console.error('Error loading album content:', error);
    }
  }

  private setupSearch() {
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    const searchBtn = document.getElementById('search-btn');

    const performSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;

      this.performSearch(query);
    };

    searchBtn?.addEventListener('click', performSearch);
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performSearch();
    });
  }

  async performSearch(query: string) {
    this.currentContext = {
      type: 'search',
      data: { query },
      breadcrumbs: [
        { label: 'Library', type: 'home', action: () => this.showHome() },
        { label: `Search: "${query}"`, type: 'home', action: () => {} }
      ]
    };

    // Add to navigation history
    this.navigationHistory.push({ type: 'search', data: query });

    this.updateBreadcrumbs();
    await this.loadSearchResults(query);
  }

  private async loadSearchResults(query: string) {
    const content = document.getElementById('library-content')!;
    content.innerHTML = '<div class="loading-placeholder">Searching...</div>';

    try {
      const results = await openSubsonicClient.search(query, 20, 20, 20);
      
      content.innerHTML = '';

      // Artists
      if (results.artist && results.artist.length > 0) {
        const artistSection = document.createElement('div');
        artistSection.className = 'media-section';
        artistSection.innerHTML = '<h3 class="section-title">Artists</h3>';
        
        const artistsHtml = results.artist.map(artist => `
          <div class="artist-item clickable" data-artist-id="${artist.id}">
            <div class="artist-image">
              <img src="${artist.coverArt ? openSubsonicClient.getCoverArtUrl(artist.coverArt, 300) : 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22 viewBox=%220 0 200 200%22%3E%3Ccircle cx=%22100%22 cy=%22100%22 r=%22100%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22100%22 y=%22110%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'}" 
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
        this.addDragScrolling(artistContainer as HTMLElement);
        
        // Add event listeners for artist cards
        artistContainer.querySelectorAll('[data-artist-id]').forEach(card => {
          card.addEventListener('click', () => {
            const artistId = card.getAttribute('data-artist-id');
            const artist = results.artist?.find(a => a.id === artistId);
            if (artist) {
              libraryBrowser.showArtist(artist);
            }
          });
        });
        
        artistSection.appendChild(artistContainer);
        content.appendChild(artistSection);
      }

      // Albums
      if (results.album && results.album.length > 0) {
        const albumSection = document.createElement('div');
        albumSection.className = 'media-section';
        albumSection.innerHTML = '<h3 class="section-title">Albums</h3>';
        
        const albumsHtml = results.album.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="album-image">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" draggable="false" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22180%22 height=%22180%22 fill=%22%23333%22%3E%3Crect width=%22180%22 height=%22180%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%2290%22 y=%2290%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2224%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist">${getAlbumArtistHtml(album)}</p>
          </div>
        `).join('');
        
        const albumContainer = document.createElement('div');
        albumContainer.className = 'horizontal-scroll';
        albumContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(albumContainer as HTMLElement);
        
        // Add event listeners for album cards
        albumContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!albumContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = results.album?.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
        
        // Add artist click listeners
        addArtistClickListeners(albumContainer);
        addArtistClickListeners(albumContainer);
        
        // Add drag listeners for context menu support
        addDragListeners(albumContainer);
        
        albumSection.appendChild(albumContainer);
        content.appendChild(albumSection);
      }

      // Songs
      if (results.song && results.song.length > 0) {
        const songSection = document.createElement('div');
        songSection.className = 'media-section';
        songSection.innerHTML = '<h3 class="section-title">Songs</h3>';
        
        const songsContainer = createUnifiedSongsContainer(results.song, 'search');
        songSection.appendChild(songsContainer);
        content.appendChild(songSection);
        
        // Add click listeners for artist and album links in search results
        addSongClickListeners(songSection);
        
        // Add drag listeners for context menu support
        addDragListeners(songSection);
        
        // Load waveform backgrounds for songs asynchronously
        setTimeout(() => loadVisibleSongWaveforms(songSection), 100);
      }

      if (!results.artist?.length && !results.album?.length && !results.song?.length) {
        content.innerHTML = '<p class="no-items">No results found</p>';
      }

    } catch (error) {
      console.error('Search error:', error);
      content.innerHTML = '<p class="error-message">Search failed. Please try again.</p>';
    }
  }

  private async loadBrowseData() {
    // Load content using getAlbumList2 API with proper types
    if (!openSubsonicClient) return;

    try {
      const [recentAlbums, mostPlayedAlbums, randomAlbums, randomArtists, hausaufgabenPlaylist] = await Promise.all([
        openSubsonicClient.getNewestAlbums(20), // Uses getAlbumList2 with type=newest
        openSubsonicClient.getAlbumList2('frequent', 20), // Uses getAlbumList2 with type=frequent
        openSubsonicClient.getRandomAlbums(20), // Uses getAlbumList2 with type=random
        openSubsonicClient.getRandomArtists(20),
        openSubsonicClient.getHausaufgabenPlaylist() // Special playlist for musik.radio-endstation.de
      ]);

      // Recent Albums (Recently Added) - Now with caching! 🚀
      const recentContainer = document.getElementById('recent-albums');
      if (recentContainer && recentAlbums.length > 0) {
        // Create Hausaufgaben playlist as first element (if available)
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
        
        // Create recent albums HTML
        const albumsHtml = recentAlbums.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist">${getAlbumArtistHtml(album)}</p>
          </div>
        `).join('');
        
        // Combine Hausaufgaben playlist (if exists) + recent albums
        recentContainer.className = 'horizontal-scroll';
        recentContainer.innerHTML = hausaufgabenHtml + albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(recentContainer as HTMLElement);
        
        // Add click listener for Hausaufgaben playlist (if present)
        if (hausaufgabenPlaylist) {
          const hausaufgabenCard = recentContainer.querySelector('[data-playlist-id]');
          if (hausaufgabenCard) {
            hausaufgabenCard.addEventListener('click', () => {
              this.showHausaufgabenPlaylist(hausaufgabenPlaylist);
            });
          }
          console.log(`🎒 Hausaufgaben playlist displayed as first element: ${hausaufgabenPlaylist.name}`);
        }
        
        // Add event listeners for recent album cards
        recentContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!recentContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = recentAlbums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
        
        // Add artist click listeners
        addArtistClickListeners(recentContainer);
        
        // Add drag listeners for context menu support
        addDragListeners(recentContainer);
      }

      // Most Played Albums - Now with caching! 🚀
      const mostPlayedContainer = document.getElementById('most-played-albums');
      if (mostPlayedContainer && mostPlayedAlbums.length > 0) {
        const albumsHtml = mostPlayedAlbums.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist">${getAlbumArtistHtml(album)}</p>
          </div>
        `).join('');
        
        mostPlayedContainer.className = 'horizontal-scroll';
        mostPlayedContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(mostPlayedContainer as HTMLElement);
        

        
        // Add event listeners for most played album cards
        mostPlayedContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!mostPlayedContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = mostPlayedAlbums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
        
        // Add artist click listeners
        addArtistClickListeners(mostPlayedContainer);
        
        // Add drag listeners for context menu support
        addDragListeners(mostPlayedContainer);
      }

      // Random Albums - Now with caching! 🚀
      const randomContainer = document.getElementById('random-albums');
      if (randomContainer && randomAlbums.length > 0) {
        const albumsHtml = randomAlbums.map(album => `
          <div class="album-card clickable" data-album-id="${album.id}">
            <div class="album-cover">
              <img src="${openSubsonicClient.getCoverArtUrl(album.coverArt || '', 300)}" alt="${escapeHtml(album.name)}" loading="lazy" onerror="this.src='data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22300%22%3E%3Crect width=%22300%22 height=%22300%22 fill=%22%23f0f0f0%22/%3E%3Ctext x=%22150%22 y=%22150%22 text-anchor=%22middle%22 dy=%220.3em%22 font-family=%22Arial%22 font-size=%2240%22 fill=%22%23666%22%3E♪%3C/text%3E%3C/svg%3E'">
            </div>
            <h4 class="album-title">${escapeHtml(album.name)}</h4>
            <p class="album-artist">${getAlbumArtistHtml(album)}</p>
          </div>
        `).join('');
        
        randomContainer.className = 'horizontal-scroll';
        randomContainer.innerHTML = albumsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(randomContainer as HTMLElement);
        

        
        // Add event listeners for random album cards
        randomContainer.querySelectorAll('[data-album-id]').forEach(card => {
          card.addEventListener('click', (e) => {
            // Nur klicken wenn nicht gedraggt wird
            if (!randomContainer.classList.contains('dragging')) {
              const albumId = card.getAttribute('data-album-id');
              const album = randomAlbums.find(a => a.id === albumId);
              if (album) {
                libraryBrowser.showAlbum(album);
              }
            }
          });
        });
        
        // Add artist click listeners
        addArtistClickListeners(randomContainer);
        
        // Add drag listeners for context menu support
        addDragListeners(randomContainer);
      }

      // Random Artists - Now with caching! 🚀
      const artistsContainer = document.getElementById('random-artists');
      if (artistsContainer && randomArtists.length > 0) {
        const artistsHtml = randomArtists.map(artist => `
          <div class="artist-card clickable" data-artist-id="${artist.id}">
            <div class="artist-image" data-artist-id="${artist.id}">
              <div class="no-cover">🎤</div>
            </div>
            <h4 class="artist-name">${escapeHtml(artist.name)}</h4>
          </div>
        `).join('');
        
        artistsContainer.className = 'horizontal-scroll';
        artistsContainer.innerHTML = artistsHtml;
        
        // Add drag scrolling to container
        this.addDragScrolling(artistsContainer as HTMLElement);
        
        // Load artist images asynchronously
        this.loadArtistImages(artistsContainer, randomArtists);
        
        // Add event listeners for random artist cards
        artistsContainer.querySelectorAll('[data-artist-id]').forEach(card => {
          card.addEventListener('click', () => {
            const artistId = card.getAttribute('data-artist-id');
            const artist = randomArtists.find(a => a.id === artistId);
            if (artist) {
              libraryBrowser.showArtist(artist);
            }
          });
        });
      }

    } catch (error) {
      console.error('Error loading browse content:', error);
    }
    
    // Nach dem Laden der Inhalte: Drag-Scroll-Funktionalität zu allen horizontalen Containern hinzufügen
    this.initializeHorizontalScrollDragging();
    
    // Artist-Namen klickbar machen
    this.initializeArtistClickListeners();
  }

  // Drag-Scroll-Funktionalität für horizontale Container
  private initializeHorizontalScrollDragging() {
    // Finde alle horizontalen Scroll-Container
    const scrollContainers = document.querySelectorAll('.horizontal-scroll');
    console.log(`Initializing drag scrolling for ${scrollContainers.length} containers`);
    
    scrollContainers.forEach((container, index) => {
      console.log(`Adding drag scrolling to container ${index}:`, container);
      this.addDragScrolling(container as HTMLElement);
    });

    // Observer für dynamisch hinzugefügte Container
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Prüfe ob das Element selbst ein horizontal-scroll Container ist
            if (element.classList.contains('horizontal-scroll')) {
              console.log('Adding drag scrolling to dynamically added container:', element);
              this.addDragScrolling(element as HTMLElement);
            }
            // Prüfe auch alle Kinder des Elements
            const childContainers = element.querySelectorAll('.horizontal-scroll');
            childContainers.forEach(child => {
              console.log('Adding drag scrolling to dynamically added child container:', child);
              this.addDragScrolling(child as HTMLElement);
            });
          }
        });
      });
    });

    // Beobachte Änderungen im Library Content
    const libraryContent = document.getElementById('library-content');
    if (libraryContent) {
      observer.observe(libraryContent, { childList: true, subtree: true });
    }
  }

  private addDragScrolling(container: HTMLElement) {
    // Verwende die globale Funktion
    addDragScrollingToContainer(container);
  }

  private initializeArtistClickListeners() {
    // Finde alle klickbaren Artist-Namen
    const clickableArtists = document.querySelectorAll('.clickable-artist');
    console.log(`Initializing artist click listeners for ${clickableArtists.length} artists`);
    
    clickableArtists.forEach(artistElement => {
      artistElement.addEventListener('click', (e) => {
        e.stopPropagation(); // Verhindert Album-Click
        
        const artistName = artistElement.getAttribute('data-artist-name');
        const artistId = artistElement.getAttribute('data-artist-id');
        
        if (artistName) {
          // Erstelle ein Artist-Objekt für den LibraryBrowser
          const artist = {
            id: artistId || artistName, // Fallback auf Name falls keine ID
            name: artistName,
            albumCount: 0 // Wird vom Server aktualisiert
          };
          
          console.log(`🎤 Artist clicked: "${artistName}"`);
          libraryBrowser.showArtist(artist);
        }
      });
    });
  }

  // Load artist images asynchronously
  private async loadArtistImages(container: HTMLElement, artists: OpenSubsonicArtist[]) {
    const imageElements = container.querySelectorAll('.artist-image[data-artist-id]');
    
    for (let i = 0; i < imageElements.length && i < artists.length; i++) {
      const imageElement = imageElements[i] as HTMLElement;
      const artist = artists[i];
      const artistId = artist.id;
      
      if (artistId && openSubsonicClient) {
        try {
          // Get artist image URL
          const imageUrl = await openSubsonicClient.getArtistImage(artistId, 300);
          
          if (imageUrl) {
            // Replace placeholder with actual image
            imageElement.innerHTML = `
              <img src="${imageUrl}" alt="${artist.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\"no-cover\\">🎤</div>'">
            `;
          } else {
            // Keep the placeholder
            console.log(`No image available for artist ${artist.name}`);
          }
        } catch (error) {
          console.error(`❌ Error loading artist image for ${artist.name}:`, error);
          // Keep the placeholder
        }
      }
    }
  }

}

// Global instance - declared above

// Globale Drag-Scroll-Funktionalität für horizontale Container
function addDragScrollingToContainer(container: HTMLElement) {
  console.log('Setting up drag scrolling for container:', container);
  
  // Prüfe ob bereits initialisiert
  if (container.dataset.dragScrollInitialized === 'true') {
    console.log('Drag scrolling already initialized for this container');
    return;
  }
  
  let isDown = false;
  let startX = 0;
  let scrollLeft = 0;
  let hasMoved = false;

  // Markiere als initialisiert
  container.dataset.dragScrollInitialized = 'true';

  container.addEventListener('mousedown', (e: MouseEvent) => {
    isDown = true;
    hasMoved = false;
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
    container.style.cursor = 'grabbing';
    container.style.userSelect = 'none';
  }, { passive: true });

  container.addEventListener('mouseleave', () => {
    isDown = false;
    hasMoved = false;
    container.classList.remove('dragging');
    container.style.cursor = 'grab';
    container.style.userSelect = '';
  }, { passive: true });

  container.addEventListener('mouseup', () => {
    isDown = false;
    container.style.cursor = 'grab';
    container.style.userSelect = '';
    if (hasMoved) {
      setTimeout(() => {
        container.classList.remove('dragging');
        hasMoved = false;
      }, 50);
    } else {
      container.classList.remove('dragging');
      hasMoved = false;
    }
  }, { passive: true });

  container.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDown) return;
    
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 2.5; // Increased multiplier for faster response
    
    if (Math.abs(walk) > 3) { // Lower threshold for faster detection
      hasMoved = true;
      container.classList.add('dragging');
    }
    
    container.scrollLeft = scrollLeft - walk;
  }, { passive: false }); // WICHTIG: passive: false für preventDefault() in Chrome

  // Touch-Support für mobile Geräte
  container.addEventListener('touchstart', (e: TouchEvent) => {
    isDown = true;
    hasMoved = false;
    startX = e.touches[0].pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  }, { passive: true });

  container.addEventListener('touchend', () => {
    isDown = false;
    if (hasMoved) {
      setTimeout(() => {
        container.classList.remove('dragging');
        hasMoved = false;
      }, 50);
    } else {
      container.classList.remove('dragging');
      hasMoved = false;
    }
  }, { passive: true });

  container.addEventListener('touchmove', (e: TouchEvent) => {
    if (!isDown) return;
    const x = e.touches[0].pageX - container.offsetLeft;
    const walk = (x - startX) * 2.5; // Increased for consistency
    
    if (Math.abs(walk) > 5) {
      if (!hasMoved) {
        hasMoved = true;
        container.classList.add('dragging');
      }
      container.scrollLeft = scrollLeft - walk;
    }
  }, { passive: true });
  
  // Initial cursor styling
  container.style.cursor = 'grab';
}

// Replace old showBrowseView with new browser system
function showBrowseView() {
  if (!libraryBrowser) {
    libraryBrowser = new LibraryBrowser();
  } else {
    libraryBrowser.showHome();
  }
}

// Make navigation functions globally available
(window as any).libraryBrowser = {
  showHome: () => libraryBrowser?.showHome(),
  showArtist: (artist: OpenSubsonicArtist) => libraryBrowser?.showArtist(artist),
  showAlbum: (album: OpenSubsonicAlbum) => libraryBrowser?.showAlbum(album),
  navigateToBreadcrumb: (index: number) => libraryBrowser?.navigateToBreadcrumb(index)
};
(window as any).showBrowseView = showBrowseView;

// Wiederverwendbarer Media Container
interface MediaItem {
  id: string;
  name: string;
  type: 'album' | 'artist' | 'song' | 'playlist';
  coverArt?: string;
  artistImageUrl?: string;
  artist?: string;
  albumCount?: number;
  songCount?: number;
  duration?: number;
  year?: number;
  [key: string]: any; // Für zusätzliche Eigenschaften
}

interface MediaContainerConfig {
  containerId: string;
  items: MediaItem[];
  displayMode: 'grid' | 'list';
  itemType: 'album' | 'artist' | 'song' | 'playlist';
  showInfo?: boolean;
  onItemClick?: (item: MediaItem) => void;
}

class MediaContainer {
  private config: MediaContainerConfig;
  private container: HTMLElement;

  constructor(config: MediaContainerConfig) {
    this.config = config;
    this.container = document.getElementById(config.containerId) as HTMLElement;
    if (!this.container) {
      throw new Error(`Container with id '${config.containerId}' not found`);
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = '';
    
    // Behalte wichtige CSS-Klassen bei (wie horizontal-scroll)
    const existingClasses = this.container.className.split(' ');
    const preservedClasses = existingClasses.filter(cls => 
      cls === 'horizontal-scroll' || cls.startsWith('horizontal-')
    );
    
    this.container.className = [
      ...preservedClasses,
      'media-container', 
      `${this.config.displayMode}-mode`, 
      `${this.config.itemType}-type`
    ].join(' ');

    this.config.items.forEach(item => {
      const element = this.createMediaElement(item);
      this.container.appendChild(element);
    });

    // Verwende die globale Drag-Scrolling Funktion für horizontale Container
    if (this.container.classList.contains('horizontal-scroll')) {
      console.log('Adding global drag scrolling to horizontal scroll container:', this.container);
      addDragScrollingToContainer(this.container);
    } else {
      // Fallback für Grid-Container
      this.enableSmartDragScrolling();
    }
    
    // Add rating handlers for songs
    this.setupSongRatingHandlers();
    
    // Add click handlers for albums and artists
    this.setupAlbumAndArtistClickHandlers();
  }
  
  private setupSongRatingHandlers() {
    if (!this.container) return;
    
    const ratingContainers = this.container.querySelectorAll('.song-rating');
    ratingContainers.forEach(container => {
      const songId = container.getAttribute('data-song-id');
      const stars = container.querySelectorAll('.star');
      
      stars.forEach((star, index) => {
        const starElement = star as HTMLElement;
        
        // Hover effects
        starElement.addEventListener('mouseenter', () => {
          stars.forEach((s, i) => {
            s.classList.toggle('hover', i <= index);
          });
        });
        
        starElement.addEventListener('mouseleave', () => {
          stars.forEach(s => s.classList.remove('hover'));
        });
        
        // Click to rate
        starElement.addEventListener('click', async (e) => {
          e.stopPropagation();
          const rating = parseInt(starElement.getAttribute('data-rating') || '0');
          if (songId) {
            await updateTrackRating(songId, rating);
          }
        });
      });
    });
  }

  private createMediaElement(item: MediaItem): HTMLElement {
    // For search results, use simplified single-element structure
    if (document.getElementById('search-content')) {
      const element = document.createElement('div');
      element.className = `media-item ${item.type}-item`;
      element.dataset.id = item.id;
      element.dataset.type = item.type;

      // Create content based on type
      switch (item.type) {
        case 'album':
          this.createAlbumElement(element, item);
          break;
        case 'artist':
          this.createArtistElement(element, item);
          break;
        case 'song':
          this.createSongElement(element, item);
          break;
        case 'playlist':
          this.createPlaylistElement(element, item);
          break;
      }

      // Add click handler directly to element
      element.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.config.onItemClick) {
          this.config.onItemClick(item);
        }
      });

      return element;
    }

    // For browse content, keep wrapper structure for info display
    const wrapper = document.createElement('div');
    wrapper.className = `media-item-wrapper ${item.type}-wrapper`;
    
    const element = document.createElement('div');
    element.className = `media-item ${item.type}-item`;
    element.dataset.id = item.id;
    element.dataset.type = item.type;

    // Create content based on type
    switch (item.type) {
      case 'album':
        this.createAlbumElement(element, item);
        break;
      case 'artist':
        this.createArtistElement(element, item);
        break;
      case 'song':
        this.createSongElement(element, item);
        break;
      case 'playlist':
        this.createPlaylistElement(element, item);
        break;
    }

    // Add info section if enabled
    if (this.config.showInfo !== false) {
      const info = this.createInfoElement(item);
      wrapper.appendChild(element);
      wrapper.appendChild(info);
    } else {
      wrapper.appendChild(element);
    }

    // Add click handler
    wrapper.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.config.onItemClick) {
        this.config.onItemClick(item);
      }
    });

    return wrapper;
  }

  private parseArtists(artistString: string): string[] {
    // Parse multiple artists separated by common delimiters
    if (!artistString) return ['Unknown Artist'];
    
    // Split by common separators: comma, semicolon, ampersand, "feat.", "ft.", "featuring"
    const separators = /[,;]|\s+&\s+|\s+feat\.?\s+|\s+ft\.?\s+|\s+featuring\s+/i;
    return artistString
      .split(separators)
      .map(artist => artist.trim())
      .filter(artist => artist.length > 0);
  }

  private createArtistLinks(artists: string[]): string {
    return artists
      .map(artist => `<span class="artist-link" data-artist-name="${escapeHtml(artist)}">${escapeHtml(artist)}</span>`)
      .join(', ');
  }

  private createAlbumElement(element: HTMLElement, item: MediaItem) {
    const coverUrl = item.coverArt && openSubsonicClient 
      ? openSubsonicClient.getCoverArtUrl(item.coverArt, 300)
      : '';

    const artists = this.parseArtists(item.artist || '');
    const artistLinks = this.createArtistLinks(artists);

    // Check if this is for search results
    if (element.closest('#search-content') || document.getElementById('search-content')) {
      element.className = 'album-wrapper';
      element.innerHTML = `
        <div class="album-clickable" data-album-id="${item.id}">
          ${coverUrl             ? `<img class="library-album-cover" src="${coverUrl}" alt="${item.name}" loading="lazy">`
            : '<div class="library-album-cover album-placeholder"><span class="material-icons">album</span></div>'
          }
          <div class="album-title">${escapeHtml(item.name)}</div>
        </div>
        <div class="album-artists">${artistLinks}</div>
      `;
    } else if (element.closest('.album-grid') || element.closest('#artist-albums')) {
      // For artist detail view - minimal design with title and year
      element.className = 'album-wrapper';
      element.innerHTML = `
        <div class="album-clickable" data-album-id="${item.id}">
          ${coverUrl 
            ? `<img class="library-album-cover" src="${coverUrl}" alt="${item.name}" loading="lazy">`
            : '<div class="library-album-cover album-placeholder"><span class="material-icons">album</span></div>'
          }
          <div class="album-title">${escapeHtml(item.name)}</div>
          ${item.year ? `<div class="album-year">${item.year}</div>` : ''}
        </div>
        <div class="album-artists">${artistLinks}</div>
      `;
    } else {
      // For browse content, use card layout with separate clickable areas
      element.className += ' album-card';
      element.innerHTML = `
        <div class="album-clickable" data-album-id="${item.id}">
          <div class="library-album-cover">
            ${coverUrl 
              ? `<img src="${coverUrl}" alt="${item.name}" loading="lazy">`
              : '<span class="material-icons">album</span>'
            }
          </div>
          <div class="album-title">${escapeHtml(item.name)}</div>
          ${item.year ? `<div class="album-year">${item.year}</div>` : ''}
        </div>
        <div class="album-artists">${artistLinks}</div>
      `;
    }
  }

  private createArtistElement(element: HTMLElement, item: MediaItem) {
    // Get artist image URL with fallback
    const artistImageUrl = item.artistImageUrl 
      ? getArtistImageUrl(item.artistImageUrl, 300)
      : (item.coverArt && openSubsonicClient ? openSubsonicClient.getCoverArtUrl(item.coverArt, 300) : '');
    
    // For search results, use simplified structure with all styling on main element
    if (element.closest('#search-content') || document.getElementById('search-content')) {
      element.className = 'artist-wrapper';
      element.innerHTML = `
        <span class="material-icons artist-placeholder">person</span>
        <div class="artist-content">
          <div class="artist-name">${escapeHtml(item.name)}</div>
          <div class="artist-album-count">${item.albumCount || 0} Albums</div>
        </div>
      `;
    } else {
      // For browse content, use unified card layout (same as Similar Artists)
      element.className += ' artist-card clickable';
      element.innerHTML = `
        <div class="artist-image">
          ${artistImageUrl 
            ? `<img src="${artistImageUrl}" alt="${escapeHtml(item.name)}" onerror="this.parentElement.innerHTML='<span class=\\'material-icons\\'>person</span>';">` 
            : `<span class="material-icons">person</span>`
          }
        </div>
        <p class="artist-name">${escapeHtml(item.name)}</p>
      `;
    }
  }

  private createSongElement(element: HTMLElement, item: MediaItem) {
    // Use unified song design for consistency
    const song: OpenSubsonicSong = {
      id: item.id,
      title: item.name,
      artist: item.artist || 'Unknown Artist',
      album: item.album || '',
      albumId: item.albumId,
      duration: item.duration || 0,
      size: 0,
      suffix: 'mp3',
      bitRate: 320,
      coverArt: item.coverArt,
      year: item.year || 0,
      genre: item.genre || '',
      userRating: item.userRating || 0
    };
    
    // Create unified song element
    const unifiedElement = createUnifiedSongElement(song, 'search');
    
    // Copy classes and properties to provided element
    element.className = unifiedElement.className;
    element.innerHTML = unifiedElement.innerHTML;
    element.draggable = unifiedElement.draggable;
    
    // Copy event listeners
    const dragHandler = (e: DragEvent) => {
      if (e.dataTransfer) {
        // Set JSON data (preferred)
        e.dataTransfer.setData('application/json', JSON.stringify({
          type: 'song',
          song: song,
          sourceUrl: openSubsonicClient?.getStreamUrl(item.id)
        }));
        // Set song ID as text/plain for fallback compatibility
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }
    };
    element.addEventListener('dragstart', dragHandler);
  }

  private createPlaylistElement(element: HTMLElement, item: MediaItem) {
    element.className += ' playlist-item';
    element.innerHTML = `
      <div class="playlist-cover">
        <span class="material-icons">queue_music</span>
      </div>
    `;
  }

  private createInfoElement(item: MediaItem): HTMLElement {
    const info = document.createElement('div');
    info.className = 'media-info-external';

    switch (item.type) {
      case 'album':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          <div class="media-artist">${item.artist || 'Unknown Artist'}</div>
          ${item.year ? `<div class="media-year">${item.year}</div>` : ''}
        `;
        break;
      case 'artist':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          ${item.albumCount ? `<div class="media-subtitle">${item.albumCount} Albums</div>` : ''}
        `;
        break;
      case 'song':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          <div class="media-artist">${item.artist || 'Unknown Artist'}</div>
        `;
        break;
      case 'playlist':
        info.innerHTML = `
          <div class="media-title">${item.name}</div>
          ${item.songCount ? `<div class="media-subtitle">${item.songCount} Songs</div>` : ''}
        `;
        break;
    }

    return info;
  }

  private enableSmartDragScrolling() {
    if (!this.container) return;

    let isDown = false;
    let startX: number;
    let scrollLeft: number;
    let hasDragged = false;

    this.container.addEventListener('mousedown', (e) => {
      // Nur auf dem Container selbst, nicht auf Items
      if ((e.target as HTMLElement).closest('.media-item-wrapper')) return;
      
      isDown = true;
      hasDragged = false;
      this.container.classList.add('active-drag');
      startX = (e as MouseEvent).pageX - this.container.getBoundingClientRect().left;
      scrollLeft = this.container.scrollLeft;
    });

    this.container.addEventListener('mouseleave', () => {
      isDown = false;
      this.container.classList.remove('active-drag');
    });

    this.container.addEventListener('mouseup', () => {
      isDown = false;
      this.container.classList.remove('active-drag');
    });

    this.container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      hasDragged = true;
      
      const x = (e as MouseEvent).pageX - this.container.getBoundingClientRect().left;
      const walk = (x - startX) * 2;
      this.container.scrollLeft = scrollLeft - walk;
    });
  }

  private setupAlbumAndArtistClickHandlers() {
    if (!this.container) return;

    // Album click handlers
    const albumClickables = this.container.querySelectorAll('.album-clickable');
    albumClickables.forEach(clickable => {
      clickable.addEventListener('click', (e) => {
        e.stopPropagation();
        const albumId = clickable.getAttribute('data-album-id');
        if (albumId) {
          // Find the album from config or search for it
          const albumItem = this.config.items.find(item => item.id === albumId);
          if (albumItem && this.config.onItemClick) {
            this.config.onItemClick(albumItem);
          } else {
            // Fallback: navigate to album page
            loadAlbumById(albumId);
          }
        }
      });
    });

    // Artist link click handlers
    const artistLinks = this.container.querySelectorAll('.artist-link');
    artistLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const artistName = link.getAttribute('data-artist-name');
        if (artistName && openSubsonicClient) {
          // Search for artist and navigate to first result
          searchAndNavigateToArtist(artistName);
        }
      });
    });
  }
}

// Helper functions for album and artist navigation
async function loadAlbumById(albumId: string) {
  if (!openSubsonicClient) return;
  
  try {
    // Search for the album by ID through the albums list
    const albums = await openSubsonicClient.getAlbums(500);
    const album = albums.find((a: OpenSubsonicAlbum) => a.id === albumId);
    if (album) {
      loadAlbumTracks(album);
    }
  } catch (error) {
    console.error('Failed to load album:', error);
  }
}

async function searchAndNavigateToArtist(artistName: string) {
  if (!openSubsonicClient) return;
  
  try {
    const searchResults = await openSubsonicClient.search(artistName);
    
    const artist = searchResults.artist?.find((a: OpenSubsonicArtist) => 
      a.name.toLowerCase() === artistName.toLowerCase()
    ) || searchResults.artist?.[0];
    
    if (artist && libraryBrowser) {
      libraryBrowser.showArtist(artist);
    }
  } catch (error) {
    console.error('Failed to search for artist:', error);
  }
}

// Legacy functions converted to use MediaContainer
async function loadRecentAlbums() {
  console.log('🔍 Loading recently added albums using getAlbumList2...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for recent albums');
    return;
  }

  try {
    const albums = await openSubsonicClient.getNewestAlbums(20);
    console.log(`🔍 Recent albums loaded: ${albums.length} albums`);
    
    const mediaItems: MediaItem[] = albums.map((album: OpenSubsonicAlbum) => ({
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }));

    const container = new MediaContainer({
      containerId: 'recent-albums',
      items: mediaItems,
      displayMode: 'grid',
      itemType: 'album',
      onItemClick: (item) => {
        const album = albums.find((a: OpenSubsonicAlbum) => a.id === item.id);
        if (album) loadAlbumTracks(album);
      }
    });

    container.render();
    console.log('✅ Recent albums loaded successfully');
  } catch (error) {
    console.error('Failed to load recent albums:', error);
    const container = document.getElementById('recent-albums');
    if (container) {
      container.innerHTML = '<div class="loading-placeholder">Failed to load recent albums</div>';
    }
  }
}

async function loadRandomAlbums() {
  console.log('🎲 Loading random albums using getAlbumList2...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for random albums');
    return;
  }

  try {
    const albums = await openSubsonicClient.getRandomAlbums(20);
    console.log(`📦 Random albums loaded: ${albums.length} albums`);
    
    const mediaItems: MediaItem[] = albums.map((album: OpenSubsonicAlbum) => ({
      id: album.id,
      name: album.name,
      type: 'album' as const,
      coverArt: album.coverArt,
      artist: album.artist,
      year: album.year
    }));

    const container = new MediaContainer({
      containerId: 'random-albums',
      items: mediaItems,
      displayMode: 'grid',
      itemType: 'album',
      onItemClick: (item) => {
        const album = albums.find((a: OpenSubsonicAlbum) => a.id === item.id);
        if (album) loadAlbumTracks(album);
      }
    });

    container.render();
    console.log('✅ Random albums loaded successfully');
  } catch (error) {
    console.error('Failed to load random albums:', error);
    const container = document.getElementById('random-albums');
    if (container) {
      container.innerHTML = '<div class="loading-placeholder">Failed to load random albums</div>';
    }
  }
}

async function loadRandomArtists() {
  console.log('Loading random artists...');
  if (!openSubsonicClient) {
    console.warn('OpenSubsonic client not available for random artists');
    return;
  }

  try {
    const artists = await openSubsonicClient.getRandomArtists(20);
    const mediaItems: MediaItem[] = artists.map((artist: OpenSubsonicArtist) => ({
      id: artist.id,
      name: artist.name,
      type: 'artist' as const,
      coverArt: artist.coverArt,
      artistImageUrl: artist.artistImageUrl,
      albumCount: artist.albumCount
    }));

    const container = new MediaContainer({
      containerId: 'random-artists',
      items: mediaItems,
      displayMode: 'grid',
      itemType: 'artist',
      onItemClick: (item) => {
        const artist = artists.find((a: OpenSubsonicArtist) => a.id === item.id);
        if (artist) loadArtistAlbums(artist);
      }
    });

    container.render();
    console.log('✅ Random artists loaded successfully');
  } catch (error) {
    console.error('Failed to load random artists:', error);
    const container = document.getElementById('random-artists');
    if (container) {
      container.innerHTML = '<div class="loading-placeholder">Failed to load random artists</div>';
    }
  }
}

// ===== WAVEFORM BLINKING SYSTEM ===== 

// Handle track ending - progressive waveform blinking
function handleTrackEnding(side: 'a' | 'b' | 'c' | 'd', timeRemaining: number) {
  const waveformContainer = document.getElementById(`waveform-${side}`);
  if (!waveformContainer) return;
  
  // Remove any existing blink classes
  waveformContainer.classList.remove('waveform-blink-slow', 'waveform-blink-medium', 'waveform-blink-fast', 'waveform-blink-rapid', 'waveform-blink-critical');
  
  // Progressive blinking based on time remaining
  if (timeRemaining > 4) {
    waveformContainer.classList.add('waveform-blink-slow');
  } else if (timeRemaining > 3) {
    waveformContainer.classList.add('waveform-blink-medium');
  } else if (timeRemaining > 2) {
    waveformContainer.classList.add('waveform-blink-fast');
  } else if (timeRemaining > 1) {
    waveformContainer.classList.add('waveform-blink-rapid');
  } else {
    waveformContainer.classList.add('waveform-blink-critical');
  }
}

// Clear waveform blinking when track ends or is ejected
function clearWaveformBlinking(side: 'a' | 'b' | 'c' | 'd') {
  const waveformContainer = document.getElementById(`waveform-${side}`);
  if (waveformContainer) {
    waveformContainer.classList.remove('waveform-blink-slow', 'waveform-blink-medium', 'waveform-blink-fast', 'waveform-blink-rapid', 'waveform-blink-critical');
  }
}

// Global debug function for drag and drop
function debugDragDrop() {
  console.log('🔍 === DRAG & DROP DEBUG ===');
  
  // Check all draggable elements
  const draggableElements = document.querySelectorAll('[draggable="true"]');
  console.log(`🔍 Found ${draggableElements.length} draggable elements`);
  
  draggableElements.forEach((element, index) => {
    console.log(`🔍 Draggable ${index + 1}:`, element);
  });
  
  // Check drop zones
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    console.log(`🔍 Player ${side} deck:`, deck ? 'EXISTS' : 'MISSING');
    
    if (deck) {
      // Test if drop zone listeners are active
      const rect = deck.getBoundingClientRect();
      console.log(`🔍 Player ${side} position:`, rect);
      console.log(`🔍 Player ${side} pointer-events:`, window.getComputedStyle(deck).pointerEvents);
      console.log(`🔍 Player ${side} z-index:`, window.getComputedStyle(deck).zIndex);
    }
  });
  
  // Check queue drop zone
  const queueList = document.getElementById('queue-list');
  console.log('🔍 Queue drop zone:', queueList ? 'EXISTS' : 'MISSING');
  if (queueList) {
    console.log(`🔍 Queue pointer-events:`, window.getComputedStyle(queueList).pointerEvents);
    console.log(`🔍 Queue z-index:`, window.getComputedStyle(queueList).zIndex);
  }
  
  // Test manual drop zone re-initialization
  console.log('🔍 Re-initializing drop zones...');
  try {
    initializePlayerDropZones();
    setupQueueDropZone();
    console.log('🔍 Drop zones re-initialized successfully');
  } catch (error) {
    console.error('🔍 Error re-initializing drop zones:', error);
  }
}

// Manual test function for drop zones
function testDropZones() {
  console.log('🧪 === TESTING DROP ZONES ===');
  
  // Simulate dragover on each deck
  ['a', 'b', 'c', 'd'].forEach(side => {
    const deck = document.getElementById(`player-${side}`);
    if (deck) {
      console.log(`🧪 Testing player ${side}...`);
      
      // Create synthetic dragover event
      const dragEvent = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: new DataTransfer()
      });
      
      deck.dispatchEvent(dragEvent);
    }
  });
}

// Test album cover dragability
function testAlbumCoverDrag() {
  console.log('🧪 === TESTING ALBUM COVER DRAG ===');
  
  ['a', 'b', 'c', 'd'].forEach(side => {
    const albumCover = document.getElementById(`album-cover-${side}`);
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    const sideKey = side as 'a' | 'b' | 'c' | 'd';
    
    console.log(`🧪 Deck ${side}:`, {
      albumCover: albumCover ? 'EXISTS' : 'MISSING',
      draggable: albumCover?.draggable,
      draggableAttr: albumCover?.getAttribute('draggable'),
      audioSrc: audio?.src || 'NO SOURCE',
      deckSong: deckSongs[sideKey] ? `"${deckSongs[sideKey]?.title}"` : 'NO SONG DATA',
      cursor: albumCover?.style.cursor || 'default'
    });
    
    // Try to make it draggable manually
    if (albumCover && audio?.src) {
      albumCover.draggable = true;
      albumCover.setAttribute('draggable', 'true');
      console.log(`🧪 Manually made deck ${side} draggable`);
    }
  });
  
  // Re-check draggable elements
  setTimeout(() => {
    const draggableElements = document.querySelectorAll('[draggable="true"]');
    console.log(`🧪 Total draggable elements now: ${draggableElements.length}`);
    draggableElements.forEach((el, i) => {
      console.log(`🧪 Draggable ${i + 1}:`, el.id, el.className);
    });
  }, 100);
}

// Initialize audio event listeners for all players after DOM is ready
function initializeAllAudioEventListeners() {
  ['a', 'b', 'c', 'd'].forEach(side => {
    const audio = document.getElementById(`audio-${side}`) as HTMLAudioElement;
    if (audio) {
      console.log(`🎵 Setting up audio event listeners for player ${side.toUpperCase()}`);
      try {
        setupAudioEventListeners(audio, side as 'a' | 'b' | 'c' | 'd');
        console.log(`✅ Audio event listeners setup complete for player ${side.toUpperCase()}`);
      } catch (error) {
        console.error(`❌ Error setting up audio event listeners for player ${side.toUpperCase()}:`, error);
      }
    } else {
      console.error(`❌ Audio element for player ${side.toUpperCase()} not found`);
    }
  });
}

// Make functions globally available
(window as any).debugDragDrop = debugDragDrop;
(window as any).testDropZones = testDropZones;
(window as any).testAlbumCoverDrag = testAlbumCoverDrag;

// Execute all pending initializations - with retry mechanism for race conditions
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;

function executePendingInitializations() {
  initializationAttempts++;
  console.log(`🚀 Executing ${pendingInitializations.length} pending initializations (attempt ${initializationAttempts})...`);
  
  if (pendingInitializations.length === 0 && initializationAttempts < MAX_INIT_ATTEMPTS) {
    // No pending initializations yet, might be race condition - try again
    console.log(`⏳ No pending initializations found, retrying in 500ms...`);
    setTimeout(executePendingInitializations, 500);
    return;
  }
  
  pendingInitializations.forEach((initFn, index) => {
    try {
      initFn();
      console.log(`✅ Pending initialization ${index + 1} completed`);
    } catch (error) {
      console.error(`❌ Pending initialization ${index + 1} failed:`, error);
    }
  });
  pendingInitializations = []; // Clear the queue
}

// Start the initialization process
setTimeout(executePendingInitializations, 100);

// =====================================
// SETUP WIZARD INITIALIZATION
// =====================================

// Add keyboard shortcut to show setup (Ctrl+Shift+S) - always available
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'S') {
    e.preventDefault();
    console.log('🔧 Setup Wizard triggered by keyboard shortcut (Ctrl+Shift+S)');
    const setupWizard = new SetupWizard();
    setupWizard.show();
  }
});

console.log('🎧 SubCaster initialized successfully!');

// =====================================
// GITHUB CAT WITH CRT EFFECTS
// =====================================

class GitHubCat {
  private catElement: HTMLElement | null = null;
  private isAnimating: boolean = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private animationFrame: number = 0;

  constructor() {
    this.initializeCat();
  }

  private initializeCat() {
    this.catElement = document.getElementById('github-cat');
    if (!this.catElement) return;

    // Click handler to open GitHub repository
    this.catElement.addEventListener('click', () => {
      window.open('https://github.com/Lokke/subcaster', '_blank');
    });

    // Start monitoring audio activity
    this.monitorAudioActivity();
  }

  private async monitorAudioActivity() {
    try {
      // Get audio context from any active deck
      const playerA = document.getElementById('player-a-audio') as HTMLAudioElement;
      const playerB = document.getElementById('player-b-audio') as HTMLAudioElement;
      const playerC = document.getElementById('player-c-audio') as HTMLAudioElement;
      const playerD = document.getElementById('player-d-audio') as HTMLAudioElement;

      // Monitor all players for audio activity
      const players = [playerA, playerB, playerC, playerD].filter(p => p);
      
      players.forEach(player => {
        if (player) {
          player.addEventListener('play', () => this.startAnimation());
          player.addEventListener('pause', () => this.checkStopAnimation());
          player.addEventListener('ended', () => this.checkStopAnimation());
        }
      });

      // Also check for live radio stream
      const radioWaveform = document.querySelector('.live-radio-waveform');
      if (radioWaveform) {
        // Start animation when live radio is active
        const observer = new MutationObserver(() => {
          if (radioWaveform.classList.contains('active')) {
            this.startAnimation();
          } else {
            this.checkStopAnimation();
          }
        });
        observer.observe(radioWaveform, { attributes: true, attributeFilter: ['class'] });
      }

      // Monitor microphone activity
      this.monitorMicrophoneActivity();

    } catch (error) {
      console.log('🐱 GitHub Cat: Could not set up audio monitoring:', error);
    }
  }

  private monitorMicrophoneActivity() {
    // Check for microphone toggle button
    const micButton = document.getElementById('mic-toggle');
    if (micButton) {
      const observer = new MutationObserver(() => {
        if (micButton.classList.contains('active')) {
          this.startAnimation();
        } else {
          this.checkStopAnimation();
        }
      });
      observer.observe(micButton, { attributes: true, attributeFilter: ['class'] });
    }
  }

  private startAnimation() {
    if (this.isAnimating || !this.catElement) return;
    
    console.log('🐱 GitHub Cat: Starting CRT animation');
    this.isAnimating = true;
    this.catElement.classList.add('playing');
    
    // Add some randomness to the animation
    this.addRandomGlitches();
  }

  private checkStopAnimation() {
    // Check if any audio is still playing
    const playerA = document.getElementById('player-a-audio') as HTMLAudioElement;
    const playerB = document.getElementById('player-b-audio') as HTMLAudioElement;
    const playerC = document.getElementById('player-c-audio') as HTMLAudioElement;
    const playerD = document.getElementById('player-d-audio') as HTMLAudioElement;
    const micButton = document.getElementById('mic-toggle');
    const radioWaveform = document.querySelector('.live-radio-waveform');

    const anyPlayerPlaying = [playerA, playerB, playerC, playerD]
      .filter(p => p)
      .some(player => !player.paused);

    const micActive = micButton?.classList.contains('active') || false;
    const radioActive = radioWaveform?.classList.contains('active') || false;

    if (!anyPlayerPlaying && !micActive && !radioActive) {
      this.stopAnimation();
    }
  }

  private stopAnimation() {
    if (!this.isAnimating || !this.catElement) return;
    
    console.log('🐱 GitHub Cat: Stopping CRT animation');
    this.isAnimating = false;
    this.catElement.classList.remove('playing');
    
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }

  private addRandomGlitches() {
    if (!this.isAnimating || !this.catElement) return;

    // More frequent, irregular glitch intervals (old CRT behavior)
    const glitchInterval = Math.random() * 2000 + 500; // 0.5-2.5 seconds
    
    setTimeout(() => {
      if (this.isAnimating && this.catElement) {
        const glitchType = Math.random();
        
        if (glitchType < 0.3) {
          // Power fluctuation glitch
          this.catElement.style.filter = `
            brightness(${0.3 + Math.random() * 0.4})
            contrast(${1.8 + Math.random() * 0.5})
            drop-shadow(0 0 8px rgba(0, 150, 0, 0.6))
          `;
          this.catElement.style.transform = `scaleY(${0.8 + Math.random() * 0.4})`;
          
        } else if (glitchType < 0.6) {
          // Color separation glitch (RGB shift)
          const redShift = Math.random() * 6 - 3;
          const blueShift = Math.random() * 6 - 3;
          this.catElement.style.filter = `
            drop-shadow(${redShift}px 0 3px rgba(255, 0, 0, 0.7))
            drop-shadow(${blueShift}px 0 3px rgba(0, 0, 255, 0.7))
            drop-shadow(0 0 4px rgba(0, 255, 0, 0.4))
            hue-rotate(${Math.random() * 180 - 90}deg)
          `;
          
        } else if (glitchType < 0.8) {
          // Horizontal sync issues
          this.catElement.style.transform = `
            translateX(${Math.random() * 20 - 10}px)
            skewX(${Math.random() * 6 - 3}deg)
            scaleX(${0.7 + Math.random() * 0.6})
          `;
          this.catElement.style.filter = `
            contrast(2)
            brightness(0.4)
            saturate(2)
          `;
          
        } else {
          // Severe interference
          this.catElement.style.filter = `
            invert(${Math.random() > 0.5 ? 1 : 0})
            contrast(${2 + Math.random()})
            brightness(${0.2 + Math.random() * 0.8})
            hue-rotate(${Math.random() * 360}deg)
            drop-shadow(0 0 15px rgba(255, 255, 255, 0.8))
          `;
          this.catElement.style.transform = `
            translate(${Math.random() * 8 - 4}px, ${Math.random() * 8 - 4}px)
            rotate(${Math.random() * 10 - 5}deg)
            scale(${0.8 + Math.random() * 0.4})
          `;
        }

        // Reset after random short duration
        const resetTime = 50 + Math.random() * 300;
        setTimeout(() => {
          if (this.catElement) {
            this.catElement.style.filter = '';
            this.catElement.style.transform = '';
          }
        }, resetTime);

        // Schedule next glitch with varying probability
        if (Math.random() < 0.9) { // 90% chance to continue glitching
          this.addRandomGlitches();
        } else {
          // Sometimes take a longer break
          setTimeout(() => this.addRandomGlitches(), 2000 + Math.random() * 3000);
        }
      }
    }, glitchInterval);
  }

  // Public method to manually trigger animation (for testing)
  public triggerGlitch() {
    if (this.catElement) {
      this.startAnimation();
      setTimeout(() => this.stopAnimation(), 3000);
    }
  }
}

// Initialize GitHub Cat
const githubCat = new GitHubCat();

// Make it globally available for debugging
(window as any).githubCat = githubCat;

// ============================================
// Discord Wishbox Integration
// ============================================

import { initializeDiscord, getDiscordClient, type DiscordGatewayClient } from './discordGateway';

// Wishbox UI elements (Dropdown)
const wishboxBtn = document.getElementById('wishbox-btn') as HTMLButtonElement;
const wishboxDropdown = document.getElementById('wishbox-dropdown') as HTMLDivElement;
// Placeholder & original parent for portal
const wishboxDropdownPlaceholder = document.createComment('wishbox-dropdown-placeholder');
let wishboxOriginalParent: Node | null = null;
const wishboxSortBtn = document.getElementById('wishbox-sort-btn') as HTMLButtonElement;
const wishboxCloseBtn = document.getElementById('wishbox-close-btn') as HTMLButtonElement;
const wishboxStatus = document.getElementById('wishbox-status') as HTMLDivElement;
const wishboxContent = document.getElementById('wishbox-content') as HTMLDivElement;

// Wishbox Frame elements (Between Decks C+D)
const wishboxFrame = document.getElementById('wishbox-frame') as HTMLDivElement;
const wishboxFrameContent = document.getElementById('wishbox-frame-content') as HTMLDivElement;

// Initially hide only the mixer-area wishbox; queue dropdown/button are left alone
if (wishboxFrame) {
  wishboxFrame.style.display = 'none';
}

// Sort order state (load from localStorage)
let wishboxSortOrder: 'newest' | 'oldest' = (localStorage.getItem('wishboxSortOrder') as 'newest' | 'oldest') || 'newest';

// Update sort button icon based on current order
function updateSortButtonIcon() {
  if (wishboxSortOrder === 'oldest') {
    wishboxSortBtn.classList.add('ascending');
    wishboxSortBtn.title = 'Sortierung: Älteste zuerst (aufsteigend)';
  } else {
    wishboxSortBtn.classList.remove('ascending');
    wishboxSortBtn.title = 'Sortierung: Neueste zuerst (absteigend)';
  }
}

// Initialize sort button
updateSortButtonIcon();

// Message storage
const discordMessages: Array<{
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar: string | null;
    discriminator: string;
  };
  timestamp: string;
}> = [];

/**
 * Format Discord timestamp to readable format
 */
function formatDiscordTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // Less than 1 minute
  if (diff < 60000) {
    return 'gerade eben';
  }
  
  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `vor ${minutes} Minute${minutes > 1 ? 'n' : ''}`;
  }
  
  // Less than 1 day
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `vor ${hours} Stunde${hours > 1 ? 'n' : ''}`;
  }
  
  // Show date
  return date.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get Discord avatar URL or generate default initials
 */
function getDiscordAvatar(author: any): string | null {
  if (author.avatar) {
    return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png?size=128`;
  }
  return null;
}

/**
 * Render a Discord message in the wishbox
 */
function renderDiscordMessage(message: any): HTMLElement {
  const messageEl = document.createElement('div');
  messageEl.className = 'discord-message';
  messageEl.dataset.messageId = message.id;
  
  const avatarUrl = getDiscordAvatar(message.author);
  const initials = message.author.username.substring(0, 2).toUpperCase();
  
  // Debug: Log message structure
  console.log('📨 Rendering message:', {
    id: message.id,
    content: message.content,
    hasAttachments: !!message.attachments,
    attachmentsCount: message.attachments?.length || 0,
    attachments: message.attachments
  });
  
  // Parse structured request format
  const parsedRequest = parseDiscordRequest(message.content);
  
  // Build attachments HTML (audio files)
  let attachmentsHtml = '';
  let hasAudioAttachment = false;
  
  if (message.attachments && message.attachments.length > 0) {
    console.log('🎵 Found attachments:', message.attachments);
    
    const audioAttachments = message.attachments.filter((att: any) => 
      att.content_type?.startsWith('audio/') || 
      /\.(mp3|wav|ogg|m4a|flac)$/i.test(att.filename)
    );
    
    console.log('🎵 Audio attachments:', audioAttachments);
    
    if (audioAttachments.length > 0) {
      hasAudioAttachment = true;
      attachmentsHtml = audioAttachments.map((att: any) => {
        // Proxy Discord audio URL through backend to avoid CORS
        const proxiedUrl = `${window.location.origin}/api/discord-audio?url=${encodeURIComponent(att.url)}`;
        
        return `
          <div class="discord-message-audio" data-audio-url="${att.url}" data-audio-filename="${escapeHtml(att.filename)}">
            <div class="audio-info">
              <span class="material-icons">music_note</span>
              <span class="audio-filename">${escapeHtml(att.filename)}</span>
            </div>
            <audio controls preload="metadata">
              <source src="${proxiedUrl}" type="${att.content_type || 'audio/mpeg'}">
              Dein Browser unterstützt keine Audio-Wiedergabe.
            </audio>
          </div>
        `;
      }).join('');
    }
  }
  
  // Build request buttons HTML
  let requestButtonsHtml = '';
  if (parsedRequest) {
    if (parsedRequest.request1) {
      requestButtonsHtml += `
        <button class="discord-request-btn" data-search="${escapeHtml(parsedRequest.request1)}" title="In Suche einfügen">
          <span class="material-icons">search</span>
          <span class="request-label">Request 1: ${escapeHtml(parsedRequest.request1)}</span>
        </button>
      `;
    }
    if (parsedRequest.request2) {
      requestButtonsHtml += `
        <button class="discord-request-btn" data-search="${escapeHtml(parsedRequest.request2)}" title="In Suche einfügen">
          <span class="material-icons">search</span>
          <span class="request-label">Request 2: ${escapeHtml(parsedRequest.request2)}</span>
        </button>
      `;
    }
  }
  
  messageEl.innerHTML = `
    <div class="discord-message-header">
      <div class="discord-message-avatar">
        ${avatarUrl ? `<img src="${avatarUrl}" alt="${message.author.username}">` : initials}
      </div>
      <div class="discord-message-info">
        <div class="discord-message-author">${message.author.username}</div>
        <div class="discord-message-timestamp">${formatDiscordTimestamp(message.timestamp)}</div>
      </div>
    </div>
    <button class="discord-message-delete" data-message-id="${message.id}" title="Nachricht löschen">
      <span class="material-icons">delete</span>
    </button>
    ${parsedRequest ? `
      <div class="discord-request-info">
        ${parsedRequest.name ? `<div class="discord-request-name"><span class="material-icons">person</span> ${escapeHtml(parsedRequest.name)}</div>` : ''}
        ${requestButtonsHtml}
        ${parsedRequest.message ? `<div class="discord-request-message"><span class="material-icons">chat</span> ${escapeHtml(parsedRequest.message)}</div>` : ''}
      </div>
    ` : `
      ${message.content ? `<div class="discord-message-content">${escapeHtml(message.content)}</div>` : ''}
    `}
    ${attachmentsHtml}
  `;
  
  // Add click handlers for request buttons
  const requestBtns = messageEl.querySelectorAll('.discord-request-btn');
  requestBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const searchQuery = (btn as HTMLElement).dataset.search || '';
      if (searchQuery) {
        // Insert into search field
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
        
        if (searchInput && searchBtn) {
          searchInput.value = searchQuery;
          searchInput.focus();
          
          // Trigger search by clicking the search button
          searchBtn.click();
          
          console.log(`🔍 Search triggered: ${searchQuery}`);
        }
      }
    });
  });
  
  // Make message draggable if it has audio attachment
  if (hasAudioAttachment) {
    messageEl.draggable = true;
    messageEl.classList.add('draggable');
    
    // Store message data for drag
    messageEl.dataset.authorUsername = message.author.username;
    
    // Drag start event
    messageEl.addEventListener('dragstart', (e) => {
      const dragEvent = e as DragEvent;
      const audioContainer = messageEl.querySelector('.discord-message-audio') as HTMLElement;
      const audioUrl = audioContainer?.dataset.audioUrl || '';
      const audioFilename = audioContainer?.dataset.audioFilename || 'audio.mp3';
      const authorName = message.author.username;
      
      console.log('🎵 Dragging Discord audio:', { audioUrl, audioFilename, authorName });
      
      // Proxy Discord audio URL through backend to avoid CORS
      const proxiedAudioUrl = `${window.location.origin}/api/discord-audio?url=${encodeURIComponent(audioUrl)}`;
      
      // Create a pseudo-song object for the deck
      const pseudoSong = {
        id: `discord-${message.id}`,
        title: `Audio-Nachricht von ${authorName}`,
        artist: 'Discord Wunschbox',
        album: 'Discord Wünsche',
        duration: 0, // Unknown duration
        streamUrl: proxiedAudioUrl,
        coverArt: '', // No cover art
        albumId: '',
        artistId: '',
        year: new Date().getFullYear(),
        genre: 'Voice Message',
        isDiscordMessage: true, // Flag to identify Discord messages
      };
      
      // Set drag data
      dragEvent.dataTransfer!.effectAllowed = 'copy';
      dragEvent.dataTransfer!.setData('application/json', JSON.stringify({
        type: 'song',
        song: pseudoSong
      }));
      
      // Visual feedback
      messageEl.classList.add('dragging');
    });
    
    messageEl.addEventListener('dragend', () => {
      messageEl.classList.remove('dragging');
    });
  }
  
  // Add delete handler
  const deleteBtn = messageEl.querySelector('.discord-message-delete') as HTMLButtonElement;
  deleteBtn?.addEventListener('click', () => deleteDiscordMessage(message.id, message.channel_id));
  
  return messageEl;
}

/**
 * Parse structured Discord request message
 * Format:
 * Name: <name>
 * Request 1: <request1>
 * Request 2: <request2>
 * Message: <message>
 */
function parseDiscordRequest(content: string): { name?: string, request1?: string, request2?: string, message?: string } | null {
  if (!content) return null;
  
  const lines = content.split('\n');
  const result: any = {};
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Match "Name: <value>"
    const nameMatch = trimmed.match(/^Name:\s*(.+)$/i);
    if (nameMatch) {
      result.name = nameMatch[1].trim();
      continue;
    }
    
    // Match "Request 1: <value>"
    const request1Match = trimmed.match(/^Request\s*1:\s*(.+)$/i);
    if (request1Match) {
      result.request1 = request1Match[1].trim();
      continue;
    }
    
    // Match "Request 2: <value>"
    const request2Match = trimmed.match(/^Request\s*2:\s*(.+)$/i);
    if (request2Match) {
      result.request2 = request2Match[1].trim();
      continue;
    }
    
    // Match "Message: <value>"
    const messageMatch = trimmed.match(/^Message:\s*(.+)$/i);
    if (messageMatch) {
      result.message = messageMatch[1].trim();
      continue;
    }
  }
  
  // Only return if at least one field was found
  if (Object.keys(result).length > 0) {
    return result;
  }
  
  return null;
}

/**
 * Delete a Discord message via REST API
 */
async function deleteDiscordMessage(messageId: string, channelId: string) {
  // ✅ Token wird vom Backend hinzugefügt - Frontend sendet KEIN Token mehr!
  
  try {
    console.log(`🗑️ Deleting Discord message ${messageId}...`);
    
    // Backend-Proxy macht die Authentifizierung
    const proxyUrl = `${window.location.origin}/api/discord/channels/${channelId}/messages/${messageId}`;
    
    const response = await fetch(proxyUrl, {
      method: 'DELETE',
      // ❌ KEIN Authorization Header mehr - Backend fügt Token hinzu!
    });
    
    if (response.status === 204) {
      console.log('✅ Message deleted successfully');
      
      // Remove from local storage
      const index = discordMessages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        discordMessages.splice(index, 1);
      }
      
      // Remove from UI
      const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
      if (messageEl) {
        messageEl.classList.add('deleting');
        setTimeout(() => {
          messageEl.remove();
          
          // Update UI if no messages left
          if (discordMessages.length === 0) {
            updateWishboxContent();
          }
        }, 300);
      }
    } else {
      const errorText = await response.text();
      console.error('❌ Failed to delete message:', response.status, errorText);
      alert('Fehler beim Löschen der Nachricht. Möglicherweise fehlen Bot-Rechte (Manage Messages).');
    }
  } catch (error) {
    console.error('❌ Error deleting message:', error);
    alert('Fehler beim Löschen der Nachricht.');
  }
}

/**
 * Update wishbox content with all messages
 */
function updateWishboxContent() {
  wishboxContent.innerHTML = '';
  
  if (discordMessages.length === 0) {
    wishboxContent.innerHTML = `
      <div class="wishbox-empty">
        <span class="material-icons">chat_bubble_outline</span>
        <p>Noch keine Wünsche vorhanden.<br>Warte auf neue Nachrichten...</p>
      </div>
    `;
    return;
  }
  
  // Sort messages based on current sort order
  let sortedMessages = [...discordMessages];
  
  if (wishboxSortOrder === 'newest') {
    // Newest first (reverse chronological)
    sortedMessages.reverse();
  }
  // If 'oldest', keep original order (chronological)
  
  sortedMessages.forEach(message => {
    const messageEl = renderDiscordMessage(message);
    wishboxContent.appendChild(messageEl);
  });
  
  // Scroll behavior based on sort order
  if (wishboxSortOrder === 'newest') {
    wishboxContent.scrollTop = 0; // Scroll to top for newest
  } else {
    wishboxContent.scrollTop = wishboxContent.scrollHeight; // Scroll to bottom for oldest
  }
}

/**
 * Update wishbox FRAME content (between Decks C+D)
 */
function updateWishboxFrameContent() {
  if (!wishboxFrameContent) return;
  
  wishboxFrameContent.innerHTML = '';
  
  if (discordMessages.length === 0) {
    wishboxFrameContent.innerHTML = `
      <div class="wishbox-empty" style="padding: 2rem; text-align: center; color: #888;">
        <span class="material-icons" style="font-size: 3rem; opacity: 0.5;">chat_bubble_outline</span>
        <p>Noch keine Wünsche vorhanden.<br>Warte auf neue Nachrichten...</p>
      </div>
    `;
    return;
  }
  
  // Sort messages based on current sort order
  let sortedMessages = [...discordMessages];
  
  if (wishboxSortOrder === 'newest') {
    // Newest first (reverse chronological)
    sortedMessages.reverse();
  }
  // If 'oldest', keep original order (chronological)
  
  // Render messages as compact wishbox items
  sortedMessages.forEach(message => {
    const messageEl = renderWishboxFrameItem(message);
    wishboxFrameContent.appendChild(messageEl);
  });
  
  // Scroll behavior based on sort order
  if (wishboxSortOrder === 'newest') {
    wishboxFrameContent.scrollTop = 0; // Scroll to top for newest
  } else {
    wishboxFrameContent.scrollTop = wishboxFrameContent.scrollHeight; // Scroll to bottom for oldest
  }
}

/**
 * Render a compact wishbox item for the frame
 */
function renderWishboxFrameItem(message: any): HTMLElement {
  const itemEl = document.createElement('div');
  itemEl.className = 'wishbox-item';
  itemEl.dataset.messageId = message.id;
  
  // Parse structured request format (same as main wishbox)
  const parsedRequest = parseDiscordRequest(message.content);
  
  if (parsedRequest) {
    // Structured format: Name, Request 1, Request 2, Message
    let requestsHtml = '';
    
    if (parsedRequest.request1) {
      requestsHtml += `
        <div class="wishbox-item-request" data-search="${escapeHtml(parsedRequest.request1)}" title="In Suche einfügen">
          <span class="material-icons">search</span>
          <span class="request-text">${escapeHtml(parsedRequest.request1)}</span>
        </div>
      `;
    }
    
    if (parsedRequest.request2) {
      requestsHtml += `
        <div class="wishbox-item-request" data-search="${escapeHtml(parsedRequest.request2)}" title="In Suche einfügen">
          <span class="material-icons">search</span>
          <span class="request-text">${escapeHtml(parsedRequest.request2)}</span>
        </div>
      `;
    }
    
    itemEl.innerHTML = `
      <div class="wishbox-item-header">
        ${parsedRequest.name ? `<div class="wishbox-item-name"><span class="material-icons">person</span>${escapeHtml(parsedRequest.name)}</div>` : ''}
        <div class="wishbox-item-time">${formatDiscordTimestamp(message.timestamp)}</div>
      </div>
      ${requestsHtml}
      ${parsedRequest.message ? `<div class="wishbox-item-message"><span class="material-icons">chat</span>${escapeHtml(parsedRequest.message)}</div>` : ''}
    `;
    
    // Add click handlers for request buttons
    const requestElements = itemEl.querySelectorAll('.wishbox-item-request');
    requestElements.forEach((reqEl) => {
      reqEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const searchQuery = (reqEl as HTMLElement).dataset.search || '';
        if (searchQuery) {
          const searchInput = document.getElementById('search-input') as HTMLInputElement;
          const searchBtnMain = document.getElementById('search-btn') as HTMLButtonElement;
          
          if (searchInput && searchBtnMain) {
            searchInput.value = searchQuery;
            searchInput.focus();
            searchBtnMain.click();
            console.log(`🔍 Search triggered from wishbox frame: ${searchQuery}`);
          }
        }
      });
    });
  } else {
    // Fallback: Simple message format (no structure)
    itemEl.innerHTML = `
      <div class="wishbox-item-header">
        <div class="wishbox-item-content">${escapeHtml(message.content)}</div>
        <div class="wishbox-item-time">${formatDiscordTimestamp(message.timestamp)}</div>
      </div>
    `;
    
    // Click handler: Insert entire message content into search
    itemEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const searchQuery = message.content || '';
      if (searchQuery) {
        const searchInput = document.getElementById('search-input') as HTMLInputElement;
        const searchBtnMain = document.getElementById('search-btn') as HTMLButtonElement;
        
        if (searchInput && searchBtnMain) {
          searchInput.value = searchQuery;
          searchInput.focus();
          searchBtnMain.click();
          console.log(`🔍 Search triggered from wishbox frame: ${searchQuery}`);
        }
      }
    });
  }
  
  return itemEl;
}

/**
 * Handle new Discord message
 */
function handleNewDiscordMessage(message: any) {
  console.log('💬 New Discord wish:', message);
  
  // Add to messages array
  discordMessages.push(message);
  
  // Keep only last 50 messages
  if (discordMessages.length > 50) {
    discordMessages.shift();
  }
  
  // Update dropdown UI if wishbox is open
  if (wishboxDropdown.classList.contains('show')) {
    updateWishboxContent();
  }
  
  // Always update the frame (visible between Decks C+D)
  updateWishboxFrameContent();
  
  // Show notification badge (optional)
  wishboxBtn.classList.add('active');
}

/**
 * Toggle wishbox dropdown
 */
function toggleWishbox() {
  const isOpen = wishboxDropdown.classList.contains('show');
  
  if (isOpen) {
    closeWishbox();
  } else {
    openWishbox();
  }
}

/**
 * Open wishbox dropdown
 */
function openWishbox() {
  // Show dropdown first so it has dimensions
  wishboxDropdown.classList.add('show');
  wishboxBtn.classList.add('active');
  updateWishboxContent();
  
  // Hide status if connected
  const client = getDiscordClient();
  if (client) {
    wishboxStatus.classList.add('hidden');
  }
  
  // Portal to body and position after DOM update
  setTimeout(() => {
    wishboxOriginalParent = portalDropdownToBody(wishboxDropdown, wishboxDropdownPlaceholder, wishboxBtn as HTMLElement);
  }, 0);
}

/**
 * Close wishbox dropdown
 */
function closeWishbox() {
  wishboxDropdown.classList.remove('show');
  wishboxBtn.classList.remove('active');
  restoreDropdown(wishboxDropdown, wishboxDropdownPlaceholder, wishboxOriginalParent);
}

// Event listeners for wishbox
wishboxBtn?.addEventListener('click', toggleWishbox);
wishboxCloseBtn?.addEventListener('click', closeWishbox);

// Close wishbox when clicking outside (same as radio dropdown)
document.addEventListener('click', (e) => {
  const wishboxIsOpen = wishboxDropdown?.classList.contains('show');
  if (wishboxIsOpen && wishboxBtn && wishboxDropdown && 
      !wishboxBtn.contains(e.target as Node) && 
      !wishboxDropdown.contains(e.target as Node)) {
    closeWishbox();
  }
});

// Sort button event listener
wishboxSortBtn?.addEventListener('click', (e) => {
  e.stopPropagation(); // Prevent closing wishbox
  
  // Toggle sort order
  wishboxSortOrder = wishboxSortOrder === 'newest' ? 'oldest' : 'newest';
  
  // Save to localStorage
  localStorage.setItem('wishboxSortOrder', wishboxSortOrder);
  
  // Update button icon
  updateSortButtonIcon();
  
  // Refresh UI with new sort order
  updateWishboxContent();
  
  console.log(`🔄 Sort order changed to: ${wishboxSortOrder}`);
});

// Wishbox can only be closed by clicking the X button or wishbox icon
// (No click-outside to close)

// Discord client will be initialized after config is loaded
let discordClient: any = null;

// Function to initialize Discord after config is ready
function initializeDiscordClient() {
  console.log('🔧 Initializing Discord Gateway...');
  discordClient = initializeDiscord();

  // Setup sort button event listener for dropdown only
  if (wishboxSortBtn) {
    wishboxSortBtn.addEventListener('click', () => {
      // Toggle sort order
      wishboxSortOrder = wishboxSortOrder === 'newest' ? 'oldest' : 'newest';
      localStorage.setItem('wishboxSortOrder', wishboxSortOrder);
      
      // Update UI
      updateSortButtonIcon();
      
      // Re-render both displays
      updateWishboxContent();
      updateWishboxFrameContent();
      
      console.log(`📊 Sort order changed to: ${wishboxSortOrder}`);
    });
  }

  if (discordClient) {
    console.log('🔗 Discord Gateway client initialized');
    
    // Subscribe to new messages
    discordClient.onNewMessage(handleNewDiscordMessage);
    
    // Subscribe to message deletions
    discordClient.onMessageDelete((messageId: string, channelId: string) => {
      console.log(`🗑️ Message deleted: ${messageId} in channel ${channelId}`);
      
      // Remove from local storage
      const index = discordMessages.findIndex(m => m.id === messageId);
      if (index !== -1) {
        console.log(`✅ Removing message from local storage: ${discordMessages[index].content}`);
        discordMessages.splice(index, 1);
        
        // Update both UIs
        updateWishboxContent();
        updateWishboxFrameContent();
        
        // Update status to show new message count
        const wishboxStatus = document.getElementById('wishbox-status');
        if (wishboxStatus) {
          wishboxStatus.innerHTML = `
            <span class="material-icons" style="color: #43b581;">check_circle</span>
            Verbunden - ${discordMessages.length} Nachrichten
          `;
        }
      }
    });
    
    // After a delay, fetch existing messages via REST API (fallback to REST)
    (async () => {
      try {
        const wishboxStatus = document.getElementById('wishbox-status');
        if (wishboxStatus) {
          wishboxStatus.innerHTML = `
            <span class="material-icons rotating">sync</span>
            Lade Nachrichten...
          `;
        }
        
        console.log('📥 Loading existing Discord messages via REST API...');
        const { fetchChannelMessages } = await import('./discordGateway');
        const existingMessages = await fetchChannelMessages(50);
        
        console.log(`📥 Loaded ${existingMessages.length} existing messages`);
        
        // Add messages to storage and UI
        existingMessages.forEach((message: any) => {
          // Check if message already exists (avoid duplicates)
          const exists = discordMessages.some(m => m.id === message.id);
          if (!exists) {
            // Store complete message including attachments
            discordMessages.push(message);
          }
        });
        
        // Update both UIs
        updateWishboxContent();
        updateWishboxFrameContent();
        
        // Update status when connected
        setTimeout(() => {
          if (wishboxStatus) {
            wishboxStatus.innerHTML = `
              <span class="material-icons" style="color: #43b581;">check_circle</span>
              Verbunden - ${discordMessages.length} Nachrichten
            `;
          }
        }, 1000);
        
      } catch (error) {
        console.error('❌ Failed to load existing messages:', error);
      }
    })();
    
    // Old status update (fallback)
    setTimeout(() => {
      const wishboxStatus = document.getElementById('wishbox-status');
      if (wishboxStatus && wishboxStatus.innerHTML.includes('Verbinde')) {
        wishboxStatus.innerHTML = `
          <span class="material-icons" style="color: #43b581;">check_circle</span>
          Verbunden mit Discord
        `;
        setTimeout(() => {
          wishboxStatus.classList.add('hidden');
        }, 3000);
      }
    }, 2000);
  } else {
    console.warn('⚠️ Discord Gateway not initialized (missing env variables)');
    
    const wishboxStatus = document.getElementById('wishbox-status');
    const wishboxBtn = document.getElementById('wishbox-btn') as HTMLButtonElement;
    
    // Show error in status
    if (wishboxStatus) {
      wishboxStatus.innerHTML = `
        <span class="material-icons" style="color: #f04747;">error</span>
        Discord nicht konfiguriert
      `;
    }
    
    // Disable wishbox button
    if (wishboxBtn) {
      wishboxBtn.disabled = true;
      wishboxBtn.style.opacity = '0.5';
      wishboxBtn.style.cursor = 'not-allowed';
      wishboxBtn.title = 'Discord nicht konfiguriert (env Variablen fehlen)';
    }
  }
}

(window as any).githubCat = githubCat;

// ========================================
// 🎯 CONTEXT MENU - Initialize global instance
// ========================================
const contextMenu = new ContextMenu();


