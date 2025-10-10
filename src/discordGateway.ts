/**
 * Discord Gateway WebSocket Client
 * Implements Discord Gateway API v10 for receiving real-time messages
 * https://discord.com/developers/docs/topics/gateway
 */

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    avatar: string | null;
    discriminator: string;
  };
  timestamp: string;
  channel_id: string;
  guild_id?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    size: number;
    url: string;
    proxy_url: string;
    content_type?: string;
  }>;
}

interface GatewayPayload {
  op: number;
  d: any;
  s: number | null;
  t: string | null;
}

// Gateway Opcodes
const OPCODES = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

// Gateway Intents
const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MEMBERS: 1 << 1,
  GUILD_MESSAGES: 1 << 9,
  MESSAGE_CONTENT: 1 << 15,
};

type MessageHandler = (message: DiscordMessage) => void;

export class DiscordGatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatInterval: number | null = null;
  private sessionId: string | null = null;
  private sequenceNumber: number | null = null;
  private resumeGatewayUrl: string | null = null;
  private token: string;
  private channelId: string;
  private guildId: string | null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private messageHandlers: MessageHandler[] = [];
  private isConnecting = false;
  private heartbeatAckReceived = true;

  constructor(token: string, channelId: string, guildId: string | null = null) {
    this.token = token;
    this.channelId = channelId;
    this.guildId = guildId;
  }

  /**
   * Connect to Discord Gateway
   */
  public async connect(): Promise<void> {
    if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
      console.log('🔗 Discord: Already connected or connecting');
      return;
    }

    this.isConnecting = true;

    try {
      // Get Gateway URL
      const gatewayUrl = await this.getGatewayUrl();
      console.log('🔗 Discord: Connecting to Gateway...');

      // Open WebSocket connection
      this.ws = new WebSocket(gatewayUrl);
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (event) => this.onMessage(event);
      this.ws.onerror = (error) => this.onError(error);
      this.ws.onclose = (event) => this.onClose(event);
    } catch (error) {
      console.error('❌ Discord: Failed to connect:', error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from Gateway
   */
  public disconnect(): void {
    console.log('👋 Discord: Disconnecting...');
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.sessionId = null;
    this.sequenceNumber = null;
    this.isConnecting = false;
  }

  /**
   * Subscribe to message events
   */
  public onNewMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Get Gateway URL from Discord API
   */
  private async getGatewayUrl(): Promise<string> {
    // Use cached resume URL if available
    if (this.resumeGatewayUrl) {
      return `${this.resumeGatewayUrl}?v=10&encoding=json`;
    }

    // Use backend proxy to avoid CORS issues
    const proxyUrl = `${window.location.origin}/api/discord/gateway`;
    
    console.log(`🔗 Fetching Gateway URL via proxy: ${proxyUrl}`);
    
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      throw new Error(`Failed to get gateway URL: ${response.statusText}`);
    }

    const data = await response.json();
    return `${data.url}?v=10&encoding=json`;
  }

  /**
   * WebSocket opened
   */
  private onOpen(): void {
    console.log('✅ Discord: WebSocket connected');
    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * WebSocket message received
   */
  private onMessage(event: MessageEvent): void {
    const payload: GatewayPayload = JSON.parse(event.data);

    // Update sequence number
    if (payload.s !== null) {
      this.sequenceNumber = payload.s;
    }

    // Handle different opcodes
    switch (payload.op) {
      case OPCODES.HELLO:
        this.handleHello(payload.d);
        break;

      case OPCODES.HEARTBEAT_ACK:
        this.heartbeatAckReceived = true;
        break;

      case OPCODES.HEARTBEAT:
        this.sendHeartbeat();
        break;

      case OPCODES.RECONNECT:
        console.log('🔄 Discord: Server requested reconnect');
        this.reconnect();
        break;

      case OPCODES.INVALID_SESSION:
        console.warn('⚠️ Discord: Invalid session');
        const canResume = payload.d as boolean;
        if (canResume) {
          this.resume();
        } else {
          this.sessionId = null;
          this.sequenceNumber = null;
          setTimeout(() => this.identify(), 1000 + Math.random() * 4000);
        }
        break;

      case OPCODES.DISPATCH:
        this.handleDispatch(payload);
        break;
    }
  }

  /**
   * WebSocket error
   */
  private onError(error: Event): void {
    console.error('❌ Discord: WebSocket error:', error);
  }

  /**
   * WebSocket closed
   */
  private onClose(event: CloseEvent): void {
    console.log(`🔌 Discord: Connection closed (code: ${event.code})`);
    this.isConnecting = false;
    this.stopHeartbeat();

    // Check if we can resume
    const canResume = [4000, 4001, 4002, 4003, 4005, 4007, 4008, 4009].includes(event.code);
    
    if (canResume && this.sessionId) {
      console.log('🔄 Discord: Attempting to resume...');
      this.reconnect();
    } else {
      // Reset session and reconnect
      this.sessionId = null;
      this.sequenceNumber = null;
      this.scheduleReconnect();
    }
  }

  /**
   * Handle HELLO opcode
   */
  private handleHello(data: any): void {
    console.log('👋 Discord: Received HELLO');
    const heartbeatInterval = data.heartbeat_interval;

    // Start heartbeat
    this.startHeartbeat(heartbeatInterval);

    // Identify or Resume
    if (this.sessionId && this.sequenceNumber !== null) {
      this.resume();
    } else {
      this.identify();
    }
  }

  /**
   * Send IDENTIFY payload
   */
  private identify(): void {
    console.log('🔐 Discord: Sending IDENTIFY');

    const payload = {
      op: OPCODES.IDENTIFY,
      d: {
        token: this.token,
        intents: INTENTS.GUILDS | INTENTS.GUILD_MESSAGES | INTENTS.MESSAGE_CONTENT,
        properties: {
          os: 'browser',
          browser: 'webdj',
          device: 'webdj',
        },
      },
    };

    this.send(payload);
  }

  /**
   * Send RESUME payload
   */
  private resume(): void {
    console.log('🔄 Discord: Sending RESUME');

    const payload = {
      op: OPCODES.RESUME,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.sequenceNumber,
      },
    };

    this.send(payload);
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(interval: number): void {
    this.stopHeartbeat();

    // Send first heartbeat with jitter
    const jitter = Math.random();
    setTimeout(() => {
      this.sendHeartbeat();
    }, interval * jitter);

    // Set up recurring heartbeat
    this.heartbeatInterval = window.setInterval(() => {
      // Check if we received ACK for previous heartbeat
      if (!this.heartbeatAckReceived) {
        console.warn('⚠️ Discord: No heartbeat ACK, reconnecting...');
        this.reconnect();
        return;
      }

      this.sendHeartbeat();
    }, interval);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send HEARTBEAT
   */
  private sendHeartbeat(): void {
    this.heartbeatAckReceived = false;
    const payload = {
      op: OPCODES.HEARTBEAT,
      d: this.sequenceNumber,
    };
    this.send(payload);
  }

  /**
   * Handle DISPATCH events
   */
  private handleDispatch(payload: GatewayPayload): void {
    const eventName = payload.t;
    const data = payload.d;

    switch (eventName) {
      case 'READY':
        console.log('✅ Discord: READY');
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        break;

      case 'RESUMED':
        console.log('✅ Discord: RESUMED');
        break;

      case 'MESSAGE_CREATE':
        // Only process messages from the target channel
        if (data.channel_id === this.channelId) {
          console.log('💬 Discord: New message from target channel');
          this.handleNewMessage(data);
        }
        break;
    }
  }

  /**
   * Handle new message
   */
  private handleNewMessage(data: DiscordMessage): void {
    // Notify all handlers
    this.messageHandlers.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error('❌ Discord: Error in message handler:', error);
      }
    });
  }

  /**
   * Send payload to Gateway
   */
  private send(payload: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    } else {
      console.warn('⚠️ Discord: Cannot send, WebSocket not open');
    }
  }

  /**
   * Reconnect to Gateway
   */
  private reconnect(): void {
    this.disconnect();
    setTimeout(() => {
      this.connect();
    }, 1000);
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ Discord: Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`🔄 Discord: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect();
    }, delay);
  }
}


// Export singleton instance
let discordClient: DiscordGatewayClient | null = null;

/**
 * Fetch existing messages from Discord channel via REST API
 */
export async function fetchChannelMessages(limit: number = 50): Promise<DiscordMessage[]> {
  const token = import.meta.env.VITE_DISCORD_BOT_TOKEN;
  const channelId = import.meta.env.VITE_DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    console.warn('⚠️ Discord: Cannot fetch messages - missing credentials');
    return [];
  }

  try {
    console.log(`📥 Fetching last ${limit} messages from Discord channel...`);
    
    // Use backend proxy to avoid CORS issues
    const proxyUrl = `${window.location.origin}/api/discord/channels/${channelId}/messages?limit=${limit}`;
    
    const response = await fetch(proxyUrl, {
      headers: {
        'Authorization': `Bot ${token}`,
      },
    });

    if (!response.ok) {
      console.error(`❌ Failed to fetch messages: ${response.status} ${response.statusText}`);
      return [];
    }

    const messages = await response.json();
    console.log(`✅ Fetched ${messages.length} messages from Discord`);
    
    // Reverse to show oldest first
    return messages.reverse();
  } catch (error) {
    console.error('❌ Error fetching Discord messages:', error);
    return [];
  }
}

export function initializeDiscord(): DiscordGatewayClient | null {
  const token = import.meta.env.VITE_DISCORD_BOT_TOKEN;
  const channelId = import.meta.env.VITE_DISCORD_CHANNEL_ID;
  const guildId = import.meta.env.VITE_DISCORD_GUILD_ID || null;

  if (!token || !channelId) {
    console.warn('⚠️ Discord: Missing environment variables (VITE_DISCORD_BOT_TOKEN, VITE_DISCORD_CHANNEL_ID)');
    return null;
  }

  if (!discordClient) {
    discordClient = new DiscordGatewayClient(token, channelId, guildId);
    discordClient.connect();
  }

  return discordClient;
}

export function getDiscordClient(): DiscordGatewayClient | null {
  return discordClient;
}

