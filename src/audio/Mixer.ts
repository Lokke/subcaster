/**
 * Mixer.ts - Audio Routing Management
 * 
 * Manages:
 * - Direct audio routing between decks and outputs (no crossfader)
 * - Microphone mixing and muting
 * - Master and stream volume control
 * 
 * Part of the audio system rewrite to fix Electron renderer crashes.
 * Note: Crossfader removed - all decks route directly to master/stream
 */

import * as AudioManager from './AudioManager';

/**
 * Direct gain nodes for all 4 decks (no crossfading, just pass-through)
 */
interface DeckPassthroughGains {
  a: GainNode;
  b: GainNode;
  c: GainNode;
  d: GainNode;
}

/**
 * Internal state
 */
let deckPassthroughGains: DeckPassthroughGains | null = null;

/**
 * Initialize the mixer system
 * Creates pass-through gain nodes and wires up direct routing
 * 
 * @returns true if initialization successful, false otherwise
 */
export function init(): boolean {
  try {
    console.log('🎛️ Mixer: Initializing direct routing (no crossfader)...');

    const ctx = AudioManager.getContext();
    if (!ctx) {
      console.error('❌ Mixer: AudioContext not available');
      return false;
    }

    // Create pass-through gain nodes for each deck (full volume)
    deckPassthroughGains = {
      a: ctx.createGain(),
      b: ctx.createGain(),
      c: ctx.createGain(),
      d: ctx.createGain()
    };

    // All decks at full volume (no crossfading)
    deckPassthroughGains.a.gain.value = 1.0;
    deckPassthroughGains.b.gain.value = 1.0;
    deckPassthroughGains.c.gain.value = 1.0;
    deckPassthroughGains.d.gain.value = 1.0;

    // Wire up direct routing: Deck gains → Pass-through → Master + Stream
    const masterGain = AudioManager.getMasterGain();
    const streamGain = AudioManager.getStreamGain();

    if (masterGain) {
      deckPassthroughGains.a.connect(masterGain);
      deckPassthroughGains.b.connect(masterGain);
      deckPassthroughGains.c.connect(masterGain);
      deckPassthroughGains.d.connect(masterGain);
    } else {
      console.warn('⚠️ Mixer: Master gain not available');
    }

    if (streamGain) {
      deckPassthroughGains.a.connect(streamGain);
      deckPassthroughGains.b.connect(streamGain);
      deckPassthroughGains.c.connect(streamGain);
      deckPassthroughGains.d.connect(streamGain);
    } else {
      console.warn('⚠️ Mixer: Stream gain not available');
    }

    // Connect deck gains to pass-through
    const deckA = AudioManager.getDeckGain('a');
    const deckB = AudioManager.getDeckGain('b');
    const deckC = AudioManager.getDeckGain('c');
    const deckD = AudioManager.getDeckGain('d');

    if (deckA) deckA.connect(deckPassthroughGains.a);
    if (deckB) deckB.connect(deckPassthroughGains.b);
    if (deckC) deckC.connect(deckPassthroughGains.c);
    if (deckD) deckD.connect(deckPassthroughGains.d);

    console.log('✅ Mixer: Direct routing established → Decks → [Master + Stream]');
    return true;
  } catch (error) {
    console.error('❌ Mixer: Initialization failed:', error);
    return false;
  }
}

/**
 * Get pass-through gain node for a specific deck
 * Used by Deck instances to connect their audio
 * 
 * @param side - Deck identifier ('a', 'b', 'c', 'd')
 * @returns GainNode for this deck's pass-through channel, or null if not initialized
 */
export function getCrossfaderGain(side: 'a' | 'b' | 'c' | 'd'): GainNode | null {
  // NOTE: Function name kept for backwards compatibility (was getCrossfaderGain)
  // but now returns pass-through gain (no crossfading)
  if (!deckPassthroughGains) {
    console.warn(`⚠️ Mixer: Pass-through not initialized (requested for deck ${side})`);
    return null;
  }
  return deckPassthroughGains[side];
}

/**
 * Set microphone volume and enabled state
 * 
 * @param enabled - Whether microphone should be audible
 * @param volume - Volume level (0.0 - 1.0)
 */
export function setMicrophoneEnabled(enabled: boolean, volume: number = 1.0): void {
  const micGain = AudioManager.getMicrophoneGain();
  if (!micGain) {
    console.warn('⚠️ Mixer: Microphone gain not available');
    return;
  }

  if (enabled) {
    micGain.gain.value = Math.max(0, Math.min(1, volume));
    console.log(`🎤 Microphone: Enabled at ${Math.round(volume * 100)}%`);
  } else {
    micGain.gain.value = 0;
    console.log(`🎤 Microphone: Muted (stream still active)`);
  }
}

/**
 * Set master output volume
 * 
 * @param volume - Volume level (0.0 - 1.0)
 */
export function setMasterVolume(volume: number): void {
  const masterGain = AudioManager.getMasterGain();
  if (!masterGain) {
    console.warn('⚠️ Mixer: Master gain not available');
    return;
  }

  masterGain.gain.value = Math.max(0, Math.min(1, volume));
  console.log(`🔊 Master Volume: ${Math.round(volume * 100)}%`);
}

/**
 * Set stream output volume
 * 
 * @param volume - Volume level (0.0 - 1.0)
 */
export function setStreamVolume(volume: number): void {
  const streamGain = AudioManager.getStreamGain();
  if (!streamGain) {
    console.warn('⚠️ Mixer: Stream gain not available');
    return;
  }

  streamGain.gain.value = Math.max(0, Math.min(1, volume));
  console.log(`📡 Stream Volume: ${Math.round(volume * 100)}%`);
}

/**
 * DEPRECATED: Crossfader removed - function kept for backwards compatibility
 */
export function setCrossfaderPosition(_position: number): void {
  // No-op: Crossfader removed, all decks route directly
  console.log('⚠️ Mixer: setCrossfaderPosition called but crossfader is removed (direct routing)');
}

/**
 * Clean up mixer resources
 */
export function cleanup(): void {
  if (deckPassthroughGains) {
    // Disconnect all pass-through nodes
    Object.values(deckPassthroughGains).forEach(node => {
      try {
        node.disconnect();
      } catch (e) {
        // Ignore already disconnected
      }
    });
    deckPassthroughGains = null;
  }

  console.log('🎛️ Mixer: Cleaned up');
}

/**
 * Get current mixer state for debugging
 */
export function getState() {
  return {
    initialized: deckPassthroughGains !== null,
    directRouting: true, // No crossfader, direct routing
    gains: deckPassthroughGains ? {
      a: deckPassthroughGains.a.gain.value,
      b: deckPassthroughGains.b.gain.value,
      c: deckPassthroughGains.c.gain.value,
      d: deckPassthroughGains.d.gain.value
    } : null
  };
}
