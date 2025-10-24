/**
 * Update Checker - Prüft auf neue App-Versionen
 * Zeigt User-Prompt wenn neue Version verfügbar ist
 */

interface VersionInfo {
  version: string;
  gitCommit: string;
  buildDate: string;
}

class UpdateChecker {
  private currentVersion: VersionInfo | null = null;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 60000; // 1 Minute
  private updatePromptShown = false;

  /**
   * Startet den Update-Check Service
   */
  async start() {
    console.log('🔄 Starting update checker service...');
    
    // Initiale Version laden
    await this.fetchCurrentVersion();
    
    // Regelmäßig auf Updates prüfen
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, this.CHECK_INTERVAL);
    
    console.log(`✅ Update checker started (checking every ${this.CHECK_INTERVAL / 1000}s)`);
  }

  /**
   * Stoppt den Update-Check Service
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('⏹️ Update checker stopped');
    }
  }

  /**
   * Lädt die aktuelle Version vom Server
   */
  private async fetchCurrentVersion(): Promise<void> {
    try {
      const response = await fetch('/api/version');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const versionInfo: VersionInfo = await response.json();
      
      if (!this.currentVersion) {
        // Erste Ladung - speichere aktuelle Version
        this.currentVersion = versionInfo;
        console.log('📦 Current version:', versionInfo);
      } else if (this.currentVersion.gitCommit !== versionInfo.gitCommit) {
        // Version hat sich geändert!
        console.log('🆕 New version detected!', {
          old: this.currentVersion.gitCommit,
          new: versionInfo.gitCommit
        });
        
        this.showUpdatePrompt(versionInfo);
      }
    } catch (error) {
      console.error('❌ Failed to fetch version info:', error);
    }
  }

  /**
   * Prüft ob eine neue Version verfügbar ist
   */
  private async checkForUpdates(): Promise<void> {
    await this.fetchCurrentVersion();
  }

  /**
   * Zeigt User-Prompt für verfügbares Update
   */
  private showUpdatePrompt(newVersion: VersionInfo) {
    // Nur einmal anzeigen
    if (this.updatePromptShown) {
      return;
    }
    this.updatePromptShown = true;

    // Erstelle Update-Banner
    const banner = document.createElement('div');
    banner.id = 'update-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      text-align: center;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      animation: slideDown 0.3s ease-out;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    `;

    banner.innerHTML = `
      <div style="max-width: 800px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 20px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 24px;">🚀</span>
          <div style="text-align: left;">
            <div style="font-weight: 600; font-size: 16px; margin-bottom: 4px;">
              Neue Version verfügbar!
            </div>
            <div style="font-size: 13px; opacity: 0.9;">
              SubCaster wurde aktualisiert. Lade die Seite neu, um die neueste Version zu verwenden.
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 10px; flex-shrink: 0;">
          <button id="update-reload-btn" style="
            background: white;
            color: #667eea;
            border: none;
            padding: 10px 24px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          ">
            Jetzt neu laden
          </button>
          <button id="update-dismiss-btn" style="
            background: rgba(255,255,255,0.2);
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 10px 24px;
            border-radius: 6px;
            font-weight: 600;
            cursor: pointer;
            font-size: 14px;
            transition: all 0.2s;
          ">
            Später
          </button>
        </div>
      </div>
    `;

    // Animations-CSS hinzufügen
    if (!document.getElementById('update-banner-styles')) {
      const style = document.createElement('style');
      style.id = 'update-banner-styles';
      style.textContent = `
        @keyframes slideDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        
        #update-reload-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        
        #update-dismiss-btn:hover {
          background: rgba(255,255,255,0.3);
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(banner);

    // Event Listeners
    const reloadBtn = document.getElementById('update-reload-btn');
    const dismissBtn = document.getElementById('update-dismiss-btn');

    reloadBtn?.addEventListener('click', () => {
      console.log('🔄 User requested reload for update');
      window.location.reload();
    });

    dismissBtn?.addEventListener('click', () => {
      console.log('⏭️ User dismissed update prompt');
      banner.style.animation = 'slideDown 0.3s ease-out reverse';
      setTimeout(() => {
        banner.remove();
        // Erlaube erneutes Anzeigen nach 5 Minuten
        setTimeout(() => {
          this.updatePromptShown = false;
        }, 300000);
      }, 300);
    });

    // Auto-dismiss nach 30 Sekunden (sanft ausblenden)
    setTimeout(() => {
      if (banner.parentNode) {
        banner.style.opacity = '0.7';
      }
    }, 30000);
  }
}

// Singleton Instance
export const updateChecker = new UpdateChecker();
