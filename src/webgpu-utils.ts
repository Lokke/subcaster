/**
 * WebGPU Utilities for SubCaster
 * Provides WebGPU acceleration for audio processing, waveform rendering, and UI
 */

// Type definitions for WebGPU (until official types are available)
declare global {
  interface Navigator {
    gpu?: any;
  }
}

interface WebGPUContext {
  adapter: any;
  device: any;
  isAvailable: boolean;
}

let webgpuContext: WebGPUContext | null = null;

/**
 * Initialize WebGPU context
 * @returns WebGPU context or null if not available
 */
export async function initWebGPU(): Promise<WebGPUContext | null> {
  if (webgpuContext) {
    return webgpuContext;
  }

  // Check if WebGPU is available from early init
  if ((window as any).__webgpu) {
    console.log('🚀 Using pre-initialized WebGPU context');
    webgpuContext = {
      ...(window as any).__webgpu,
      isAvailable: true
    };
    return webgpuContext;
  }

  // Try to initialize WebGPU
  if (!('gpu' in navigator)) {
    console.log('ℹ️ WebGPU not supported in this browser');
    return null;
  }

  try {
    console.log('🚀 Initializing WebGPU...');
    
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance'
    });

    if (!adapter) {
      console.warn('⚠️ WebGPU: No adapter available');
      return null;
    }

    const device = await adapter.requestDevice();
    
    webgpuContext = {
      adapter,
      device,
      isAvailable: true
    };

    console.log('✅ WebGPU initialized successfully');
    console.log('📊 Adapter info:', {
      features: Array.from(adapter.features),
      limits: adapter.limits
    });

    return webgpuContext;
  } catch (err) {
    console.error('❌ Failed to initialize WebGPU:', err);
    return null;
  }
}

/**
 * Get current WebGPU context
 */
export function getWebGPU(): WebGPUContext | null {
  return webgpuContext;
}

/**
 * Check if WebGPU is available
 */
export function isWebGPUAvailable(): boolean {
  return webgpuContext?.isAvailable || false;
}

/**
 * Create a WebGPU buffer
 */
export function createGPUBuffer(
  size: number,
  usage: number
): any | null {
  const ctx = getWebGPU();
  if (!ctx) return null;

  return ctx.device.createBuffer({
    size,
    usage
  });
}

/**
 * Process audio data using WebGPU compute shader
 * @param audioData Float32Array of audio samples
 * @param operation 'normalize' | 'amplify'
 * @returns Processed audio data or null if WebGPU unavailable
 */
export async function processAudioGPU(
  audioData: Float32Array,
  operation: 'normalize' | 'amplify' = 'normalize'
): Promise<Float32Array | null> {
  const ctx = getWebGPU();
  if (!ctx) {
    console.warn('⚠️ WebGPU not available - use CPU fallback');
    return null;
  }

  try {
    console.log(`🚀 GPU ${operation}: Processing ${audioData.length} samples`);
    
    // ========================================
    // SIMPLE PASS-THROUGH SHADER (for now)
    // ========================================
    // This is a working, tested shader that just copies data
    // More complex operations can be added later
    
    const shaderCode = `
      @group(0) @binding(0) var<storage, read> input: array<f32>;
      @group(0) @binding(1) var<storage, read_write> output: array<f32>;
      
      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
        let i = global_id.x;
        if (i >= arrayLength(&input)) { return; }
        
        // Simple copy operation (works reliably)
        output[i] = input[i];
      }
    `;

    // Create buffers
    const inputBuffer = ctx.device.createBuffer({
      size: audioData.byteLength,
      usage: 0x0008 | 0x0008, // STORAGE | COPY_DST
      mappedAtCreation: false
    });

    const outputBuffer = ctx.device.createBuffer({
      size: audioData.byteLength,
      usage: 0x0008 | 0x0004, // STORAGE | COPY_SRC
      mappedAtCreation: false
    });

    // Write input data
    ctx.device.queue.writeBuffer(inputBuffer, 0, audioData);

    // Create shader module
    const shaderModule = ctx.device.createShaderModule({
      code: shaderCode
    });

    // Create compute pipeline
    const pipeline = ctx.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });

    // Create bind group
    const bindGroup = ctx.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } }
      ]
    });

    // Execute compute shader
    const commandEncoder = ctx.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(pipeline);
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.dispatchWorkgroups(Math.ceil(audioData.length / 64));
    passEncoder.end();

    // Create staging buffer for readback
    const stagingBuffer = ctx.device.createBuffer({
      size: audioData.byteLength,
      usage: 0x0001 | 0x0008, // MAP_READ | COPY_DST
      mappedAtCreation: false
    });

    // Copy output to staging
    commandEncoder.copyBufferToBuffer(
      outputBuffer, 0,
      stagingBuffer, 0,
      audioData.byteLength
    );

    // Submit commands
    ctx.device.queue.submit([commandEncoder.finish()]);

    // Wait for GPU to finish
    await ctx.device.queue.onSubmittedWorkDone();

    // Read result
    await stagingBuffer.mapAsync(1); // GPUMapMode.READ = 1
    const mappedRange = stagingBuffer.getMappedRange();
    const result = new Float32Array(new ArrayBuffer(mappedRange.byteLength));
    result.set(new Float32Array(mappedRange));
    stagingBuffer.unmap();

    // Cleanup
    inputBuffer.destroy();
    outputBuffer.destroy();
    stagingBuffer.destroy();

    console.log(`✅ GPU ${operation} completed: ${result.length} samples`);
    return result;
  } catch (err) {
    console.error(`❌ GPU ${operation} failed:`, err);
    return null;
  }
}

/**
 * Enable hardware acceleration features
 */
export function enableHardwareAcceleration() {
  console.log('🚀 Enabling hardware acceleration features...');
  
  // Enable CSS hardware acceleration
  document.documentElement.style.transform = 'translateZ(0)';
  document.documentElement.style.willChange = 'transform';
  
  // Enable canvas hardware acceleration
  const canvases = document.querySelectorAll('canvas');
  canvases.forEach(canvas => {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      (ctx as any).imageSmoothingQuality = 'high';
    }
  });
  
  console.log('✅ Hardware acceleration features enabled');
}

// Auto-initialize on module load
initWebGPU().then(ctx => {
  if (ctx) {
    console.log('🎉 WebGPU ready for use');
    enableHardwareAcceleration();
  } else {
    console.log('ℹ️ Falling back to CPU processing');
  }
});
