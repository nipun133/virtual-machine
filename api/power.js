// In-memory debounce lock for power operations
const activeLocks = new Map();
const COOLDOWN_MS = 2500;

module.exports = async (req, res) => {
  // Enforce zero cache at HTTP server level
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-github-token, Cache-Control, Pragma');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const token = process.env.GITHUB_TOKEN || req.headers['x-github-token'];
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'GitHub Token is not configured. Please set GITHUB_TOKEN environment variable in Vercel.',
      code: 'MISSING_TOKEN'
    });
  }

  // Parse query params first for dual-redundancy
  const parsedUrl = new URL(req.url, 'http://localhost');
  let name = parsedUrl.searchParams.get('name') || req.query?.name;
  let action = parsedUrl.searchParams.get('action') || req.query?.action;

  // Try parsing request body if query params are missing
  if (!name || !action) {
    let rawBody = '';
    if (req.body) {
      if (typeof req.body === 'object') {
        name = name || req.body.name;
        action = action || req.body.action;
      } else if (typeof req.body === 'string') {
        try {
          const parsed = JSON.parse(req.body);
          name = name || parsed.name;
          action = action || parsed.action;
        } catch (e) {}
      }
    } else {
      // Read stream
      await new Promise((resolve) => {
        req.on('data', chunk => { rawBody += chunk; });
        req.on('end', () => {
          try {
            if (rawBody) {
              const parsed = JSON.parse(rawBody);
              name = name || parsed.name;
              action = action || parsed.action;
            }
          } catch (e) {}
          resolve();
        });
        req.on('error', () => resolve());
      });
    }
  }

  action = (action || '').toLowerCase().trim();

  if (!name) {
    return res.status(400).json({ success: false, error: 'Missing "name" parameter in request.' });
  }

  if (action !== 'start' && action !== 'stop') {
    return res.status(400).json({ success: false, error: 'Invalid action. Must be "start" or "stop".' });
  }

  const now = Date.now();

  // Edge Case: Debounce spamming on server side
  const lock = activeLocks.get(name);
  if (lock && (now - lock.time) < COOLDOWN_MS) {
    return res.status(200).json({
      success: true,
      throttled: true,
      name,
      action: lock.action,
      message: 'Operation in progress. Debouncing duplicate request.',
      cooldownRemainingMs: COOLDOWN_MS - (now - lock.time),
      timestamp: new Date().toISOString()
    });
  }

  // Set lock
  activeLocks.set(name, { time: now, action });

  // Clean old entries (>30s)
  for (const [key, val] of activeLocks.entries()) {
    if (now - val.time > 30000) activeLocks.delete(key);
  }

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    const ghRes = await fetch(`https://api.github.com/user/codespaces/${encodeURIComponent(name)}/${action}?_nocache=${Date.now()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Codespace-VM-Controller',
        'Cache-Control': 'no-cache, no-store',
        'Content-Length': '0'
      },
      cache: 'no-store'
    });

    const latencyMs = Date.now() - startTime;

    // Edge Case: 409 Conflict (e.g. machine already starting or stopping)
    if (ghRes.status === 409) {
      return res.status(200).json({
        success: true,
        conflict: true,
        name,
        action,
        message: 'VM transition already initiated on GitHub.',
        latencyMs,
        timestamp,
        cacheBypass: true
      });
    }

    if (!ghRes.ok) {
      const errorText = await ghRes.text();
      return res.status(ghRes.status).json({
        success: false,
        error: `GitHub API error: ${ghRes.status} ${ghRes.statusText}`,
        details: errorText,
        latencyMs,
        timestamp
      });
    }

    const data = await ghRes.json();

    return res.status(200).json({
      success: true,
      action,
      name,
      newState: data.state,
      isOnline: data.state === 'Available',
      message: `Power command (${action.toUpperCase()}) executed successfully.`,
      latencyMs,
      timestamp,
      cacheBypass: true
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error while executing power action',
      timestamp
    });
  }
};
