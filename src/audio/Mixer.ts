/**
 * Mixer.ts - Crossfader and Audio Routing Management
 * 
 * Manages:
 * - 4-deck crossfader with smooth gain curves
 * - Audio routing between decks, mixer, and outputs
 * - Microphone mixing and muting
 * - Master and stream volume control
 * 
 * Part of the audio system rewrite to fix Electron renderer crashes.
 */

import * as AudioManager from './AudioManager';

/**
 * Crossfader gain state for all 4 decks
 */
interface CrossfaderGains {
  a: GainNode;
  b: GainNode;
  c: GainNode;
  d: GainNode;
}

/**
 * Internal state
 */
let crossfaderGains: CrossfaderGains | null = null;
let currentCrossfaderPosition: number = 0.5; // Center position

/**
 * Initialize the mixer system
 * Creates crossfader gain nodes and wires up audio routing
 * 
 * @returns true if initialization successful, false otherwise
 */
export function init(): boolean {
  try {
    console.log('🎛️ Mixer: Initializing crossfader and routing...');

    const ctx = AudioManager.getContext();
    if (!ctx) {
      console.error('❌ Mixer: AudioContext not available');
      return false;
    }

    // Create crossfader gain nodes for each deck
    crossfaderGains = {
      a: ctx.createGain(),
      b: ctx.createGain(),
      c: ctx.createGain(),
      d: ctx.createGain()
    };

    // Initialize to center position (equal mix)
    const initialGain = 0.5;
    crossfaderGains.a.gain.value = initialGain;
    crossfaderGains.b.gain.value = initialGain;
    crossfaderGains.c.gain.value = initialGain;
    crossfaderGains.d.gain.value = initialGain;

    // Wire up crossfader → master + stream
    const masterGain = AudioManager.getMasterGain();
    const streamGain = AudioManager.getStreamGain();

    if (masterGain) {
      crossfaderGains.a.connect(masterGain);
      crossfaderGains.b.connect(masterGain);
      crossfaderGains.c.connect(masterGain);
      crossfaderGains.d.connect(masterGain);
    } else {
      console.warn('⚠️ Mixer: Master gain not available');
    }

    if (streamGain) {
      crossfaderGains.a.connect(streamGain);
      crossfaderGains.b.connect(streamGain);
      crossfaderGains.c.connect(streamGain);
      crossfaderGains.d.connect(streamGain);
    } else {
      console.warn('⚠️ Mixer: Stream gain not available');
    }

    // Connect deck gains to crossfader
    const deckA = AudioManager.getDeckGain('a');
    const deckB = AudioManager.getDeckGain('b');
    const deckC = AudioManager.getDeckGain('c');
    const deckD = AudioManager.getDeckGain('d');

    if (deckA) deckA.connect(crossfaderGains.a);
    if (deckB) deckB.connect(crossfaderGains.b);
    if (deckC) deckC.connect(crossfaderGains.c);
    if (deckD) deckD.connect(crossfaderGains.d);

    console.log('✅ Mixer: Routing established → Decks → Crossfader → [Master + Stream]');
    return true;
  } catch (error) {
    console.error('❌ Mixer: Initialization failed:', error);
    return false;
  }
}

/**
 * Set crossfader position (0 = all A, 0.25 = all B, 0.5 = all C, 0.75 = all D, 1.0 = all D)
 * Smooth equal-power crossfade curves for 4 decks
 * 
 * @param position - Crossfader position (0.0 - 1.0)
 */
export function setCrossfaderPosition(position: number): void {
  if (!crossfaderGains) {
    console.warn('⚠️ Mixer: Crossfader not initialized');
    return;
  }

  // Clamp position between 0 and 1
  position = Math.max(0, Math.min(1, position));
  currentCrossfaderPosition = position;

  // Equal-power crossfade curves for 4 decks
  // Position ranges: 0-0.25 (A→B), 0.25-0.5 (B→C), 0.5-0.75 (C→D), 0.75-1.0 (D)
  const aGain = position < 0.25 ? 1.0 : Math.max(0, 1.0 - (position - 0.25) * 4);
  const bGain = position < 0.25 
    ? position * 4 
    : (position < 0.5 ? 1.0 : Math.max(0, 1.0 - (position - 0.5) * 4));
  const cGain = position < 0.5 
    ? 0 
    : (position < 0.75 ? (position - 0.5) * 4 : Math.max(0, 1.0 - (position - 0.75) * 4));
  const dGain = position < 0.75 ? 0 : (position - 0.75) * 4;

  // Apply gains (clamped to 0-1)
  crossfaderGains.a.gain.value = Math.max(0, Math.min(1, aGain));
  crossfaderGains.b.gain.value = Math.max(0, Math.min(1, bGain));
  crossfaderGains.c.gain.value = Math.max(0, Math.min(1, cGain));
  crossfaderGains.d.gain.value = Math.max(0, Math.min(1, dGain));

  console.log(
    `🎚️ Crossfader: ${position.toFixed(3)} → A:${aGain.toFixed(2)} B:${bGain.toFixed(2)} C:${cGain.toFixed(2)} D:${dGain.toFixed(2)}`
  );
}

/**
 * Get current crossfader position
 * 
 * @returns Current position (0.0 - 1.0)
 */
export function getCrossfaderPosition(): number {
  return currentCrossfaderPosition;
}

/**
 * Get crossfader gain node for a specific deck
 * Used by Deck instances to connect their audio
 * 
 * @param side - Deck identifier ('a', 'b', 'c', 'd')
 * @returns GainNode for this deck's crossfader channel, or null if not initialized
 */
export function getCrossfaderGain(side: 'a' | 'b' | 'c' | 'd'): GainNode | null {
  if (!crossfaderGains) {
    console.warn(`⚠️ Mixer: Crossfader not initialized (requested for deck ${side})`);
    return null;
  }
  return crossfaderGains[side];
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
 * Clean up mixer resources
 */
export function cleanup(): void {
  if (crossfaderGains) {
    // Disconnect all crossfader nodes
    Object.values(crossfaderGains).forEach(node => {
      try {
        node.disconnect();
      } catch (e) {
        // Ignore already disconnected
      }
    });
    crossfaderGains = null;
  }

  currentCrossfaderPosition = 0.5;
  console.log('🎛️ Mixer: Cleaned up');
}

/**
 * Get current mixer state for debugging
 */
export function getState() {
  return {
    initialized: crossfaderGains !== null,
    crossfaderPosition: currentCrossfaderPosition,
    gains: crossfaderGains ? {
      a: crossfaderGains.a.gain.value,
      b: crossfaderGains.b.gain.value,
      c: crossfaderGains.c.gain.value,
      d: crossfaderGains.d.gain.value
    } : null
  };
}
