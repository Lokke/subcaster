/**
 * SourceNodeCache.ts
 * 
 * CRITICAL MODULE: Prevents Electron renderer crashes by ensuring
 * createMediaElementSource() is only called ONCE per audio element.
 * 
 * The Web Audio API requirement: createMediaElementSource() can only
 * be called once per HTMLAudioElement. Multiple calls cause crashes
 * (ACCESS_VIOLATION 0xC0000005) in Electron.
 * 
 * This module provides a global cache and safe accessor.
 */

/**
 * Global cache of MediaElementSourceNodes
 * Key: HTMLAudioElement
 * Value: MediaElementAudioSourceNode (already created)
 */
const sourceNodeCache = new Map<HTMLAudioElement, MediaElementAudioSourceNode>();

/**
 * Safely get or create a MediaElementAudioSourceNode.
 * 
 * IMPORTANT: This function MUST be used for ALL createMediaElementSource calls.
 * Direct usage of audioContext.createMediaElementSource() is FORBIDDEN.
 * 
 * @param audioElement - The HTMLAudioElement to create/get source node for
 * @param audioContext - The AudioContext instance
 * @returns MediaElementAudioSourceNode or null if creation failed
 * 
 * @example
 * ```typescript
 * const sourceNode = getOrCreateSourceNode(audioElement, audioContext);
 * if (sourceNode) {
 *   sourceNode.connect(gainNode);
 * }
 * ```
 */
export function getOrCreateSourceNode(
  audioElement: HTMLAudioElement,
  audioContext: AudioContext
): MediaElementAudioSourceNode | null {
  if (!audioContext) {
    console.warn('⚠️ AudioContext not available');
    return null;
  }

  // Check if we already have a SourceNode for this element
  if (sourceNodeCache.has(audioElement)) {
    console.log('🔄 Reusing existing MediaElementSourceNode');
    return sourceNodeCache.get(audioElement)!;
  }

  // Create new SourceNode and cache it
  try {
    const sourceNode = audioContext.createMediaElementSource(audioElement);
    sourceNodeCache.set(audioElement, sourceNode);
    console.log('🆕 Created new MediaElementSourceNode (cached)');
    return sourceNode;
  } catch (error) {
    console.error('❌ Failed to create MediaElementSourceNode:', error);
    
    // If this fails, it's likely because createMediaElementSource
    // was already called elsewhere. This is a critical error.
    if (error instanceof Error && error.message.includes('HTMLMediaElement')) {
      console.error('💥 CRITICAL: Attempted to create duplicate MediaElementSource!');
      console.error('This audio element already has a source node attached.');
      console.error('Check for direct createMediaElementSource() calls in codebase.');
    }
    
    return null;
  }
}

/**
 * Remove a source node from cache when audio element is destroyed.
 * Call this when ejecting/clearing a deck to allow recreation.
 * 
 * @param audioElement - The HTMLAudioElement to remove from cache
 */
export function removeSourceNode(audioElement: HTMLAudioElement): void {
  if (sourceNodeCache.has(audioElement)) {
    const sourceNode = sourceNodeCache.get(audioElement);
    
    try {
      // Disconnect the node before removing
      sourceNode?.disconnect();
      console.log('🔌 Disconnected MediaElementSourceNode');
    } catch (e) {
      // Already disconnected, ignore
    }
    
    sourceNodeCache.delete(audioElement);
    console.log('🗑️ Removed MediaElementSourceNode from cache');
  }
}

/**
 * Check if an audio element has a cached source node
 */
export function hasSourceNode(audioElement: HTMLAudioElement): boolean {
  return sourceNodeCache.has(audioElement);
}

/**
 * Get current cache size (for debugging)
 */
export function getCacheSize(): number {
  return sourceNodeCache.size;
}

/**
 * Debug: List all cached audio elements
 */
export function debugCache(): void {
  console.log(`📊 SourceNodeCache Status:`);
  console.log(`   Total cached nodes: ${sourceNodeCache.size}`);
  
  sourceNodeCache.forEach((node, element) => {
    console.log(`   - Element ID: ${element.id || 'unknown'}`);
    console.log(`     Connected: ${node.numberOfOutputs > 0}`);
    console.log(`     Context State: ${node.context.state}`);
  });
}

/**
 * Clear entire cache (use with caution!)
 * This should only be called during full app shutdown/reset
 */
export function clearCache(): void {
  console.warn('⚠️ Clearing entire SourceNode cache');
  
  sourceNodeCache.forEach((node, element) => {
    try {
      node.disconnect();
    } catch (e) {
      // Already disconnected
    }
  });
  
  sourceNodeCache.clear();
  console.log('✅ SourceNode cache cleared');
}
