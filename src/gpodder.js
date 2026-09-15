import {
  getUserByUsername,
  verifyPassword,
  createSession,
  getSession,
  upsertDevice,
  getUserDevices,
  getSubscriptionDeltas,
  addSubscription,
  removeSubscription,
  getUserSubscriptionUrls,
  getEpisodeActions,
  applyEpisodeActionsFromClient,
  upsertPodcast,
  upsertEpisode
} from './db.js';
import { fetchAndParseFeed } from './feed-parser.js';

export function authenticateGpodderRequest(db, req) {
  // 1. Check HTTP Basic Auth header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const creds = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIdx = creds.indexOf(':');
      if (colonIdx !== -1) {
        const username = creds.slice(0, colonIdx);
        const password = creds.slice(colonIdx + 1);
        const user = getUserByUsername(db, username);
        if (user && verifyPassword(password, user.password_hash, user.salt)) {
          return { id: user.id, username: user.username };
        }
      }
    } catch (e) {
      // ignore decoding error
    }
  }

  // 2. Check Cookie
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k, v.join('=')];
      })
    );
    if (cookies.sessionid) {
      const session = getSession(db, cookies.sessionid);
      if (session) {
        return { id: session.user_id, username: session.username };
      }
    }
  }

  return null;
}

// Background sync worker for feeds newly added from AntennaPod
export async function syncFeedInBackground(db, feedUrl) {
  try {
    const parsed = await fetchAndParseFeed(feedUrl);
    const podcastId = upsertPodcast(db, parsed.podcast);
    for (const ep of parsed.episodes) {
      upsertEpisode(db, podcastId, ep);
    }
  } catch (err) {
    console.error(`[Background Feed Sync] Failed to sync ${feedUrl}:`, err.message);
  }
}

export async function handleGpodderRoutes(db, req, res, pathname, query, body) {
  const method = req.method.toUpperCase();

  // ----------------------------------------------------
  // Authentication: POST /api/2/auth/:username/login.json
  // ----------------------------------------------------
  const authLoginMatch = pathname.match(/^\/api\/2\/auth\/([^/]+)\/login\.json$/);
  if (authLoginMatch && method === 'POST') {
    const targetUser = decodeURIComponent(authLoginMatch[1]);
    const user = getUserByUsername(db, targetUser);

    let authenticated = false;
    // Check Basic Auth first
    const basicUser = authenticateGpodderRequest(db, req);
    if (basicUser && basicUser.username.toLowerCase() === targetUser.toLowerCase()) {
      authenticated = true;
    } else if (body && body.password && user) {
      if (verifyPassword(body.password, user.password_hash, user.salt)) {
        authenticated = true;
      }
    }

    if (!authenticated || !user) {
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
      res.end('Authentication required');
      return true;
    }

    const { token, expiresAt } = createSession(db, user.id);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expiresAt - Math.floor(Date.now() / 1000)}`
    });
    res.end(JSON.stringify({ status: 'ok', sessionid: token }));
    return true;
  }

  // POST /api/2/auth/:username/logout.json
  if (pathname.match(/^\/api\/2\/auth\/([^/]+)\/logout\.json$/) && method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }

  // ----------------------------------------------------
  // Devices: GET /api/2/devices/:username.json
  // ----------------------------------------------------
  const devicesMatch = pathname.match(/^\/api\/2\/devices\/([^/]+)\.json$/);
  if (devicesMatch) {
    const authUser = authenticateGpodderRequest(db, req);
    if (!authUser) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AntennaPodder"' });
      res.end('Unauthorized');
      return true;
    }

    if (method === 'GET') {
      const devices = getUserDevices(db, authUser.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(devices));
      return true;
    }
  }

  // POST /api/2/devices/:username/:device.json
  const deviceDetailMatch = pathname.match(/^\/api\/2\/devices\/([^/]+)\/([^/]+)\.json$/);
  if (deviceDetailMatch && method === 'POST') {
    const authUser = authenticateGpodderRequest(db, req);
    if (!authUser) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AntennaPodder"' });
      res.end('Unauthorized');
      return true;
    }

    const deviceId = decodeURIComponent(deviceDetailMatch[2]);
    const caption = body ? body.caption : null;
    const type = body ? body.type : 'phone';
    upsertDevice(db, authUser.id, deviceId, caption, type);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }

  // ----------------------------------------------------
  // Subscriptions (Delta sync): /api/2/subscriptions/:username/:device.json
  // ----------------------------------------------------
  const subDeltaMatch = pathname.match(/^\/api\/2\/subscriptions\/([^/]+)\/([^/]+)\.json$/);
  if (subDeltaMatch) {
    const authUser = authenticateGpodderRequest(db, req);
    if (!authUser) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AntennaPodder"' });
      res.end('Unauthorized');
      return true;
    }

    const deviceId = decodeURIComponent(subDeltaMatch[2]);
    upsertDevice(db, authUser.id, deviceId);

    if (method === 'GET') {
      const since = query.get('since') || 0;
      const result = getSubscriptionDeltas(db, authUser.id, since);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return true;
    }

    if (method === 'POST') {
      const addList = Array.isArray(body?.add) ? body.add : [];
      const removeList = Array.isArray(body?.remove) ? body.remove : [];

      for (const url of addList) {
        if (typeof url === 'string' && url.trim()) {
          const feedUrl = url.trim();
          addSubscription(db, authUser.id, feedUrl);
          syncFeedInBackground(db, feedUrl);
        }
      }

      for (const url of removeList) {
        if (typeof url === 'string' && url.trim()) {
          removeSubscription(db, authUser.id, url.trim());
        }
      }

      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ update_urls: [], timestamp: now }));
      return true;
    }
  }

  // ----------------------------------------------------
  // Subscriptions (Simple format): /subscriptions/:username/:device.json
  // ----------------------------------------------------
  const subSimpleMatch = pathname.match(/^\/subscriptions\/([^/]+)\/([^/]+)\.json$/);
  if (subSimpleMatch) {
    const authUser = authenticateGpodderRequest(db, req);
    if (!authUser) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AntennaPodder"' });
      res.end('Unauthorized');
      return true;
    }

    const deviceId = decodeURIComponent(subSimpleMatch[2]);
    upsertDevice(db, authUser.id, deviceId);

    if (method === 'GET') {
      const urls = getUserSubscriptionUrls(db, authUser.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(urls));
      return true;
    }

    if (method === 'PUT') {
      const desiredUrls = Array.isArray(body) ? body : [];

      // Safe additive merge: always add incoming subscriptions from the device.
      // We do not remove missing subscriptions here so that an uninitialized device or
      // device with only a subset of feeds cannot wipe existing subscriptions.
      for (const url of desiredUrls) {
        if (typeof url === 'string' && url.trim()) {
          addSubscription(db, authUser.id, url.trim());
          syncFeedInBackground(db, url.trim());
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return true;
    }
  }

  // ----------------------------------------------------
  // Episode Actions: /api/2/episodes/:username.json
  // ----------------------------------------------------
  const epActionsMatch = pathname.match(/^\/api\/2\/episodes\/([^/]+)\.json$/);
  if (epActionsMatch) {
    const authUser = authenticateGpodderRequest(db, req);
    if (!authUser) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AntennaPodder"' });
      res.end('Unauthorized');
      return true;
    }

    if (method === 'GET') {
      const since = query.get('since') || 0;
      const podcastFilter = query.get('podcast') || null;
      const deviceFilter = query.get('device') || null;
      const result = getEpisodeActions(db, authUser.id, since, podcastFilter, deviceFilter);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return true;
    }

    if (method === 'POST') {
      const actions = Array.isArray(body) ? body : (body?.actions || []);
      const result = applyEpisodeActionsFromClient(db, authUser.id, actions);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return true;
    }
  }

  // ----------------------------------------------------
  // Nextcloud gpoddersync compatibility routes:
  // /index.php/apps/gpoddersync/... and /apps/gpoddersync/...
  // ----------------------------------------------------
  const isNextcloudRoute = pathname.startsWith('/index.php/apps/gpoddersync') || pathname.startsWith('/apps/gpoddersync');
  if (isNextcloudRoute) {
    const authUser = authenticateGpodderRequest(db, req);
    if (!authUser) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="AntennaPodder"' });
      res.end('Unauthorized');
      return true;
    }

    const subPath = pathname.replace(/^(\/index\.php)?\/apps\/gpoddersync/, '');

    // Subscriptions GET
    if (subPath === '/subscriptions' && method === 'GET') {
      const since = query.get('since') || 0;
      const result = getSubscriptionDeltas(db, authUser.id, since);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return true;
    }

    // Subscriptions Change POST
    if (subPath === '/subscription_change/create' && method === 'POST') {
      const addList = Array.isArray(body?.add) ? body.add : (body?.['add[]'] ? (Array.isArray(body['add[]']) ? body['add[]'] : [body['add[]']]) : []);
      const removeList = Array.isArray(body?.remove) ? body.remove : (body?.['remove[]'] ? (Array.isArray(body['remove[]']) ? body['remove[]'] : [body['remove[]']]) : []);

      for (const url of addList) {
        if (typeof url === 'string' && url.trim()) {
          addSubscription(db, authUser.id, url.trim());
          syncFeedInBackground(db, url.trim());
        }
      }

      for (const url of removeList) {
        if (typeof url === 'string' && url.trim()) {
          removeSubscription(db, authUser.id, url.trim());
        }
      }

      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ timestamp: now }));
      return true;
    }

    // Episode Action GET
    if (subPath === '/episode_action' && method === 'GET') {
      const since = query.get('since') || 0;
      const podcastFilter = query.get('podcast') || null;
      const result = getEpisodeActions(db, authUser.id, since, podcastFilter);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return true;
    }

    // Episode Action Create POST
    if (subPath === '/episode_action/create' && method === 'POST') {
      let actions = [];
      if (Array.isArray(body)) {
        actions = body;
      } else if (Array.isArray(body?.actions)) {
        actions = body.actions;
      } else if (body && (body.podcast || body.episode)) {
        actions = [body];
      }
      applyEpisodeActionsFromClient(db, authUser.id, actions);
      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ timestamp: now }));
      return true;
    }
  }

  return false;
}
