/**
 * WaveformAdapter Module
 * 
 * Wrapper for WaveSurfer library with enforced MediaElement backend.
 * Ensures sequential waveform loading to prevent parallel audio decoding crashes.
 * 
 * Architecture:
 * - Singleton pattern prevents duplicate instances
 * - MediaElement backend prevents AudioBuffer decoding crashes
 * - Sequential loading queue prevents parallel decode attempts
 * - Clean lifecycle management with proper cleanup
 * 
 * Crash Prevention:
 * - Forces MediaElement backend (no AudioBuffer decoding)
 * - Queue system prevents parallel load operations
 * - Proper cleanup prevents memory leaks
 * - Error boundaries prevent cascade failures
 */

import WaveSurfer from 'wavesurfer.js';

/**
 * Waveform loading queue item
 */
interface QueueItem {
  wavesurfer: WaveSurfer;
  url: string;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * WaveformAdapter class - manages WaveSurfer instances with safe loading
 */
export class WaveformAdapter {
  private static instance: WaveformAdapter | null = null;
  private loadQueue: QueueItem[] = [];
  private isLoading = false;
  
  /**
   * Private constructor - use getInstance()
   */
  private constructor() {
    console.log('🎵 WaveformAdapter: Initialized');
  }
  
  /**
   * Get singleton instance
   */
  public static getInstance(): WaveformAdapter {
    if (!WaveformAdapter.instance) {
      WaveformAdapter.instance = new WaveformAdapter();
    }
    return WaveformAdapter.instance;
  }
  
  /**
   * Reset singleton (for testing only)
   */
  public static resetInstance(): void {
    if (WaveformAdapter.instance) {
      WaveformAdapter.instance.loadQueue = [];
      WaveformAdapter.instance.isLoading = false;
      WaveformAdapter.instance = null;
    }
  }
  
  /**
   * Create a new WaveSurfer instance with safe MediaElement backend
   * 
   * @param container - Container element for waveform
   * @param options - Additional WaveSurfer options (backend will be forced to MediaElement)
   * @returns WaveSurfer instance
   */
  public createWaveSurfer(container: string | HTMLElement, options: any = {}): WaveSurfer {
    // Force MediaElement backend to prevent AudioBuffer decoding crashes
    const safeOptions = {
      ...options,
      backend: 'MediaElement', // CRITICAL: Prevents audio decoding crashes
      mediaControls: false,
      interact: true,
    };
    
    console.log('🎵 WaveformAdapter: Creating WaveSurfer instance', {
      container: typeof container === 'string' ? container : 'HTMLElement',
      backend: safeOptions.backend
    });
    
    try {
      const wavesurfer = WaveSurfer.create({
        container,
        ...safeOptions
      });
      
      console.log('✅ WaveformAdapter: WaveSurfer instance created successfully');
      return wavesurfer;
      
    } catch (error) {
      console.error('❌ WaveformAdapter: Failed to create WaveSurfer instance', error);
      throw new Error(`WaveSurfer creation failed: ${error}`);
    }
  }
  
  /**
   * Load audio into WaveSurfer with sequential queue to prevent parallel decoding
   * 
   * @param wavesurfer - WaveSurfer instance
   * @param url - Audio file URL
   * @returns Promise that resolves when loading is complete
   */
  public async loadAudio(wavesurfer: WaveSurfer, url: string): Promise<void> {
    console.log(`🎵 WaveformAdapter: Queueing audio load: ${url}`);
    
    return new Promise((resolve, reject) => {
      // Add to queue
      this.loadQueue.push({
        wavesurfer,
        url,
        resolve,
        reject
      });
      
      // Process queue if not already processing
      if (!this.isLoading) {
        this.processQueue();
      }
    });
  }
  
  /**
   * Process the loading queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.loadQueue.length === 0) {
      this.isLoading = false;
      console.log('✅ WaveformAdapter: Queue empty, processing complete');
      return;
    }
    
    this.isLoading = true;
    const item = this.loadQueue.shift()!;
    
    console.log(`🎵 WaveformAdapter: Processing load (${this.loadQueue.length} remaining in queue): ${item.url}`);
    
    try {
      // Load the audio
      await item.wavesurfer.load(item.url);
      
      console.log(`✅ WaveformAdapter: Load successful: ${item.url}`);
      item.resolve();
      
    } catch (error) {
      console.error(`❌ WaveformAdapter: Load failed: ${item.url}`, error);
      item.reject(error instanceof Error ? error : new Error(String(error)));
      
    } finally {
      // Continue with next item in queue
      this.processQueue();
    }
  }
  
  /**
   * Destroy a WaveSurfer instance safely
   * 
   * @param wavesurfer - WaveSurfer instance to destroy
   */
  public destroyWaveSurfer(wavesurfer: WaveSurfer): void {
    try {
      console.log('🎵 WaveformAdapter: Destroying WaveSurfer instance');
      
      // Remove any pending queue items for this instance
      this.loadQueue = this.loadQueue.filter(item => item.wavesurfer !== wavesurfer);
      
      // Destroy the instance
      wavesurfer.destroy();
      
      console.log('✅ WaveformAdapter: WaveSurfer instance destroyed');
      
    } catch (error) {
      console.error('❌ WaveformAdapter: Failed to destroy WaveSurfer instance', error);
      // Don't throw - cleanup should be best-effort
    }
  }
  
  /**
   * Get current queue length (for debugging)
   */
  public getQueueLength(): number {
    return this.loadQueue.length;
  }
  
  /**
   * Check if currently processing
   */
  public isProcessing(): boolean {
    return this.isLoading;
  }
}

/**
 * Export singleton instance
 */
export const waveformAdapter = WaveformAdapter.getInstance();
