# Audio System Rewrite

**Status:** 🚧 In Development (Phase 1)  
**Branch:** `audio-rewrite`  
**Goal:** Electron-stable audio system without renderer crashes

## Why Rewrite?

The original audio system caused renderer crashes (0xC0000005 ACCESS_VIOLATION) due to:
- Multiple `createMediaElementSource()` calls on same audio elements
- Parallel audio decoding (WaveSurfer + native decoder race conditions)
- Complex WebAudio graph with unsafe connect/disconnect patterns
- getUserMedia lifecycle issues

## Architecture

### Modules

- **SourceNodeCache.ts** - Central MediaElementSourceNode cache (prevents duplicate creation)
- **AudioManager.ts** - AudioContext lifecycle, master nodes, initialization
- **Mixer.ts** - Routing: per-deck gains, crossfader, master/stream destinations
- **Deck.ts** - Per-deck adapter: manages HTMLAudioElement, playback, waveform sync
- **MicManager.ts** - Microphone capture, processing chain (compressor, EQ, limiter)
- **WaveformAdapter.ts** - WaveSurfer wrapper with sequential loading (MediaElement backend)
- **VolumeMeters.ts** - AnalyserNode-based metering for all sources

### Key Principles

1. **Single SourceNode per Element** - Enforced by SourceNodeCache
2. **MediaElement Backend** - No native decoding in renderer (WaveSurfer uses MediaElement)
3. **Deferred Connections** - Connect to WebAudio graph only when playing
4. **Sequential Operations** - No parallel decode, no race conditions
5. **Guarded Lifecycle** - AudioContext close/resume properly managed

## Contract (Public API)

```typescript
// AudioManager
AudioManager.init(): Promise<void>
AudioManager.getContext(): AudioContext
AudioManager.getMasterDestination(): MediaStreamAudioDestinationNode
AudioManager.close(): Promise<void>

// Deck (per deck A/B/C/D)
deck.load(url: string, metadata: TrackMetadata): Promise<void>
deck.play(): Promise<void>
deck.pause(): void
deck.seek(time: number): void
deck.clear(): void
deck.setVolume(v: number): void
deck.connectToMixer(): boolean

// Mixer
mixer.setDeckGain(side, gain)
mixer.setCrossfader(position)
mixer.getStreamOutput(): MediaStream

// MicManager
mic.setup(deviceId?: string): Promise<boolean>
mic.setEnabled(enabled: boolean)
mic.setVolume(v: number)
```

## Testing

### Smoke Test (Manual)
1. Start app (`npm run dev`)
2. Login to OpenSubsonic
3. Double-click song → loads to Deck A
4. Click play → waveform animates, meter updates
5. **Critical:** Drag album cover while playing (crash test!)
6. Drag to Deck B → swaps cleanly
7. Enable microphone → mic meter shows signal
8. No renderer crash ✅

### Unit Tests
```powershell
npm test  # when tests are added
```

## Migration Status

- [x] Phase 1: SourceNodeCache + AudioManager skeleton
- [ ] Phase 2: Deck + Mixer extraction
- [ ] Phase 3: MicManager + WaveformAdapter
- [ ] Phase 4: Integration + crash testing
- [ ] Phase 5: Cleanup old code + PR

## Debug Tips

- Check `audioSourceNodes` Map size: `AudioManager.debugSourceNodes()`
- Inspect AudioContext state: `AudioManager.getContext().state`
- Volume meter not working? Check AnalyserNode connections
- Crash on drag? Check SourceNodeCache for duplicate creation attempts

## Known Issues (Current)

- Original implementation has multiple `createMediaElementSource` calls
- WaveSurfer uses MediaElement backend (good!) but connections may race
- Drag & drop while playing triggers unsafe node manipulation

## Rollback

If something breaks critically:
```powershell
git checkout main
npm run dev
```
