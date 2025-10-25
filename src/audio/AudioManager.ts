/**
 * AudioManager.ts
 * 
 * Central AudioContext management and master node orchestration.
 * Handles initialization, lifecycle, and provides access to core audio infrastructure.
 */

import { clearCache as clearSourceNodeCache } from './SourceNodeCache';

/**
 * AudioManager - Central audio system manager
 * 
 * Manages AudioContext lifecycle and master audio nodes.
 * Provides safe init/close methods and access to audio resources.
 */

export interface AudioManagerState {
  initialized: boolean;
  audioContext: AudioContext | null;
  masterGainNode: GainNode | null;
  streamGainNode: GainNode | null;
  masterDestination: MediaStreamAudioDestinationNode | null;
  
  // Per-deck gain nodes (A, B, C, D)
  deckGains: {
    a: GainNode | null;
    b: GainNode | null;
    c: GainNode | null;
    d: GainNode | null;
  };
  
  // Crossfader gain nodes (for monitor output)
  crossfaderGains: {
    a: GainNode | null;
    b: GainNode | null;
    c: GainNode | null;
    d: GainNode | null;
  };
  
  // Microphone nodes
  microphoneGain: GainNode | null;
}

const state: AudioManagerState = {
  initialized: false,
  audioContext: null,
  masterGainNode: null,
  streamGainNode: null,
  masterDestination: null,
  deckGains: { a: null, b: null, c: null, d: null },
  crossfaderGains: { a: null, b: null, c: null, d: null },
  microphoneGain: null,
};

/**
 * Initialize the Audio Manager and create master audio infrastructure.
 * 
 * This creates:
 * - AudioContext with playback latency hint (browser-friendly)
 * - Master gain for monitor output (speakers/headphones)
 * - Stream gain for broadcast output (AzuraCast/streaming)
 * - Per-deck gain nodes (4 decks: A, B, C, D)
 * - Crossfader gains for monitor mixing
 * - Microphone gain node
 * 
 * @returns Promise that resolves when initialization is complete
 */
export async function init(): Promise<void> {
  if (state.initialized) {
    console.warn('⚠️ AudioManager already initialized');
    return;
  }

  try {
    console.log('🎵 Initializing AudioManager...');

    // Create AudioContext with browser-friendly options
    const audioContextOptions: AudioContextOptions = {
      latencyHint: 'playback', // Optimized for playback, less invasive
    };

    state.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)(audioContextOptions);

    console.log(`🎵 AudioContext created:`);
    console.log(`   Sample Rate: ${state.audioContext.sampleRate} Hz`);
    console.log(`   State: ${state.audioContext.state}`);

    // Resume if suspended (autoplay policy)
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
      console.log('🔊 AudioContext resumed');
    }

    // Create master gain node (monitor output to speakers/headphones)
    state.masterGainNode = state.audioContext.createGain();
    state.masterGainNode.gain.value = 0.99; // 99% volume
    state.masterGainNode.connect(state.audioContext.destination);

    // Create stream gain node (broadcast output to AzuraCast/streaming)
    state.streamGainNode = state.audioContext.createGain();
    state.streamGainNode.gain.value = 0.99; // 99% volume

    // Create master destination for streaming
    state.masterDestination = state.audioContext.createMediaStreamDestination();
    state.streamGainNode.connect(state.masterDestination);

    // Create per-deck gain nodes
    state.deckGains.a = state.audioContext.createGain();
    state.deckGains.a.gain.value = 1.0;
    state.deckGains.b = state.audioContext.createGain();
    state.deckGains.b.gain.value = 1.0;
    state.deckGains.c = state.audioContext.createGain();
    state.deckGains.c.gain.value = 1.0;
    state.deckGains.d = state.audioContext.createGain();
    state.deckGains.d.gain.value = 1.0;

    // Create crossfader gain nodes
    const initialGain = Math.cos(0.5 * Math.PI / 2); // ~0.707 for 50% position
    state.crossfaderGains.a = state.audioContext.createGain();
    state.crossfaderGains.a.gain.value = initialGain;
    state.crossfaderGains.b = state.audioContext.createGain();
    state.crossfaderGains.b.gain.value = initialGain;
    state.crossfaderGains.c = state.audioContext.createGain();
    state.crossfaderGains.c.gain.value = initialGain;
    state.crossfaderGains.d = state.audioContext.createGain();
    state.crossfaderGains.d.gain.value = initialGain;

    // Create microphone gain node
    state.microphoneGain = state.audioContext.createGain();
    state.microphoneGain.gain.value = 1.0;

    // Wire up routing:
    // Deck Gains → Crossfader Gains → Master/Stream Gains

    // Monitor routing (speakers): All decks through crossfader
    state.crossfaderGains.a.connect(state.masterGainNode);
    state.crossfaderGains.b.connect(state.masterGainNode);
    state.crossfaderGains.c.connect(state.masterGainNode);
    state.crossfaderGains.d.connect(state.masterGainNode);

    // Stream routing: All decks + mic to stream
    state.crossfaderGains.a.connect(state.streamGainNode);
    state.crossfaderGains.b.connect(state.streamGainNode);
    state.crossfaderGains.c.connect(state.streamGainNode);
    state.crossfaderGains.d.connect(state.streamGainNode);
    state.microphoneGain.connect(state.streamGainNode);

    // Connect deck gains to crossfader gains
    state.deckGains.a.connect(state.crossfaderGains.a);
    state.deckGains.b.connect(state.crossfaderGains.b);
    state.deckGains.c.connect(state.crossfaderGains.c);
    state.deckGains.d.connect(state.crossfaderGains.d);

    state.initialized = true;

    console.log('✅ AudioManager initialized successfully');
    console.log('🎛️ Routing: Decks → Crossfader → [Monitor + Stream]');
  } catch (error) {
    console.error('❌ Failed to initialize AudioManager:', error);
    throw error;
  }
}

/**
 * Get the AudioContext instance.
 * Throws if not initialized.
 */
export function getContext(): AudioContext {
  if (!state.audioContext) {
    throw new Error('AudioManager not initialized. Call init() first.');
  }
  return state.audioContext;
}

/**
 * Get a deck's gain node
 */
export function getDeckGain(side: 'a' | 'b' | 'c' | 'd'): GainNode | null {
  return state.deckGains[side];
}

/**
 * Get the microphone gain node
 */
export function getMicrophoneGain(): GainNode | null {
  return state.microphoneGain;
}

/**
 * Get the stream output (for broadcasting)
 */
export function getStreamDestination(): MediaStreamAudioDestinationNode | null {
  return state.masterDestination;
}

/**
 * Get the master gain node (for monitoring)
 */
export function getMasterGain(): GainNode | null {
  return state.masterGainNode;
}

/**
 * Check if AudioManager is initialized
 */
export function isInitialized(): boolean {
  return state.initialized;
}

/**
 * Close AudioContext and cleanup all audio resources.
 * This should be called on app shutdown or reload.
 */
export async function close(): Promise<void> {
  console.log('🧹 Closing AudioManager...');

  try {
    // Clear source node cache
    clearSourceNodeCache();

    // Close AudioContext to release audio hardware
    if (state.audioContext && state.audioContext.state !== 'closed') {
      await state.audioContext.close();
      console.log('🔊 AudioContext closed');
    }

    // Reset state
    state.audioContext = null;
    state.masterGainNode = null;
    state.streamGainNode = null;
    state.masterDestination = null;
    state.deckGains = { a: null, b: null, c: null, d: null };
    state.crossfaderGains = { a: null, b: null, c: null, d: null };
    state.microphoneGain = null;
    state.initialized = false;

    console.log('✅ AudioManager closed');
  } catch (error) {
    console.error('❌ Error closing AudioManager:', error);
  }
}

/**
 * Debug: Get current AudioManager state
 */
export function debugState(): void {
  console.log('📊 AudioManager State:');
  console.log(`   Initialized: ${state.initialized}`);
  console.log(`   AudioContext: ${state.audioContext?.state || 'null'}`);
  console.log(`   Sample Rate: ${state.audioContext?.sampleRate || 'N/A'} Hz`);
  console.log(`   Deck Gains: A=${!!state.deckGains.a}, B=${!!state.deckGains.b}, C=${!!state.deckGains.c}, D=${!!state.deckGains.d}`);
  console.log(`   Microphone Gain: ${!!state.microphoneGain}`);
}

// Expose for debugging
if (typeof window !== 'undefined') {
  (window as any).AudioManager = {
    init,
    close,
    getContext,
    isInitialized,
    debugState,
  };
}
