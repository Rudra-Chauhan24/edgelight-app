const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('edgeLightAPI', {
  setIgnoreMouseEvents: (ignore, options) => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, options);
  },
  bringToFront: () => {
    ipcRenderer.send('bring-to-front');
  },
  onToggleLight: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('toggle-light', subscription);
    return () => ipcRenderer.removeListener('toggle-light', subscription);
  },
  onSetLightState: (callback) => {
    const subscription = (_event, state) => callback(state);
    ipcRenderer.on('set-light-state', subscription);
    return () => ipcRenderer.removeListener('set-light-state', subscription);
  },
  notifyLightState: (isOn) => {
    ipcRenderer.send('light-state-changed', isOn);
  },
  onToggleControls: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('toggle-controls', subscription);
    return () => ipcRenderer.removeListener('toggle-controls', subscription);
  },
  notifyControlsState: (visible) => {
    ipcRenderer.send('controls-visibility-changed', visible);
  },
  quitApp: () => {
    ipcRenderer.send('quit-app');
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  toggleFullScreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  onWebcamAccessChanged: (callback) => {
    const subscription = (_event, inUse, activeApps) => callback(inUse, activeApps);
    ipcRenderer.on('webcam-access-changed', subscription);
    return () => ipcRenderer.removeListener('webcam-access-changed', subscription);
  },
  getLaunchAtLogin: () => ipcRenderer.invoke('get-launch-at-login'),
  setLaunchAtLogin: (enable) => ipcRenderer.invoke('set-launch-at-login', enable),
  getLicenseInfo: () => ipcRenderer.invoke('get-license-info'),
  refreshLicenseInfo: () => ipcRenderer.invoke('refresh-license-info'),
  resetTrial: () => ipcRenderer.invoke('reset-trial'),
  copyHWID: () => ipcRenderer.invoke('copy-hwid'),
  getPaymentConfig: () => ipcRenderer.invoke('get-payment-config'),
  createRazorpayPaymentLink: (params) => ipcRenderer.invoke('create-razorpay-link', params),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  onLicenseStatusChanged: (callback) => {
    const subscription = (_event, info) => callback(info);
    ipcRenderer.on('license-status-changed', subscription);
    return () => ipcRenderer.removeListener('license-status-changed', subscription);
  },
  onShowLicenseModal: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('show-license-modal', subscription);
    return () => ipcRenderer.removeListener('show-license-modal', subscription);
  },
  onShowSetupWizard: (callback) => {
    const subscription = (_event, ...args) => callback(...args);
    ipcRenderer.on('show-setup-wizard', subscription);
    return () => ipcRenderer.removeListener('show-setup-wizard', subscription);
  },
  onShowStatus: (callback) => {
    const subscription = (_event, msg) => callback(msg);
    ipcRenderer.on('show-status', subscription);
    return () => ipcRenderer.removeListener('show-status', subscription);
  },
  getCursorPosition: () => ipcRenderer.invoke('get-cursor-position'),
  onCursorPosition: (callback) => {
    const subscription = (_event, pos) => callback(pos);
    ipcRenderer.on('cursor-position', subscription);
    return () => ipcRenderer.removeListener('cursor-position', subscription);
  },
  // OTA Updater APIs
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: (url) => ipcRenderer.invoke('download-update', url),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (callback) => {
    const subscription = (_event, updateInfo) => callback(updateInfo);
    ipcRenderer.on('update-available', subscription);
    return () => ipcRenderer.removeListener('update-available', subscription);
  },
  onUpdateProgress: (callback) => {
    const subscription = (_event, progress) => callback(progress);
    ipcRenderer.on('update-download-progress', subscription);
    return () => ipcRenderer.removeListener('update-download-progress', subscription);
  },
  // In-app payment window (Razorpay inside Electron BrowserWindow, not external browser)
  openPaymentWindow: (params) => ipcRenderer.invoke('open-payment-window', params),
  focusPaymentWindow: () => ipcRenderer.invoke('focus-payment-window'),
  closePaymentWindow: () => ipcRenderer.invoke('close-payment-window'),
  openPaymentInBrowser: (url) => ipcRenderer.invoke('open-payment-in-browser', url),
  startPaymentSession: () => ipcRenderer.invoke('start-payment-session'),
  endPaymentSession: () => ipcRenderer.invoke('end-payment-session'),
  activatePaymentRef: (params) => ipcRenderer.invoke('activate-payment-ref', params),
  onPaymentSessionStarted: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('payment-session-started', subscription);
    return () => ipcRenderer.removeListener('payment-session-started', subscription);
  },
  onPaymentSessionEnded: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('payment-session-ended', subscription);
    return () => ipcRenderer.removeListener('payment-session-ended', subscription);
  },
  onPaymentWindowOpened: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('payment-window-opened', subscription);
    return () => ipcRenderer.removeListener('payment-window-opened', subscription);
  },
  onPaymentWindowClosed: (callback) => {
    const subscription = (_event, result) => callback(result);
    ipcRenderer.on('payment-window-closed', subscription);
    return () => ipcRenderer.removeListener('payment-window-closed', subscription);
  },
  // Internet connectivity APIs
  getConnectivityStatus: () => ipcRenderer.invoke('get-connectivity-status'),
  forceConnectivityCheck: () => ipcRenderer.invoke('force-connectivity-check'),
  onConnectivityChanged: (callback) => {
    const subscription = (_event, online) => callback(online);
    ipcRenderer.on('connectivity-changed', subscription);
    return () => ipcRenderer.removeListener('connectivity-changed', subscription);
  },
  onOfflineDurationUpdate: (callback) => {
    const subscription = (_event, hours) => callback(hours);
    ipcRenderer.on('offline-duration-update', subscription);
    return () => ipcRenderer.removeListener('offline-duration-update', subscription);
  }
});