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
  
  const minimizeBtn = document.getElementById('minimize-btn');
  const maximizeBtn = document.getElementById('maximize-btn');
  const closeBtn = document.getElementById('close-btn');
  
  console.log('🔍 Titlebar buttons found:', {
    minimize: !!minimizeBtn,
    maximize: !!maximizeBtn,
    close: !!closeBtn
  });
  
  minimizeBtn?.addEventListener('click', (e) => {
    console.log('🖱️ Minimize button clicked');
    e.stopPropagation();
    e.preventDefault();
    electronAPI.minimizeWindow();
  });
  
  maximizeBtn?.addEventListener('click', (e) => {
    console.log('🖱️ Maximize button clicked');
    e.stopPropagation();
    e.preventDefault();
    electronAPI.maximizeWindow();
  });
  
  closeBtn?.addEventListener('click', (e) => {
    console.log('🖱️ Close button clicked');
    e.stopPropagation();
    e.preventDefault();
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
  
  // Add double-click to maximize/restore on drag regions
  document.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    
    // Never maximize when clicking on buttons or interactive elements
    if (target.closest('button') || target.closest('input') || target.closest('select') || 
        target.closest('.titlebar-button') || target.closest('.titlebar-controls')) {
      return;
    }
    
    const computedStyle = window.getComputedStyle(target);
    const appRegion = computedStyle.getPropertyValue('-webkit-app-region');
    
    // Only maximize if clicking on a drag region (not on buttons, inputs, etc.)
    if (appRegion === 'drag') {
      electronAPI.maximizeWindow();
      e.preventDefault();
    }
  });
  
  console.log('✅ Electron titlebar initialized with drag regions and double-click maximize');
}
