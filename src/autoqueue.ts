/**
 * Auto-Queue System
 * 
 * Manages automatic playback rotation between deck pairs (A+B and C+D)
 * Handles queue synchronization, deck preparation, and rotation validation
 * 
 * ⚠️ CRITICAL: This module uses dependency injection to avoid circular dependencies
 * Must call initializeAutoQueue() once after main.ts is ready, before calling setupAutoQueueControls()
 */

import type { OpenSubsonicSong } from './opensubsonic';

// ========================================
// TYPES
// ========================================

export interface AutoQueueConfig {
  deckPairAB: boolean;
  deckPairCD: boolean;
  lastPlayedDeck: 'a' | 'b' | 'c' | 'd' | null;
  playbackOrder: ('a' | 'b' | 'c' | 'd')[];
  isAutoPlaying: boolean;
}

interface QueueItem {
  id: string;
  type: 'song' | 'microphone';
  song?: OpenSubsonicSong;
  assignedToDeck?: 'a' | 'b' | 'c' | 'd' | null;
  loadedAt?: Date;
  [key: string]: any;
}

interface AutoQueueDeps {
  getQueue: () => QueueItem[];
  isSongQueueItem: (item: QueueItem) => boolean;
  updateQueueDisplay: () => void;
  getCurrentLoadedSong: (deck: 'a' | 'b' | 'c' | 'd') => OpenSubsonicSong | null;
  getDeckState: (deck: 'a' | 'b' | 'c' | 'd') => string;
  loadTrackToPlayer: (deck: 'a' | 'b' | 'c' | 'd', song: OpenSubsonicSong, autoplay: boolean) => void;
  isDeckLoading: (deck: 'a' | 'b' | 'c' | 'd') => boolean;
  getPlayerStates: () => any;
  startPlayHistoryUpdateWatcher: () => void;
  addMicrophoneToQueue: () => void;
}

// ========================================
// MODULE STATE
// ========================================

export const autoQueueConfig: AutoQueueConfig = {
  deckPairAB: true,
  deckPairCD: false,
  lastPlayedDeck: null,
  playbackOrder: ['a', 'b', 'c', 'd'],
  isAutoPlaying: false
};

let deps: AutoQueueDeps | null = null;
let autoQueueWatcherInterval: number | null = null;

// ========================================
// INITIALIZATION
// ========================================

export function initializeAutoQueue(dependencies: AutoQueueDeps) {
  if (deps) {
    console.log('⚠️ Auto-queue already initialized, skipping re-initialization');
    return;
  }
  
  deps = dependencies;
  console.log('✅ Auto-queue dependencies initialized');
}

// ========================================
// MAIN SETUP FUNCTION
// ========================================

export function setupAutoQueueControls() {
  if (!deps) {
    console.error('❌ Auto-queue not initialized! Call initializeAutoQueue() first.');
    return;
  }

  const abButton = document.getElementById('auto-queue-ab') as HTMLButtonElement;
  const cdButton = document.getElementById('auto-queue-cd') as HTMLButtonElement;
  
  if (!abButton || !cdButton) {
    console.warn('Auto-queue buttons not found');
    return;
  }
  
  // Clone buttons to remove existing event listeners
  const newAbButton = abButton.cloneNode(true) as HTMLButtonElement;
  const newCdButton = cdButton.cloneNode(true) as HTMLButtonElement;
  abButton.parentNode?.replaceChild(newAbButton, abButton);
  cdButton.parentNode?.replaceChild(newCdButton, cdButton);
  
  const abBtn = newAbButton;
  const cdBtn = newCdButton;
  
  // Update button states
  const updateButtonStates = () => {
    abBtn.classList.toggle('active', autoQueueConfig.deckPairAB);
    cdBtn.classList.toggle('active', autoQueueConfig.deckPairCD);
    console.log(`Auto-Queue Config: A+B=${autoQueueConfig.deckPairAB}, C+D=${autoQueueConfig.deckPairCD}`);
  };
  
  // A+B Button Handler
  abBtn.addEventListener('click', () => {
    autoQueueConfig.deckPairAB = !autoQueueConfig.deckPairAB;
    updateButtonStates();
    
    if (autoQueueConfig.deckPairAB) {
      console.log('🎵 Auto-Queue enabled for Deck A+B');
      synchronizeDecksWithQueue(['a', 'b']);
      prepareDecksOnActivation(['a', 'b']);
      setTimeout(() => {
        validateAndFixRotation();
        checkAndFillEmptyDecks();
      }, 100);
    } else {
      console.log('⏸️ Auto-Queue disabled for Deck A+B');
      resetDeckAssignments(['a', 'b']);
      if (autoQueueConfig.deckPairCD) {
        setTimeout(() => {
          validateAndFixRotation();
          checkAndFillEmptyDecks();
        }, 100);
      }
    }
  });
  
  // C+D Button Handler
  cdBtn.addEventListener('click', () => {
    autoQueueConfig.deckPairCD = !autoQueueConfig.deckPairCD;
    updateButtonStates();
    
    if (autoQueueConfig.deckPairCD) {
      console.log('🎵 Auto-Queue enabled for Deck C+D');
      synchronizeDecksWithQueue(['c', 'd']);
      prepareDecksOnActivation(['c', 'd']);
      setTimeout(() => {
        validateAndFixRotation();
        checkAndFillEmptyDecks();
      }, 100);
    } else {
      console.log('⏸️ Auto-Queue disabled for Deck C+D');
      resetDeckAssignments(['c', 'd']);
      if (autoQueueConfig.deckPairAB) {
        setTimeout(() => {
          validateAndFixRotation();
          checkAndFillEmptyDecks();
        }, 100);
      }
    }
  });
  
  updateButtonStates();
  startAutoQueueWatcher();
  deps.startPlayHistoryUpdateWatcher();
  
  const micAddButton = document.getElementById('queue-mic-add-btn') as HTMLButtonElement;
  micAddButton?.addEventListener('click', () => {
    deps!.addMicrophoneToQueue();
  });
}

// ========================================
// HELPER FUNCTIONS
// ========================================

function resetDeckAssignments(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  if (!deps) return;
  
  console.log(`🔄 Resetting deck assignments for: [${deckPair.join(', ').toUpperCase()}]`);
  
  const queue = deps.getQueue();
  queue.forEach(queueItem => {
    if (queueItem.assignedToDeck && deckPair.includes(queueItem.assignedToDeck)) {
      const songTitle = deps!.isSongQueueItem(queueItem) && queueItem.song ? queueItem.song.title : 'Item';
      console.log(`🔄 Clearing assignment: ${songTitle} from Deck ${queueItem.assignedToDeck.toUpperCase()}`);
      queueItem.assignedToDeck = null;
    }
  });
  
  deps.updateQueueDisplay();
}

function removeDuplicateQueueAssignments() {
  if (!deps) return;
  
  const assignedSongs = new Set<string>();
  const queue = deps.getQueue();
  
  queue.forEach(item => {
    if (deps!.isSongQueueItem(item) && item.song && item.assignedToDeck) {
      const songId = item.song.id;
      
      if (assignedSongs.has(songId)) {
        console.log(`🔄 Removing duplicate assignment for "${item.song.title}" from deck ${item.assignedToDeck.toUpperCase()}`);
        item.assignedToDeck = null;
      } else {
        assignedSongs.add(songId);
      }
    }
  });
}

function reassignQueueToDecks() {
  if (!deps) return;
  
  console.log(`🎯 Reassigning unassigned queue items to optimal deck positions`);
  
  const availableDecks: ('a' | 'b' | 'c' | 'd')[] = [];
  if (autoQueueConfig.deckPairAB) {
    availableDecks.push('a', 'b');
  }
  if (autoQueueConfig.deckPairCD) {
    availableDecks.push('c', 'd');
  }
  
  if (availableDecks.length === 0) {
    console.log('⏸️ No active deck pairs for reassignment');
    return;
  }
  
  const queue = deps.getQueue();
  const unassignedSongs = queue.filter(item => 
    deps!.isSongQueueItem(item) && 
    item.song && 
    item.assignedToDeck === null
  );
  
  console.log(`📋 Found ${unassignedSongs.length} unassigned songs to reassign`);
  
  let deckIndex = 0;
  unassignedSongs.forEach((songItem) => {
    const targetDeck = availableDecks[deckIndex % availableDecks.length];
    songItem.assignedToDeck = targetDeck;
    
    const songTitle = songItem.song?.title || 'Unknown';
    console.log(`📌 Reassigned "${songTitle}" to deck ${targetDeck.toUpperCase()}`);
    
    deckIndex++;
  });
  
  console.log(`✅ Reassigned ${unassignedSongs.length} songs to decks`);
}

// ========================================
// EXPORTED FUNCTIONS
// ========================================

export function isAutoQueueActive(): boolean {
  return autoQueueConfig.deckPairAB || autoQueueConfig.deckPairCD;
}

export function isAutoQueueActiveForDeck(deck: 'a' | 'b' | 'c' | 'd'): boolean {
  if (deck === 'a' || deck === 'b') {
    return autoQueueConfig.deckPairAB;
  } else {
    return autoQueueConfig.deckPairCD;
  }
}

export function getActiveRotationOrder(): ('a' | 'b' | 'c' | 'd')[] {
  const order: ('a' | 'b' | 'c' | 'd')[] = [];
  
  if (autoQueueConfig.deckPairAB) {
    order.push('a', 'b');
  }
  
  if (autoQueueConfig.deckPairCD) {
    order.push('c', 'd');
  }
  
  return order;
}

export function synchronizeDecksWithQueue(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  if (!deps) return;
  
  console.log(`🔄 Enhanced synchronization for decks: [${deckPair.join(', ').toUpperCase()}]`);
  
  const queue = deps.getQueue();
  
  deckPair.forEach(deck => {
    const loadedSong = deps!.getCurrentLoadedSong(deck);
    if (loadedSong) {
      console.log(`🔍 Checking deck ${deck.toUpperCase()} loaded song: "${loadedSong.title}"`);
      
      const existingQueueItemIndex = queue.findIndex(item => 
        deps!.isSongQueueItem(item) && 
        item.song?.id === loadedSong.id
      );
      
      if (existingQueueItemIndex !== -1) {
        const queueItem = queue[existingQueueItemIndex];
        console.log(`📌 Found "${loadedSong.title}" in queue at position ${existingQueueItemIndex + 1}`);
        
        const oldAssignment = queueItem.assignedToDeck;
        queueItem.assignedToDeck = deck;
        queueItem.loadedAt = new Date();
        
        const deckState = deps!.getDeckState(deck);
        if (deckState === 'playing') {
          console.log(`▶️ Moving currently playing song to top of queue`);
          const item = queue.splice(existingQueueItemIndex, 1)[0];
          queue.unshift(item);
        }
        
        console.log(`✅ Synchronized "${loadedSong.title}" with deck ${deck.toUpperCase()}${oldAssignment ? ` (was assigned to ${oldAssignment.toUpperCase()})` : ''}`);
      } else {
        console.log(`⚠️ Loaded song "${loadedSong.title}" not found in queue`);
      }
    }
  });
  
  removeDuplicateQueueAssignments();
  reassignQueueToDecks();
  deps.updateQueueDisplay();
}

export async function prepareDecksOnActivation(deckPair: ('a' | 'b' | 'c' | 'd')[]) {
  if (!deps) return;
  
  console.log(`🎵 Preparing decks on activation: [${deckPair.join(', ').toUpperCase()}]`);
  
  const playerStates = deps.getPlayerStates();
  let hasPlayingDeck = false;
  for (const deck of deckPair) {
    const deckState = playerStates[deck as keyof typeof playerStates];
    if (deckState?.isPlaying) {
      console.log(`🎵 Deck ${deck.toUpperCase()} is already playing`);
      hasPlayingDeck = true;
      break;
    }
  }
  
  let hasLoadedDeck = false;
  for (const deck of deckPair) {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    const isRadioStream = audio && audio.getAttribute('data-stream-type') === 'live';
    
    if (audio && audio.src && audio.readyState >= 1) {
      if (isRadioStream) {
        console.log(`📻 Deck ${deck.toUpperCase()} has a radio stream loaded (excluding from auto-queue)`);
      } else {
        console.log(`🎵 Deck ${deck.toUpperCase()} has a track loaded`);
        hasLoadedDeck = true;
        break;
      }
    }
  }
  
  const queue = deps.getQueue();
  if (!hasPlayingDeck && !hasLoadedDeck && queue.length > 0) {
    console.log(`📋 Auto-filling empty decks from queue (${queue.length} items available)`);
    
    const firstAvailableSong = queue.find(item => !item.assignedToDeck);
    const firstDeck = deckPair[0];
    
    if (firstAvailableSong && deps.isSongQueueItem(firstAvailableSong) && firstAvailableSong.song) {
      try {
        console.log(`📋 Loading first available song to Deck ${firstDeck.toUpperCase()}: ${firstAvailableSong.song.title}`);
        
        deps.loadTrackToPlayer(firstDeck, firstAvailableSong.song, false);
        firstAvailableSong.assignedToDeck = firstDeck;
        
        console.log(`⏳ [LoadingLock] Waiting for Deck ${firstDeck.toUpperCase()} to finish loading...`);
        
        const maxWaitTime = 15000;
        const startWait = Date.now();
        
        while (deps.isDeckLoading(firstDeck) && (Date.now() - startWait) < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (deps.isDeckLoading(firstDeck)) {
          console.warn(`⚠️ [LoadingLock] Timeout waiting for Deck ${firstDeck.toUpperCase()}`);
        } else {
          console.log(`✅ [LoadingLock] Deck ${firstDeck.toUpperCase()} ready`);
        }
        
        if (!hasPlayingDeck) {
          console.log(`🎵 Auto-starting playback on Deck ${firstDeck.toUpperCase()}`);
          const playButton = document.querySelector(`[data-deck="${firstDeck}"] .play-pause-btn`) as HTMLButtonElement;
          if (playButton) {
            playButton.click();
          }
        }
        
        deps.updateQueueDisplay();
        
        const secondAvailableSong = queue.find(item => !item.assignedToDeck && item !== firstAvailableSong);
        const secondDeck = deckPair[1];
        
        if (secondAvailableSong && deps.isSongQueueItem(secondAvailableSong) && secondAvailableSong.song) {
          console.log(`📋 Preparing second deck ${secondDeck.toUpperCase()} with: ${secondAvailableSong.song.title}`);
          
          deps.loadTrackToPlayer(secondDeck, secondAvailableSong.song, false);
          secondAvailableSong.assignedToDeck = secondDeck;
          
          deps.updateQueueDisplay();
        }
      } catch (error) {
        console.error(`❌ Error preparing decks:`, error);
      }
    }
  }
}

export function startAutoQueueWatcher() {
  console.log('🚀 Starting auto-queue watcher...');
  
  if (autoQueueWatcherInterval !== null) {
    console.warn('⚠️ Auto-queue watcher already running');
    return;
  }
  
  autoQueueWatcherInterval = window.setInterval(() => {
    checkAndFillEmptyDecks();
  }, 5000);
  
  console.log('✅ Auto-queue watcher started (checking every 5 seconds)');
}

export function stopAutoQueueWatcher() {
  console.log('🛑 Stopping auto-queue watcher...');
  
  if (autoQueueWatcherInterval !== null) {
    window.clearInterval(autoQueueWatcherInterval);
    autoQueueWatcherInterval = null;
    console.log('✅ Auto-queue watcher stopped');
  }
}

export function checkAndFillEmptyDecks() {
  if (!deps || !isAutoQueueActive()) return;
  
  const queue = deps.getQueue();
  const availableDecks = getActiveRotationOrder();
  
  availableDecks.forEach(async deck => {
    const audio = document.getElementById(`audio-${deck}`) as HTMLAudioElement;
    const isRadioStream = audio && audio.getAttribute('data-stream-type') === 'live';
    
    if (isRadioStream) {
      return;
    }
    
    const playerState = deps!.getPlayerStates()[deck as any];
    const hasTrackLoaded = audio && audio.src && audio.readyState >= 1;
    
    if (!hasTrackLoaded || (playerState && playerState.currentTime >= playerState.duration - 5)) {
      const nextSong = queue.find(item => 
        deps!.isSongQueueItem(item) && 
        item.song && 
        !item.assignedToDeck
      );
      
      if (nextSong && nextSong.song) {
        console.log(`📋 Auto-filling Deck ${deck.toUpperCase()} with: ${nextSong.song.title}`);
        deps!.loadTrackToPlayer(deck, nextSong.song, false);
        nextSong.assignedToDeck = deck;
        deps!.updateQueueDisplay();
      }
    }
  });
}

export function validateAndFixRotation() {
  if (!deps) return;
  
  console.log('🔍 Validating deck rotation...');
  
  const queue = deps.getQueue();
  const activeOrder = getActiveRotationOrder();
  
  const assigned = queue.filter(item => item.assignedToDeck);
  const unassigned = queue.filter(item => !item.assignedToDeck && deps!.isSongQueueItem(item));
  
  console.log(`📊 Queue status: ${assigned.length} assigned, ${unassigned.length} unassigned`);
  
  if (unassigned.length > 0) {
    reassignQueueToDecks();
    deps.updateQueueDisplay();
  }
}

export function handleAutoQueue(finishedDeck: 'a' | 'b' | 'c' | 'd') {
  if (!deps) return;
  
  console.log(`🎵 handleAutoQueue called for deck ${finishedDeck.toUpperCase()}`);
  
  if (!isAutoQueueActiveForDeck(finishedDeck)) {
    console.log(`⏸️ Auto-queue not active for deck ${finishedDeck.toUpperCase()}`);
    return;
  }
  
  autoQueueConfig.lastPlayedDeck = finishedDeck;
  
  const activeOrder = getActiveRotationOrder();
  const currentIndex = activeOrder.indexOf(finishedDeck);
  const nextDeck = activeOrder[(currentIndex + 1) % activeOrder.length];
  
  console.log(`🔄 Rotation: ${finishedDeck.toUpperCase()} → ${nextDeck.toUpperCase()}`);
  
  const audio = document.getElementById(`audio-${nextDeck}`) as HTMLAudioElement;
  if (audio && audio.src && audio.readyState >= 1) {
    const isRadioStream = audio.getAttribute('data-stream-type') === 'live';
    
    if (!isRadioStream) {
      console.log(`▶️ Starting playback on Deck ${nextDeck.toUpperCase()}`);
      audio.play();
    }
  }
  
  const queue = deps.getQueue();
  const nextAvailableSong = queue.find(item => 
    deps!.isSongQueueItem(item) && 
    item.song && 
    !item.assignedToDeck
  );
  
  if (nextAvailableSong && nextAvailableSong.song) {
    console.log(`📋 Loading next song to Deck ${finishedDeck.toUpperCase()}: ${nextAvailableSong.song.title}`);
    deps.loadTrackToPlayer(finishedDeck, nextAvailableSong.song, false);
    nextAvailableSong.assignedToDeck = finishedDeck;
    deps.updateQueueDisplay();
  }
}
