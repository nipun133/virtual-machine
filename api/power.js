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

  // Parse body
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  } else if (!body) {
    // Collect stream chunks if not parsed
    try {
      const buffers = [];
      for await (const chunk of req) {
        buffers.push(chunk);
      }
      const dataStr = Buffer.concat(buffers).toString();
      body = dataStr ? JSON.parse(dataStr) : {};
    } catch (e) {
      body = {};
    }
  }

  const name = body?.name;
  const action = (body?.action || '').toLowerCase();

  if (!name) {
    return res.status(400).json({ success: false, error: 'Missing "name" parameter in request body.' });
  }

  if (action !== 'start' && action !== 'stop') {
    return res.status(400).json({ success: false, error: 'Invalid action. Must be "start" or "stop".' });
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
