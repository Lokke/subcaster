/**
 * Setup Wizard - Guided Setup for SubCaster
 * Creates and manages a user-friendly initial configuration
 */

interface SetupConfig {
  // Unified Login Configuration
  unifiedLogin?: {
    enabled: boolean;
    username: string;
    password: string;
  };
  
  // OpenSubsonic Configuration
  opensubsonic?: {
    url: string;
    username: string;
    password: string;
  };
  
  // AzuraCast Configuration
  azuracast?: {
    servers: string;
    stationId: number;
    username: string;
    password: string;
  };
  
  // Discord Wishbox Configuration (Optional)
  discord?: {
    enabled: boolean;
    token: string;
    channelId: string;
    guildId: string;
  };
  
  // Streaming Configuration
  streaming: {
    bitrate: number;
    sampleRate: number;
    server: string;
    port: number;
    username: string;
    password: string;
  };
}

class SetupWizard {
  private currentStep = 1;
  private maxSteps = 5;
  private isDemo = false;
  private config: SetupConfig = { streaming: { bitrate: 128, sampleRate: 44100, server: '', port: 8000, username: '', password: '' } };
  
  // DOM Elements
  private overlay!: HTMLElement;
  private choiceContainer!: HTMLElement;
  private progressContainer!: HTMLElement;
  private stepContents!: NodeListOf<HTMLElement>;
  private stepIndicators!: NodeListOf<HTMLElement>;
  private backBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private finishBtn!: HTMLButtonElement;
  private skipBtn!: HTMLButtonElement;
  private summaryContainer!: HTMLElement;
  private demoBtn!: HTMLButtonElement;
  private customBtn!: HTMLButtonElement;

  constructor() {
    this.initializeElements();
    this.attachEventListeners();
    this.initializeStartView();
  }

  private initializeStartView(): void {
    // Show choice container, hide progress and steps initially
    this.choiceContainer.style.display = 'flex';
    this.progressContainer.style.display = 'none';
    
    // Hide all step contents initially
    this.stepContents.forEach(content => {
      content.classList.remove('active');
    });
  }

  private initializeElements(): void {
    console.log('🔍 Initializing Setup Wizard elements...');
    
    // Check DOM state first
    console.log('🔍 DOM readyState:', document.readyState);
    console.log('🔍 Document body exists:', !!document.body);
    
    // Try to find each element with detailed logging
    console.log('🔍 Looking for setup-wizard-overlay...');
    this.overlay = document.getElementById('setup-wizard-overlay')!;
    console.log('🔍 Overlay found:', !!this.overlay, this.overlay);
    
    console.log('🔍 Looking for setup-choice...');
    this.choiceContainer = document.getElementById('setup-choice')!;
    console.log('🔍 Choice container found:', !!this.choiceContainer, this.choiceContainer);
    
    console.log('🔍 Looking for setup-progress...');
    this.progressContainer = document.getElementById('setup-progress')!;
    console.log('🔍 Progress container found:', !!this.progressContainer, this.progressContainer);
    
    console.log('🔍 Looking for .setup-step-content elements...');
    this.stepContents = document.querySelectorAll('.setup-step-content');
    console.log('🔍 Step contents found:', this.stepContents.length, this.stepContents);
    
    console.log('🔍 Looking for .setup-step elements...');
    this.stepIndicators = document.querySelectorAll('.setup-step');
    console.log('🔍 Step indicators found:', this.stepIndicators.length, this.stepIndicators);
    
    console.log('🔍 Looking for setup-back-btn...');
    this.backBtn = document.getElementById('setup-back-btn') as HTMLButtonElement;
    console.log('🔍 Back button found:', !!this.backBtn, this.backBtn);
    
    console.log('🔍 Looking for setup-next-btn...');
    this.nextBtn = document.getElementById('setup-next-btn') as HTMLButtonElement;
    console.log('🔍 Next button found:', !!this.nextBtn, this.nextBtn);
    
    console.log('🔍 Looking for setup-finish-btn...');
    this.finishBtn = document.getElementById('setup-finish-btn') as HTMLButtonElement;
    console.log('🔍 Finish button found:', !!this.finishBtn, this.finishBtn);
    
    console.log('🔍 Looking for setup-skip-btn...');
    this.skipBtn = document.getElementById('setup-skip-btn') as HTMLButtonElement;
    console.log('🔍 Skip button found:', !!this.skipBtn, this.skipBtn);
    
    console.log('🔍 Looking for setup-summary...');
    this.summaryContainer = document.getElementById('setup-summary')!;
    console.log('🔍 Summary container found:', !!this.summaryContainer, this.summaryContainer);
    
    console.log('🔍 Looking for setup-demo-btn...');
    this.demoBtn = document.getElementById('setup-demo-btn') as HTMLButtonElement;
    console.log('🔍 Demo button found:', !!this.demoBtn, this.demoBtn);
    if (this.demoBtn) {
      console.log('🔍 Demo button details:', {
        id: this.demoBtn.id,
        className: this.demoBtn.className,
        textContent: this.demoBtn.textContent,
        outerHTML: this.demoBtn.outerHTML,
        offsetParent: this.demoBtn.offsetParent,
        style: this.demoBtn.style.cssText,
        computedStyle: window.getComputedStyle(this.demoBtn).display
      });
    }
    
    console.log('🔍 Looking for setup-custom-btn...');
    this.customBtn = document.getElementById('setup-custom-btn') as HTMLButtonElement;
    console.log('🔍 Custom button found:', !!this.customBtn, this.customBtn);
    if (this.customBtn) {
      console.log('🔍 Custom button details:', {
        id: this.customBtn.id,
        className: this.customBtn.className,
        textContent: this.customBtn.textContent,
        outerHTML: this.customBtn.outerHTML,
        offsetParent: this.customBtn.offsetParent,
        style: this.customBtn.style.cssText,
        computedStyle: window.getComputedStyle(this.customBtn).display
      });
    }
    
    // Comprehensive summary
    const elementSummary = {
      overlay: !!this.overlay,
      choiceContainer: !!this.choiceContainer,
      progressContainer: !!this.progressContainer,
      stepContents: this.stepContents.length,
      stepIndicators: this.stepIndicators.length,
      backBtn: !!this.backBtn,
      nextBtn: !!this.nextBtn,
      finishBtn: !!this.finishBtn,
      skipBtn: !!this.skipBtn,
      summaryContainer: !!this.summaryContainer,
      demoBtn: !!this.demoBtn,
      customBtn: !!this.customBtn
    };
    
    console.log('🔍 Element initialization summary:', elementSummary);
    console.log(`✅ Found ${this.stepContents.length} step contents, ${this.stepIndicators.length} indicators`);
    
    // Enhanced error logging
    if (!this.overlay) console.error('❌ Overlay not found! Check if setup-wizard-overlay exists in HTML');
    if (!this.choiceContainer) console.error('❌ Choice container not found! Check if setup-choice exists in HTML');
    if (!this.progressContainer) console.error('❌ Progress container not found! Check if setup-progress exists in HTML');
    if (!this.nextBtn) console.error('❌ Next button not found! Check if setup-next-btn exists in HTML');
    if (!this.demoBtn) console.error('❌ Demo button not found! Check if setup-demo-btn exists in HTML');
    if (!this.customBtn) console.error('❌ Custom button not found! Check if setup-custom-btn exists in HTML');
    if (!this.summaryContainer) console.error('❌ Summary container not found! Check if setup-summary exists in HTML');
    
    // Query all elements with setup- prefix for debugging
    console.log('🔍 All elements with setup- prefix:');
    const allSetupElements = document.querySelectorAll('[id^="setup-"]');
    allSetupElements.forEach((el, index) => {
      console.log(`${index + 1}. #${el.id}:`, el);
    });
  }

  private attachEventListeners(): void {
    console.log('🔧 Attaching Setup Wizard event listeners...');
    
    // Demo and Custom setup buttons
    if (this.demoBtn) {
      this.demoBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startDemoSetup();
      });
    }
    
    if (this.customBtn) {
      this.customBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.startCustomSetup();
      });
    }
    
    if (this.backBtn) {
      this.backBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.previousStep();
      });
    }
    
    if (this.nextBtn) {
      this.nextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.nextStep();
      });
    }
    
    if (this.finishBtn) {
      this.finishBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.finishSetup();
      });
    }
    
    if (this.skipBtn) {
      this.skipBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.skipSetup();
      });
    }

    // Auto-fill validation listeners
    this.addValidationListeners();
    
    // Discord Wishbox handlers
    this.addDiscordHandlers();
  }

  private addValidationListeners(): void {
    // OpenSubsonic validation
    const opensubsonicUrl = document.getElementById('setup-opensubsonic-url') as HTMLInputElement;
    const opensubsonicUsername = document.getElementById('setup-opensubsonic-username') as HTMLInputElement;
    const opensubsonicPassword = document.getElementById('setup-opensubsonic-password') as HTMLInputElement;

    if (opensubsonicUrl) {
      opensubsonicUrl.addEventListener('blur', () => this.validateUrl(opensubsonicUrl));
    }

    // AzuraCast validation
    const azuracastServers = document.getElementById('setup-azuracast-servers') as HTMLInputElement;
    if (azuracastServers) {
      azuracastServers.addEventListener('blur', () => this.validateUrls(azuracastServers));
    }

    // Unified Login handling
    this.addUnifiedLoginHandlers();
  }

  private addUnifiedLoginHandlers(): void {
    const unifiedLoginCheckbox = document.getElementById('setup-use-unified-login') as HTMLInputElement;
    const unifiedCredentials = document.getElementById('setup-unified-credentials') as HTMLElement;
    const individualCredentials = document.getElementById('setup-individual-credentials') as HTMLElement;
    const individualAzuracastCredentials = document.getElementById('setup-individual-azuracast-credentials') as HTMLElement;

    if (!unifiedLoginCheckbox) return;

    unifiedLoginCheckbox.addEventListener('change', () => {
      const isUnified = unifiedLoginCheckbox.checked;
      
      // Show/hide credential sections
      if (unifiedCredentials) {
        unifiedCredentials.style.display = isUnified ? 'block' : 'none';
      }
      if (individualCredentials) {
        individualCredentials.style.display = isUnified ? 'none' : 'block';
      }
      if (individualAzuracastCredentials) {
        individualAzuracastCredentials.style.display = isUnified ? 'none' : 'block';
      }

      // Clear fields when switching
      this.clearCredentialFields(isUnified);
    });

    // Auto-sync unified credentials to individual fields when typing
    const unifiedUsername = document.getElementById('setup-unified-username') as HTMLInputElement;
    const unifiedPassword = document.getElementById('setup-unified-password') as HTMLInputElement;

    if (unifiedUsername) {
      unifiedUsername.addEventListener('input', () => {
        if (unifiedLoginCheckbox.checked) {
          this.syncUnifiedCredentials();
        }
      });
    }

    if (unifiedPassword) {
      unifiedPassword.addEventListener('input', () => {
        if (unifiedLoginCheckbox.checked) {
          this.syncUnifiedCredentials();
        }
      });
    }
  }

  private addDiscordHandlers(): void {
    const enableDiscordCheckbox = document.getElementById('setup-enable-discord') as HTMLInputElement;
    const discordConfig = document.getElementById('setup-discord-config') as HTMLElement;

    if (!enableDiscordCheckbox) return;

    enableDiscordCheckbox.addEventListener('change', () => {
      const isEnabled = enableDiscordCheckbox.checked;
      
      // Show/hide Discord config section
      if (discordConfig) {
        discordConfig.style.display = isEnabled ? 'block' : 'none';
      }
    });
  }

  private clearCredentialFields(isUnified: boolean): void {
    if (isUnified) {
      // Clear individual credential fields
      const opensubsonicUsername = document.getElementById('setup-opensubsonic-username') as HTMLInputElement;
      const opensubsonicPassword = document.getElementById('setup-opensubsonic-password') as HTMLInputElement;
      const azuracastUsername = document.getElementById('setup-azuracast-username') as HTMLInputElement;
      const azuracastPassword = document.getElementById('setup-azuracast-password') as HTMLInputElement;

      if (opensubsonicUsername) opensubsonicUsername.value = '';
      if (opensubsonicPassword) opensubsonicPassword.value = '';
      if (azuracastUsername) azuracastUsername.value = '';
      if (azuracastPassword) azuracastPassword.value = '';
    } else {
      // Clear unified credential fields
      const unifiedUsername = document.getElementById('setup-unified-username') as HTMLInputElement;
      const unifiedPassword = document.getElementById('setup-unified-password') as HTMLInputElement;

      if (unifiedUsername) unifiedUsername.value = '';
      if (unifiedPassword) unifiedPassword.value = '';
    }
  }

  private syncUnifiedCredentials(): void {
    const unifiedUsername = (document.getElementById('setup-unified-username') as HTMLInputElement)?.value || '';
    const unifiedPassword = (document.getElementById('setup-unified-password') as HTMLInputElement)?.value || '';

    // Sync to OpenSubsonic fields (read-only display)
    const opensubsonicUsername = document.getElementById('setup-opensubsonic-username') as HTMLInputElement;
    const opensubsonicPassword = document.getElementById('setup-opensubsonic-password') as HTMLInputElement;
    const azuracastUsername = document.getElementById('setup-azuracast-username') as HTMLInputElement;
    const azuracastPassword = document.getElementById('setup-azuracast-password') as HTMLInputElement;

    if (opensubsonicUsername) {
      opensubsonicUsername.value = unifiedUsername;
      opensubsonicUsername.readOnly = true;
      opensubsonicUsername.style.backgroundColor = '#f0f0f0';
    }
    if (opensubsonicPassword) {
      opensubsonicPassword.value = unifiedPassword;
      opensubsonicPassword.readOnly = true;
      opensubsonicPassword.style.backgroundColor = '#f0f0f0';
    }
    if (azuracastUsername) {
      azuracastUsername.value = unifiedUsername;
      azuracastUsername.readOnly = true;
      azuracastUsername.style.backgroundColor = '#f0f0f0';
    }
    if (azuracastPassword) {
      azuracastPassword.value = unifiedPassword;
      azuracastPassword.readOnly = true;
      azuracastPassword.style.backgroundColor = '#f0f0f0';
    }
  }

  private validateUrl(input: HTMLInputElement): boolean {
    const url = input.value.trim();
    if (!url) return true; // Empty is okay for optional fields
    
    try {
      new URL(url);
      input.style.borderColor = '#00ff88';
      return true;
    } catch {
      input.style.borderColor = '#ff4444';
      return false;
    }
  }

  private validateUrls(input: HTMLInputElement): boolean {
    const urls = input.value.trim();
    if (!urls) return true;
    
    const urlList = urls.split(',').map(u => u.trim());
    let allValid = true;
    
    for (const url of urlList) {
      try {
        new URL(url);
      } catch {
        allValid = false;
        break;
      }
    }
    
    input.style.borderColor = allValid ? '#00ff88' : '#ff4444';
    return allValid;
  }

  private previousStep(): void {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.updateUI();
    }
  }

  private nextStep(): void {
    console.log(`🔍 Validating step ${this.currentStep}...`);
    
    if (this.validateCurrentStep()) {
      console.log(`✅ Step ${this.currentStep} validation passed`);
      this.collectCurrentStepData();
      
      if (this.currentStep < this.maxSteps) {
        this.currentStep++;
        console.log(`➡️ Moving to step ${this.currentStep}`);
        this.updateUI();
        
        // Generate summary on last step
        if (this.currentStep === this.maxSteps) {
          console.log('📋 Generating setup summary...');
          this.generateSummary();
        }
      }
    } else {
      console.log(`❌ Step ${this.currentStep} validation failed`);
    }
  }

  private validateCurrentStep(): boolean {
    switch (this.currentStep) {
      case 1: return this.validateStep1();
      case 2: return this.validateStep2();
      case 3: return this.validateStep3();
      case 4: return this.validateStep4();
      case 5: return true; // Summary step
      default: return true;
    }
  }

  private validateStep1(): boolean {
    const skipCheckbox = document.getElementById('setup-skip-opensubsonic') as HTMLInputElement;
    if (skipCheckbox?.checked) return true;

    const url = (document.getElementById('setup-opensubsonic-url') as HTMLInputElement)?.value?.trim();
    const useUnifiedLogin = (document.getElementById('setup-use-unified-login') as HTMLInputElement)?.checked;
    
    // URL is required
    if (!url) {
      alert('OpenSubsonic Server URL ist ein Pflichtfeld.');
      return false;
    }

    // Validate URL format
    if (!this.validateUrl(document.getElementById('setup-opensubsonic-url') as HTMLInputElement)) {
      return false;
    }

    // If unified login is enabled, check unified credentials
    if (useUnifiedLogin) {
      const unifiedUsername = (document.getElementById('setup-unified-username') as HTMLInputElement)?.value?.trim();
      const unifiedPassword = (document.getElementById('setup-unified-password') as HTMLInputElement)?.value?.trim();
      
      // Unified credentials are optional
      if ((unifiedUsername && !unifiedPassword) || (!unifiedUsername && unifiedPassword)) {
        alert('Wenn du unified login verwendest, fülle bitte sowohl Username als auch Password aus oder lasse beide leer.');
        return false;
      }
    } else {
      // Individual credentials are optional
      const username = (document.getElementById('setup-opensubsonic-username') as HTMLInputElement)?.value?.trim();
      const password = (document.getElementById('setup-opensubsonic-password') as HTMLInputElement)?.value?.trim();
      
      if ((username && !password) || (!username && password)) {
        alert('Wenn du Username eingibst, ist auch das Password erforderlich (oder lasse beide leer).');
        return false;
      }
    }

    return true;
  }

  private validateStep2(): boolean {
    const skipCheckbox = document.getElementById('setup-skip-azuracast') as HTMLInputElement;
    if (skipCheckbox?.checked) return true;

    const servers = (document.getElementById('setup-azuracast-servers') as HTMLInputElement)?.value?.trim();
    const useUnifiedLogin = (document.getElementById('setup-use-unified-login') as HTMLInputElement)?.checked;

    // Server URLs are required
    if (!servers) {
      alert('AzuraCast Server URLs sind ein Pflichtfeld.');
      return false;
    }

    // Validate URLs format
    if (!this.validateUrls(document.getElementById('setup-azuracast-servers') as HTMLInputElement)) {
      return false;
    }

    // If not using unified login, validate individual credentials (optional)
    if (!useUnifiedLogin) {
      const username = (document.getElementById('setup-azuracast-username') as HTMLInputElement)?.value?.trim();
      const password = (document.getElementById('setup-azuracast-password') as HTMLInputElement)?.value?.trim();
      
      if ((username && !password) || (!username && password)) {
        alert('Wenn du Username eingibst, ist auch das Password erforderlich (oder lasse beide leer).');
        return false;
      }
    }

    return true;
  }

  private validateStep3(): boolean {
    const server = (document.getElementById('setup-stream-server') as HTMLInputElement)?.value?.trim();
    const username = (document.getElementById('setup-stream-username') as HTMLInputElement)?.value?.trim();
    const password = (document.getElementById('setup-stream-password') as HTMLInputElement)?.value?.trim();

    // Streaming configuration is optional too
    if (server || username || password) {
      if (!server || !username || !password) {
        alert('Bitte fülle alle Streaming-Felder aus oder lasse alle leer zum Überspringen.');
        return false;
      }
    }

    return true;
  }

  private validateStep4(): boolean {
    const enableDiscord = (document.getElementById('setup-enable-discord') as HTMLInputElement)?.checked;
    
    // Discord is completely optional
    if (!enableDiscord) {
      return true;
    }

    // If enabled, token and channel ID are required
    const token = (document.getElementById('setup-discord-token') as HTMLInputElement)?.value?.trim();
    const channelId = (document.getElementById('setup-discord-channel-id') as HTMLInputElement)?.value?.trim();
    
    if (!token || !channelId) {
      alert('Wenn Discord Wishbox aktiviert ist, sind Bot Token und Channel ID erforderlich.');
      return false;
    }

    // Validate token format (basic check)
    if (!token.includes('.')) {
      alert('Der Discord Bot Token hat ein ungültiges Format. Er sollte drei Teile haben, getrennt durch Punkte (z.B. MTQy...GXkUTk.xqdO...)');
      return false;
    }

    // Validate channel ID format (should be numeric)
    if (!/^\d+$/.test(channelId)) {
      alert('Die Discord Channel ID sollte nur aus Zahlen bestehen.');
      return false;
    }

    // Guild ID is optional, but if provided, validate it
    const guildId = (document.getElementById('setup-discord-guild-id') as HTMLInputElement)?.value?.trim();
    if (guildId && !/^\d+$/.test(guildId)) {
      alert('Die Discord Guild ID sollte nur aus Zahlen bestehen (oder leer lassen).');
      return false;
    }

    return true;
  }

  private collectCurrentStepData(): void {
    switch (this.currentStep) {
      case 1:
        this.collectOpenSubsonicData();
        break;
      case 2:
        this.collectAzuraCastData();
        break;
      case 3:
        this.collectStreamingData();
        break;
      case 4:
        this.collectDiscordData();
        break;
    }
  }

  private collectOpenSubsonicData(): void {
    const skipCheckbox = document.getElementById('setup-skip-opensubsonic') as HTMLInputElement;
    if (skipCheckbox?.checked) {
      delete this.config.opensubsonic;
      return;
    }

    const url = (document.getElementById('setup-opensubsonic-url') as HTMLInputElement)?.value?.trim();
    const useUnifiedLogin = (document.getElementById('setup-use-unified-login') as HTMLInputElement)?.checked;

    // Collect unified login data if enabled
    if (useUnifiedLogin) {
      const unifiedUsername = (document.getElementById('setup-unified-username') as HTMLInputElement)?.value?.trim();
      const unifiedPassword = (document.getElementById('setup-unified-password') as HTMLInputElement)?.value?.trim();

      this.config.unifiedLogin = {
        enabled: true,
        username: unifiedUsername || '',
        password: unifiedPassword || ''
      };

      // Only save if URL is provided (credentials can be empty)
      if (url) {
        this.config.opensubsonic = { 
          url, 
          username: unifiedUsername || '', 
          password: unifiedPassword || '' 
        };
      } else {
        delete this.config.opensubsonic;
      }
    } else {
      // Individual credentials mode
      this.config.unifiedLogin = { enabled: false, username: '', password: '' };
      
      const username = (document.getElementById('setup-opensubsonic-username') as HTMLInputElement)?.value?.trim();
      const password = (document.getElementById('setup-opensubsonic-password') as HTMLInputElement)?.value?.trim();

      // Only save if URL is provided (credentials can be empty)
      if (url) {
        this.config.opensubsonic = { 
          url, 
          username: username || '', 
          password: password || '' 
        };
      } else {
        delete this.config.opensubsonic;
      }
    }
  }

  private collectAzuraCastData(): void {
    const skipCheckbox = document.getElementById('setup-skip-azuracast') as HTMLInputElement;
    if (skipCheckbox?.checked) {
      delete this.config.azuracast;
      return;
    }

    const servers = (document.getElementById('setup-azuracast-servers') as HTMLInputElement)?.value?.trim();
    const stationId = parseInt((document.getElementById('setup-azuracast-station-id') as HTMLInputElement)?.value || '1');
    const useUnifiedLogin = (document.getElementById('setup-use-unified-login') as HTMLInputElement)?.checked;

    // Use unified credentials if enabled, otherwise individual credentials
    let username = '';
    let password = '';

    if (useUnifiedLogin && this.config.unifiedLogin) {
      username = this.config.unifiedLogin.username;
      password = this.config.unifiedLogin.password;
    } else {
      username = (document.getElementById('setup-azuracast-username') as HTMLInputElement)?.value?.trim() || '';
      password = (document.getElementById('setup-azuracast-password') as HTMLInputElement)?.value?.trim() || '';
    }

    // Only save if servers are provided (credentials can be empty)
    if (servers) {
      this.config.azuracast = { servers, stationId, username, password };
    } else {
      delete this.config.azuracast;
    }
  }

  private collectStreamingData(): void {
    const bitrate = parseInt((document.getElementById('setup-stream-bitrate') as HTMLSelectElement)?.value || '128');
    const sampleRate = parseInt((document.getElementById('setup-sample-rate') as HTMLSelectElement)?.value || '44100');
    const server = (document.getElementById('setup-stream-server') as HTMLInputElement)?.value?.trim();
    const port = parseInt((document.getElementById('setup-stream-port') as HTMLInputElement)?.value || '8000');
    const username = (document.getElementById('setup-stream-username') as HTMLInputElement)?.value?.trim();
    const password = (document.getElementById('setup-stream-password') as HTMLInputElement)?.value?.trim();

    // Always collect streaming data (with defaults for empty fields)
    this.config.streaming = { 
      bitrate, 
      sampleRate, 
      server: server || '', 
      port, 
      username: username || '', 
      password: password || '' 
    };
  }

  private collectDiscordData(): void {
    const enabled = (document.getElementById('setup-enable-discord') as HTMLInputElement)?.checked || false;
    const token = (document.getElementById('setup-discord-token') as HTMLInputElement)?.value?.trim() || '';
    const channelId = (document.getElementById('setup-discord-channel-id') as HTMLInputElement)?.value?.trim() || '';
    const guildId = (document.getElementById('setup-discord-guild-id') as HTMLInputElement)?.value?.trim() || '';

    // Only save Discord config if enabled
    if (enabled && token && channelId) {
      this.config.discord = {
        enabled: true,
        token,
        channelId,
        guildId
      };
    } else {
      this.config.discord = {
        enabled: false,
        token: '',
        channelId: '',
        guildId: ''
      };
    }
  }

  private generateSummary(): void {
    let summaryHTML = '';

    // Demo mode indicator
    if (this.isDemo) {
      summaryHTML += `
        <div class="setup-summary-section" style="background: rgba(0, 212, 255, 0.1); border: 1px solid rgba(0, 212, 255, 0.3);">
          <h4 style="color: #00d4ff;">🚀 Demo Mode</h4>
          <p style="color: #ccc; margin: 10px 0;">
            You are using pre-configured demo data. The configuration will be saved to the .env file and 
            will be available on the next start.
          </p>
        </div>
      `;
    }

    // OpenSubsonic Summary
    if (this.config.opensubsonic) {
      const isDemoData = this.config.opensubsonic.url === 'https://demo.navidrome.org';
      summaryHTML += `
        <div class="setup-summary-section">
          <h4>🎵 Musik-Bibliothek (OpenSubsonic) ${isDemoData ? '- DEMO' : ''}</h4>
          <div class="setup-summary-item">
            <span>Server:</span>
            <strong>${this.config.opensubsonic.url}</strong>
          </div>
          <div class="setup-summary-item">
            <span>Benutzername:</span>
            <strong>${this.config.opensubsonic.username}</strong>
          </div>
          <div class="setup-summary-item">
            <span>Passwort:</span>
            <strong>${'*'.repeat(this.config.opensubsonic.password.length)}</strong>
          </div>
          ${isDemoData ? '<small style="color: #00d4ff;">Demo-Server von Navidrome.org</small>' : ''}
        </div>
      `;
    } else {
      summaryHTML += `
        <div class="setup-summary-section">
          <h4>🎵 Musik-Bibliothek (OpenSubsonic)</h4>
          <div class="setup-summary-item">
            <span style="color: #ff9800;">Später konfigurieren</span>
          </div>
        </div>
      `;
    }

    // AzuraCast Summary
    if (this.config.azuracast && this.config.azuracast.servers) {
      const isDemoData = this.config.azuracast.servers.includes('funkturm.radio-endstation.de');
      summaryHTML += `
        <div class="setup-summary-section">
          <h4>📡 Radio-Server (AzuraCast) ${isDemoData ? '- DEMO' : ''}</h4>
          <div class="setup-summary-item">
            <span>Server:</span>
            <strong>${this.config.azuracast.servers}</strong>
          </div>
          <div class="setup-summary-item">
            <span>Station ID:</span>
            <strong>${this.config.azuracast.stationId}</strong>
          </div>
          ${this.config.azuracast.username ? `
          <div class="setup-summary-item">
            <span>DJ Benutzername:</span>
            <strong>${this.config.azuracast.username}</strong>
          </div>
          <div class="setup-summary-item">
            <span>DJ Passwort:</span>
            <strong>${'*'.repeat(this.config.azuracast.password.length)}</strong>
          </div>
          ` : '<div class="setup-summary-item"><span style="color: #ff9800;">Keine Streaming-Zugangsdaten</span></div>'}
          ${isDemoData ? '<small style="color: #00d4ff;">Demo-Server für Radio-Streams</small>' : ''}
        </div>
      `;
    } else {
      summaryHTML += `
        <div class="setup-summary-section">
          <h4>📡 Radio-Server (AzuraCast)</h4>
          <div class="setup-summary-item">
            <span style="color: #ff9800;">Später konfigurieren</span>
          </div>
        </div>
      `;
    }

    // Streaming Summary
    summaryHTML += `
      <div class="setup-summary-section">
        <h4>🎙️ Live-Streaming</h4>
        <div class="setup-summary-item">
          <span>Bitrate:</span>
          <strong>${this.config.streaming.bitrate} kbps</strong>
        </div>
        <div class="setup-summary-item">
          <span>Sample Rate:</span>
          <strong>${this.config.streaming.sampleRate} Hz</strong>
        </div>
        <div class="setup-summary-item">
          <span>Server:</span>
          <strong>${this.config.streaming.server}:${this.config.streaming.port}</strong>
        </div>
        <div class="setup-summary-item">
          <span>Benutzername:</span>
          <strong>${this.config.streaming.username}</strong>
        </div>
        <div class="setup-summary-item">
          <span>Passwort:</span>
          <strong>${'*'.repeat(this.config.streaming.password.length)}</strong>
        </div>
      </div>
    `;

    // Discord Wishbox Summary
    if (this.config.discord && this.config.discord.enabled) {
      summaryHTML += `
        <div class="setup-summary-section">
          <h4>💬 Discord Wishbox</h4>
          <div class="setup-summary-item">
            <span>Status:</span>
            <strong style="color: #5865F2;">✅ Aktiviert</strong>
          </div>
          <div class="setup-summary-item">
            <span>Bot Token:</span>
            <strong>${this.config.discord.token.substring(0, 20)}...${this.config.discord.token.slice(-8)}</strong>
          </div>
          <div class="setup-summary-item">
            <span>Channel ID:</span>
            <strong>${this.config.discord.channelId}</strong>
          </div>
          ${this.config.discord.guildId ? `
          <div class="setup-summary-item">
            <span>Guild ID:</span>
            <strong>${this.config.discord.guildId}</strong>
          </div>
          ` : ''}
          <small style="color: #5865F2;">🔐 Token wird sicher auf dem Server gespeichert</small>
        </div>
      `;
    } else {
      summaryHTML += `
        <div class="setup-summary-section">
          <h4>💬 Discord Wishbox</h4>
          <div class="setup-summary-item">
            <span style="color: #666;">Nicht aktiviert</span>
          </div>
        </div>
      `;
    }

    this.summaryContainer.innerHTML = summaryHTML;
  }

  private startDemoSetup(): void {
    console.log('🚀 Starting demo setup...');
    this.isDemo = true;
    
    // Set demo configuration
    this.config = {
      opensubsonic: {
        url: 'https://demo.navidrome.org',
        username: 'demo',
        password: 'demo'
      },
      azuracast: {
        servers: 'https://funkturm.radio-endstation.de',
        stationId: 1,
        username: '',
        password: ''
      },
      streaming: {
        bitrate: 128,
        sampleRate: 44100,
        server: '',
        port: 8000,
        username: '',
        password: ''
      }
    };
    
    // Hide choice, show progress and go directly to summary
    this.choiceContainer.style.display = 'none';
    this.progressContainer.style.display = 'flex';
    this.currentStep = this.maxSteps;
    this.generateSummary();
    this.updateUI();
  }

  private startCustomSetup(): void {
    console.log('⚙️ Starting custom setup...');
    this.isDemo = false;
    
    // Hide choice, show progress and start with step 1
    this.choiceContainer.style.display = 'none';
    this.progressContainer.style.display = 'flex';
    this.currentStep = 1;
    this.updateUI();
  }

  private updateUI(): void {
    console.log(`🔄 Updating UI for step ${this.currentStep}`);
    
    // Update step contents
    this.stepContents.forEach((content, index) => {
      content.classList.toggle('active', index + 1 === this.currentStep);
    });

    // Update step indicators
    this.stepIndicators.forEach((indicator, index) => {
      const stepNumber = index + 1;
      indicator.classList.toggle('active', stepNumber === this.currentStep);
      indicator.classList.toggle('completed', stepNumber < this.currentStep);
    });

    // Update buttons
    this.backBtn.disabled = this.currentStep === 1;
    this.nextBtn.style.display = this.currentStep === this.maxSteps ? 'none' : 'inline-block';
    this.finishBtn.style.display = this.currentStep === this.maxSteps ? 'inline-block' : 'none';
  }

  private async finishSetup(): Promise<void> {
    console.log('🚀 Finishing setup...', { isDemo: this.isDemo });
    
    // Always save to file, regardless if demo or custom
    try {
      await this.saveConfigToFile(false); // No backup needed for demo
      if (this.isDemo) {
        this.showSuccessMessage('Demo configuration saved successfully!');
      } else {
        this.showSuccessMessage('Configuration saved successfully!');
      }
    } catch (error) {
      console.error('Setup save error:', error);
      this.showErrorMessage('Error saving configuration: ' + (error as Error).message);
      return;
    }

    // Apply configuration to current session
    this.applyConfigToSession();
    
    // Hide setup wizard
    this.hide();
    
    // Mark setup as completed
    localStorage.setItem('subcaster-setup-completed', 'true');
    
    // Remove demo-active flag if it exists
    localStorage.removeItem('subcaster-demo-active');
  }

  private async saveConfigToFile(createBackup: boolean): Promise<void> {
    const envContent = this.generateEnvContent();
    
    const response = await fetch('/api/save-config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: envContent,
        createBackup
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
  }

  private generateEnvContent(): string {
    let env = '# SubCaster Configuration - Generated by Setup Wizard\n\n';

    // Unified Login Configuration (if enabled)
    if (this.config.unifiedLogin?.enabled) {
      env += '# Unified Login Option (optional)\n';
      env += '# If enabled, the same credentials are used for OpenSubsonic and AzuraCast\n';
      env += `VITE_USE_UNIFIED_LOGIN=true\n`;
      env += `UNIFIED_USERNAME=${this.config.unifiedLogin.username}\n`;
      env += `UNIFIED_PASSWORD=${this.config.unifiedLogin.password}\n\n`;
    } else {
      env += '# Unified Login Option (disabled)\n';
      env += `VITE_USE_UNIFIED_LOGIN=false\n`;
      env += `UNIFIED_USERNAME=\n`;
      env += `UNIFIED_PASSWORD=\n\n`;
    }

    if (this.config.opensubsonic) {
      env += '# OpenSubsonic API Configuration (for music library)\n';
      env += `VITE_OPENSUBSONIC_URL=${this.config.opensubsonic.url}\n`;
      
      // Only include individual credentials if unified login is disabled
      if (!this.config.unifiedLogin?.enabled) {
        env += `OPENSUBSONIC_USERNAME=${this.config.opensubsonic.username}\n`;
        env += `OPENSUBSONIC_PASSWORD=${this.config.opensubsonic.password}\n`;
      } else {
        env += `OPENSUBSONIC_USERNAME=\n`;
        env += `OPENSUBSONIC_PASSWORD=\n`;
      }
      env += '\n';
    }

    env += '# Proxy Server Configuration (CORS bypass)\n';
    env += 'PROXY_PORT=3001\n\n';

    if (this.config.azuracast) {
      env += '# AzuraCast WebDJ Integration\n';
      env += `VITE_AZURACAST_SERVERS=${this.config.azuracast.servers}\n`;
      env += `VITE_AZURACAST_STATION_ID=${this.config.azuracast.stationId}\n`;
      
      // Only include individual credentials if unified login is disabled
      if (!this.config.unifiedLogin?.enabled) {
        env += `AZURACAST_DJ_USERNAME=${this.config.azuracast.username}\n`;
        env += `AZURACAST_DJ_PASSWORD=${this.config.azuracast.password}\n`;
      } else {
        env += `AZURACAST_DJ_USERNAME=\n`;
        env += `AZURACAST_DJ_PASSWORD=\n`;
      }
      env += '\n';
    }

    // Discord Wishbox Configuration (Optional)
    env += '# ============================================\n';
    env += '# Discord Wishbox (Optional)\n';
    env += '# ============================================\n';
    if (this.config.discord?.enabled) {
      env += `# ❌ Discord Bot Token OHNE VITE_ prefix (bleibt auf Server!)\n`;
      env += `DISCORD_BOT_TOKEN=${this.config.discord.token}\n\n`;
      env += `# ✅ Discord IDs MIT VITE_ prefix (öffentlich)\n`;
      env += `VITE_DISCORD_CHANNEL_ID=${this.config.discord.channelId}\n`;
      env += `VITE_DISCORD_GUILD_ID=${this.config.discord.guildId}\n\n`;
    } else {
      env += `# Discord Wishbox deaktiviert\n`;
      env += `DISCORD_BOT_TOKEN=\n`;
      env += `VITE_DISCORD_CHANNEL_ID=\n`;
      env += `VITE_DISCORD_GUILD_ID=\n\n`;
    }

    env += '# Live Streaming Configuration\n';
    env += `VITE_STREAM_BITRATE=${this.config.streaming.bitrate}\n`;
    env += `VITE_STREAM_SAMPLE_RATE=${this.config.streaming.sampleRate}\n\n`;

    env += '# Server Environment Variables (for unified-server.js)\n';
    env += `STREAM_SERVER=${this.config.streaming.server}\n`;
    env += `STREAM_PORT=${this.config.streaming.port}\n`;
    env += `STREAM_USERNAME=${this.config.streaming.username}\n`;
    env += `STREAM_PASSWORD=${this.config.streaming.password}\n`;

    return env;
  }

  private applyConfigToSession(): void {
    // Apply configuration to current runtime environment
    if (this.config.opensubsonic) {
      // Update OpenSubsonic configuration in runtime
      (window as any).openSubsonicConfig = this.config.opensubsonic;
    }
    
    if (this.config.azuracast) {
      // Update AzuraCast configuration in runtime
      (window as any).azuraCastConfig = this.config.azuracast;
    }
    
    // Update streaming configuration
    (window as any).streamingConfig = this.config.streaming;
  }

  private skipSetup(): void {
    if (confirm('Really skip setup? You can configure manually later.')) {
      this.hide();
      localStorage.setItem('subcaster-setup-skipped', 'true');
    }
  }

  private showSuccessMessage(message: string): void {
    // You could implement a toast notification here
    alert('✅ ' + message);
  }

  private showErrorMessage(message: string): void {
    // You could implement a toast notification here
    alert('❌ ' + message);
  }

  public show(): void {
    // Hide old login form when setup wizard is shown
    const oldLoginForm = document.getElementById('OpenSubsonic-login');
    if (oldLoginForm) {
      oldLoginForm.style.display = 'none';
      console.log('🔒 Hidden old login form');
    }
    
    // Show setup wizard overlay
    this.overlay.classList.remove('hidden');
    this.overlay.style.display = 'flex';
    console.log('🔧 Setup Wizard shown');
  }

  public hide(): void {
    this.overlay.classList.add('hidden');
    this.overlay.style.display = 'none';
    
    console.log('🔧 Setup Wizard hidden');
    
    // If we're in setup-only mode (no config was found), initialize the full app now
    const setupCompleted = localStorage.getItem('subcaster-setup-completed');
    const setupSkipped = localStorage.getItem('subcaster-setup-skipped');
    
    if (setupCompleted || setupSkipped) {
      console.log('🚀 Setup completed - initializing full application...');
      
      // Show all hidden main app elements
      const mainApp = document.querySelector('main') || document.body;
      if (mainApp) {
        const allElements = mainApp.children;
        for (let i = 0; i < allElements.length; i++) {
          const element = allElements[i] as HTMLElement;
          if (element.id !== 'setup-wizard-overlay') {
            element.style.display = '';
          }
        }
      }
      
      // Initialize the full app (call the function from main.ts)
      if ((window as any).initializeFullApp) {
        (window as any).initializeFullApp();
      } else {
        console.warn('⚠️ initializeFullApp function not available - app may need manual refresh');
        // Fallback: reload the page to initialize everything properly
        window.location.reload();
      }
    } else {
      // Show old login form again if setup was skipped without completion
      const oldLoginForm = document.getElementById('OpenSubsonic-login');
      if (oldLoginForm) {
        oldLoginForm.style.display = 'block';
        console.log('🔒 Restored old login form');
      }
    }
  }

  public static shouldShowSetup(): boolean {
    // Check if setup was already completed or skipped
    const completed = localStorage.getItem('subcaster-setup-completed');
    const skipped = localStorage.getItem('subcaster-setup-skipped');
    const demoActive = localStorage.getItem('subcaster-demo-active');
    
    // If demo was active, clear it and show setup again
    if (demoActive) {
      localStorage.removeItem('subcaster-demo-active');
      return true;
    }
    
    return !completed && !skipped;
  }
}

// Export for use in main.ts
export { SetupWizard };