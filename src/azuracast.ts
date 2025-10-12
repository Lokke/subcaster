/**
 * AzuraCast WebDJ Integration
 * Based on AzuraCast's WebDJ system for streaming master audio
 */

export interface AzuraCastMetadata {
  title: string;
  artist: string;
}

export interface AzuraCastConfig {
  servers: string[]; // Multiple server URLs
  stationId: string;
  stationShortcode?: string; // Add shortcode for proper WebDJ URL
  serverUrl?: string; // Selected server URL for current station
  username: string;
  password: string;
  bitrate: number;
  sampleRate: number;
}

export interface AzuraCastStation {
  id: number;
  name: string;
  shortcode: string;
  description: string;
  is_public: boolean;
  is_online: boolean;
  listen_url: string;
}

export interface AzuraCastNowPlayingResponse {
  station: AzuraCastStation & {
    frontend: string;
    backend: string;
    timezone: string;
    url: string;
    public_player_url: string;
    playlist_pls_url: string;
    playlist_m3u_url: string;
    mounts: Array<{
      id: number;
      name: string;
      url: string;
      bitrate: number;
      format: string;
      path: string;
      is_default: boolean;
    }>;
  };
  listeners: {
    total: number;
    unique: number;
    current: number;
  };
  live: {
    is_live: boolean;
    streamer_name: string;
    broadcast_start: string | null;
    art: string | null;
  };
  now_playing: {
    song: {
      id: string;
      art: string;
      text: string;
      artist: string;
      title: string;
      album: string;
      genre: string;
    };
    elapsed: number;
    remaining: number;
  };
  is_online: boolean;
}

export class AzuraCastWebcaster {
  private socket: WebSocket | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private isConnected = false;
  private config: AzuraCastConfig;
  private metadata: AzuraCastMetadata | null = null;
  private metadataUpdateTimer: number | null = null;
  private lastSentMetadata: string | null = null;
  private currentUsername: string = '';

  constructor(config: AzuraCastConfig) {
    this.config = config;
    this.currentUsername = config.username || 'Unknown';
  }

  /**
   * Connect to AzuraCast WebDJ endpoint
   */
  async connect(audioStream: MediaStream): Promise<boolean> {
    try {
      const serverUrl = this.config.serverUrl || this.config.servers[0];
      const stationIdentifier = this.config.stationShortcode || this.config.stationId;
      
      // Try multiple WebSocket URL formats
      const possibleUrls = [];
      
      if (serverUrl.includes('funkturm.radio-endstation.de')) {
        // Multiple formats for funkturm.radio-endstation.de
        possibleUrls.push(`wss://funkturm.radio-endstation.de/public/${stationIdentifier}/websocket`);
        possibleUrls.push(`wss://funkturm.radio-endstation.de/webdj/${stationIdentifier}/`);
        possibleUrls.push(`${serverUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/webdj/${stationIdentifier}/`);
      } else {
        // Standard AzuraCast WebDJ URL format
        possibleUrls.push(`${serverUrl.replace('https://', 'wss://').replace('http://', 'ws://')}/webdj/${stationIdentifier}/`);
        possibleUrls.push(`wss://${serverUrl.replace('https://', '').replace('http://', '')}/public/${stationIdentifier}/websocket`);
      }
      
      // Try connecting to each URL
      for (let i = 0; i < possibleUrls.length; i++) {
        const wsUrl = possibleUrls[i];
        const success = await this.tryConnect(wsUrl, audioStream);
        if (success) {
          return true;
        }
        
        // Wait a bit before trying next URL
        if (i < possibleUrls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // If all WebSocket attempts failed, start metadata-only mode
      console.log('⚠️ All WebSocket connections failed, starting metadata-only mode');
      this.startMetadataOnlyMode();
      return false;

    } catch (error) {
      console.error('❌ Failed to connect to AzuraCast:', error);
      this.startMetadataOnlyMode();
      return false;
    }
  }

  /**
   * Try connecting to a specific WebSocket URL
   */
  private async tryConnect(wsUrl: string, audioStream: MediaStream): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const timestamp = Date.now();
        console.log(`🔗 [${timestamp}] Trying to connect to: ${wsUrl}`);
        console.log(`🔐 [${timestamp}] Using credentials - User: ${this.config.username}, Password: ${this.config.password ? '[SET]' : '[NOT SET]'}`);
        
        this.socket = new WebSocket(wsUrl, "webcast");
        console.log(`📡 [${timestamp}] WebSocket created with protocol: webcast`);

        // Setup MediaRecorder for audio streaming
        this.mediaRecorder = new MediaRecorder(audioStream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: this.config.bitrate * 1000
        });

        if (!this.socket) {
          resolve(false);
          return;
        }

        // Set timeout to prevent hanging
        const connectTimeout = setTimeout(() => {
          console.log(`⏰ Connection timeout for ${wsUrl}`);
          if (this.socket) {
            this.socket.close();
          }
          resolve(false);
        }, 5000);

        this.socket.onopen = () => {
          clearTimeout(connectTimeout);
          const timestamp = Date.now();
          console.log(`🎯 [${timestamp}] AzuraCast WebSocket connected to ${wsUrl}`);
          
          // Send hello message (AzuraCast protocol)
          const hello = {
            mime: this.mediaRecorder?.mimeType || 'audio/webm;codecs=opus',
            user: this.config.username,
            password: this.config.password
          };

          console.log(`📤 [${timestamp}] Sending hello message:`, hello);
          this.socket?.send(JSON.stringify({
            type: "hello",
            data: hello
          }));

          this.isConnected = true;

          // AzuraCast Pattern: Wait 1000ms to confirm stable connection
          // (Liquidsoap won't return any success/failure message)
          setTimeout(() => {
            const confirmTimestamp = Date.now();
            
            if (this.isConnected && this.socket?.readyState === WebSocket.OPEN) {
              console.log(`✅ [${confirmTimestamp}] AzuraCast WebDJ connection confirmed stable!`);
              
              // Start recording and streaming after confirmed connection
              this.startRecording();

              // Start continuous metadata management
              this.startMetadataUpdates();
              
              // Send initial metadata if available (AzuraCast pattern)
              if (this.metadata) {
                console.log(`📊 [${confirmTimestamp}] Sending initial metadata after connection`);
                this.socket?.send(JSON.stringify({
                  type: "metadata",
                  data: this.metadata
                }));
              } else {
                // Send fallback metadata
                this.sendFallbackMetadata();
              }
              
              resolve(true);
            } else {
              console.log(`❌ [${confirmTimestamp}] Connection not stable after 1000ms`);
              resolve(false);
            }
          }, 1000);
        };

        this.socket.onerror = (error) => {
          clearTimeout(connectTimeout);
          console.warn(`⚠️ WebSocket connection failed for ${wsUrl}`);
          this.isConnected = false;
          resolve(false);
        };

        this.socket.onmessage = (event) => {
          const timestamp = new Date().toISOString();
          console.log(`📨 [${timestamp}] AZURACAST SERVER RESPONSE`);
          console.log(`   Raw Data: "${event.data}"`);
          
          try {
            const data = JSON.parse(event.data);
            console.log(`📊 [${timestamp}] PARSED SERVER MESSAGE:`);
            console.log(`   Type: ${data.type || 'unknown'}`);
            console.log(`   Data:`, data.data || data);
            
            // Check if this is a metadata response
            if (data.type === 'metadata' || data.metadata) {
              console.log(`🎵 [${timestamp}] METADATA SERVER RESPONSE:`);
              console.log(`   Status: ${data.status || 'unknown'}`);
              console.log(`   Success: ${data.success !== undefined ? data.success : 'unknown'}`);
              console.log(`   Message: ${data.message || 'no message'}`);
            }
          } catch (e) {
            console.log(`📄 [${timestamp}] RAW TEXT SERVER RESPONSE: "${event.data}"`);
            
            // Check for common Liquidsoap responses
            if (event.data.includes('OK') || event.data.includes('ok')) {
              console.log(`✅ [${timestamp}] SERVER OK RESPONSE (likely metadata accepted)`);
            } else if (event.data.includes('ERROR') || event.data.includes('error')) {
              console.log(`❌ [${timestamp}] SERVER ERROR RESPONSE`);
            }
          }
        };

        this.socket.onclose = (event) => {
          clearTimeout(connectTimeout);
          const timestamp = Date.now();
          console.log(`🔌 [${timestamp}] AzuraCast WebSocket disconnected`);
          console.log(`🔍 [${timestamp}] Close event details:`, {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean
          });
          this.isConnected = false;
          this.stopRecording();
          this.stopMetadataUpdates();
          
          // Only resolve false if we weren't already connected
          if (!this.isConnected) {
            resolve(false);
          }
        };

      } catch (error) {
        console.error('❌ Failed to create WebSocket connection:', error);
        resolve(false);
      }
    });
  }

  /**
   * Start metadata-only mode when WebSocket connection fails
   */
  private startMetadataOnlyMode(): void {
    console.log('🔄 Starting metadata-only mode (no WebSocket streaming)');
    this.isConnected = false; // No WebSocket, but we can still send metadata via HTTP API
    
    // Start metadata updates anyway
    this.startMetadataUpdates();
    
    // Send initial fallback metadata
    this.sendFallbackMetadata();
  }

  /**
   * Start recording and streaming audio
   */
  private startRecording(): void {
    if (!this.mediaRecorder) return;

    this.mediaRecorder.ondataavailable = async (event: BlobEvent) => {
      if (this.isConnected && this.socket && event.data.size > 0) {
        const audioData = await event.data.arrayBuffer();
        this.socket.send(audioData);
      }
    };

    this.mediaRecorder.onstop = () => {
      if (this.isConnected && this.socket) {
        this.socket.close();
      }
    };

    // Start recording with 100ms intervals (like AzuraCast)
    this.mediaRecorder.start(100);
    console.log('🎤 Started recording master audio for AzuraCast streaming');
  }

  /**
   * Stop recording and streaming
   */
  private stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
      console.log('⏹️ Stopped recording master audio');
    }
  }

  /**
   * Send metadata to AzuraCast (like track info)
   */
  sendMetadata(metadata: AzuraCastMetadata): void {
    const metadataString = `${metadata.artist} - ${metadata.title}`;
    const timestamp = new Date().toISOString();
    
    // Avoid sending duplicate metadata
    if (this.lastSentMetadata === metadataString) {
      console.log(`🔄 [${timestamp}] Skipping duplicate metadata: ${metadataString}`);
      return;
    }

    this.metadata = metadata;
    this.lastSentMetadata = metadataString;

    console.log(`🎵 [${timestamp}] METADATA UPDATE INITIATED`);
    console.log(`   Artist: "${metadata.artist}"`);
    console.log(`   Title: "${metadata.title}"`);
    console.log(`   Station: ${this.config.stationId} (${this.config.serverUrl})`);

    // Send metadata via established WebSocket connection (same as audio streaming)
    if (this.isConnected && this.socket) {
      this.socket.send(JSON.stringify({
        type: "metadata",
        data: metadata
      }));
      console.log(`📡 [${timestamp}] Sent via WebSocket: ${metadataString}`);
    } else {
      console.log(`❌ [${timestamp}] WebSocket unavailable - metadata not sent (no audio connection)`);
    }
  }

  /**
   * Send metadata via Liquidsoap HTTP handlers (Variante 2 - only method available with streaming credentials)
   */
  private async sendMetadataViaHTTP(metadata: AzuraCastMetadata): Promise<void> {
    console.log(`🌐 Attempting metadata update via Liquidsoap HTTP API (unified-server proxy)`);
    
    const serverUrl = this.config.serverUrl || this.config.servers[0];
    const stationId = parseInt(this.config.stationId);
    
    // Liquidsoap custom_metadata.insert command
    const command = `custom_metadata.insert artist="${metadata.artist.replace(/"/g, '\\"')}",title="${metadata.title.replace(/"/g, '\\"')}"`;
    
    try {
      const requestTimestamp = new Date().toISOString();
      console.log(`🎭 [${requestTimestamp}] LIQUIDSOAP HTTP API REQUEST`);
      console.log(`   Server: ${serverUrl}`);
      console.log(`   Station ID: ${stationId}`);
      console.log(`   Command: ${command}`);
      console.log(`   API Key: ${this.config.password ? '[CONFIGURED]' : '[MISSING]'}`);
      
      const requestBody = {
        serverUrl: serverUrl,
        stationId: stationId,
        apiKey: this.config.password,
        command: command
      };
      
      console.log(`📤 [${requestTimestamp}] Sending to unified-server proxy...`);
      
      // Use our unified-server proxy to avoid mixed content blocking
      const response = await fetch('/api/azuracast-telnet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      const responseTimestamp = new Date().toISOString();
      const result = await response.json();
      
      console.log(`📥 [${responseTimestamp}] LIQUIDSOAP HTTP API RESPONSE`);
      console.log(`   HTTP Status: ${response.status}`);
      console.log(`   Success: ${result.success}`);
      console.log(`   Used URL: ${result.usedUrl || 'N/A'}`);
      console.log(`   Response: ${result.response || 'No response'}`);
      
      if (result.success) {
        console.log(`✅ [${responseTimestamp}] METADATA UPDATE SUCCESSFUL`);
        console.log(`   Target: ${result.usedUrl}`);
        console.log(`   Liquidsoap Response: "${result.response}"`);
        console.log(`   Metadata: ${metadata.artist} - ${metadata.title}`);
        return; // Success!
      } else {
        console.log(`❌ [${responseTimestamp}] METADATA UPDATE FAILED`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Error: ${result.response}`);
        console.log(`   Trying fallback methods...`);
      }
      
    } catch (error) {
      const errorTimestamp = new Date().toISOString();
      console.error(`❌ [${errorTimestamp}] UNIFIED PROXY ERROR`);
      console.error(`   Error Type: ${error instanceof Error ? error.name : 'Unknown'}`);
      console.error(`   Error Message: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`💡 [${errorTimestamp}] Falling back to Harbor HTTP handlers...`);
    }
    
    // Fallback: Harbor HTTP handlers (original method)
    await this.sendMetadataViaHarborHTTP(metadata);
  }

  /**
   * Fallback: Send metadata via Harbor HTTP handlers (direct attempts)
   */
  private async sendMetadataViaHarborHTTP(metadata: AzuraCastMetadata): Promise<void> {
    const fallbackTimestamp = new Date().toISOString();
    console.log(`🌐 [${fallbackTimestamp}] HARBOR HTTP FALLBACK INITIATED`);
    console.log(`   Artist: "${metadata.artist}"`);
    console.log(`   Title: "${metadata.title}"`);
    
    const serverUrl = this.config.serverUrl || this.config.servers[0];
    const serverHost = serverUrl.replace('https://', '').replace('http://', '');
    
    console.log(`   Server Host: ${serverHost}`);
    console.log(`   Full Server URL: ${serverUrl}`);
    
    // Common Liquidsoap HTTP handler endpoints based on research
    const possibleEndpoints = [
      // Standard harbor.http.register pattern (Port 7000 is common)
      `http://${serverHost}:7000/setmeta?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      `https://${serverHost}:7000/setmeta?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      
      // Alternative ports commonly used for Liquidsoap HTTP
      `http://${serverHost}:8080/setmeta?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      `http://${serverHost}:8000/setmeta?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      
      // Paths that might be proxied through the main server
      `${serverUrl}/liquidsoap/setmeta?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      `${serverUrl}/harbor/setmeta?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      `${serverUrl}/api/liquidsoap/metadata?title=${encodeURIComponent(metadata.title)}&artist=${encodeURIComponent(metadata.artist)}`,
      
      // Alternative parameter formats
      `http://${serverHost}:7000/metadata?song=${encodeURIComponent(`${metadata.artist} - ${metadata.title}`)}`,
      `http://${serverHost}:7000/nowplaying?artist=${encodeURIComponent(metadata.artist)}&title=${encodeURIComponent(metadata.title)}`
    ];
    
    for (const endpoint of possibleEndpoints) {
      try {
        console.log(`Trying Liquidsoap HTTP handler: ${endpoint}`);
        
        const response = await fetch(endpoint, {
          method: 'GET',
          headers: {
            // Use streaming credentials for authentication
            'Authorization': `Basic ${btoa(`${this.config.username}:${this.config.password}`)}`,
            'User-Agent': 'SubCaster-Liquidsoap-Client'
          },
          // Short timeout since we're trying multiple endpoints
          signal: AbortSignal.timeout(3000)
        });
        
        if (response.ok) {
          const result = await response.text();
          console.log(`✅ Liquidsoap HTTP handler successful: ${result}`);
          console.log(`📊 Metadata sent: ${metadata.artist} - ${metadata.title}`);
          return; // Success, don't try other endpoints
        } else {
          console.log(`⚠️ HTTP ${response.status} for ${endpoint}`);
        }
      } catch (error) {
        console.log(`⚠️ Failed: ${endpoint} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    const finalTimestamp = new Date().toISOString();
    console.log(`❌ [${finalTimestamp}] ALL HARBOR HTTP ATTEMPTS FAILED`);
    console.log(`   Tried ${possibleEndpoints.length} Harbor HTTP endpoints`);
    console.log(`   Server: ${this.config.serverUrl || this.config.servers[0]}`);
    console.log(`   Station: ${this.config.stationId}`);
    console.log(`   Metadata: ${metadata.artist} - ${metadata.title}`);
    console.log(`💡 The server might not have harbor.http.register enabled`);
    console.log(`💡 Check AzuraCast Liquidsoap configuration for HTTP handlers`);
  }



  /**
   * Send fallback metadata when no music is playing
   */
  private sendFallbackMetadata(): void {
    const fallbackMetadata: AzuraCastMetadata = {
      title: this.currentUsername,
      artist: 'SubCaster'
    };
    
    this.sendMetadata(fallbackMetadata);
  }

  /**
   * Start continuous metadata updates
   */
  private startMetadataUpdates(): void {
    // Clear any existing timer
    this.stopMetadataUpdates();
    
    // Update metadata every 5 seconds to ensure it's always current
    this.metadataUpdateTimer = window.setInterval(() => {
      if (this.isConnected) {
        // Try to get current track metadata from the main application
        const currentTrack = this.getCurrentTrackFromApp();
        
        if (currentTrack) {
          this.sendMetadata(currentTrack);
        } else {
          // No music playing, send fallback
          this.sendFallbackMetadata();
        }
      }
    }, 5000);
    
    console.log('🔄 Started continuous metadata updates (every 5 seconds)');
  }

  /**
   * Stop continuous metadata updates
   */
  private stopMetadataUpdates(): void {
    if (this.metadataUpdateTimer) {
      clearInterval(this.metadataUpdateTimer);
      this.metadataUpdateTimer = null;
      console.log('⏹️ Stopped continuous metadata updates');
    }
  }

  /**
   * Get current track metadata from the main application
   * This will be called by the main app to provide current track info
   */
  private getCurrentTrackFromApp(): AzuraCastMetadata | null {
    // This will be set by the main application via setCurrentTrackProvider
    if (typeof (window as any).getCurrentTrackMetadata === 'function') {
      return (window as any).getCurrentTrackMetadata();
    }
    return null;
  }



  /**
   * Disconnect from AzuraCast
   */
  disconnect(): void {
    this.isConnected = false;
    
    // Stop metadata updates
    this.stopMetadataUpdates();
    
    if (this.mediaRecorder) {
      this.stopRecording();
    }
    
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    // Reset metadata state
    this.metadata = null;
    this.lastSentMetadata = null;
    
    console.log('🔌 Disconnected from AzuraCast WebDJ');
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Update streaming configuration
   */
  updateConfig(newConfig: Partial<AzuraCastConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update username if provided
    if (newConfig.username) {
      this.currentUsername = newConfig.username;
    }
    
    console.log('⚙️ Updated AzuraCast configuration:', newConfig);
  }

  /**
   * Set current track metadata provider function
   * This allows the main app to provide current track info
   */
  setCurrentTrackProvider(provider: () => AzuraCastMetadata | null): void {
    (window as any).getCurrentTrackMetadata = provider;
  }

  /**
   * Force update metadata immediately
   */
  updateMetadataImmediate(metadata?: AzuraCastMetadata): void {
    if (metadata) {
      this.sendMetadata(metadata);
    } else {
      const currentTrack = this.getCurrentTrackFromApp();
      if (currentTrack) {
        this.sendMetadata(currentTrack);
      } else {
        this.sendFallbackMetadata();
      }
    }
  }
}

/**
 * Create AzuraCast configuration from environment variables
 * @param overrideStationId - Optional station ID to override the environment variable
 * @param overrideStationShortcode - Optional station shortcode for WebDJ URL
 * @param selectedServerUrl - Optional server URL for selected station
 */
export function createAzuraCastConfig(overrideStationId?: string, overrideStationShortcode?: string, selectedServerUrl?: string, dynamicUsername?: string, dynamicPassword?: string): AzuraCastConfig {
  const timestamp = Date.now();
  
  // ✅ Nur Runtime-Config vom Backend verwenden (secure!)
  // ❌ KEIN Fallback zu import.meta.env - würde Secrets embedden!
  const getConfigValue = (window as any).getConfigValue || (() => {
    console.warn('⚠️ getConfigValue not available - backend config not loaded?');
    return '';
  });
  
  const serversEnv = getConfigValue('VITE_AZURACAST_SERVERS') || 'https://localhost';
  const servers = serversEnv.split(',').map((url: string) => url.trim());
  
  // Check for unified login (Backend-Proxy fügt Credentials hinzu - Frontend braucht sie nicht!)
  const useUnifiedLogin = getConfigValue('VITE_USE_UNIFIED_LOGIN') === 'true';
  
  // ⚠️ finalUsername/finalPassword werden nicht mehr verwendet, da Backend-Proxy die Auth übernimmt!
  // Fallback-Werte für alte Code-Pfade (werden nicht mehr an Backend gesendet):
  const finalUsername = dynamicUsername || 'webdj'; // Fallback, wird vom Backend ignoriert
  const finalPassword = dynamicPassword || 'webdj123'; // Fallback, wird vom Backend ignoriert
  
  const config = {
    servers,
    serverUrl: selectedServerUrl || servers[0], // Default to first server
    stationId: overrideStationId || getConfigValue('VITE_AZURACAST_STATION_ID') || '1',
    stationShortcode: overrideStationShortcode,
    username: finalUsername,
    password: finalPassword,
    bitrate: parseInt(getConfigValue('VITE_STREAM_BITRATE') || '128'),
    sampleRate: parseInt(getConfigValue('VITE_STREAM_SAMPLE_RATE') || '44100')
  };
  
  console.log(`🔧 [${timestamp}] AzuraCast Config created:`);
  console.log(`   - Server: ${config.serverUrl}`);
  console.log(`   - Station ID: ${config.stationId}`);
  console.log(`   - Station Shortcode: ${config.stationShortcode}`);
  console.log(`   - Username: ${config.username}`);
  console.log(`   - Password: ${config.password ? '[SET - ' + config.password.length + ' chars]' : '[NOT SET]'}`);
  console.log(`   - Bitrate: ${config.bitrate}`);
  
  return config;
}

/**
 * Fetch available AzuraCast stations from nowplaying API
 */
/**
 * Fetch available AzuraCast stations from nowplaying API
 */
export async function fetchAzuraCastStations(apiUrl: string): Promise<AzuraCastStation[]> {
  try {
    const response = await fetch(`${apiUrl}/nowplaying`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: AzuraCastNowPlayingResponse[] = await response.json();
    
    return data.map((item) => ({
      id: item.station.id,
      name: item.station.name,
      shortcode: item.station.shortcode,
      description: item.station.description,
      is_public: item.station.is_public,
      is_online: item.station.is_online,
      listen_url: item.station.listen_url
    }));
  } catch (error) {
    console.error(`Failed to fetch stations from ${apiUrl}:`, error);
    throw error;
  }
}

/**
 * Fetch stations from all configured AzuraCast servers
 */
export async function fetchAllAzuraCastStations(servers: string[]): Promise<Array<{serverUrl: string, stations: any[]}>> {
  const results = [];
  
  for (const serverUrl of servers) {
    try {
      console.log(`🔍 Loading stations from ${serverUrl}...`);
      const apiUrl = `${serverUrl}/api`;
      const response = await fetch(`${apiUrl}/nowplaying`);
      
      if (response.ok) {
        const stationsData = await response.json();
        results.push({
          serverUrl,
          stations: stationsData
        });
        console.log(`✅ Loaded ${stationsData.length} stations from ${serverUrl}`);
      } else {
        console.warn(`⚠️ Failed to load stations from ${serverUrl}: ${response.status}`);
      }
    } catch (error) {
      console.error(`❌ Error loading stations from ${serverUrl}:`, error);
    }
  }
  
  return results;
}