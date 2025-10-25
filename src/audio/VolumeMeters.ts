/**
 * VolumeMeters Module
 * 
 * Manages AnalyserNode-based real-time volume metering for all audio sources.
 * Provides decibel-accurate RMS (Root Mean Square) level measurements for VU meters.
 * 
 * Architecture:
 * - Singleton pattern for centralized meter management
 * - Per-source AnalyserNode instances with consistent configuration
 * - Efficient RMS calculation with dB conversion
 * - Clean lifecycle with proper disposal
 * 
 * Features:
 * - Real-time level measurement (RMS-based)
 * - Decibel scale conversion (-∞ to 0 dB)
 * - Peak detection with hold/decay
 * - Multiple source support (decks, mics, master, stream)
 * - Low CPU overhead (optimized analysis)
 */

import { getContext } from './AudioManager';

/**
 * Meter configuration
 */
interface MeterConfig {
  fftSize?: number;           // FFT size for analysis (default: 2048)
  smoothingTimeConstant?: number; // Smoothing (default: 0.8)
  minDecibels?: number;       // Min dB level (default: -90)
  maxDecibels?: number;       // Max dB level (default: 0)
}

/**
 * Meter reading
 */
export interface MeterReading {
  rms: number;        // RMS level (0.0 to 1.0)
  db: number;         // dB level (-∞ to 0)
  peak: number;       // Peak level (0.0 to 1.0)
  peakDb: number;     // Peak dB level (-∞ to 0)
}

/**
 * Meter instance for a single audio source
 */
class VolumeMeter {
  private analyser: AnalyserNode;
  private dataArray: Uint8Array<ArrayBuffer>;
  private peak = 0;
  private peakDecay = 0.95; // Peak decay factor per frame
  private sourceNode: AudioNode;
  
  constructor(
    sourceNode: AudioNode,
    context: AudioContext,
    config: MeterConfig = {}
  ) {
    this.sourceNode = sourceNode;
    
    // Create analyser
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = config.fftSize || 2048;
    this.analyser.smoothingTimeConstant = config.smoothingTimeConstant || 0.8;
    this.analyser.minDecibels = config.minDecibels || -90;
    this.analyser.maxDecibels = config.maxDecibels || 0;
    
    // Connect source -> analyser (tap, doesn't interrupt audio flow)
    this.sourceNode.connect(this.analyser);
    
    // Create data buffer with explicit ArrayBuffer type
    const buffer = new ArrayBuffer(this.analyser.frequencyBinCount);
    this.dataArray = new Uint8Array(buffer);
    
    console.log('📊 VolumeMeter: Created', {
      fftSize: this.analyser.fftSize,
      binCount: this.analyser.frequencyBinCount
    });
  }
  
  /**
   * Get current meter reading
   */
  public getReading(): MeterReading {
    // Get time domain data (waveform)
    this.analyser.getByteTimeDomainData(this.dataArray);
    
    // Calculate RMS (Root Mean Square)
    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      const normalized = (this.dataArray[i] - 128) / 128; // Normalize to -1.0 to 1.0
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    
    // Update peak with decay
    if (rms > this.peak) {
      this.peak = rms;
    } else {
      this.peak *= this.peakDecay;
    }
    
    // Convert to dB (20 * log10(level))
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const peakDb = this.peak > 0 ? 20 * Math.log10(this.peak) : -Infinity;
    
    return {
      rms,
      db,
      peak: this.peak,
      peakDb
    };
  }
  
  /**
   * Reset peak hold
   */
  public resetPeak(): void {
    this.peak = 0;
  }
  
  /**
   * Dispose of this meter
   */
  public dispose(): void {
    try {
      // Disconnect analyser
      this.sourceNode.disconnect(this.analyser);
      this.analyser.disconnect();
      
      console.log('📊 VolumeMeter: Disposed');
    } catch (error) {
      console.error('❌ VolumeMeter: Disposal failed', error);
    }
  }
}

/**
 * VolumeMeters manager - singleton
 */
export class VolumeMeters {
  private static instance: VolumeMeters | null = null;
  private meters = new Map<string, VolumeMeter>();
  private defaultConfig: MeterConfig = {
    fftSize: 2048,
    smoothingTimeConstant: 0.8,
    minDecibels: -90,
    maxDecibels: 0
  };
  
  /**
   * Private constructor - use getInstance()
   */
  private constructor() {
    console.log('📊 VolumeMeters: Initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): VolumeMeters {
    if (!VolumeMeters.instance) {
      VolumeMeters.instance = new VolumeMeters();
    }
    return VolumeMeters.instance;
  }
  
  /**
   * Reset singleton (for testing only)
   */
  public static resetInstance(): void {
    if (VolumeMeters.instance) {
      VolumeMeters.instance.disposeAll();
      VolumeMeters.instance = null;
    }
  }
  
  /**
   * Create or get a meter for a source
   * 
   * @param id - Unique meter identifier (e.g., "deck-a", "mic-1", "master")
   * @param sourceNode - Audio source node to meter
   * @param config - Optional meter configuration
   */
  public createMeter(id: string, sourceNode: AudioNode, config?: MeterConfig): void {
    // Dispose existing meter if any
    if (this.meters.has(id)) {
      console.log(`📊 VolumeMeters: Replacing existing meter: ${id}`);
      this.disposeMeter(id);
    }
    
    const context = getContext();
    if (!context) {
      console.error('❌ VolumeMeters: Cannot create meter - AudioContext not available');
      return;
    }
    
    const meterConfig = { ...this.defaultConfig, ...config };
    const meter = new VolumeMeter(sourceNode, context, meterConfig);
    this.meters.set(id, meter);
    
    console.log(`✅ VolumeMeters: Meter created: ${id}`);
  }
  
  /**
   * Get meter reading
   * 
   * @param id - Meter identifier
   * @returns Meter reading or null if meter doesn't exist
   */
  public getReading(id: string): MeterReading | null {
    const meter = this.meters.get(id);
    if (!meter) {
      return null;
    }
    return meter.getReading();
  }
  
  /**
   * Get all meter readings
   * 
   * @returns Map of meter IDs to readings
   */
  public getAllReadings(): Map<string, MeterReading> {
    const readings = new Map<string, MeterReading>();
    for (const [id, meter] of this.meters) {
      readings.set(id, meter.getReading());
    }
    return readings;
  }
  
  /**
   * Reset peak hold for a meter
   * 
   * @param id - Meter identifier
   */
  public resetPeak(id: string): void {
    const meter = this.meters.get(id);
    if (meter) {
      meter.resetPeak();
    }
  }
  
  /**
   * Reset all peaks
   */
  public resetAllPeaks(): void {
    for (const meter of this.meters.values()) {
      meter.resetPeak();
    }
  }
  
  /**
   * Dispose of a specific meter
   * 
   * @param id - Meter identifier
   */
  public disposeMeter(id: string): void {
    const meter = this.meters.get(id);
    if (meter) {
      meter.dispose();
      this.meters.delete(id);
      console.log(`📊 VolumeMeters: Meter disposed: ${id}`);
    }
  }
  
  /**
   * Dispose of all meters
   */
  public disposeAll(): void {
    console.log(`📊 VolumeMeters: Disposing ${this.meters.size} meters`);
    for (const [id, meter] of this.meters) {
      meter.dispose();
    }
    this.meters.clear();
    console.log('✅ VolumeMeters: All meters disposed');
  }
  
  /**
   * Check if meter exists
   * 
   * @param id - Meter identifier
   */
  public hasMeter(id: string): boolean {
    return this.meters.has(id);
  }
  
  /**
   * Get list of all meter IDs
   */
  public getMeterIds(): string[] {
    return Array.from(this.meters.keys());
  }
  
  /**
   * Get meter count
   */
  public getMeterCount(): number {
    return this.meters.size;
  }
}

/**
 * Export singleton instance
 */
export const volumeMeters = VolumeMeters.getInstance();
