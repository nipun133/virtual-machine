/**
 * Codespace VM Controller Client
 * 
 * STRICT ARCHITECTURE CONSTRAINTS:
 * 1. ZERO localStorage, sessionStorage, or client-side caching.
 * 2. Every HTTP request strictly bypasses cache with 'no-store' & unique timestamp.
 * 3. 100% real-time accuracy via direct GitHub API sync.
 * 
 * EDGE CASES COVERED:
 * - Power button rapid spam / double-click protection (client debounce + server lock)
 * - Refresh button throttling & cancellation of stale requests
 * - Request sequencing / race condition prevention (stale requests discarded)
 * - Offline / online network status detection
 * - Background tab throttling recovery (visibilitychange auto-sync)
 * - GitHub 409 Conflict & transitioning state resilience
 * - Clean in-app toast feedback (no intrusive native alerts)
 */

// Pure in-memory state (0 bytes persistent storage)
let currentVm = null;
let isOperating = false;
let isCheckingStatus = false;
let pollTimer = null;
let lastCheckTimestamp = null;
let clockInterval = null;
let lastPowerClickTime = 0;
let lastRefreshClickTime = 0;
let requestSequence = 0;
let latestCompletedSeq = 0;
let activeAbortController = null;

// DOM Elements
const statusPill = document.getElementById('status-pill');
const statusText = document.getElementById('status-text');
const powerBtn = document.getElementById('power-toggle-btn');
const powerActionText = document.getElementById('power-action-text');
const powerSubtext = document.getElementById('power-subtext');
const vmRepo = document.getElementById('vm-repo');
const vmDisplayName = document.getElementById('vm-display-name');
const vmName = document.getElementById('vm-name');
const connectIdeBtn = document.getElementById('connect-ide-btn');
const sshInfoBtn = document.getElementById('ssh-info-btn');
const refreshBtn = document.getElementById('refresh-btn');
const refreshIcon = document.getElementById('refresh-icon');

const specCpu = document.getElementById('spec-cpu');
const specRam = document.getElementById('spec-ram');
const specDisk = document.getElementById('spec-disk');
const specRegion = document.getElementById('spec-region');
const specTimeout = document.getElementById('spec-timeout');
const specLatency = document.getElementById('spec-latency');
const lastVerifiedClock = document.getElementById('last-verified-clock');
const terminalLogs = document.getElementById('terminal-logs');

// Toast Notification System
function showToast(message, type = 'info') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      width: 90%;
      max-width: 400px;
    `;
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  const bgColors = {
    info: 'rgba(15, 23, 42, 0.95)',
    success: 'rgba(6, 78, 59, 0.95)',
    warning: 'rgba(120, 53, 15, 0.95)',
    error: 'rgba(127, 29, 29, 0.95)'
  };
  const borderColors = {
    info: '#38bdf8',
    success: '#34d399',
    warning: '#fbbf24',
    error: '#f87171'
  };

  toast.style.cssText = `
    background: ${bgColors[type] || bgColors.info};
    border: 1px solid ${borderColors[type] || borderColors.info};
    color: #f8fafc;
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 0.8rem;
    font-weight: 500;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    transition: all 0.25s ease;
    opacity: 0;
    transform: translateY(-8px);
    text-align: center;
    line-height: 1.4;
  `;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// In-Memory Activity Logger
function logEvent(msg, type = 'info') {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${timeStr}]`;
  
  const msgSpan = document.createElement('span');
  msgSpan.className = `log-msg log-${type}`;
  msgSpan.textContent = msg;
  
  entry.appendChild(timeSpan);
  entry.appendChild(msgSpan);
  terminalLogs.appendChild(entry);
  
  // Keep max 60 entries in memory to preserve DOM performance
  while (terminalLogs.children.length > 60) {
    terminalLogs.removeChild(terminalLogs.firstChild);
  }

  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Zero-Cache Fetch Helper with Abort Signal Support
async function fetchNoCache(url, options = {}) {
  const cacheBuster = `_t=${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const separator = url.includes('?') ? '&' : '?';
  const fullUrl = `${url}${separator}${cacheBuster}`;

  const defaultHeaders = {
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  };

  const finalOptions = {
    ...options,
    cache: 'no-store',
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    }
  };

  return await fetch(fullUrl, finalOptions);
}

// Fetch VM Status with Race-Condition & Stale-Request Guard
async function checkVmStatus(silent = false) {
  // Edge Case: Check offline status first
  if (!navigator.onLine) {
    statusText.textContent = 'NETWORK OFFLINE';
    statusPill.className = 'status-pill status-loading';
    powerBtn.disabled = true;
    powerActionText.textContent = 'No Internet Connection';
    powerSubtext.textContent = 'Please check your Wi-Fi or mobile data';
    return;
  }

  // Abort previous pending status request to prevent queueing
  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  const thisSeq = ++requestSequence;
  isCheckingStatus = true;

  if (!silent) {
    refreshIcon.classList.add('spinning');
    refreshBtn.disabled = true;
  }

  try {
    const res = await fetchNoCache('/api/status', {
      signal: activeAbortController.signal
    });
    const data = await res.json();

    // Edge Case: Stale request check (prevent race conditions)
    if (thisSeq < latestCompletedSeq) {
      return; // Discard older response
    }
    latestCompletedSeq = thisSeq;

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to fetch VM status');
    }

    const vm = data.codespace;
    currentVm = vm;
    lastCheckTimestamp = Date.now();

    updateUi(vm, data.latencyMs);

    if (!silent) {
      logEvent(`Status sync confirmed: ${vm.state} (${data.latencyMs}ms)`, 'success');
    }

    // Dynamic polling rate based on transition state
    scheduleNextPoll(vm.isTransitioning ? 2000 : 4500);

  } catch (err) {
    if (err.name === 'AbortError') return; // Expected cancellation

    console.error('Status check error:', err);
    logEvent(`Sync error: ${err.message}`, 'error');
    statusText.textContent = 'SYNC ERROR';
    statusPill.className = 'status-pill status-loading';
    powerActionText.textContent = 'Connection Issue';
    powerSubtext.textContent = err.message;
    scheduleNextPoll(5000);
  } finally {
    isCheckingStatus = false;
    refreshIcon.classList.remove('spinning');
    refreshBtn.disabled = false;
  }
}

// Update UI with 100% Accuracy
function updateUi(vm, latencyMs) {
  if (!vm) {
    statusText.textContent = 'NO VM FOUND';
    powerActionText.textContent = 'No Virtual Machine Detected';
    return;
  }

  // Update Identity & Specs
  vmDisplayName.textContent = vm.displayName || 'virtual-machine';
  vmName.textContent = vm.name;
  if (vm.repository) vmRepo.textContent = vm.repository;

  specRegion.textContent = vm.location || 'Central India';
  specTimeout.textContent = `${vm.idleTimeoutMinutes} min (4h)`;
  if (latencyMs) specLatency.textContent = `${latencyMs} ms`;

  // Parse hardware specs
  if (vm.specs) {
    if (vm.specs.includes('cores')) specCpu.textContent = vm.specs.split(',')[0].trim();
    if (vm.specs.includes('RAM')) specRam.textContent = vm.specs.split(',')[1].trim();
    if (vm.specs.includes('storage')) specDisk.textContent = vm.specs.split(',')[2].trim();
  }

  // State Logic
  const state = vm.state;
  statusPill.className = 'status-pill';
  powerBtn.className = 'power-button';

  if (state === 'Available') {
    // VM IS RUNNING (ONLINE)
    statusPill.classList.add('status-online');
    statusText.textContent = 'ONLINE / RUNNING';

    powerBtn.classList.add('btn-is-online');
    powerBtn.disabled = isOperating;
    powerActionText.textContent = 'Power OFF Virtual Machine';
    powerSubtext.textContent = 'Click to safely shut down • Saves core hours';

    // Enable Web IDE button
    connectIdeBtn.classList.remove('btn-disabled');
    connectIdeBtn.href = vm.webUrl || `https://${vm.name}.github.dev`;
  } else if (state === 'Shutdown') {
    // VM IS STOPPED (OFFLINE)
    statusPill.classList.add('status-offline');
    statusText.textContent = 'OFFLINE / STOPPED';

    powerBtn.classList.add('btn-is-offline');
    powerBtn.disabled = isOperating;
    powerActionText.textContent = 'Power ON Virtual Machine';
    powerSubtext.textContent = 'Click to start VM • Central India';

    // Disable Web IDE
    connectIdeBtn.classList.add('btn-disabled');
    connectIdeBtn.href = '#';
  } else if (['Starting', 'Queued', 'Provisioning'].includes(state)) {
    // VM IS POWERING ON
    statusPill.classList.add('status-starting');
    statusText.textContent = 'POWERING ON...';

    powerBtn.classList.add('btn-is-transitioning');
    powerBtn.disabled = true;
    powerActionText.textContent = 'Starting Up System...';
    powerSubtext.textContent = 'Allocating hardware resources & network';

    connectIdeBtn.classList.add('btn-disabled');
  } else if (['ShuttingDown', 'Stopping'].includes(state)) {
    // VM IS POWERING OFF
    statusPill.classList.add('status-stopping');
    statusText.textContent = 'SHUTTING DOWN...';

    powerBtn.classList.add('btn-is-transitioning');
    powerBtn.disabled = true;
    powerActionText.textContent = 'Powering Down VM...';
    powerSubtext.textContent = 'Flushing disk buffers & releasing resources';

    connectIdeBtn.classList.add('btn-disabled');
  } else {
    // OTHER (Rebuilding, Updating)
    statusPill.classList.add('status-starting');
    statusText.textContent = state.toUpperCase();
    powerBtn.disabled = true;
    powerActionText.textContent = `State: ${state}`;
  }
}

// Power Toggle Handler with Comprehensive Edge-Case Protection
async function togglePower() {
  const now = Date.now();

  // Edge Case 1: Button spam / rapid click protection (< 1500ms debounce)
  if (now - lastPowerClickTime < 1500) {
    showToast('Click registered. Please wait a moment.', 'warning');
    return;
  }

  // Edge Case 2: In-progress operation lock
  if (!currentVm || isOperating) {
    showToast('An operation is already in progress.', 'warning');
    return;
  }

  // Edge Case 3: Offline network check
  if (!navigator.onLine) {
    showToast('Cannot send power command: Device is offline.', 'error');
    return;
  }

  lastPowerClickTime = now;
  const isCurrentlyOnline = currentVm.state === 'Available';
  const action = isCurrentlyOnline ? 'stop' : 'start';

  // Immediate Lock & Visual State Transition
  isOperating = true;
  powerBtn.disabled = true;
  powerBtn.className = 'power-button btn-is-transitioning';
  powerActionText.textContent = isCurrentlyOnline ? 'Initiating Shutdown...' : 'Initiating Startup...';
  
  logEvent(`Sent command: POWER ${action.toUpperCase()} for ${currentVm.name}`, 'warning');
  showToast(`Initiating POWER ${action.toUpperCase()} command...`, 'info');

  try {
    const powerUrl = `/api/power?name=${encodeURIComponent(currentVm.name)}&action=${action}`;
    const res = await fetchNoCache(powerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: currentVm.name,
        action: action
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Power operation failed');
    }

    if (data.throttled) {
      logEvent(`Notice: ${data.message}`, 'warning');
      showToast('Command received: VM is already processing this action.', 'warning');
    } else if (data.conflict) {
      logEvent(`Notice: ${data.message}`, 'warning');
      showToast('VM is already in state transition on GitHub.', 'info');
    } else {
      logEvent(`GitHub confirmed: ${data.message} (State: ${data.newState})`, 'success');
      showToast(`Command sent: VM is now ${action === 'start' ? 'starting up' : 'shutting down'}!`, 'success');
    }

    // Accelerate status checking during transition
    await checkVmStatus(true);
  } catch (err) {
    console.error('Power toggle error:', err);
    logEvent(`Power command error: ${err.message}`, 'error');
    showToast(`Failed to ${action} VM: ${err.message}`, 'error');
    await checkVmStatus(true);
  } finally {
    // Release client lock after a safety cooldown
    setTimeout(() => {
      isOperating = false;
    }, 1200);
  }
}

// Scheduling Helper (Ensures single active timer)
function scheduleNextPoll(delayMs) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    checkVmStatus(true);
  }, delayMs);
}

// Freshness Clock Tick (Updates every second)
function startFreshnessClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(() => {
    if (!lastCheckTimestamp) return;
    const diffSec = Math.floor((Date.now() - lastCheckTimestamp) / 1000);
    if (diffSec < 1) {
      lastVerifiedClock.textContent = 'Just now (<1s)';
    } else {
      lastVerifiedClock.textContent = `${diffSec}s ago`;
    }
  }, 1000);
}

// Event Listeners with Edge-Case Throttling
powerBtn.addEventListener('click', togglePower);

// Refresh Button Throttling (Min 1.2s between user manual refreshes)
refreshBtn.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastRefreshClickTime < 1200) {
    showToast('Refreshing too fast. Please wait a moment.', 'warning');
    return;
  }
  lastRefreshClickTime = now;
  logEvent('Manual refresh triggered by user', 'info');
  checkVmStatus(false);
});

// SSH Info Command Copy
sshInfoBtn.addEventListener('click', () => {
  if (!currentVm) return;
  const sshCmd = `gh codespace ssh -c ${currentVm.name}`;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(sshCmd).then(() => {
      logEvent(`Copied SSH command to clipboard`, 'info');
      showToast('SSH command copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Copy SSH Command:', sshCmd);
    });
  } else {
    prompt('Copy SSH Command:', sshCmd);
  }
});

// Edge Case: Offline / Online Network Detection
window.addEventListener('offline', () => {
  logEvent('Network connection lost. Pausing live sync.', 'error');
  showToast('Network connection lost. Pausing sync.', 'error');
  statusText.textContent = 'OFFLINE (NO NETWORK)';
  statusPill.className = 'status-pill status-loading';
  powerBtn.disabled = true;
});

window.addEventListener('online', () => {
  logEvent('Network restored. Re-synchronizing with GitHub...', 'success');
  showToast('Network restored! Re-syncing status...', 'success');
  checkVmStatus(false);
});

// Edge Case: Background Tab Throttling Recovery
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    // If user returns after more than 3.5s, immediately re-verify live status
    if (!lastCheckTimestamp || (Date.now() - lastCheckTimestamp) > 3500) {
      logEvent('Tab reactivated. Immediate status re-check.', 'info');
      checkVmStatus(true);
    }
  }
});

// Initial Startup
logEvent('System initialized. Cache disabled.', 'info');
startFreshnessClock();
checkVmStatus(false);
