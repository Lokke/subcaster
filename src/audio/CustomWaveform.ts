/**
 * CustomWaveform.ts
 * Native Web Audio API waveform visualization
 * Replaces WaveSurfer.js for lightweight, crash-free audio visualization
 */

export interface WaveformOptions {
  container: HTMLElement;
  waveColor?: string;
  progressColor?: string;
  cursorColor?: string;
  height?: number;
  barWidth?: number;
  barGap?: number;
  normalize?: boolean;
  interact?: boolean;
  responsive?: boolean;
}

export interface WaveformPeaks {
  data: Float32Array;
  length: number;
}

export class CustomWaveform {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audioElement: HTMLMediaElement;
  private audioContext: AudioContext;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  
  // Waveform data
  private peaks: Float32Array | null = null;
  private duration: number = 0;
  
  // Visual settings
  private options: Required<WaveformOptions>;
  
  // Animation
  private animationFrame: number | null = null;
  private isPlaying: boolean = false;
  
  // Interaction
  private isDragging: boolean = false;
  
  // Zoom
  private zoom: number = 1;
  private scrollOffset: number = 0;
  private zoomWindow: number = 0; // 0 = overview (full track), >0 = zoom window in seconds (e.g., 5)
  
  constructor(options: WaveformOptions, audioElement: HTMLMediaElement, audioContext: AudioContext, zoomWindow: number = 0) {
    this.container = options.container;
    this.audioElement = audioElement;
    this.audioContext = audioContext;
    this.zoomWindow = zoomWindow;
    
    // Default options
    this.options = {
      container: options.container,
      waveColor: options.waveColor || '#4a9eff',
      progressColor: options.progressColor || '#1e88e5',
      cursorColor: options.cursorColor || '#ffffff',
      height: options.height || 128,
      barWidth: options.barWidth || 2,
      barGap: options.barGap || 1,
      normalize: options.normalize !== false,
      interact: options.interact !== false,
      responsive: options.responsive !== false
    };
    
    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = `${this.options.height}px`;
    this.canvas.style.cursor = this.options.interact ? 'pointer' : 'default';
    this.container.appendChild(this.canvas);
    
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas 2D context');
    }
    this.ctx = ctx;
    
    // Setup canvas dimensions
    this.updateCanvasSize();
    
    // Setup event listeners
    if (this.options.interact) {
      this.setupInteraction();
    }
    
    // Setup mouse wheel zoom (only for zoom waveforms)
    if (this.zoomWindow > 0) {
      this.setupWheelZoom();
    }
    
    if (this.options.responsive) {
      window.addEventListener('resize', () => this.updateCanvasSize());
    }
    
    // Listen to audio events
    this.audioElement.addEventListener('timeupdate', () => {
      // Only redraw on timeupdate if not playing (to avoid redundant draws)
      if (!this.isPlaying) {
        this.draw();
      }
    });
    this.audioElement.addEventListener('play', () => {
      this.isPlaying = true;
      this.startAnimation();
    });
    this.audioElement.addEventListener('pause', () => {
      this.isPlaying = false;
      this.stopAnimation();
      this.draw(); // Final draw when paused
    });
    this.audioElement.addEventListener('ended', () => {
      this.isPlaying = false;
      this.stopAnimation();
      this.draw(); // Final draw when ended
    });
  }
  
  /**
   * Load audio and generate waveform
   * CRITICAL: Fetch waveform data from SERVER to prevent ACCESS_VIOLATION
   * Server handles audio decoding, client only renders
   */
  async load(url: string): Promise<void> {
    console.log(`🌊 [CustomWaveform] Loading audio: ${url}`);
    
    try {
      // Extract songId from URL (assuming OpenSubsonic format)
      const urlParams = new URLSearchParams(url.split('?')[1]);
      const originalUrl = urlParams.get('url');
      const songId = new URLSearchParams(originalUrl?.split('?')[1] || '').get('id');
      
      if (!songId) {
        throw new Error('Could not extract song ID from URL');
      }
      
      console.log(`🆔 [CustomWaveform] Song ID: ${songId}`);
      
      // STEP 1: Fetch waveform data from SERVER (no client-side decoding!)
      console.log(`📥 [CustomWaveform] Fetching waveform from server...`);
      const waveformUrl = `/api/waveform/${songId}?url=${encodeURIComponent(url)}`;
      
      // Retry logic for waveform generation
      let attempts = 0;
      const maxAttempts = 10; // Max 20 seconds (10 * 2s)
      let waveformData: any = null;
      
      while (attempts < maxAttempts) {
        const waveformResponse = await fetch(waveformUrl);
        
        if (waveformResponse.status === 202) {
          // Waveform is being generated, wait and retry
          const statusData = await waveformResponse.json();
          console.log(`⏳ [CustomWaveform] Waveform generating (attempt ${attempts + 1}/${maxAttempts})...`);
          
          // Draw loading indicator
          this.drawLoadingIndicator(`Generating waveform... (${attempts + 1}/${maxAttempts})`);
          
          // Wait before retry (use retryAfter from server or default 2s)
          const retryAfter = statusData.retryAfter || 2;
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          
          attempts++;
          continue;
        }
        
        if (!waveformResponse.ok) {
          throw new Error(`Failed to fetch waveform: ${waveformResponse.status} ${waveformResponse.statusText}`);
        }
        
        waveformData = await waveformResponse.json();
        console.log(`✅ [CustomWaveform] Waveform data received: ${waveformData.peaks.length} peaks`);
        break;
      }
      
      if (!waveformData) {
        throw new Error('Waveform generation timed out');
      }
      
      // Convert to Float32Array
      this.peaks = new Float32Array(waveformData.peaks);
      
      // STEP 2: Now load audio into element for playback
      // The audio element will decode separately for playback
      this.audioElement.src = url;
      
      // Wait for metadata
      await new Promise<void>((resolve, reject) => {
        const onLoadedMetadata = () => {
          this.duration = this.audioElement.duration;
          this.audioElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          this.audioElement.removeEventListener('error', onError);
          resolve();
        };
        
        const onError = () => {
          this.audioElement.removeEventListener('loadedmetadata', onLoadedMetadata);
          this.audioElement.removeEventListener('error', onError);
          reject(new Error('Failed to load audio metadata'));
        };
        
        this.audioElement.addEventListener('loadedmetadata', onLoadedMetadata);
        this.audioElement.addEventListener('error', onError);
      });
      
      console.log(`✅ [CustomWaveform] Audio loaded, duration: ${this.duration}s`);
      
      // Initial draw
      this.draw();
      
    } catch (error) {
      console.error('❌ [CustomWaveform] Failed to load audio:', error);
      throw error;
    }
  }
  
  /**
   * Draw waveform on canvas
   */
  private draw(): void {
    if (!this.peaks) return;
    
    const { width, height } = this.canvas;
    const halfHeight = height / 2;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);
    
    // Calculate progress
    const currentTime = this.audioElement.currentTime;
    const progress = this.duration > 0 ? currentTime / this.duration : 0;
    
    // Zoom mode: show only a time window around current position
    if (this.zoomWindow > 0) {
      // Time window: always show [currentTime - zoomWindow/2, currentTime + zoomWindow/2]
      // But when currentTime < zoomWindow/2, we still show zoomWindow total duration
      // This way the waveform "fills from the left" as playback starts
      const halfWindow = this.zoomWindow / 2;
      
      // Calculate the time range to display
      let startTime: number;
      let endTime: number;
      
      if (currentTime < halfWindow) {
        // Near start: show [0, zoomWindow]
        startTime = 0;
        endTime = Math.min(this.duration, this.zoomWindow);
      } else if (currentTime > this.duration - halfWindow) {
        // Near end: show [duration - zoomWindow, duration]
        startTime = Math.max(0, this.duration - this.zoomWindow);
        endTime = this.duration;
      } else {
        // Middle: centered window
        startTime = currentTime - halfWindow;
        endTime = currentTime + halfWindow;
      }
      
      // Draw waveform bars with interpolation for smooth scrolling
      const barTotalWidth = this.options.barWidth + this.options.barGap;
      const numBars = Math.floor(width / barTotalWidth);
      
      // Calculate cursor position (depends on where we are in the track)
      let cursorX: number;
      if (currentTime < halfWindow) {
        // Near start: cursor moves from left towards center
        cursorX = (currentTime / this.zoomWindow) * width;
      } else if (currentTime > this.duration - halfWindow) {
        // Near end: cursor moves from center towards right
        const timeInWindow = currentTime - (this.duration - this.zoomWindow);
        cursorX = (timeInWindow / this.zoomWindow) * width;
      } else {
        // Middle: cursor stays centered
        cursorX = width / 2;
      }
      
      // Render each bar with interpolation for smooth transitions
      for (let i = 0; i < numBars; i++) {
        const x = i * barTotalWidth;
        
        // Calculate the exact time this bar represents
        const barTime = startTime + ((i / numBars) * (endTime - startTime));
        const barProgress = barTime / this.duration; // 0.0 to 1.0
        
        // Get interpolated peak value at this exact time position
        const peakIndex = barProgress * (this.peaks.length - 1);
        const lowerIndex = Math.floor(peakIndex);
        const upperIndex = Math.min(lowerIndex + 1, this.peaks.length - 1);
        const fraction = peakIndex - lowerIndex;
        
        // Linear interpolation between two peaks for smooth animation
        const lowerPeak = this.peaks[lowerIndex] || 0;
        const upperPeak = this.peaks[upperIndex] || 0;
        const peak = lowerPeak + (upperPeak - lowerPeak) * fraction;
        
        const barHeight = peak * halfHeight;
        
        // Color based on position relative to cursor
        this.ctx.fillStyle = x < cursorX ? this.options.progressColor : this.options.waveColor;
        
        // Draw bar (centered vertically)
        this.ctx.fillRect(
          x,
          halfHeight - barHeight,
          this.options.barWidth,
          barHeight * 2
        );
      }
      
      // Draw cursor
      this.ctx.strokeStyle = this.options.cursorColor;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(cursorX, 0);
      this.ctx.lineTo(cursorX, height);
      this.ctx.stroke();
      
    } else {
      // Overview mode: show full track
      const progressX = width * progress;
      
      // Draw waveform bars
      const barTotalWidth = this.options.barWidth + this.options.barGap;
      const numBars = Math.floor(width / barTotalWidth);
      
      for (let i = 0; i < numBars; i++) {
        const x = i * barTotalWidth;
        const peakIndex = Math.floor((i / numBars) * this.peaks.length);
        const peak = this.peaks[peakIndex] || 0;
        const barHeight = peak * halfHeight;
        
        // Choose color based on progress
        this.ctx.fillStyle = x < progressX ? this.options.progressColor : this.options.waveColor;
        
        // Draw bar (centered vertically)
        this.ctx.fillRect(
          x,
          halfHeight - barHeight,
          this.options.barWidth,
          barHeight * 2
        );
      }
      
      // Draw cursor
      if (this.isPlaying || this.isDragging) {
        this.ctx.strokeStyle = this.options.cursorColor;
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(progressX, 0);
        this.ctx.lineTo(progressX, height);
        this.ctx.stroke();
      }
    }
  }
  
  /**
   * Draw loading indicator while waveform is being generated
   */
  private drawLoadingIndicator(message: string): void {
    const { width, height } = this.canvas;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, width, height);
    
    // Draw background
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, width, height);
    
    // Draw loading text
    this.ctx.fillStyle = '#4a9eff';
    this.ctx.font = '14px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.fillText(message, width / 2, height / 2);
    
    // Draw animated spinner
    const time = Date.now() / 1000;
    const spinnerSize = 20;
    const spinnerX = width / 2;
    const spinnerY = height / 2 - 30;
    
    this.ctx.strokeStyle = '#4a9eff';
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();
    this.ctx.arc(spinnerX, spinnerY, spinnerSize, time * 2, time * 2 + Math.PI * 1.5);
    this.ctx.stroke();
  }
  
  /**
   * Update canvas size (for responsive design)
   */
  private updateCanvasSize(): void {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = this.options.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${this.options.height}px`;
    
    // Redraw after resize
    if (this.peaks) {
      this.draw();
    }
  }
  
  /**
   * Setup click/drag interaction for seeking
   */
  private setupInteraction(): void {
    const seek = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const clickProgress = x / rect.width; // 0.0 to 1.0 within canvas
      
      let time: number;
      
      if (this.zoomWindow > 0) {
        // Zoom mode: calculate time within visible window
        const currentTime = this.audioElement.currentTime;
        const halfWindow = this.zoomWindow / 2;
        const startTime = Math.max(0, currentTime - halfWindow);
        const endTime = Math.min(this.duration, currentTime + halfWindow);
        
        // Map click position to time within visible range
        time = startTime + (clickProgress * (endTime - startTime));
      } else {
        // Overview mode: direct mapping to full duration
        time = clickProgress * this.duration;
      }
      
      if (time >= 0 && time <= this.duration) {
        this.audioElement.currentTime = time;
        this.draw();
      }
    };
    
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      seek(e);
    });
    
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        seek(e);
      }
    });
    
    this.canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
    
    this.canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
    });
    
    this.canvas.addEventListener('click', seek);
  }
  
  /**
   * Setup mouse wheel zoom for zoom waveform
   */
  private setupWheelZoom(): void {
    this.canvas.addEventListener('wheel', (e: WheelEvent) => {
      e.preventDefault();
      
      // Zoom factor: deltaY < 0 = zoom in, deltaY > 0 = zoom out
      const zoomFactor = e.deltaY < 0 ? 0.9 : 1.1; // 10% steps
      const newZoomWindow = this.zoomWindow * zoomFactor;
      
      // Clamp zoom window: min 1 second, max full track duration
      this.zoomWindow = Math.max(1, Math.min(this.duration, newZoomWindow));
      
      console.log(`🔍 [CustomWaveform] Zoom: ${this.zoomWindow.toFixed(2)}s window`);
      
      // Redraw with new zoom level
      this.draw();
    });
  }
  
  /**
   * Start animation loop
   */
  private startAnimation(): void {
    if (this.animationFrame !== null) return;
    
    const animate = () => {
      this.draw();
      if (this.isPlaying) {
        this.animationFrame = requestAnimationFrame(animate);
      }
    };
    
    this.animationFrame = requestAnimationFrame(animate);
  }
  
  /**
   * Stop animation loop
   */
  private stopAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }
  
  /**
   * Set zoom level (1 = normal, > 1 = zoomed in)
   */
  setZoom(level: number): void {
    this.zoom = Math.max(1, Math.min(10, level));
    this.draw();
  }
  
  /**
   * Play audio
   */
  play(): Promise<void> {
    return this.audioElement.play();
  }
  
  /**
   * Pause audio
   */
  pause(): void {
    this.audioElement.pause();
  }
  
  /**
   * Seek to position (0-1)
   */
  seekTo(progress: number): void {
    if (this.duration > 0) {
      this.audioElement.currentTime = progress * this.duration;
    }
  }
  
  /**
   * Check if currently playing
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }
  
  /**
   * Destroy waveform and cleanup
   */
  destroy(): void {
    this.stopAnimation();
    
    // Remove event listeners
    window.removeEventListener('resize', () => this.updateCanvasSize());
    
    // Remove canvas
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    
    console.log('🗑️ [CustomWaveform] Destroyed');
  }
  
  /**
   * Get current progress (0-1)
   */
  getProgress(): number {
    return this.duration > 0 ? this.audioElement.currentTime / this.duration : 0;
  }
  
  /**
   * Check if waveform is ready
   */
  isReady(): boolean {
    return this.peaks !== null && this.duration > 0;
  }
}

/**
 * Factory function to create CustomWaveform instances
 */
export function createCustomWaveform(
  options: WaveformOptions,
  audioElement: HTMLMediaElement,
  audioContext: AudioContext,
  zoomWindow: number = 0
): CustomWaveform {
  return new CustomWaveform(options, audioElement, audioContext, zoomWindow);
}
