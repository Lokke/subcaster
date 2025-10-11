// OpenSubsonic API Client für SubCaster
// Server: https://musik.radio-endstation.de
// Credentials: a/b

interface OpenSubsonicConfig {
  serverUrl: string;
  username: string;
  password: string;
}

interface OpenSubsonicAuth {
  token: string;
  salt: string;
}

interface OpenSubsonicArtistRef {
  id: string;
  name: string;
}

interface OpenSubsonicSong {
  id: string;
  title: string;
  artist: string;  // Fallback string für Kompatibilität
  album: string;
  albumId?: string;  // Album ID falls verfügbar
  duration: number;
  size: number;
  suffix: string;
  bitRate: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  userRating?: number;  // 1-5 stars rating
  playCount?: number;  // Play count für Statistics
  artists?: OpenSubsonicArtistRef[];  // Array von Artists mit ID und Name
  albumArtists?: OpenSubsonicArtistRef[];  // Array von Album Artists
  displayArtist?: string;  // Anzeige-String für Artists
  displayAlbumArtist?: string;  // Anzeige-String für Album Artists
}

interface OpenSubsonicAlbum {
  id: string;
  name: string;
  artist: string;
  artistId: string;
  songCount: number;
  duration: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  created?: string;  // Creation date for newest albums
  artists?: OpenSubsonicArtistRef[];  // Multi-artist support
  albumArtists?: OpenSubsonicArtistRef[];  // Multi-album-artist support
}

interface OpenSubsonicArtist {
  id: string;
  name: string;
  albumCount: number;
  starred?: string;
  coverArt?: string;  // Cover art from first album
  artistImageUrl?: string;  // Direct artist image URL from API
}

interface OpenSubsonicSearchResult {
  song?: OpenSubsonicSong[];
  album?: OpenSubsonicAlbum[];
  artist?: OpenSubsonicArtist[];
}

interface OpenSubsonicPlaylist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount: number;
  duration: number;
  created?: string;
  changed?: string;
  coverArt?: string;
  allowedUser?: string[];
  entry?: OpenSubsonicSong[];
}

class SubsonicApiClient {
  private config: OpenSubsonicConfig;
  private auth: OpenSubsonicAuth | null = null;

  constructor(config: OpenSubsonicConfig) {
    this.config = config;
  }

  // Get current username
  getUsername(): string {
    return this.config.username;
  }

  // MD5 Hash Funktion für Authentifizierung (echte MD5-Implementierung)
  private md5(text: string): string {
    // Echte MD5-Implementierung für korrekte OpenSubsonic-Authentifizierung
    function rotateLeft(lValue: number, iShiftBits: number): number {
      return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }

    function addUnsigned(lX: number, lY: number): number {
      const lX4 = (lX & 0x40000000);
      const lY4 = (lY & 0x40000000);
      const lX8 = (lX & 0x80000000);
      const lY8 = (lY & 0x80000000);
      const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
      if (lX4 & lY4) {
        return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
      }
      if (lX4 | lY4) {
        if (lResult & 0x40000000) {
          return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
        } else {
          return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
        }
      } else {
        return (lResult ^ lX8 ^ lY8);
      }
    }

    function F(x: number, y: number, z: number): number {
      return (x & y) | ((~x) & z);
    }

    function G(x: number, y: number, z: number): number {
      return (x & z) | (y & (~z));
    }

    function H(x: number, y: number, z: number): number {
      return (x ^ y ^ z);
    }

    function I(x: number, y: number, z: number): number {
      return (y ^ (x | (~z)));
    }

    function FF(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function GG(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function HH(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function II(a: number, b: number, c: number, d: number, x: number, s: number, ac: number): number {
      a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
      return addUnsigned(rotateLeft(a, s), b);
    }

    function convertToWordArray(string: string): number[] {
      let lWordCount;
      const lMessageLength = string.length;
      const lNumberOfWords_temp1 = lMessageLength + 8;
      const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
      const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
      const lWordArray = Array(lNumberOfWords - 1);
      let lBytePosition = 0;
      let lByteCount = 0;
      while (lByteCount < lMessageLength) {
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
        lByteCount++;
      }
      lWordCount = (lByteCount - (lByteCount % 4)) / 4;
      lBytePosition = (lByteCount % 4) * 8;
      lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
      lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
      lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
      return lWordArray;
    }

    function wordToHex(lValue: number): string {
      let WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
      for (lCount = 0; lCount <= 3; lCount++) {
        lByte = (lValue >>> (lCount * 8)) & 255;
        WordToHexValue_temp = "0" + lByte.toString(16);
        WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
      }
      return WordToHexValue;
    }

    const x = convertToWordArray(text);
    let a = 0x67452301;
    let b = 0xEFCDAB89;
    let c = 0x98BADCFE;
    let d = 0x10325476;

    for (let k = 0; k < x.length; k += 16) {
      const AA = a;
      const BB = b;
      const CC = c;
      const DD = d;
      a = FF(a, b, c, d, x[k + 0], 7, 0xD76AA478);
      d = FF(d, a, b, c, x[k + 1], 12, 0xE8C7B756);
      c = FF(c, d, a, b, x[k + 2], 17, 0x242070DB);
      b = FF(b, c, d, a, x[k + 3], 22, 0xC1BDCEEE);
      a = FF(a, b, c, d, x[k + 4], 7, 0xF57C0FAF);
      d = FF(d, a, b, c, x[k + 5], 12, 0x4787C62A);
      c = FF(c, d, a, b, x[k + 6], 17, 0xA8304613);
      b = FF(b, c, d, a, x[k + 7], 22, 0xFD469501);
      a = FF(a, b, c, d, x[k + 8], 7, 0x698098D8);
      d = FF(d, a, b, c, x[k + 9], 12, 0x8B44F7AF);
      c = FF(c, d, a, b, x[k + 10], 17, 0xFFFF5BB1);
      b = FF(b, c, d, a, x[k + 11], 22, 0x895CD7BE);
      a = FF(a, b, c, d, x[k + 12], 7, 0x6B901122);
      d = FF(d, a, b, c, x[k + 13], 12, 0xFD987193);
      c = FF(c, d, a, b, x[k + 14], 17, 0xA679438E);
      b = FF(b, c, d, a, x[k + 15], 22, 0x49B40821);
      a = GG(a, b, c, d, x[k + 1], 5, 0xF61E2562);
      d = GG(d, a, b, c, x[k + 6], 9, 0xC040B340);
      c = GG(c, d, a, b, x[k + 11], 14, 0x265E5A51);
      b = GG(b, c, d, a, x[k + 0], 20, 0xE9B6C7AA);
      a = GG(a, b, c, d, x[k + 5], 5, 0xD62F105D);
      d = GG(d, a, b, c, x[k + 10], 9, 0x2441453);
      c = GG(c, d, a, b, x[k + 15], 14, 0xD8A1E681);
      b = GG(b, c, d, a, x[k + 4], 20, 0xE7D3FBC8);
      a = GG(a, b, c, d, x[k + 9], 5, 0x21E1CDE6);
      d = GG(d, a, b, c, x[k + 14], 9, 0xC33707D6);
      c = GG(c, d, a, b, x[k + 3], 14, 0xF4D50D87);
      b = GG(b, c, d, a, x[k + 8], 20, 0x455A14ED);
      a = GG(a, b, c, d, x[k + 13], 5, 0xA9E3E905);
      d = GG(d, a, b, c, x[k + 2], 9, 0xFCEFA3F8);
      c = GG(c, d, a, b, x[k + 7], 14, 0x676F02D9);
      b = GG(b, c, d, a, x[k + 12], 20, 0x8D2A4C8A);
      a = HH(a, b, c, d, x[k + 5], 4, 0xFFFA3942);
      d = HH(d, a, b, c, x[k + 8], 11, 0x8771F681);
      c = HH(c, d, a, b, x[k + 11], 16, 0x6D9D6122);
      b = HH(b, c, d, a, x[k + 14], 23, 0xFDE5380C);
      a = HH(a, b, c, d, x[k + 1], 4, 0xA4BEEA44);
      d = HH(d, a, b, c, x[k + 4], 11, 0x4BDECFA9);
      c = HH(c, d, a, b, x[k + 7], 16, 0xF6BB4B60);
      b = HH(b, c, d, a, x[k + 10], 23, 0xBEBFBC70);
      a = HH(a, b, c, d, x[k + 13], 4, 0x289B7EC6);
      d = HH(d, a, b, c, x[k + 0], 11, 0xEAA127FA);
      c = HH(c, d, a, b, x[k + 3], 16, 0xD4EF3085);
      b = HH(b, c, d, a, x[k + 6], 23, 0x4881D05);
      a = HH(a, b, c, d, x[k + 9], 4, 0xD9D4D039);
      d = HH(d, a, b, c, x[k + 12], 11, 0xE6DB99E5);
      c = HH(c, d, a, b, x[k + 15], 16, 0x1FA27CF8);
      b = HH(b, c, d, a, x[k + 2], 23, 0xC4AC5665);
      a = II(a, b, c, d, x[k + 0], 6, 0xF4292244);
      d = II(d, a, b, c, x[k + 7], 10, 0x432AFF97);
      c = II(c, d, a, b, x[k + 14], 15, 0xAB9423A7);
      b = II(b, c, d, a, x[k + 5], 21, 0xFC93A039);
      a = II(a, b, c, d, x[k + 12], 6, 0x655B59C3);
      d = II(d, a, b, c, x[k + 3], 10, 0x8F0CCC92);
      c = II(c, d, a, b, x[k + 10], 15, 0xFFEFF47D);
      b = II(b, c, d, a, x[k + 1], 21, 0x85845DD1);
      a = II(a, b, c, d, x[k + 8], 6, 0x6FA87E4F);
      d = II(d, a, b, c, x[k + 15], 10, 0xFE2CE6E0);
      c = II(c, d, a, b, x[k + 6], 15, 0xA3014314);
      b = II(b, c, d, a, x[k + 13], 21, 0x4E0811A1);
      a = II(a, b, c, d, x[k + 4], 6, 0xF7537E82);
      d = II(d, a, b, c, x[k + 11], 10, 0xBD3AF235);
      c = II(c, d, a, b, x[k + 2], 15, 0x2AD7D2BB);
      b = II(b, c, d, a, x[k + 9], 21, 0xEB86D391);
      a = addUnsigned(a, AA);
      b = addUnsigned(b, BB);
      c = addUnsigned(c, CC);
      d = addUnsigned(d, DD);
    }

    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
  }

  // Authentifizierung mit OpenSubsonic
  async authenticate(): Promise<boolean> {
    try {
      // Generiere Salt (random string)
      const salt = Math.random().toString(36).substring(2, 15);
      
      // Erstelle Token: md5(password + salt)
      const passwordSaltCombo = this.config.password + salt;
      const token = this.md5(passwordSaltCombo);
      
      console.log(`🔐 Auth Debug: password="${this.config.password}", salt="${salt}"`);
      console.log(`🔐 Auth Debug: password+salt="${passwordSaltCombo}"`);
      console.log(`🔐 Auth Debug: token="${token}"`);
      
      this.auth = { token, salt };

      // Teste Authentifizierung mit ping
      const response = await this.makeRequest('ping');
      return response.status === 'ok';
    } catch (error) {
      console.error('OpenSubsonic Authentication failed:', error);
      return false;
    }
  }

  // HTTP Request zu OpenSubsonic API
  private async makeRequest(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.auth) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    const baseParams = {
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      f: 'json',
      v: '1.16.1',
      c: 'SubCaster'
    };

    const allParams = { ...baseParams, ...params };
    const queryString = new URLSearchParams(allParams).toString();
    const url = `${this.config.serverUrl}/rest/${method}?${queryString}`;

    console.log('🌐 OpenSubsonic API Request:', method, 'URL:', url.split('?')[0]);
    console.log('📋 Parameters:', Object.keys(allParams));

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        mode: 'cors' // Explizit CORS-Modus setzen
      });

      console.log('📥 Response status:', response.status, response.statusText);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      console.log('📦 Response data received');
      
      if (data['subsonic-response'].status !== 'ok') {
        const errorMsg = data['subsonic-response'].error?.message || 'Unknown error';
        console.error('🚫 OpenSubsonic API error:', errorMsg);
        throw new Error(`OpenSubsonic API error: ${errorMsg}`);
      }

      return data['subsonic-response'];
    } catch (fetchError) {
      console.error('🚨 Fetch error:', fetchError);
      throw fetchError;
    }
  }

  // Suche nach Songs, Alben, Künstlern
  async search(query: string, songCount = 20, albumCount = 10, artistCount = 10): Promise<OpenSubsonicSearchResult> {
    const response = await this.makeRequest('search3', {
      query,
      songCount,
      albumCount,
      artistCount
    });

    return response.searchResult3 || {};
  }

  // Alle Songs abrufen (paginiert)
  async getSongs(size = 50, offset = 0): Promise<OpenSubsonicSong[]> {
    const response = await this.makeRequest('getSong', { size, offset });
    return response.song || [];
  }

  // Alle Alben abrufen
  async getAlbums(size = 50, offset = 0): Promise<OpenSubsonicAlbum[]> {
    const response = await this.makeRequest('getAlbumList', { 
      type: 'alphabeticalByName',
      size, 
      offset 
    });
    return response.albumList?.album || [];
  }

  // Album-Listen nach Typ (getAlbumList2)
  async getAlbumList2(type: 'random' | 'newest' | 'highest' | 'frequent' | 'recent' | 'alphabeticalByName' | 'alphabeticalByArtist' | 'starred', size = 50, offset = 0): Promise<OpenSubsonicAlbum[]> {
    const response = await this.makeRequest('getAlbumList2', { 
      type, 
      size, 
      offset 
    });
    return response.albumList2?.album || [];
  }

  // Ähnliche Songs basierend auf Artist ID
  async getSimilarSongs2(songId: string, count = 50): Promise<OpenSubsonicSong[]> {
    const response = await this.makeRequest('getSimilarSongs2', { 
      id: songId, 
      count 
    });
    return response.similarSongs2?.song || [];
  }

  // Alle Künstler abrufen
  async getArtists(): Promise<OpenSubsonicArtist[]> {
    const response = await this.makeRequest('getArtists');
    const indexes = response.artists?.index || [];
    const artists: OpenSubsonicArtist[] = [];
    
    indexes.forEach((index: any) => {
      if (index.artist) {
        artists.push(...index.artist);
      }
    });
    
    return artists;
  }

  // Songs eines Albums abrufen
  async getAlbumSongs(albumId: string): Promise<OpenSubsonicSong[]> {
    const response = await this.makeRequest('getAlbum', { id: albumId });
    return response.album?.song || [];
  }

  // Songs eines Artists abrufen (Top Songs)
  async getArtistSongs(artistId: string): Promise<OpenSubsonicSong[]> {
    try {
      // Versuche zuerst mit Artist ID über getArtistInfo2
      const response = await this.makeRequest('getArtistInfo2', { id: artistId });
      if (response.artistInfo2?.topSongs?.song) {
        return response.artistInfo2.topSongs.song;
      }
    } catch (error) {
      console.log('getArtistInfo2 failed, trying alternative approach');
    }

    try {
      // Alternative: Alle Songs suchen und nach Artist filtern
      // Zuerst Artist-Info holen für den Namen
      const artistResponse = await this.makeRequest('getArtist', { id: artistId });
      const artistName = artistResponse.artist?.name;
      
      if (artistName) {
        // TopSongs mit Artist-Namen abrufen
        const topSongsResponse = await this.makeRequest('getTopSongs', { artist: artistName });
        return topSongsResponse.topSongs?.song || [];
      }
    } catch (error) {
      console.log('getTopSongs failed, trying search approach');
    }

    try {
      // Fallback: Search verwenden
      const artistResponse = await this.makeRequest('getArtist', { id: artistId });
      const artistName = artistResponse.artist?.name;
      
      if (artistName) {
        const searchResponse = await this.makeRequest('search3', { 
          query: artistName,
          songCount: 20,
          albumCount: 0,
          artistCount: 0
        });
        return searchResponse.searchResult3?.song || [];
      }
    } catch (error) {
      console.error('All methods failed for getArtistSongs:', error);
    }

    return [];
  }

  // Albums eines Artists abrufen
  async getArtistAlbums(artistId: string): Promise<OpenSubsonicAlbum[]> {
    const response = await this.makeRequest('getArtist', { id: artistId });
    return response.artist?.album || [];
  }

  // Get artist cover art from first album (ohne Cache)
  async getArtistCoverArt(artistId: string): Promise<string | null> {
    try {
      const albums = await this.getArtistAlbums(artistId);
      if (albums.length > 0 && albums[0].coverArt) {
        return albums[0].coverArt;
      }
      return null;
    } catch (error) {
      console.error('Error getting artist cover art:', error);
      return null;
    }
  }

  // Get artist image URL directly
  async getArtistImage(artistId: string, size = 300): Promise<string> {
    if (!artistId) {
      return '';
    }
    
    try {
      // Versuche Cover Art vom ersten Album zu bekommen
      const coverArtId = await this.getArtistCoverArt(artistId);
      
      if (coverArtId) {
        return this.getCoverArtUrl(coverArtId, size);
      }
      
      return '';
      
    } catch (error) {
      console.error(`❌ Failed to load artist image for ${artistId}:`, error);
      return '';
    }
  }

  // Get single artist by ID
  async getArtist(artistId: string): Promise<OpenSubsonicArtist | null> {
    try {
      const response = await this.makeRequest('getArtist', { id: artistId });
      return response.artist || null;
    } catch (error) {
      console.error('Error getting artist by ID:', error);
      return null;
    }
  }

  // Alle Alben finden, auf denen ein Künstler vorkommt (auch Sampler)
  async getAllAlbumsWithArtist(artistName: string): Promise<OpenSubsonicAlbum[]> {
    try {
      // Suche nach Songs des Künstlers, um alle Alben zu finden
      const searchResponse = await this.makeRequest('search3', { 
        query: artistName,
        songCount: 500,  // Mehr Songs für bessere Abdeckung
        albumCount: 200
      });
      
      const songs = searchResponse.searchResult3?.song || [];
      
      // Sammle alle Album-Namen aus Songs wo der Künstler beteiligt ist
      const albumNames = new Set<string>();
      
      songs.forEach((song: OpenSubsonicSong) => {
        // Prüfe ob der Künstler in Artist-Field vorkommt (exakter Match oder Teil)
        if (song.artist && song.artist.toLowerCase().includes(artistName.toLowerCase())) {
          if (song.album) {
            albumNames.add(song.album);
          }
        }
      });
      
      // Jetzt suche nach jedem Album-Namen um die Album-Details zu bekommen
      const albums: OpenSubsonicAlbum[] = [];
      const albumSet = new Set<string>(); // Duplikate vermeiden
      
      for (const albumName of albumNames) {
        try {
          const albumSearchResponse = await this.makeRequest('search3', { 
            query: albumName,
            albumCount: 50
          });
          
          const foundAlbums = albumSearchResponse.searchResult3?.album || [];
          foundAlbums.forEach((album: OpenSubsonicAlbum) => {
            // Nur hinzufügen wenn exakter Album-Name Match
            if (album.name.toLowerCase() === albumName.toLowerCase() && !albumSet.has(album.id)) {
              albums.push(album);
              albumSet.add(album.id);
            }
          });
        } catch (error) {
          console.warn(`Failed to search for album ${albumName}:`, error);
        }
      }
      
      return albums;
    } catch (error) {
      console.error('Error searching for albums with artist:', error);
      return [];
    }
  }

  // Album-Informationen abrufen
  async getAlbumInfo(albumId: string): Promise<OpenSubsonicAlbum | null> {
    const response = await this.makeRequest('getAlbum', { id: albumId });
    return response.album || null;
  }

  // Stream URL für einen Song erstellen
  getStreamUrl(songId: string): string {
    if (!this.auth) {
      throw new Error('Not authenticated');
    }

    const params = new URLSearchParams({
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      v: '1.16.1',
      c: 'SubCaster',
      id: songId
    });

    // Ursprüngliche OpenSubsonic URL
    const originalUrl = `${this.config.serverUrl}/rest/stream?${params.toString()}`;
    
    // CORS-Fix: Über SAME-ORIGIN API Route leiten (löst Cross-Origin Problem)
    const proxiedUrl = `/api/opensubsonic-stream?url=${encodeURIComponent(originalUrl)}`;
    
    console.log(`🎵 Stream URL (same-origin): ${proxiedUrl}`);
    return proxiedUrl;
  }

  // Cover Art URL erstellen (ohne Cache)
  getCoverArtUrl(coverArtId: string, size = 300): string {
    if (!this.auth || !coverArtId) {
      return '';
    }

    const params = new URLSearchParams({
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      v: '1.16.1',
      c: 'SubCaster',
      id: coverArtId,
      size: size.toString()
    });

    // Ursprüngliche Cover Art URL
    const originalUrl = `${this.config.serverUrl}/rest/getCoverArt?${params.toString()}`;
    
    // CORS-Fix: Über SAME-ORIGIN API Route leiten (löst Cross-Origin Problem)
    const proxiedUrl = `/api/opensubsonic-cover?url=${encodeURIComponent(originalUrl)}`;
    
    return proxiedUrl;
  }



  // Download URL für einen Song
  getDownloadUrl(songId: string): string {
    if (!this.auth) {
      throw new Error('Not authenticated');
    }

    const params = new URLSearchParams({
      u: this.config.username,
      t: this.auth.token,
      s: this.auth.salt,
      v: '1.16.1',
      c: 'SubCaster',
      id: songId
    });

    return `${this.config.serverUrl}/rest/download?${params.toString()}`;
  }

  // Rating für einen Song setzen (1-5 Sterne)
  async setRating(songId: string, rating: number): Promise<boolean> {
    try {
      if (rating < 1 || rating > 5) {
        throw new Error('Rating must be between 1 and 5');
      }

      await this.makeRequest('setRating', { 
        id: songId, 
        rating: rating.toString() 
      });
      
      return true;
    } catch (error) {
      console.error('Error setting rating:', error);
      return false;
    }
  }

  // Rating für einen Song abrufen
  async getRating(songId: string): Promise<number | null> {
    try {
      const response = await this.makeRequest('getSong', { id: songId });
      return response.song?.userRating || null;
    } catch (error) {
      console.error('Error getting rating:', error);
      return null;
    }
  }

  // Get newest albums using getAlbumList2
  async getNewestAlbums(size = 20): Promise<OpenSubsonicAlbum[]> {
    try {
      console.log('🔗 API Call: getAlbumList2 with type=newest, size=' + size);
      
      const response = await this.makeRequest('getAlbumList2', { 
        type: 'newest',
        size: size.toString(),
        offset: '0'
      });
      
      const albums = response.albumList2?.album || [];
      console.log('📦 Newest Albums (getAlbumList2) returned:', albums.length, 'albums');
      
      return albums;
    } catch (error) {
      console.error('Error getting newest albums:', error);
      return [];
    }
  }

  // Zufällige Alben abrufen - using getAlbumList2 for consistency
  async getRandomAlbums(size = 20): Promise<OpenSubsonicAlbum[]> {
    try {
      console.log('🔗 API Call: getAlbumList2 with type=random, size=' + size);
      const response = await this.makeRequest('getAlbumList2', { 
        type: 'random',
        size: size.toString(),
        offset: '0'
      });
      
      const albums = response.albumList2?.album || [];
      console.log('📦 Random Albums (getAlbumList2) returned:', albums.length, 'albums');
      if (albums.length > 0) {
        console.log('📝 First album from API:', albums[0]);
        console.log('🎲 Random sample of albums returned:', albums.slice(0, 5).map((a: any) => a.name));
      }
      
      return albums;
    } catch (error) {
      console.error('Error getting random albums:', error);
      return [];
    }
  }

  // Zufällige Künstler abrufen
  async getRandomArtists(size = 20): Promise<OpenSubsonicArtist[]> {
    try {
      // Da es keine direkte "random artists" API gibt, holen wir alle Künstler und mischen sie
      const allArtists = await this.getArtists();
      
      // Fisher-Yates Shuffle für echte Zufälligkeit
      const shuffled = [...allArtists];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      
      const selectedArtists = shuffled.slice(0, size);
      
      // Cover Art für Artists ohne artistImageUrl laden (parallel für bessere Performance)
      const artistsWithCover = await Promise.all(
        selectedArtists.map(async (artist) => {
          // Verwende artistImageUrl falls verfügbar, sonst lade Cover Art vom ersten Album
          if (artist.artistImageUrl) {
            return artist;
          } else {
            const coverArt = await this.getArtistCoverArt(artist.id);
            return { ...artist, coverArt: coverArt || undefined };
          }
        })
      );
      
      return artistsWithCover;
    } catch (error) {
      console.error('Error getting random artists:', error);
      return [];
    }
  }

  // Tracks eines Albums abrufen (Alias für getAlbumSongs)
  async getAlbumTracks(albumId: string): Promise<OpenSubsonicSong[]> {
    return this.getAlbumSongs(albumId);
  }

  // Spezielle API-Methoden für Ihr System
  async getMostPlayedSongs(count: number = 100): Promise<OpenSubsonicSong[]> {
    try {
      console.log(`🎵 Loading most played songs (count: ${count})`);
      
      if (!this.auth) {
        throw new Error('Not authenticated');
      }
      
      // Verwende getRandomSongs und filtere nach playCount als Fallback
      // Da getTopSongs einen artist Parameter erfordert
      const url = new URL(`${this.config.serverUrl}/rest/getRandomSongs`);
      url.searchParams.append('u', this.config.username);
      url.searchParams.append('t', this.auth.token);
      url.searchParams.append('s', this.auth.salt);
      url.searchParams.append('v', '1.16.1');
      url.searchParams.append('c', 'webdj');
      url.searchParams.append('f', 'json');
      url.searchParams.append('size', (count * 3).toString()); // Mehr laden um zu filtern
      
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data['subsonic-response']?.status !== 'ok') {
        throw new Error(data['subsonic-response']?.error?.message || 'API error');
      }

      let songs = data['subsonic-response']?.randomSongs?.song || [];
      
      // Sortiere nach playCount (falls verfügbar) und limitiere
      songs = songs
        .filter((song: any) => song.playCount && song.playCount > 0)
        .sort((a: any, b: any) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, count);
      
      // Falls nicht genug Songs mit playCount, fülle mit restlichen auf
      if (songs.length < count) {
        const remainingSongs = data['subsonic-response']?.randomSongs?.song || [];
        const additionalSongs = remainingSongs
          .filter((song: any) => !songs.find((s: any) => s.id === song.id))
          .slice(0, count - songs.length);
        songs = [...songs, ...additionalSongs];
      }
      
      console.log(`📦 Most played songs loaded: ${songs.length} songs`);
      
      // Transformiere die Daten in OpenSubsonicSong Format
      return songs.map((song: any) => ({
        id: song.id,
        title: song.title || song.name,
        artist: song.artist || song.artistName || 'Unknown Artist',
        album: song.album || song.albumName || 'Unknown Album',
        albumId: song.albumId,
        duration: song.duration || 0,
        size: song.size || 0,
        suffix: song.suffix || song.format || 'mp3',
        bitRate: song.bitRate || 0,
        year: song.year,
        genre: song.genre,
        coverArt: song.coverArt || song.albumArt,
        userRating: song.userRating,
        playCount: song.playCount
      }));
      
    } catch (error) {
      console.error('Failed to load most played songs:', error);
      return [];
    }
  }

  async getTopRatedSongs(count: number = 500): Promise<OpenSubsonicSong[]> {
    try {
      console.log(`⭐ Loading top rated songs (count: ${count})`);
      
      if (!this.auth) {
        throw new Error('Not authenticated');
      }
      
      // Für Top Rated verwenden wir getRandomSongs als Fallback
      // Da nicht alle Server getTopSongs unterstützen
      const url = new URL(`${this.config.serverUrl}/rest/getRandomSongs`);
      url.searchParams.append('u', this.config.username);
      url.searchParams.append('t', this.auth.token);
      url.searchParams.append('s', this.auth.salt);
      url.searchParams.append('v', '1.16.1');
      url.searchParams.append('c', 'webdj');
      url.searchParams.append('f', 'json');
      url.searchParams.append('size', count.toString());
      
      const response = await fetch(url.toString());

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (data['subsonic-response']?.status !== 'ok') {
        throw new Error(data['subsonic-response']?.error?.message || 'API error');
      }

      let songs = data['subsonic-response']?.randomSongs?.song || [];
      
      // Filtere Songs mit Rating > 0 und sortiere nach Rating
      songs = songs
        .filter((song: any) => song.userRating && song.userRating > 0)
        .sort((a: any, b: any) => (b.userRating || 0) - (a.userRating || 0))
        .slice(0, Math.min(count, 100)); // Limitiere auf 100 um Performance zu gewährleisten
      
      console.log(`📦 Top rated songs loaded: ${songs.length} songs`);
      
      // Transformiere die Daten in OpenSubsonicSong Format
      return songs.map((song: any) => ({
        id: song.id,
        title: song.title || song.name,
        artist: song.artist || song.artistName || 'Unknown Artist',
        album: song.album || song.albumName || 'Unknown Album',
        albumId: song.albumId,
        duration: song.duration || 0,
        size: song.size || 0,
        suffix: song.suffix || song.format || 'mp3',
        bitRate: song.bitRate || 0,
        year: song.year,
        genre: song.genre,
        coverArt: song.coverArt || song.albumArt,
        userRating: song.userRating,
        playCount: song.playCount
      }));
      
    } catch (error) {
      console.error('Failed to load top rated songs:', error);
      return [];
    }
  }

  // Get all playlists
  async getPlaylists(): Promise<OpenSubsonicPlaylist[]> {
    try {
      const response = await this.makeRequest('getPlaylists');
      const playlists = response.playlists?.playlist || [];
      
      console.log(`📋 Playlists loaded: ${playlists.length} playlists`);
      
      return playlists.map((playlist: any) => ({
        id: playlist.id,
        name: playlist.name,
        comment: playlist.comment,
        owner: playlist.owner,
        public: playlist.public,
        songCount: playlist.songCount || 0,
        duration: playlist.duration || 0,
        created: playlist.created,
        changed: playlist.changed,
        coverArt: playlist.coverArt
      }));
      
    } catch (error) {
      console.error('Failed to load playlists:', error);
      return [];
    }
  }

  // Get playlist details with songs
  async getPlaylist(playlistId: string): Promise<OpenSubsonicPlaylist | null> {
    try {
      const response = await this.makeRequest('getPlaylist', { id: playlistId });
      const playlist = response.playlist;
      
      if (!playlist) {
        return null;
      }
      
      console.log(`📋 Playlist loaded: ${playlist.name} with ${playlist.entry?.length || 0} songs`);
      
      return {
        id: playlist.id,
        name: playlist.name,
        comment: playlist.comment,
        owner: playlist.owner,
        public: playlist.public,
        songCount: playlist.songCount || 0,
        duration: playlist.duration || 0,
        created: playlist.created,
        changed: playlist.changed,
        coverArt: playlist.coverArt,
        entry: playlist.entry?.map((song: any) => ({
          id: song.id,
          title: song.title || song.name,
          artist: song.artist || song.artistName || 'Unknown Artist',
          album: song.album || song.albumName || 'Unknown Album',
          albumId: song.albumId,
          duration: song.duration || 0,
          size: song.size || 0,
          suffix: song.suffix || song.format || 'mp3',
          bitRate: song.bitRate || 0,
          year: song.year,
          genre: song.genre,
          coverArt: song.coverArt || song.albumArt,
          userRating: song.userRating,
          playCount: song.playCount
        })) || []
      };
      
    } catch (error) {
      console.error(`Failed to load playlist ${playlistId}:`, error);
      return null;
    }
  }

  // Find "Hausaufgaben" playlist (only for musik.radio-endstation.de)
  async getHausaufgabenPlaylist(): Promise<OpenSubsonicPlaylist | null> {
    // Only for the specific server
    if (!this.config.serverUrl.includes('musik.radio-endstation.de')) {
      return null;
    }

    try {
      const playlists = await this.getPlaylists();
      const hausaufgabenPlaylist = playlists.find(playlist => 
        playlist.name.toLowerCase().includes('hausaufgaben')
      );

      if (hausaufgabenPlaylist) {
        console.log(`🎯 Found Hausaufgaben playlist: ${hausaufgabenPlaylist.name}`);
        // Load full playlist with songs
        return await this.getPlaylist(hausaufgabenPlaylist.id);
      }

      return null;
    } catch (error) {
      console.error('Failed to find Hausaufgaben playlist:', error);
      return null;
    }
  }
}

// Exportiere für Verwendung in main.ts
export { SubsonicApiClient, type OpenSubsonicSong, type OpenSubsonicAlbum, type OpenSubsonicArtist, type OpenSubsonicSearchResult, type OpenSubsonicPlaylist, type OpenSubsonicArtistRef };