/**
 * Runtime Configuration Loader
 * 
 * Lädt alle Environment-Variablen vom Backend zur Laufzeit.
 * Vorteil: Keine Neubuilds bei Config-Änderungen!
 * Sicherheit: Tokens bleiben auf dem Server!
 */

interface AppConfig {
  opensubsonic: {
    url: string;
    username: string;
  };
  azuracast: {
    servers: string;
    stationId: string;
  };
  discord: {
    channelId: string;
    guildId: string;
    enabled: boolean;
  };
  unifiedLogin: {
    enabled: boolean;
  };
  stream: {
    bitrate: string;
    sampleRate: string;
  };
  deckConfiguration: string;
}

let cachedConfig: AppConfig | null = null;

/**
 * Lädt die Konfiguration vom Backend
 * Cached das Ergebnis für Performance
 */
export async function loadConfig(): Promise<AppConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  console.log('📋 Loading configuration from backend...');

  try {
    const response = await fetch('/api/config');
    
    if (!response.ok) {
      throw new Error(`Failed to load config: ${response.status}`);
    }

    const config = await response.json();
    cachedConfig = config;

    console.log('✅ Configuration loaded successfully');
    console.log('   OpenSubsonic:', config.opensubsonic.url ? '✅' : '❌');
    console.log('   AzuraCast:', config.azuracast.servers ? '✅' : '❌');
    console.log('   Discord:', config.discord.enabled ? '✅' : '❌');

    return config;
  } catch (error) {
    console.error('❌ Failed to load configuration:', error);
    
    // Fallback to empty config
    const fallbackConfig: AppConfig = {
      opensubsonic: { url: '', username: '' },
      azuracast: { servers: '', stationId: '1' },
      discord: { channelId: '', guildId: '', enabled: false },
      unifiedLogin: { enabled: false },
      stream: { bitrate: '128', sampleRate: '44100' },
      deckConfiguration: 'four-decks',
    };

    return fallbackConfig;
  }
}

/**
 * Gibt einen einzelnen Config-Wert zurück
 * Kompatibel mit altem import.meta.env.VITE_* Pattern
 */
export function getConfigValue(key: string): string {
  if (!cachedConfig) {
    console.warn(`⚠️ Config not loaded yet, trying to access: ${key}`);
    return '';
  }

  // Map old VITE_* keys to new config structure
  const keyMap: Record<string, () => string> = {
    'VITE_OPENSUBSONIC_URL': () => cachedConfig!.opensubsonic.url,
    'VITE_OPENSUBSONIC_USERNAME': () => cachedConfig!.opensubsonic.username,
    'VITE_AZURACAST_SERVERS': () => cachedConfig!.azuracast.servers,
    'VITE_AZURACAST_STATION_ID': () => cachedConfig!.azuracast.stationId,
    'VITE_DISCORD_CHANNEL_ID': () => cachedConfig!.discord.channelId,
    'VITE_DISCORD_GUILD_ID': () => cachedConfig!.discord.guildId,
    'VITE_STREAM_BITRATE': () => cachedConfig!.stream.bitrate,
    'VITE_STREAM_SAMPLE_RATE': () => cachedConfig!.stream.sampleRate,
    'VITE_DECK_CONFIGURATION': () => cachedConfig!.deckConfiguration,
    'VITE_USE_UNIFIED_LOGIN': () => String(cachedConfig!.unifiedLogin.enabled),
  };

  const getter = keyMap[key];
  if (getter) {
    return getter();
  }

  console.warn(`⚠️ Unknown config key: ${key}`);
  return '';
}

/**
 * Expose getConfigValue globally for compatibility
 */
(window as any).getConfigValue = getConfigValue;

/**
 * Get Discord credentials from backend (for WebSocket connection)
 */
export async function getDiscordCredentials(): Promise<{ token: string; channelId: string; guildId: string } | null> {
  try {
    // Token wird nicht mehr direkt geholt, sondern über Gateway-Proxy
    const config = await loadConfig();
    
    if (!config.discord.enabled) {
      console.log('⚠️ Discord not enabled in backend config');
      return null;
    }

    // Backend wird Discord Gateway Connection für uns machen
    // Frontend nutzt WebSocket ohne direkten Token-Zugriff
    return {
      token: '', // Token bleibt auf Backend!
      channelId: config.discord.channelId,
      guildId: config.discord.guildId,
    };
  } catch (error) {
    console.error('❌ Failed to get Discord credentials:', error);
    return null;
  }
}

/**
 * Get OpenSubsonic authentication from backend
 */
export async function getOpenSubsonicAuth(): Promise<{ serverUrl: string; username: string; token: string; salt: string } | null> {
  try {
    const response = await fetch('/api/opensubsonic/auth', {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`OpenSubsonic auth failed: ${response.status}`);
    }

    const auth = await response.json();
    console.log('✅ OpenSubsonic authentication received from backend');
    
    return auth;
  } catch (error) {
    console.error('❌ Failed to get OpenSubsonic authentication:', error);
    return null;
  }
}

/**
 * Send AzuraCast Liquidsoap command via backend proxy
 */
export async function sendAzuraCastCommand(
  serverUrl: string,
  stationId: string,
  command: string
): Promise<{ success: boolean; response: any }> {
  try {
    const response = await fetch('/api/azuracast/liquidsoap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverUrl, stationId, command }),
    });

    if (!response.ok) {
      throw new Error(`AzuraCast command failed: ${response.status}`);
    }

    const result = await response.json();
    console.log('✅ AzuraCast command sent via backend');
    
    return result;
  } catch (error) {
    console.error('❌ Failed to send AzuraCast command:', error);
    return { success: false, response: error };
  }
}
