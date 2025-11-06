/**
 * AzuraCast WebSocket Service for Now Playing Updates
 * High-performance real-time updates using Centrifugo websockets
 */

export interface AzuraCastNowPlayingData {
  station: {
    id: number;
    name: string;
    shortcode: string;
  };
  now_playing: {
    song: {
      id: string;
      title: string;
      artist: string;
      album: string;
      art: string;
      text: string;
    };
    elapsed: number;
    remaining: number;
    duration: number;
  };
  live: {
    is_live: boolean;
    streamer_name: string;
  };
  listeners?: {
    total: number;
    unique: number;
    current: number;
  };
  playing_next?: {
    song: {
      title: string;
      artist: string;
      album: string;
      art: string;
    };
  };
}

export class AzuraCastWebSocketService {
  private connections = new Map<string, WebSocket>();
  private subscribers = new Map<string, Set<(data: AzuraCastNowPlayingData) => void>>();
  private nowPlayingData = new Map<string, AzuraCastNowPlayingData>();
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();
  private failedWebSockets = new Set<string>();
  private pollingIntervals = new Map<string, NodeJS.Timeout>();

  /**
   * Subscribe to Now Playing updates for a specific station
   */
  subscribe(serverUrl: string, stationShortcode: string, callback: (data: AzuraCastNowPlayingData) => void) {
    const key = `${serverUrl}:${stationShortcode}`;
    
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    
    this.subscribers.get(key)!.add(callback);
    
    // Start WebSocket connection if not already connected
    if (!this.connections.has(key)) {
      this.connect(serverUrl, stationShortcode);
    }
    
    // Send current data immediately if available
    if (this.nowPlayingData.has(key)) {
      callback(this.nowPlayingData.get(key)!);
    }
    
    console.log(`📻 Subscribed to ${stationShortcode} on ${serverUrl}`);
  }

  /**
   * Unsubscribe from Now Playing updates
   */
  unsubscribe(serverUrl: string, stationShortcode: string, callback: (data: AzuraCastNowPlayingData) => void) {
    const key = `${serverUrl}:${stationShortcode}`;
    
    if (this.subscribers.has(key)) {
      this.subscribers.get(key)!.delete(callback);
      
      // If no more subscribers, close the connection
      if (this.subscribers.get(key)!.size === 0) {
        this.disconnect(key);
      }
    }
  }

  /**
   * Unsubscribe all callbacks for a station
   */
  unsubscribeAll(serverUrl: string, stationShortcode: string) {
    const key = `${serverUrl}:${stationShortcode}`;
    
    if (this.subscribers.has(key)) {
      this.subscribers.get(key)!.clear();
      this.disconnect(key);
      console.log(`📻 Unsubscribed all callbacks from ${stationShortcode} on ${serverUrl}`);
    }
  }

  /**
   * Get current Now Playing data for a station
   */
  getCurrentData(serverUrl: string, stationShortcode: string): AzuraCastNowPlayingData | null {
    const key = `${serverUrl}:${stationShortcode}`;
    return this.nowPlayingData.get(key) || null;
  }

  /**
   * Connect to AzuraCast WebSocket
   */
  private connect(serverUrl: string, stationShortcode: string) {
    const key = `${serverUrl}:${stationShortcode}`;
    
    // If this server has failed WebSocket before, use HTTP polling
    if (this.failedWebSockets.has(key)) {
      console.log(`🔄 Using HTTP polling for ${stationShortcode} (WebSocket previously failed)`);
      this.startHttpPolling(serverUrl, stationShortcode);
      return;
    }
    
    const wsUrl = `${serverUrl.replace(/^https?:\/\//, 'wss://')}/api/live/nowplaying/websocket`;
    
    try {
      console.log(`🔌 Connecting to AzuraCast WebSocket: ${wsUrl}`);
      
      const socket = new WebSocket(wsUrl);
      this.connections.set(key, socket);

      socket.onopen = () => {
        console.log(`✅ WebSocket connected for ${stationShortcode}`);
        
        // Send subscription message
        const subscriptionMessage = {
          subs: {
            [`station:${stationShortcode}`]: { recover: true }
          }
        };
        
        socket.send(JSON.stringify(subscriptionMessage));
      };

      socket.onmessage = (event) => {
        this.handleMessage(key, event.data);
      };

      socket.onclose = (event) => {
        console.log(`🔌 WebSocket closed for ${stationShortcode}:`, event.code, event.reason);
        this.connections.delete(key);
        
        // Check for failure codes that indicate WebSocket is not supported
        if (event.code === 1005 || event.code === 1006 || event.code === 1011 || event.code === 1002) {
          console.log(`🔄 WebSocket not supported for ${stationShortcode}, switching to HTTP polling`);
          this.failedWebSockets.add(key);
          this.startHttpPolling(serverUrl, stationShortcode);
          return;
        }
        
        // Attempt to reconnect if there are still subscribers
        if (this.subscribers.has(key) && this.subscribers.get(key)!.size > 0) {
          this.scheduleReconnect(serverUrl, stationShortcode);
        }
      };

      socket.onerror = (error) => {
        console.error(`❌ WebSocket error for ${stationShortcode}:`, error);
      };

    } catch (error) {
      console.error(`❌ Failed to connect to WebSocket for ${stationShortcode}:`, error);
      this.failedWebSockets.add(key);
      this.startHttpPolling(serverUrl, stationShortcode);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(key: string, data: string) {
    try {
      const jsonData = JSON.parse(data);
      
      // Handle connection acknowledgment with initial data
      if ('connect' in jsonData) {
        const connectData = jsonData.connect;
        
        // Handle cached NowPlaying initial push
        for (const subName in connectData.subs) {
          const sub = connectData.subs[subName];
          if ('publications' in sub && sub.publications.length > 0) {
            sub.publications.forEach((publication: any) => {
              this.processNowPlayingUpdate(key, publication);
            });
          }
        }
      }
      // Handle live updates
      else if ('pub' in jsonData) {
        this.processNowPlayingUpdate(key, jsonData.pub);
      }
      // Ignore empty pings
      
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error);
    }
  }

  /**
   * Process Now Playing update
   */
  private processNowPlayingUpdate(key: string, publication: any) {
    if (publication.data && publication.data.np) {
      const nowPlayingData = publication.data.np as AzuraCastNowPlayingData;
      
      // Store the data
      this.nowPlayingData.set(key, nowPlayingData);
      
      // Notify all subscribers
      if (this.subscribers.has(key)) {
        this.subscribers.get(key)!.forEach(callback => {
          try {
            callback(nowPlayingData);
          } catch (error) {
            console.error('❌ Error in Now Playing callback:', error);
          }
        });
      }
      
      console.log(`🎵 Now Playing update for ${key}:`, nowPlayingData.now_playing?.song?.text || 'Unknown');
    }
  }

  /**
   * Disconnect from WebSocket or stop HTTP polling
   */
  private disconnect(key: string) {
    if (this.connections.has(key)) {
      this.connections.get(key)!.close();
      this.connections.delete(key);
    }
    
    if (this.reconnectTimeouts.has(key)) {
      clearTimeout(this.reconnectTimeouts.get(key)!);
      this.reconnectTimeouts.delete(key);
    }
    
    if (this.pollingIntervals.has(key)) {
      clearInterval(this.pollingIntervals.get(key)!);
      this.pollingIntervals.delete(key);
    }
    
    this.nowPlayingData.delete(key);
    this.subscribers.delete(key);
    
    console.log(`🔌 Disconnected from ${key}`);
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(serverUrl: string, stationShortcode: string) {
    const key = `${serverUrl}:${stationShortcode}`;
    
    if (this.reconnectTimeouts.has(key)) {
      clearTimeout(this.reconnectTimeouts.get(key)!);
    }
    
    const timeout = setTimeout(() => {
      console.log(`🔄 Attempting to reconnect to ${key}`);
      this.connect(serverUrl, stationShortcode);
    }, 5000); // Reconnect after 5 seconds
    
    this.reconnectTimeouts.set(key, timeout);
  }

  /**
   * Start HTTP polling as fallback when WebSocket fails
   */
  private startHttpPolling(serverUrl: string, stationShortcode: string) {
    const key = `${serverUrl}:${stationShortcode}`;
    
    // Clear any existing polling interval
    if (this.pollingIntervals.has(key)) {
      clearInterval(this.pollingIntervals.get(key)!);
    }
    
    // Start polling every 10 seconds
    const pollNowPlaying = async () => {
      try {
        const response = await fetch(`${serverUrl}/api/nowplaying/${stationShortcode}`);
        if (response.ok) {
          const data = await response.json();
          
          // Store the data
          this.nowPlayingData.set(key, data);
          
          // Notify all subscribers
          if (this.subscribers.has(key)) {
            this.subscribers.get(key)!.forEach(callback => {
              try {
                callback(data);
              } catch (error) {
                console.error('❌ Error in Now Playing callback:', error);
              }
            });
          }
          
          console.log(`🔄 HTTP polling update for ${stationShortcode}:`, data.now_playing?.song?.text || 'Unknown');
        } else {
          console.error(`❌ HTTP polling failed for ${stationShortcode}:`, response.status);
        }
      } catch (error) {
        console.error(`❌ HTTP polling error for ${stationShortcode}:`, error);
      }
    };
    
    // Poll immediately, then every 10 seconds
    pollNowPlaying();
    const interval = setInterval(pollNowPlaying, 10000);
    this.pollingIntervals.set(key, interval as any);
    
    console.log(`🔄 Started HTTP polling for ${stationShortcode}`);
  }

  /**
   * Cleanup all connections and polling intervals
   */
  cleanup() {
    this.connections.forEach((socket, key) => {
      socket.close();
    });
    
    this.reconnectTimeouts.forEach((timeout) => {
      clearTimeout(timeout);
    });
    
    this.pollingIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    
    this.connections.clear();
    this.subscribers.clear();
    this.nowPlayingData.clear();
    this.reconnectTimeouts.clear();
    this.pollingIntervals.clear();
    this.failedWebSockets.clear();
  }
}

// Global instance
export const azuraCastWebSocket = new AzuraCastWebSocketService();