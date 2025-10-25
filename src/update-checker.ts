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

    // Finde die Versions-Anzeige
    const versionDisplay = document.getElementById('version-display');
    if (!versionDisplay) {
      console.warn('⚠️ Version display not found');
      return;
    }

    // Erstelle kleines Update-Badge
    const updateBadge = document.createElement('div');
    updateBadge.id = 'update-badge';
    updateBadge.style.cssText = `
      position: fixed;
      bottom: 14px;
      right: 140px;
      z-index: 9999;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 6px 12px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      font-weight: bold;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
      animation: pulse 2s ease-in-out infinite;
      user-select: none;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.3s ease;
      pointer-events: auto;
    `;

    updateBadge.innerHTML = `
      <span style="font-size: 14px;">🚀</span>
      <span>UPDATE</span>
    `;

    // Hover-Effekt
    updateBadge.addEventListener('mouseenter', () => {
      updateBadge.style.transform = 'scale(1.1)';
      updateBadge.style.boxShadow = '0 4px 16px rgba(102, 126, 234, 0.6)';
    });
    
    updateBadge.addEventListener('mouseleave', () => {
      updateBadge.style.transform = 'scale(1)';
      updateBadge.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.4)';
    });

    // Click: Reload
    updateBadge.addEventListener('click', () => {
      window.location.reload();
    });

    // Animations-CSS hinzufügen
    if (!document.getElementById('update-badge-styles')) {
      const style = document.createElement('style');
      style.id = 'update-badge-styles';
      style.textContent = `
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.7;
          }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(updateBadge);

    console.log('� Update badge displayed - click to reload');
  }
}

// Singleton Instance
export const updateChecker = new UpdateChecker();
