module.exports = async (req, res) => {
  // Enforce zero cache at HTTP server level
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-github-token, Cache-Control, Pragma');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.GITHUB_TOKEN || req.headers['x-github-token'];
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'GitHub Token is not configured. Please set GITHUB_TOKEN environment variable in Vercel.',
      code: 'MISSING_TOKEN'
    });
  }

  const parsedUrl = new URL(req.url, 'http://localhost');
  const requestedName = parsedUrl.searchParams.get('name') || req.query?.name;

  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  try {
    // If specific codespace name provided
    if (requestedName) {
      const ghRes = await fetch(`https://api.github.com/user/codespaces/${encodeURIComponent(requestedName)}?_nocache=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Codespace-VM-Controller',
          'Cache-Control': 'no-cache, no-store'
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

      const cs = await ghRes.json();
      return res.status(200).json({
        success: true,
        codespace: formatCodespace(cs),
        latencyMs,
        timestamp,
        cacheBypass: true
      });
    }

    // Otherwise list all codespaces for this user
    const ghRes = await fetch(`https://api.github.com/user/codespaces?_nocache=${Date.now()}&per_page=30`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Codespace-VM-Controller',
        'Cache-Control': 'no-cache, no-store'
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
    const codespaces = (data.codespaces || []).map(formatCodespace);

    return res.status(200).json({
      success: true,
      codespace: codespaces[0] || null,
      allCodespaces: codespaces,
      total: data.total_count || codespaces.length,
      latencyMs,
      timestamp,
      cacheBypass: true
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error while communicating with GitHub',
      timestamp
    });
  }
};

function formatCodespace(cs) {
  const isOnline = cs.state === 'Available';
  const isTransitioning = ['Starting', 'Queued', 'Provisioning', 'ShuttingDown', 'Stopping', 'Rebuilding', 'Updating'].includes(cs.state);
  
  return {
    name: cs.name,
    displayName: cs.display_name || cs.name,
    state: cs.state,
    isOnline: isOnline,
    isTransitioning: isTransitioning,
    machine: cs.machine?.name || 'unknown',
    specs: cs.machine?.display_name || '2 cores, 8 GB RAM, 32 GB storage',
    location: cs.location || 'Unknown',
    idleTimeoutMinutes: cs.idle_timeout_minutes || 240,
    webUrl: cs.web_url,
    repository: cs.repository?.full_name || '',
    branch: cs.git_status?.ref || 'main',
    updatedAt: cs.updated_at,
    lastUsedAt: cs.last_used_at,
    createdAt: cs.created_at
  };
}
