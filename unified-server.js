// Unified Server: Web-App + CORS-Proxy auf Port 5173
import express from 'express';
import cors from 'cors';
import net from 'net';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file (wichtig für Docker und lokale Entwicklung)
// In Docker: Lädt aus /app/docker-data/.env (gemountet)
// Lokal: Lädt aus .env im Projektverzeichnis
const envPath = process.env.DOCKER_ENV 
  ? path.join(__dirname, 'docker-data', '.env')
  : path.join(__dirname, '.env');

console.log(`📄 Loading .env from: ${envPath}`);
dotenv.config({ path: envPath });

const app = express();
const PORT = process.env.PORT || 3002;

// Debug: Environment Variables
console.log('🔍 Environment Debug:');
console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`   DOCKER_ENV: ${process.env.DOCKER_ENV}`);
console.log(`   __dirname: ${__dirname}`);
console.log(`   DISCORD_BOT_TOKEN: ${process.env.DISCORD_BOT_TOKEN ? '***configured***' : '❌ NOT SET'}`);
console.log(`   VITE_DISCORD_CHANNEL_ID: ${process.env.VITE_DISCORD_CHANNEL_ID}`);
console.log(`   Discord Bot Token: ${process.env.DISCORD_BOT_TOKEN ? '✅ Set' : '❌ Missing'}`);
console.log(`   Discord Channel ID: ${process.env.VITE_DISCORD_CHANNEL_ID ? '✅ Set' : '❌ Missing'}`);

// CORS für alle Requests aktivieren
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Ice-Public', 'Ice-Name', 'Ice-Description', 'User-Agent', 'Range']
}));

// JSON Body Parser for Setup-Wizard
app.use(express.json({ limit: '10mb' }));

// ============================================================================
// BACKEND CONFIG API - Loads settings from .env at runtime (no rebuild needed!)
// ============================================================================

// Get all frontend configuration (public + masked secrets)
app.get('/api/config', (req, res) => {
  console.log('📋 Frontend requested configuration');
  
  const config = {
    // OpenSubsonic settings
    opensubsonic: {
      url: process.env.VITE_OPENSUBSONIC_URL || '',
      username: process.env.OPENSUBSONIC_USERNAME || '',
      // Password is handled server-side only
    },
    
    // AzuraCast settings
    azuracast: {
      servers: process.env.VITE_AZURACAST_SERVERS || '',
      stationId: process.env.VITE_AZURACAST_STATION_ID || '1',
      // DJ credentials handled server-side only
    },
    
    // Discord settings (no tokens exposed!)
    discord: {
      channelId: process.env.VITE_DISCORD_CHANNEL_ID || '',
      guildId: process.env.VITE_DISCORD_GUILD_ID || '',
      enabled: !!(process.env.DISCORD_BOT_TOKEN && process.env.VITE_DISCORD_CHANNEL_ID),
    },
    
    // Unified login settings
    unifiedLogin: {
      enabled: process.env.VITE_USE_UNIFIED_LOGIN === 'true',
      // Credentials handled server-side only
    },
    
    // Stream settings
    stream: {
      bitrate: process.env.VITE_STREAM_BITRATE || '128',
      sampleRate: process.env.VITE_STREAM_SAMPLE_RATE || '44100',
    },
    
    // Deck configuration
    deckConfiguration: process.env.VITE_DECK_CONFIGURATION || 'four-decks',
  };
  
  // Return config directly (config-loader.ts expects this format)
  res.json(config);
});

// ============================================================================
// DISCORD API PROXY - Bot token stays server-side!
// ============================================================================

// Get Discord Gateway URL
app.get('/api/discord/gateway', async (req, res) => {
  const token = process.env.DISCORD_BOT_TOKEN;
  
  if (!token) {
    return res.status(500).json({ error: 'Discord bot token not configured' });
  }
  
  try {
    const response = await fetch('https://discord.com/api/v10/gateway/bot', {
      headers: { 'Authorization': `Bot ${token}` }
    });
    
    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('❌ Discord gateway error:', error);
    res.status(500).json({ error: 'Failed to get Discord gateway' });
  }
});

// Get Discord channel messages
app.get('/api/discord/channels/:channelId/messages', async (req, res) => {
  const token = process.env.DISCORD_BOT_TOKEN;
  const { channelId } = req.params;
  const limit = req.query.limit || 50;
  
  if (!token) {
    return res.status(500).json({ error: 'Discord bot token not configured' });
  }
  
  try {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
      {
        headers: { 'Authorization': `Bot ${token}` }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }
    
    const messages = await response.json();
    res.json(messages);
  } catch (error) {
    console.error('❌ Discord messages error:', error);
    res.status(500).json({ error: 'Failed to fetch Discord messages' });
  }
});

// ============================================================================
// OPENSUBSONIC API PROXY - Credentials stay server-side!
// ============================================================================

// OpenSubsonic authentication
app.post('/api/opensubsonic/auth', async (req, res) => {
  const serverUrl = process.env.VITE_OPENSUBSONIC_URL;
  const username = process.env.OPENSUBSONIC_USERNAME;
  const password = process.env.OPENSUBSONIC_PASSWORD;
  
  if (!serverUrl || !username || !password) {
    return res.status(500).json({ error: 'OpenSubsonic not configured' });
  }
  
  // Generate salt and token (MD5 hash)
  const crypto = await import('crypto');
  const salt = Math.random().toString(36).substring(2, 15);
  const token = crypto.createHash('md5').update(password + salt).digest('hex');
  
  res.json({
    serverUrl,
    username,
    token,
    salt,
  });
});

// OpenSubsonic proxy for any API call
app.get('/api/opensubsonic/:endpoint', async (req, res) => {
  const serverUrl = process.env.VITE_OPENSUBSONIC_URL;
  const username = process.env.OPENSUBSONIC_USERNAME;
  const password = process.env.OPENSUBSONIC_PASSWORD;
  const { endpoint } = req.params;
  
  if (!serverUrl || !username || !password) {
    return res.status(500).json({ error: 'OpenSubsonic not configured' });
  }
  
  try {
    const crypto = await import('crypto');
    const salt = Math.random().toString(36).substring(2, 15);
    const token = crypto.createHash('md5').update(password + salt).digest('hex');
    
    const params = new URLSearchParams({
      u: username,
      t: token,
      s: salt,
      v: '1.16.1',
      c: 'SubCaster',
      f: 'json',
      ...req.query
    });
    
    const url = `${serverUrl}/rest/${endpoint}?${params}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`OpenSubsonic API error: ${response.status}`);
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('❌ OpenSubsonic proxy error:', error);
    res.status(500).json({ error: 'OpenSubsonic API failed' });
  }
});

// ============================================================================
// AZURACAST API PROXY - DJ credentials stay server-side!
// ============================================================================

// AzuraCast Liquidsoap command proxy
app.post('/api/azuracast/liquidsoap', async (req, res) => {
  const { serverUrl, stationId, command } = req.body;
  const username = process.env.VITE_USE_UNIFIED_LOGIN === 'true' 
    ? process.env.UNIFIED_USERNAME 
    : process.env.AZURACAST_DJ_USERNAME;
  const password = process.env.VITE_USE_UNIFIED_LOGIN === 'true'
    ? process.env.UNIFIED_PASSWORD
    : process.env.AZURACAST_DJ_PASSWORD;
  
  if (!username || !password) {
    return res.status(500).json({ error: 'AzuraCast credentials not configured' });
  }
  
  try {
    // Try HTTP API endpoint
    const apiUrl = `${serverUrl}/api/station/${stationId}/backend/liquidsoap/command`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      },
      body: JSON.stringify({ command })
    });
    
    if (!response.ok) {
      throw new Error(`AzuraCast API error: ${response.status}`);
    }
    
    const data = await response.json();
    res.json({ success: true, response: data });
  } catch (error) {
    console.error('❌ AzuraCast liquidsoap error:', error);
    res.status(500).json({ error: 'AzuraCast command failed' });
  }
});

// Harbor Connection Handler
let harborSocket = null;
let isConnected = false;
const MOUNT_POINTS = ['/', '/radio.mp3', '/teststream', '/live'];
let currentMountIndex = 0;

// CORS-Proxy Routes ZUERST definieren (vor static files)
// Audio-Proxy für OpenSubsonic Streams
app.get('/api/opensubsonic-stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }
    
    console.log(`🎵 Audio-Stream Request: ${targetUrl}`);
    console.log(`📡 Headers: Range=${req.headers.range || 'none'}`);
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        // Headers für Request vorbereiten
        const requestHeaders = {
            'User-Agent': req.headers['user-agent'] || 'OpenSubsonic-SubCaster-Proxy'
        };
        
        // Range-Header nur hinzufügen wenn vorhanden
        if (req.headers.range) {
            requestHeaders['Range'] = req.headers.range;
        }
        
        // Authorization hinzufügen falls vorhanden
        if (req.headers.authorization) {
            requestHeaders['Authorization'] = req.headers.authorization;
        }
        
        console.log(`📤 Forwarding headers:`, requestHeaders);
        
        const response = await fetch(targetUrl, {
            headers: requestHeaders,
            // Timeout hinzufügen
            timeout: 30000
        });
        
        console.log(`📥 OpenSubsonic response: ${response.status} ${response.statusText}`);
        
        // CORS-Headers hinzufügen
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
        });
        
        // Content-Type weiterleiten
        if (response.headers.get('content-type')) {
            res.set('Content-Type', response.headers.get('content-type'));
        }
        
        // Content-Length weiterleiten falls vorhanden
        if (response.headers.get('content-length')) {
            res.set('Content-Length', response.headers.get('content-length'));
        }
        
        // Accept-Ranges weiterleiten
        if (response.headers.get('accept-ranges')) {
            res.set('Accept-Ranges', response.headers.get('accept-ranges'));
        }
        
        // Content-Range weiterleiten (wichtig für Range-Requests)
        if (response.headers.get('content-range')) {
            res.set('Content-Range', response.headers.get('content-range'));
        }
        
        // Status Code weiterleiten
        res.status(response.status);
        
        // Error-Handler für Response
        res.on('error', (err) => {
            console.error('❌ Audio response stream error:', err.message);
            if (response.body) {
                response.body.destroy();
            }
        });
        
        // Error-Handler für incoming stream
        response.body.on('error', (err) => {
            console.error('❌ Audio source stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream Error' });
            } else {
                res.end();
            }
        });
        
        // Check if client disconnected
        req.on('close', () => {
            if (response.body) {
                response.body.destroy();
            }
        });
        
        // Stream weiterleiten
        response.body.pipe(res);
        console.log(`✅ Audio-Stream proxied: ${response.status}`);
        
    } catch (error) {
        console.error(`❌ Audio-Proxy Error:`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy Error', details: error.message });
        }
    }
});

// Cover Art Proxy für OpenSubsonic
app.get('/api/opensubsonic-cover', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing URL parameter' });
    }
    
    // Reduzierte Logging - nur bei Debug oder Fehlern
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        // Headers für Request vorbereiten
        const requestHeaders = {
            'User-Agent': req.headers['user-agent'] || 'OpenSubsonic-SubCaster-Proxy'
        };
        
        // Authorization hinzufügen falls vorhanden
        if (req.headers.authorization) {
            requestHeaders['Authorization'] = req.headers.authorization;
        }
        
        const response = await fetch(targetUrl, {
            headers: requestHeaders,
            // Timeout hinzufügen um hängende Verbindungen zu vermeiden
            timeout: 10000
        });
        
        // Check for XML error responses from Subsonic/Navidrome
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('xml') || contentType.includes('text/xml')) {
            // Read the body to check for error
            const text = await response.text();
            
            // Check if it's an error response
            if (text.includes('status="failed"') || text.includes('<error')) {
                console.log(`❌ Cover Art XML Error: ${targetUrl}`);
                // Return 404 so onerror handler triggers
                return res.status(404).send('Cover art not found');
            }
            
            // If it's valid XML but not an error, something is weird
            // But let's send it anyway
            res.set({
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Content-Type': contentType
            });
            res.status(response.status);
            return res.send(text);
        }
        
        // Nur Fehlermeldungen loggen, keine 200 OK Spam
        if (response.status >= 400) {
            console.log(`❌ Cover Art Error: ${response.status} ${response.statusText}`);
        }
        
        // CORS-Headers hinzufügen
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type'
        });
        
        // Content-Type weiterleiten
        if (response.headers.get('content-type')) {
            res.set('Content-Type', response.headers.get('content-type'));
        }
        
        // Content-Length weiterleiten falls vorhanden
        if (response.headers.get('content-length')) {
            res.set('Content-Length', response.headers.get('content-length'));
        }
        
        // Status Code weiterleiten
        res.status(response.status);
        
        // Error-Handler für Response
        res.on('error', (err) => {
            console.error('❌ Response stream error:', err.message);
            // Stream cleanup
            if (response.body) {
                response.body.destroy();
            }
        });
        
        // Error-Handler für incoming stream
        response.body.on('error', (err) => {
            console.error('❌ Source stream error:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream Error' });
            } else {
                res.end();
            }
        });
        
        // Check if client disconnected
        req.on('close', () => {
            if (response.body) {
                response.body.destroy();
            }
        });
        
        // Stream weiterleiten
        response.body.pipe(res);
        
    } catch (error) {
        console.error(`❌ Cover Art Proxy Error:`, error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy Error', details: error.message });
        }
    }
});

// Discord API Proxy für DELETE requests (Message löschen)
app.delete('/api/discord/channels/:channelId/messages/:messageId', async (req, res) => {
    const { channelId, messageId } = req.params;
    
    // ✅ Token wird vom Backend hinzugefügt, NICHT vom Frontend erwartet!
    const token = process.env.DISCORD_BOT_TOKEN;
    
    if (!token) {
        return res.status(500).json({ error: 'Discord bot token not configured on server' });
    }
    
    console.log(`🗑️ Discord Delete Message: ${messageId} in channel ${channelId}`);
    
    try {
        const fetch = (await import('node-fetch')).default;
        
        const response = await fetch(
            `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`,
            {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bot ${token}`,
                    'User-Agent': 'WebDJ-Discord-Bot'
                }
            }
        );
        
        console.log(`📥 Discord Delete response: ${response.status}`);
        
        // CORS-Headers hinzufügen
        res.set({
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        });
        
        // Status Code weiterleiten
        res.status(response.status);
        
        if (response.status === 204) {
            res.end();
        } else {
            const errorData = await response.text();
            res.send(errorData);
        }
        
    } catch (error) {
        console.error(`❌ Discord Delete Proxy Error:`, error.message);
        res.status(500).json({ error: 'Proxy Error', details: error.message });
    }
});

// Discord Audio Proxy (GET /api/discord-audio)
// Proxies Discord CDN audio files to avoid CORS issues
app.get('/api/discord-audio', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'Missing url parameter' });
    }
    
    // Validate that it's a Discord CDN URL
    if (!url.startsWith('https://cdn.discordapp.com/')) {
        return res.status(403).json({ error: 'Invalid URL - must be Discord CDN' });
    }
    
    try {
        console.log(`🎵 Discord Audio Proxy: GET ${url.substring(0, 100)}...`);
        
        // Handle range requests for seeking
        const range = req.headers.range;
        const fetchHeaders = {
            'User-Agent': 'WebDJ-Discord-Bot'
        };
        
        if (range) {
            fetchHeaders['Range'] = range;
            console.log(`📍 Range request: ${range}`);
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: fetchHeaders
        });
        
        console.log(`📥 Discord Audio response: ${response.status}`);
        
        if (response.ok || response.status === 206) {
            // Get content type from Discord response
            const contentType = response.headers.get('content-type') || 'audio/mpeg';
            const contentLength = response.headers.get('content-length');
            const contentRange = response.headers.get('content-range');
            
            // Set response status
            res.status(response.status);
            
            // Set CORS and content headers
            const headers = {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, Content-Type',
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            };
            
            if (contentLength) {
                headers['Content-Length'] = contentLength;
            }
            
            if (contentRange) {
                headers['Content-Range'] = contentRange;
            }
            
            res.set(headers);
            
            // Stream audio using Node.js streams
            const reader = response.body.getReader();
            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            controller.enqueue(value);
                        }
                        controller.close();
                    } catch (error) {
                        controller.error(error);
                    }
                }
            });
            
            // Convert ReadableStream to Node.js stream
            for await (const chunk of stream) {
                res.write(Buffer.from(chunk));
            }
            res.end();
            
        } else {
            console.error(`❌ Discord Audio error: ${response.status}`);
            const errorData = await response.text();
            res.status(response.status).send(errorData);
        }
        
    } catch (error) {
        console.error(`❌ Discord Audio Proxy Error:`, error.message);
        res.status(500).json({ error: 'Proxy Error', details: error.message });
    }
});

// AzuraCast Liquidsoap Telnet Proxy für Metadata Updates
app.post('/api/azuracast-telnet', async (req, res) => {
    const { serverUrl, stationId, apiKey, command } = req.body;
    
    if (!serverUrl || !stationId || !apiKey || !command) {
        return res.status(400).json({ 
            error: 'Missing required parameters', 
            required: ['serverUrl', 'stationId', 'apiKey', 'command'] 
        });
    }
    
    console.log(`🎭 AzuraCast Telnet Request: Station ${stationId}, Command: ${command}`);
    
    try {
        // Port-Berechnung basierend auf AzuraCast-Logik
        // Frontend Port = 8000 + ((station_id - 1) * 10)
        // Stream Port = Frontend Port + 5  
        // HTTP API Port = Stream Port - 1
        const frontendPort = 8000 + ((stationId - 1) * 10);
        const streamPort = frontendPort + 5;
        const httpApiPort = streamPort - 1;
        
        console.log(`📊 Port-Berechnung: Frontend=${frontendPort}, Stream=${streamPort}, HTTP API=${httpApiPort}`);
        
        const fetch = (await import('node-fetch')).default;
        
        // URL konstruieren - sowohl HTTP als auch HTTPS versuchen
        const urls = [
            `${serverUrl.replace(/\/$/, '')}:${httpApiPort}/telnet`,
            `${serverUrl.replace(/^https?:\/\//, 'http://')}:${httpApiPort}/telnet`,
            `${serverUrl.replace(/^https?:\/\//, 'https://')}:${httpApiPort}/telnet`
        ];
        
        let lastError = null;
        
        for (const targetUrl of urls) {
            try {
                console.log(`🔗 Versuche Liquidsoap HTTP API: ${targetUrl}`);
                
                const response = await fetch(targetUrl, {
                    method: 'POST',
                    headers: {
                        'x-liquidsoap-api-key': apiKey,
                        'Content-Type': 'text/plain',
                        'User-Agent': 'WebDJ-SubCaster-Proxy'
                    },
                    body: command,
                    timeout: 5000
                });
                
                const responseText = await response.text();
                
                console.log(`✅ Liquidsoap Response (${response.status}): ${responseText.slice(0, 100)}`);
                
                return res.json({
                    success: response.ok,
                    status: response.status,
                    response: responseText,
                    usedUrl: targetUrl
                });
                
            } catch (error) {
                lastError = error;
                console.log(`❌ Liquidsoap API failed for ${targetUrl}: ${error.message}`);
                continue;
            }
        }
        
        // Alle URLs fehlgeschlagen
        throw new Error(`Alle Liquidsoap HTTP API URLs fehlgeschlagen. Letzter Fehler: ${lastError?.message}`);
        
    } catch (error) {
        console.error(`❌ AzuraCast Telnet Proxy Error:`, error.message);
        res.status(500).json({ 
            error: 'AzuraCast Telnet Proxy Error', 
            details: error.message 
        });
    }
});

// Harbor Stream Handler
app.post('/api/stream', async (req, res) => {
    console.log('📡 Incoming stream request');
    
    const chunks = [];
    
    req.on('data', (chunk) => {
        chunks.push(chunk);
    });
    
    req.on('end', async () => {
        const audioData = Buffer.concat(chunks);
        console.log(`🎵 Received audio chunk: ${audioData.length} bytes`);
        
        // Harbor-Verbindung aufbauen falls noch nicht vorhanden
        if (!harborSocket || harborSocket.destroyed) {
            try {
                await connectToHarbor(req.headers);
            } catch (error) {
                console.error('❌ Failed to connect to Harbor:', error);
                return res.status(504).json({ error: 'Gateway Timeout', details: error.message });
            }
        }
        
        // Audio-Daten an Harbor senden
        if (isConnected && harborSocket && !harborSocket.destroyed) {
            try {
                harborSocket.write(audioData);
                res.status(200).json({ 
                    status: 'ok', 
                    message: 'Audio data sent to Harbor',
                    bytes: audioData.length,
                    mountPoint: MOUNT_POINTS[currentMountIndex]
                });
            } catch (error) {
                console.error('❌ Failed to send audio to Harbor:', error);
                res.status(500).json({ error: 'Harbor Write Error', details: error.message });
            }
        } else {
            console.warn('⚠️  Harbor not connected, dropping audio data');
            res.status(503).json({ error: 'Harbor not connected' });
        }
    });
});

// Harbor Verbindung aufbauen
async function connectToHarbor(headers = {}) {
    return new Promise((resolve, reject) => {
        const SERVER_HOST = process.env.STREAM_SERVER || 'funkturm.radio-endstation.de';
        const SERVER_PORT = parseInt(process.env.STREAM_PORT || '8015', 10);
        const USERNAME = process.env.STREAM_USERNAME || 'test';
        const PASSWORD = process.env.STREAM_PASSWORD || 'test';
        
        const mountPoint = MOUNT_POINTS[currentMountIndex];
        
        console.log(`🔌 Connecting to Liquidsoap Harbor with mount: ${mountPoint}`);
        
        harborSocket = new net.Socket();
        
        harborSocket.connect(SERVER_PORT, SERVER_HOST, () => {
            console.log('✅ Connected to Harbor TCP socket');
            
            const credentials = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
            console.log(`🔐 Using auth header: Basic ${credentials}`);
            console.log(`🔐 Decoded credentials: ${USERNAME}:${PASSWORD}`);
            
            const sourceRequest = `SOURCE ${mountPoint} HTTP/1.0\r\nAuthorization: Basic ${credentials}\r\nUser-Agent: SubCaster-Harbor-Client\r\nContent-Type: audio/mpeg\r\n\r\n`;
            
            console.log(`📤 Sending SOURCE request: SOURCE ${mountPoint} HTTP/1.0`);
            harborSocket.write(sourceRequest);
        });
        
        harborSocket.on('data', (data) => {
            const response = data.toString();
            console.log(`📥 Harbor response: ${response.trim()}`);
            
            if (response.includes('200 OK')) {
                console.log(`✅ Harbor confirmed connection with mount: ${mountPoint}`);
                isConnected = true;
                resolve();
            } else if (response.includes('401') || response.includes('403')) {
                console.error('❌ Harbor authentication failed');
                reject(new Error('Authentication failed'));
            } else if (response.includes('404')) {
                console.warn(`⚠️  Mount point ${mountPoint} not found, trying next...`);
                currentMountIndex = (currentMountIndex + 1) % MOUNT_POINTS.length;
                if (currentMountIndex === 0) {
                    reject(new Error('All mount points failed'));
                } else {
                    harborSocket.destroy();
                    setTimeout(() => connectToHarbor(headers).then(resolve).catch(reject), 1000);
                }
            }
        });
        
        harborSocket.on('error', (error) => {
            console.error('❌ Harbor connection error:', error);
            isConnected = false;
            reject(error);
        });
        
        harborSocket.on('close', () => {
            console.log('🔌 Harbor connection closed');
            isConnected = false;
        });
    });
}

// Setup Wizard - Save Configuration Endpoint
app.post('/api/save-config', async (req, res) => {
    try {
        const { content, createBackup } = req.body;
        
        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid content provided' });
        }
        
        // In Docker: persistentes Volume verwenden, sonst aktuelles Verzeichnis
        const isDocker = process.env.DOCKER_ENV === 'true';
        const envDir = isDocker ? '/app/docker-data' : __dirname;
        const envPath = path.join(envDir, '.env');
        
        console.log(`📁 Using env path: ${envPath} (Docker: ${isDocker})`);
        
        // Verzeichnis erstellen falls nicht vorhanden
        if (isDocker) {
            await fs.mkdir('/app/docker-data', { recursive: true });
        }
        
        // Create backup if requested
        if (createBackup) {
            try {
                const existingContent = await fs.readFile(envPath, 'utf8');
                const backupPath = path.join(__dirname, `.env.backup.${Date.now()}`);
                await fs.writeFile(backupPath, existingContent, 'utf8');
                console.log(`📁 Backup created: ${backupPath}`);
            } catch (backupError) {
                console.warn('⚠️ Could not create backup:', backupError.message);
                // Continue anyway - backup is optional
            }
        }
        
        // Write new configuration
        await fs.writeFile(envPath, content, 'utf8');
        console.log('✅ Configuration saved to .env file');
        
        res.json({ 
            success: true, 
            message: 'Configuration saved successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Error saving configuration:', error);
        
        // Spezielle Behandlung für Permission-Fehler
        if (error.code === 'EACCES') {
            const fixCommand = isDocker 
                ? 'chmod 777 docker-data && chmod 666 docker-data/.env'
                : 'chmod 666 .env';
            
            return res.status(500).json({ 
                error: 'Permission denied', 
                details: `Cannot write to ${envPath}. Run: ${fixCommand}`,
                code: 'EACCES',
                suggestion: isDocker 
                    ? 'Run the docker-start.sh script which automatically fixes permissions'
                    : 'Ensure the .env file has write permissions'
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to save configuration', 
            details: error.message 
        });
    }
});

// Setup Wizard - Check Configuration Status
app.get('/api/setup-status', async (req, res) => {
    try {
        // In Docker: persistentes Volume verwenden, sonst aktuelles Verzeichnis
        const isDocker = process.env.DOCKER_ENV === 'true';
        const envDir = isDocker ? '/app/docker-data' : __dirname;
        const envPath = path.join(envDir, '.env');
        
        console.log(`📁 Checking env path: ${envPath} (Docker: ${isDocker})`);
        
        try {
            const envContent = await fs.readFile(envPath, 'utf8');
            const hasContent = envContent.trim().length > 0;
            
            // Parse env content to check for actual values
            const envLines = envContent.split('\n');
            const envVars = {};
            envLines.forEach(line => {
                const match = line.match(/^([^#=]+)=(.*)$/);
                if (match) {
                    envVars[match[1].trim()] = match[2].trim();
                }
            });
            
            // Check if services have basic configuration (URLs/servers configured, credentials can be empty)
            const hasOpenSubsonic = !!(envVars['VITE_OPENSUBSONIC_URL']);
                                       
            const hasAzuraCast = !!(envVars['VITE_AZURACAST_SERVERS']);
                                   
            const hasStreaming = !!(envVars['STREAM_SERVER']);
            
            // Check if any service URL/server is configured (credentials optional for runtime login)
            const isConfigured = hasOpenSubsonic || hasAzuraCast || hasStreaming;
            
            console.log(`🔍 Setup Status Check:`, {
                hasContent,
                opensubsonic: hasOpenSubsonic,
                azuracast: hasAzuraCast,
                streaming: hasStreaming,
                isConfigured
            });
            
            res.json({
                configExists: isConfigured,
                hasEnvFile: true,
                hasContent,
                services: {
                    opensubsonic: hasOpenSubsonic,
                    azuracast: hasAzuraCast,
                    streaming: hasStreaming
                },
                lastModified: (await fs.stat(envPath)).mtime
            });
        } catch (fileError) {
            res.json({
                configExists: false,
                hasEnvFile: false,
                hasContent: false,
                services: {
                    opensubsonic: false,
                    azuracast: false,
                    streaming: false
                }
            });
        }
    } catch (error) {
        console.error('❌ Error checking setup status:', error);
        res.status(500).json({ error: 'Failed to check setup status' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Unified SubCaster Server (Web + CORS Proxy)',
        harbor: isConnected ? 'connected' : 'disconnected',
        mountPoint: isConnected ? MOUNT_POINTS[currentMountIndex] : null,
        corsProxy: 'enabled'
    });
});

// Statische Dateien NACH den API-Routes
app.use(express.static(path.join(__dirname, 'dist'), {
    setHeaders: (res, path, stat) => {
        // Cache-Control für bessere Performance
        res.set('Cache-Control', 'public, max-age=31536000'); // 1 Jahr für Assets
        if (path.endsWith('.html')) {
            res.set('Cache-Control', 'no-cache'); // HTML nicht cachen
        }
    }
}));

// Error handling
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Unified SubCaster Server running on Port ${PORT}`);
    console.log(`🎯 Target: ${process.env.STREAM_SERVER || 'funkturm.radio-endstation.de'}:${process.env.STREAM_PORT || '8015'}`);
    console.log(`📡 CORS Proxy: /api/opensubsonic-stream, /api/opensubsonic-cover`);
    console.log(`🔄 Harbor Stream: /api/stream`);
    console.log(`🔄 Mount-Points: ${MOUNT_POINTS.join(', ')}`);
    console.log(`🚀 Server ready and listening...`);
});

server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

