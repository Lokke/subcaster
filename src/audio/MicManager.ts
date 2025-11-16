/**
 * MicManager.ts - Microphone Input and Processing Management
 * 
 * Manages:
 * - getUserMedia() microphone access and device selection
 * - Professional broadcast audio processing chain
 * - Radio broadcast effects (compressor, EQ, limiter)
 * - Microphone stream lifecycle and cleanup
 * 
 * Part of the audio system rewrite to fix Electron renderer crashes.
 */

import * as AudioManager from './AudioManager';
import * as Mixer from './Mixer';

/**
 * Processing state for radio broadcast effects
 */
interface ProcessingState {
  compressor: boolean;
  eq: boolean;
  limiter: boolean;
}

/**
 * Internal state
 */
let microphoneStream: MediaStream | null = null;
let selectedMicDeviceId: string | null = null;
let micActive: boolean = false;

// Processing nodes
let micCompressorNode: DynamicsCompressorNode | null = null;
let micEqLowNode: BiquadFilterNode | null = null;
let micEqMidNode: BiquadFilterNode | null = null;
let micEqHighNode: BiquadFilterNode | null = null;
let micLimiterNode: DynamicsCompressorNode | null = null;
let micProcessingGain: GainNode | null = null;

// Processing state (defaults: compressor ON, EQ ON, limiter ON)
let processingState: ProcessingState = {
  compressor: true,
  eq: true,
  limiter: true
};

/**
 * Format microphone device name for display
 * Removes common prefixes and adds emoji
 */
function formatMicrophoneName(label: string): string {
  const prefixes = [
    'Mikrofon',
    'Microphone',
    'Default',
    'Communications',
    'Internal',
    'External',
    'Built-in',
    'USB'
  ];

  for (const prefix of prefixes) {
    const regex = new RegExp(`^${prefix}\\s*[\\(\\-\\:]?\\s*`, 'i');
    if (regex.test(label)) {
      const deviceName = label.replace(regex, '').trim();
      return deviceName ? `🎤 ${deviceName}` : '🎤 ' + label;
    }
  }

  return `🎤 ${label}`;
}

/**
 * Populate microphone device dropdown
 * Uses temporary getUserMedia stream to get device labels (Electron fix)
 */
export async function populateMicrophoneDevices(selectElement: HTMLSelectElement): Promise<void> {
  try {
    console.log('🎤 MicManager: Loading available microphone devices...');
    
    // 🔧 ELECTRON FIX: Request permission first to get device labels
    let tempStream: MediaStream | null = null;
    try {
      tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('🎤 MicManager: Permission granted for device enumeration');
    } catch (permError) {
      console.warn('🎤 MicManager: Permission denied:', permError);
      // Continue - will show device IDs instead of labels
    }
    
    // Get all audio input devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(device => device.kind === 'audioinput');
    
    // 🔧 ELECTRON FIX: Properly cleanup temporary stream
    if (tempStream) {
      tempStream.getTracks().forEach(track => {
        track.stop();
        console.log(`🎤 MicManager: Stopped temp track: ${track.label}`);
      });
      tempStream = null;
      console.log('🎤 MicManager: Temp stream cleaned up');
    }
    
    // Clear and populate dropdown
    selectElement.innerHTML = '';
    
    audioInputs.forEach(device => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      const deviceLabel = device.label || `Microphone ${audioInputs.indexOf(device) + 1}`;
      option.textContent = formatMicrophoneName(deviceLabel);
      selectElement.appendChild(option);
    });
    
    console.log(`🎤 MicManager: Found ${audioInputs.length} microphone devices`);
    
    // Auto-select first device
    if (audioInputs.length > 0 && !selectedMicDeviceId) {
      selectedMicDeviceId = audioInputs[0].deviceId;
      selectElement.value = selectedMicDeviceId;
      console.log(`🎤 MicManager: Auto-selected: ${formatMicrophoneName(audioInputs[0].label || 'Microphone 1')}`);
    }
    
  } catch (error) {
    console.error('❌ MicManager: Error loading devices:', error);
    selectElement.innerHTML = '<option value="">Error loading devices</option>';
  }
}

/**
 * Set the selected microphone device ID
 * If microphone is active, will gracefully switch devices
 */
export async function selectMicrophoneDevice(deviceId: string): Promise<void> {
  selectedMicDeviceId = deviceId;
  console.log(`🎤 MicManager: Device selected: ${deviceId}`);
  
  // If mic is active, gracefully switch devices
  if (micActive && microphoneStream) {
    console.log('🎤 MicManager: Gracefully switching device...');
    
    // Stop old stream
    microphoneStream.getTracks().forEach(track => {
      track.stop();
      console.log(`🎤 MicManager: Released track: ${track.label}`);
    });
    microphoneStream = null;
    
    // Wait for hardware to settle
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Restart with new device
    console.log('🎤 MicManager: Activating new device...');
    await setupMicrophone();
  }
}

/**
 * Initialize radio broadcast processing nodes
 */
async function initializeRadioProcessing(): Promise<void> {
  const ctx = AudioManager.getContext();
  if (!ctx) {
    console.error('❌ MicManager: AudioContext not available');
    return;
  }
  
  console.log('📻 MicManager: Initializing broadcast processing...');
  
  // Processing Gain Node (input to processing chain)
  micProcessingGain = ctx.createGain();
  micProcessingGain.gain.setValueAtTime(1.0, ctx.currentTime);
  
  // Professional Radio Compressor - MODERATE settings
  micCompressorNode = ctx.createDynamicsCompressor();
  micCompressorNode.threshold.setValueAtTime(-24, ctx.currentTime);  // -24dB threshold (more gentle)
  micCompressorNode.knee.setValueAtTime(12, ctx.currentTime);        // 12dB knee (softer)
  micCompressorNode.ratio.setValueAtTime(4, ctx.currentTime);        // 4:1 ratio (less aggressive)
  micCompressorNode.attack.setValueAtTime(0.003, ctx.currentTime);   // 3ms attack (more natural)
  micCompressorNode.release.setValueAtTime(0.15, ctx.currentTime);   // 150ms release (smoother)
  
  // 3-Band EQ for Voice Optimization - REDUCED boost/cut
  micEqLowNode = ctx.createBiquadFilter();
  micEqLowNode.type = 'peaking';
  micEqLowNode.frequency.setValueAtTime(200, ctx.currentTime);
  micEqLowNode.Q.setValueAtTime(1.0, ctx.currentTime);
  micEqLowNode.gain.setValueAtTime(-1, ctx.currentTime); // Reduce muddiness (less cut)
  
  micEqMidNode = ctx.createBiquadFilter();
  micEqMidNode.type = 'peaking';
  micEqMidNode.frequency.setValueAtTime(2500, ctx.currentTime);
  micEqMidNode.Q.setValueAtTime(1.2, ctx.currentTime);
  micEqMidNode.gain.setValueAtTime(2, ctx.currentTime); // Presence boost (reduced from 4)
  
  micEqHighNode = ctx.createBiquadFilter();
  micEqHighNode.type = 'peaking';
  micEqHighNode.frequency.setValueAtTime(8000, ctx.currentTime);
  micEqHighNode.Q.setValueAtTime(0.8, ctx.currentTime);
  micEqHighNode.gain.setValueAtTime(1, ctx.currentTime); // Air/brightness (reduced from 2)
  
  // Broadcast Limiter (prevents clipping) - MODERATE settings
  micLimiterNode = ctx.createDynamicsCompressor();
  micLimiterNode.threshold.setValueAtTime(-6, ctx.currentTime);      // -6dB threshold (less limiting)
  micLimiterNode.knee.setValueAtTime(2, ctx.currentTime);            // 2dB knee (softer)
  micLimiterNode.ratio.setValueAtTime(12, ctx.currentTime);          // 12:1 ratio (less brick-wall)
  micLimiterNode.attack.setValueAtTime(0.001, ctx.currentTime);      // 1ms attack
  micLimiterNode.release.setValueAtTime(0.08, ctx.currentTime);      // 80ms release (faster recovery)
  
  console.log('✅ MicManager: Broadcast processing initialized');
}

/**
 * Setup microphone with professional broadcast processing chain
 * Creates: Mic → High-Pass → PreAmp → Compressor → EQ → Limiter → Output → Analyser → Mixer
 * 
 * @returns true if setup successful, false otherwise
 */
export async function setupMicrophone(): Promise<boolean> {
  const ctx = AudioManager.getContext();
  const micGain = AudioManager.getMicrophoneGain();
  
  if (!ctx || !micGain) {
    console.error('❌ MicManager: AudioContext or MicGain not available');
    return false;
  }
  
  // If microphone is already active and stream exists, don't re-initialize
  if (micActive && microphoneStream) {
    console.log('✅ MicManager: Microphone already active, skipping setup');
    return true;
  }
  
  try {
    // Clean up existing stream (only if switching devices or re-initializing)
    if (microphoneStream) {
      microphoneStream.getTracks().forEach(track => {
        track.stop();
        console.log('🎤 MicManager: Previous track stopped');
      });
      microphoneStream = null;
    }
    
    const contextSampleRate = ctx.sampleRate;
    console.log(`🎤 MicManager: Setting up microphone (${contextSampleRate} Hz)...`);

    // Microphone constraints (all audio effects OFF for natural voice)
    const audioConstraints: MediaTrackConstraints = {
      ...(selectedMicDeviceId && { deviceId: { exact: selectedMicDeviceId } }),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: { 
        ideal: contextSampleRate,
        min: 8000,
        max: 192000
      },
      sampleSize: { ideal: 16 },
      channelCount: { ideal: 1 }, // Mono
      // @ts-ignore - Browser-specific
      googEchoCancellation: false,
      // @ts-ignore
      googAutoGainControl: false,
      // @ts-ignore
      googNoiseSuppression: false,
      // @ts-ignore
      googHighpassFilter: false,
      // @ts-ignore
      googTypingNoiseDetection: false,
      // @ts-ignore
      googAudioMirroring: false
    };
    
    // Get microphone stream
    microphoneStream = await navigator.mediaDevices.getUserMedia({ 
      audio: audioConstraints
    });
    
    // Configure tracks for browser compatibility
    microphoneStream.getAudioTracks().forEach((track, index) => {
      track.enabled = true;
      
      if (track.applyConstraints) {
        track.applyConstraints({
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }).catch(err => console.warn('⚠️ Could not apply track constraints:', err));
      }
      
      const settings = track.getSettings();
      console.log(`🎙️ MicManager Track ${index + 1}:`);
      console.log(`   Sample Rate: ${settings.sampleRate || 'unknown'} Hz`);
      console.log(`   Channels: ${settings.channelCount || 'unknown'}`);
      console.log(`   Echo Cancel: ${settings.echoCancellation ? '✅' : '❌'}`);
      console.log(`   Noise Suppress: ${settings.noiseSuppression ? '✅' : '❌'}`);
      console.log(`   Auto Gain: ${settings.autoGainControl ? '✅' : '❌'}`);
      
      if (settings.sampleRate && settings.sampleRate !== contextSampleRate) {
        console.warn(`⚠️ Sample Rate Mismatch: Mic=${settings.sampleRate}Hz, Context=${contextSampleRate}Hz`);
        console.log(`🔄 Browser will resample: ${settings.sampleRate}Hz → ${contextSampleRate}Hz`);
      }
    });
    
    // Create MediaStreamAudioSourceNode
    const micSourceNode = ctx.createMediaStreamSource(microphoneStream);
    
    // Create AnalyserNode for volume meter
    const micAnalyser = ctx.createAnalyser();
    micAnalyser.fftSize = 256;
    micAnalyser.smoothingTimeConstant = 0.3;
    
    // Store analyser globally for volume meter access
    (window as any).micAnalyser = micAnalyser;
    
    // 🎙️ PROFESSIONAL BROADCAST PROCESSING CHAIN 🎙️
    console.log('🔧 MicManager: Building processing chain...');
    
    // 1. HIGH-PASS FILTER (removes rumble)
    const highPassFilter = ctx.createBiquadFilter();
    highPassFilter.type = 'highpass';
    highPassFilter.frequency.setValueAtTime(85, ctx.currentTime); // 85Hz cutoff
    highPassFilter.Q.setValueAtTime(0.7, ctx.currentTime);
    
    // 2. PREAMP/INPUT GAIN (boost before compression) - REDUCED for natural sound
    const preAmp = ctx.createGain();
    preAmp.gain.setValueAtTime(0, ctx.currentTime); // Start at 0 for fade-in
    preAmp.gain.linearRampToValueAtTime(1.5, ctx.currentTime + 0.05); // Fade to +3.5dB over 50ms
    
    // 3. Initialize processing nodes if not already created
    if (!micCompressorNode) {
      await initializeRadioProcessing();
    }
    
    // 4. OUTPUT GAIN (final level control) - REDUCED for natural sound
    const outputGain = ctx.createGain();
    outputGain.gain.setValueAtTime(0, ctx.currentTime); // Start at 0 for fade-in
    outputGain.gain.linearRampToValueAtTime(1.2, ctx.currentTime + 0.05); // Fade to +1.6dB over 50ms
    
    // 📻 WIRE UP PROCESSING CHAIN 📻
    // Mic → High-Pass → PreAmp → Compressor → EQ (Low/Mid/High) → Limiter → Output → Analyser → Mic Gain
    micSourceNode.connect(highPassFilter);
    highPassFilter.connect(preAmp);
    preAmp.connect(micCompressorNode!);
    micCompressorNode!.connect(micEqLowNode!);
    micEqLowNode!.connect(micEqMidNode!);
    micEqMidNode!.connect(micEqHighNode!);
    micEqHighNode!.connect(micLimiterNode!);
    micLimiterNode!.connect(outputGain);
    outputGain.connect(micAnalyser);
    micAnalyser.connect(micGain); // Connect to microphone gain from AudioManager
    
    micActive = true;
    console.log(`✅ MicManager: Microphone connected with broadcast processing (${contextSampleRate}Hz)`);
    return true;
    
  } catch (error) {
    console.error('❌ MicManager: Setup failed:', error);
    
    // Try fallback with basic settings
    try {
      console.log('🔄 MicManager: Trying fallback with browser defaults...');
      microphoneStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false
        } 
      });
      
      const micSourceNode = ctx.createMediaStreamSource(microphoneStream);
      micSourceNode.connect(micGain!);
      
      micActive = true;
      console.log('✅ MicManager: Microphone connected (fallback mode)');
      return true;
      
    } catch (fallbackError) {
      console.error('❌ MicManager: Fallback also failed:', fallbackError);
      return false;
    }
  }
}

/**
 * Toggle radio broadcast processing effects
 */
export function toggleProcessing(process: 'compressor' | 'eq' | 'limiter'): void {
  const ctx = AudioManager.getContext();
  if (!ctx) return;
  
  processingState[process] = !processingState[process];
  const isActive = processingState[process];
  
  switch (process) {
    case 'compressor':
      if (micCompressorNode) {
        micCompressorNode.ratio.setValueAtTime(isActive ? 4 : 1, ctx.currentTime);
        console.log(`📻 MicManager COMPRESSOR: ${isActive ? 'ON (4:1)' : 'OFF (1:1)'}`);
      }
      break;
      
    case 'eq':
      if (micEqLowNode && micEqMidNode && micEqHighNode) {
        micEqLowNode.gain.setValueAtTime(isActive ? -1 : 0, ctx.currentTime);
        micEqMidNode.gain.setValueAtTime(isActive ? 2 : 0, ctx.currentTime);
        micEqHighNode.gain.setValueAtTime(isActive ? 1 : 0, ctx.currentTime);
        console.log(`📻 MicManager EQ: ${isActive ? 'ON (voice optimized)' : 'OFF (flat)'}`);
      }
      break;
      
    case 'limiter':
      if (micLimiterNode) {
        micLimiterNode.threshold.setValueAtTime(isActive ? -6 : 0, ctx.currentTime);
        console.log(`📻 MicManager LIMITER: ${isActive ? 'ON (-6dB)' : 'OFF (0dB)'}`);
      }
      break;
  }
}

/**
 * Get current processing state
 */
export function getProcessingState(): ProcessingState {
  return { ...processingState };
}

/**
 * Check if microphone is currently active
 */
export function isMicrophoneActive(): boolean {
  return micActive;
}

/**
 * Clean up microphone resources
 */
export function cleanup(): void {
  console.log('🧹 MicManager: Cleaning up...');
  
  // Stop microphone stream
  if (microphoneStream) {
    microphoneStream.getTracks().forEach(track => {
      track.stop();
      console.log('🎤 MicManager: Track stopped');
    });
    microphoneStream = null;
  }
  
  // Disconnect processing nodes
  const nodes = [
    micProcessingGain,
    micCompressorNode,
    micEqLowNode,
    micEqMidNode,
    micEqHighNode,
    micLimiterNode
  ];
  
  nodes.forEach(node => {
    if (node) {
      try {
        node.disconnect();
      } catch (e) {
        // Ignore already disconnected
      }
    }
  });
  
  // Reset state
  micProcessingGain = null;
  micCompressorNode = null;
  micEqLowNode = null;
  micEqMidNode = null;
  micEqHighNode = null;
  micLimiterNode = null;
  micActive = false;
  
  console.log('✅ MicManager: Cleaned up');
}

/**
 * Get current state for debugging
 */
export function getState() {
  return {
    active: micActive,
    hasStream: microphoneStream !== null,
    selectedDevice: selectedMicDeviceId,
    processing: processingState,
    nodes: {
      compressor: micCompressorNode !== null,
      eqLow: micEqLowNode !== null,
      eqMid: micEqMidNode !== null,
      eqHigh: micEqHighNode !== null,
      limiter: micLimiterNode !== null
    }
  };
}
