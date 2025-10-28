/**
 * WaveformAdapter Module - DEPRECATED
 * 
 * This file has been replaced by CustomWaveform.ts which uses native Web Audio API
 * instead of WaveSurfer.js library.
 * 
 * Reason for replacement:
 * - WaveSurfer.js caused ACCESS_VIOLATION crashes due to parallel audio decoding
 * - CustomWaveform uses single audio decode path with Canvas rendering
 * - Lighter weight (no external dependency)
 * - Better performance and stability
 * 
 * @deprecated Use CustomWaveform from './CustomWaveform' instead
 */

// Stub class kept for compatibility - should be removed in future cleanup
export class WaveformAdapter {
  // This class is deprecated and no longer used
  static getInstance(): WaveformAdapter {
    return new WaveformAdapter();
  }
}

// Export stub instance for backward compatibility
export const waveformAdapter = WaveformAdapter.getInstance();
