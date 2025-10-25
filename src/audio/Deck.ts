/**
 * Deck.ts - Audio Player Deck Manager
 * 
 * Manages a single player deck (A, B, C, or D).
 * Encapsulates HTMLAudioElement lifecycle, playback controls,
 * mixer connection, and volume control.
 * 
 * Key responsibilities:
 * - Load tracks into HTMLAudioElement
 * - Control playback (play/pause/seek)
 * - Connect/disconnect from audio mixer
 * - Volume control
 * - State tracking (empty/loading/ready/playing/paused/ended/error)
 * 
 * Thread safety:
 * - All methods should be called from main thread (renderer)
 * - Uses deferred connection strategy (connect on play, not on load)
 */

import * as AudioManager from './AudioManager';
import * as SourceNodeCache from './SourceNodeCache';

export type DeckSide = 'a' | 'b' | 'c' | 'd';

export type DeckState = 
  | 'empty'      // No track loaded
  | 'loading'    // Track loading
  | 'ready'      // Track loaded, ready to play
  | 'playing'    // Currently playing
  | 'paused'     // Paused
  | 'ended'      // Track ended
  | 'error';     // Error state

export interface TrackMetadata {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  coverArt?: string;
}

/**
 * Deck class - manages a single audio player deck
 */
export class Deck {
  private side: DeckSide;
  private audioElement: HTMLAudioElement;
  private currentTrack: TrackMetadata | null = null;
  private isConnectedToMixer: boolean = false;
  private pendingMixerConnection: boolean = false;

  constructor(side: DeckSide, audioElement: HTMLAudioElement) {
    this.side = side;
    this.audioElement = audioElement;

    // Setup event listeners for auto-connection
    this.setupEventListeners();
  }

  /**
   * Get current deck state
   */
  getState(): DeckState {
    if (!this.audioElement.src || this.audioElement.src === '') {
      return 'empty';
    }

    if (this.audioElement.error) {
      return 'error';
    }

    if (this.audioElement.readyState < 2) {
      return 'loading';
    }

    if (this.audioElement.ended || 
        (this.audioElement.duration > 0 && this.audioElement.currentTime >= this.audioElement.duration)) {
      return 'ended';
    }

    if (!this.audioElement.paused && this.audioElement.currentTime > 0) {
      return 'playing';
    }

    if (this.audioElement.paused && this.audioElement.currentTime > 0) {
      return 'paused';
    }

    return 'ready';
  }

  /**
   * Check if deck is playing
   */
  isPlaying(): boolean {
    return this.getState() === 'playing';
  }

  /**
   * Check if deck is available for new content
   */
  isAvailable(): boolean {
    const state = this.getState();
    return state === 'empty' || state === 'ended' || state === 'error';
  }

  /**
   * Get current track metadata
   */
  getCurrentTrack(): TrackMetadata | null {
    return this.currentTrack;
  }

  /**
   * Load a track into this deck
   * @param url - Audio stream URL
   * @param metadata - Track metadata
   */
  async load(url: string, metadata: TrackMetadata): Promise<void> {
    console.log(`🎵 [Deck ${this.side.toUpperCase()}] Loading track: ${metadata.title}`);

    // Clear previous track first
    await this.clear();

    // Set new source
    this.audioElement.src = url;
    this.audioElement.dataset.songId = metadata.id;
    this.currentTrack = metadata;

    // Set pending connection flag - will connect when play starts
    this.pendingMixerConnection = true;

    console.log(`✅ [Deck ${this.side.toUpperCase()}] Track loaded: ${metadata.title}`);
  }

  /**
   * Play the loaded track
   */
  async play(): Promise<void> {
    const state = this.getState();
    if (state === 'empty' || state === 'error') {
      throw new Error(`Cannot play deck ${this.side}: ${state}`);
    }

    console.log(`▶️ [Deck ${this.side.toUpperCase()}] Play requested`);

    // Connect to mixer if not already connected
    if (!this.isConnectedToMixer) {
      this.connectToMixer();
    }

    await this.audioElement.play();
    console.log(`✅ [Deck ${this.side.toUpperCase()}] Playing`);
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (this.getState() === 'playing') {
      this.audioElement.pause();
      console.log(`⏸️ [Deck ${this.side.toUpperCase()}] Paused`);
    }
  }

  /**
   * Seek to position
   * @param time - Time in seconds
   */
  seek(time: number): void {
    if (this.audioElement.duration > 0) {
      this.audioElement.currentTime = Math.max(0, Math.min(time, this.audioElement.duration));
      console.log(`⏩ [Deck ${this.side.toUpperCase()}] Seeked to ${time.toFixed(2)}s`);
    }
  }

  /**
   * Set volume (0-1)
   * @param volume - Volume level (0-1)
   */
  setVolume(volume: number): void {
    this.audioElement.volume = Math.max(0, Math.min(1, volume));
    console.log(`🔊 [Deck ${this.side.toUpperCase()}] Volume: ${Math.round(volume * 100)}%`);
  }

  /**
   * Clear deck and disconnect
   */
  async clear(): Promise<void> {
    console.log(`🔄 [Deck ${this.side.toUpperCase()}] Clearing deck`);

    // Pause and reset playback
    this.audioElement.pause();
    this.audioElement.currentTime = 0;

    // Disconnect from mixer
    this.disconnectFromMixer();

    // Clear source
    this.audioElement.src = '';
    this.audioElement.load();
    this.audioElement.removeAttribute('src');
    delete this.audioElement.dataset.songId;

    // Clear metadata
    this.currentTrack = null;
    this.pendingMixerConnection = false;

    console.log(`✅ [Deck ${this.side.toUpperCase()}] Cleared`);
  }

  /**
   * Connect audio element to mixer
   * 🔧 ELECTRON FIX: Only connect when audio is actually playing
   * to prevent ACCESS_VIOLATION crashes
   */
  connectToMixer(): boolean {
    if (this.isConnectedToMixer) {
      console.log(`✓ [Deck ${this.side.toUpperCase()}] Already connected to mixer`);
      return true;
    }

    // 🔧 ELECTRON FIX: Don't connect if audio isn't ready or playing
    if (!this.audioElement.src || this.audioElement.readyState === 0) {
      console.warn(`⚠️ [Deck ${this.side.toUpperCase()}] Audio not ready - deferring connection`);
      this.pendingMixerConnection = true;
      return false;
    }

    // 🔧 ELECTRON FIX: Defer connection until audio is actually playing
    if (this.audioElement.paused && this.audioElement.currentTime === 0) {
      console.log(`⏸️ [Deck ${this.side.toUpperCase()}] Not yet playing - deferring connection`);
      this.pendingMixerConnection = true;
      return false;
    }

    try {
      const context = AudioManager.getContext();
      if (!context) {
        console.warn(`⚠️ [Deck ${this.side.toUpperCase()}] AudioContext not available`);
        return false;
      }

      // Get or create source node (safe from duplicate creation)
      const sourceNode = SourceNodeCache.getOrCreateSourceNode(this.audioElement, context);
      if (!sourceNode) {
        console.error(`❌ [Deck ${this.side.toUpperCase()}] Failed to get SourceNode`);
        return false;
      }

      // Get deck gain node from AudioManager
      const deckGain = AudioManager.getDeckGain(this.side);
      if (!deckGain) {
        console.error(`❌ [Deck ${this.side.toUpperCase()}] Deck gain node not found`);
        return false;
      }

      // Connect: SourceNode → DeckGain (already connected to crossfader → master/stream)
      sourceNode.connect(deckGain);

      this.isConnectedToMixer = true;
      this.pendingMixerConnection = false;

      console.log(`✅ [Deck ${this.side.toUpperCase()}] Connected to mixer`);
      return true;

    } catch (error) {
      console.error(`❌ [Deck ${this.side.toUpperCase()}] Failed to connect to mixer:`, error);
      return false;
    }
  }

  /**
   * Disconnect from mixer
   */
  disconnectFromMixer(): void {
    if (!this.isConnectedToMixer) {
      return;
    }

    try {
      // Remove source node from cache (disconnects automatically)
      SourceNodeCache.removeSourceNode(this.audioElement);

      this.isConnectedToMixer = false;
      this.pendingMixerConnection = false;

      console.log(`🔌 [Deck ${this.side.toUpperCase()}] Disconnected from mixer`);

    } catch (error) {
      console.error(`❌ [Deck ${this.side.toUpperCase()}] Failed to disconnect:`, error);
    }
  }

  /**
   * Setup event listeners for automatic connection management
   */
  private setupEventListeners(): void {
    // 🔧 ELECTRON FIX: Connect to mixer when track starts playing
    this.audioElement.addEventListener('playing', () => {
      console.log(`🎵 [Deck ${this.side.toUpperCase()}] 'playing' event - ensuring mixer connection`);
      if (this.pendingMixerConnection || !this.isConnectedToMixer) {
        this.connectToMixer();
      }
    });

    // Try to connect when audio can play through
    this.audioElement.addEventListener('canplaythrough', () => {
      console.log(`🎵 [Deck ${this.side.toUpperCase()}] 'canplaythrough' event - checking mixer connection`);
      if (this.pendingMixerConnection && !this.audioElement.paused) {
        this.connectToMixer();
      }
    });

    // Handle errors
    this.audioElement.addEventListener('error', () => {
      console.error(`❌ [Deck ${this.side.toUpperCase()}] Audio error`);
      this.disconnectFromMixer();
    });

    // Handle track end
    this.audioElement.addEventListener('ended', () => {
      console.log(`🏁 [Deck ${this.side.toUpperCase()}] Track ended`);
      // Note: Keep connected to mixer for seamless transitions
    });
  }

  /**
   * Get the underlying audio element (for UI updates)
   */
  getAudioElement(): HTMLAudioElement {
    return this.audioElement;
  }

  /**
   * Get deck side identifier
   */
  getSide(): DeckSide {
    return this.side;
  }
}
