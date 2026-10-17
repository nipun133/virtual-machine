/**
 * Codespace VM Controller Client
 * 
 * STRICT ARCHITECTURE CONSTRAINTS:
 * 1. ZERO localStorage, sessionStorage, or client-side caching.
 * 2. Every HTTP request strictly bypasses cache with 'no-store' & timestamp parameter.
 * 3. 100% real-time accuracy via direct GitHub API sync.
 */

// Pure in-memory state (destroyed when tab closes, 0 bytes persistent storage)
let currentVm = null;
let isOperating = false;
let pollTimer = null;
let lastCheckTimestamp = null;
let clockInterval = null;

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
  
  // Auto-scroll
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Zero-Cache Fetch Helper
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

// Fetch VM Status Directly from GitHub API
async function checkVmStatus(silent = false) {
  if (!silent) {
    refreshIcon.classList.add('spinning');
  }

  try {
    const res = await fetchNoCache('/api/status');
    const data = await res.json();

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

    // Dynamic polling rate based on whether VM is in a transitioning state
    scheduleNextPoll(vm.isTransitioning ? 2000 : 4500);

  } catch (err) {
    console.error('Status check error:', err);
    logEvent(`Sync error: ${err.message}`, 'error');
    statusText.textContent = 'SYNC ERROR';
    statusPill.className = 'status-pill status-loading';
    powerActionText.textContent = 'Connection Issue';
    powerSubtext.textContent = err.message;
    scheduleNextPoll(5000);
  } finally {
    refreshIcon.classList.remove('spinning');
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

// Power Toggle Handler (Switch ON / OFF)
async function togglePower() {
  if (!currentVm || isOperating) return;

  const isCurrentlyOnline = currentVm.state === 'Available';
  const action = isCurrentlyOnline ? 'stop' : 'start';

  isOperating = true;
  powerBtn.disabled = true;
  powerBtn.className = 'power-button btn-is-transitioning';
  powerActionText.textContent = isCurrentlyOnline ? 'Initiating Shutdown...' : 'Initiating Startup...';
  
  logEvent(`Sent command: POWER ${action.toUpperCase()} for ${currentVm.name}`, 'warning');

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

    logEvent(`GitHub confirmed: ${data.message} (State: ${data.newState})`, 'success');
    
    // Immediate status refresh
    await checkVmStatus(true);
  } catch (err) {
    console.error('Power toggle error:', err);
    logEvent(`Power command failed: ${err.message}`, 'error');
    alert(`Failed to ${action} virtual machine: ${err.message}`);
    await checkVmStatus(true);
  } finally {
    isOperating = false;
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

// Event Listeners
powerBtn.addEventListener('click', togglePower);

refreshBtn.addEventListener('click', () => {
  logEvent('Manual refresh triggered by user', 'info');
  checkVmStatus(false);
});

sshInfoBtn.addEventListener('click', () => {
  if (!currentVm) return;
  const sshCmd = `gh codespace ssh -c ${currentVm.name}`;
  navigator.clipboard.writeText(sshCmd).then(() => {
    logEvent(`Copied SSH command to clipboard: ${sshCmd}`, 'info');
    alert(`SSH Command copied to clipboard:\n\n${sshCmd}`);
  }).catch(() => {
    prompt('Copy SSH Command:', sshCmd);
  });
});

// Initial Startup
logEvent('System initialized. Cache disabled.', 'info');
startFreshnessClock();
checkVmStatus(false);
