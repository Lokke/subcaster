// Electron custom titlebar
export function initElectronTitlebar() {
  // Only run in Electron
  if (!(window as any).electronAPI) return;
  
  // Create titlebar element
  const titlebar = document.createElement('div');
  titlebar.id = 'electron-titlebar';
  titlebar.innerHTML = `
    <div class="titlebar-drag-region">
      <div class="titlebar-title">SubCaster</div>
    </div>
    <div class="titlebar-controls">
      <button class="titlebar-button" id="minimize-btn" title="Minimize">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="0" y="5" width="12" height="2" fill="currentColor"/>
        </svg>
      </button>
      <button class="titlebar-button" id="maximize-btn" title="Maximize">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="0" y="0" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
      <button class="titlebar-button close-btn" id="close-btn" title="Close">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M 0,0 L 12,12 M 12,0 L 0,12" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </button>
    </div>
  `;
  
  // Add to body as first element
  document.body.insertBefore(titlebar, document.body.firstChild);
  
  // Add window control event listeners
  const electronAPI = (window as any).electronAPI;
  
  document.getElementById('minimize-btn')?.addEventListener('click', () => {
    electronAPI.minimizeWindow();
  });
  
  document.getElementById('maximize-btn')?.addEventListener('click', () => {
    electronAPI.maximizeWindow();
  });
  
  document.getElementById('close-btn')?.addEventListener('click', () => {
    electronAPI.closeWindow();
  });
  
  // Handle maximize/unmaximize icon changes
  electronAPI.onMaximizeChange(() => {
    const maxBtn = document.getElementById('maximize-btn');
    if (maxBtn) {
      maxBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="0" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <rect x="0" y="2" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      `;
      maxBtn.title = 'Restore';
    }
  });
  
  electronAPI.onUnmaximizeChange(() => {
    const maxBtn = document.getElementById('maximize-btn');
    if (maxBtn) {
      maxBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="0" y="0" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      `;
      maxBtn.title = 'Maximize';
    }
  });
  
  console.log('✅ Electron titlebar initialized');
}
