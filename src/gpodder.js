import crypto from 'node:crypto';
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

// In-memory store for Nextcloud Login Flow v2
const nextcloudFlows = new Map();

// Periodic cleanup of stale login flows (older than 20 mins)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of nextcloudFlows.entries()) {
    if (val && val.createdAt && (now - val.createdAt > 20 * 60 * 1000)) {
      nextcloudFlows.delete(key);
    }
  }
}, 5 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

export function authenticateGpodderRequest(db, req) {
  // 1. Check HTTP Basic Auth header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Basic ')) {
    try {
      const creds = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const colonIdx = creds.indexOf(':');
      if (colonIdx !== -1) {
        const username = creds.slice(0, colonIdx).trim();
        const password = creds.slice(colonIdx + 1);
        const user = getUserByUsername(db, username);
        if (user) {
          if (verifyPassword(password, user.password_hash, user.salt)) {
            return { id: user.id, username: user.username };
          }
          // Also allow passing session token as password (app passwords / tokens)
          const session = getSession(db, password.trim());
          if (session && session.user_id === user.id) {
            return { id: user.id, username: user.username };
          }
        }
      }
    } catch (e) {
      // ignore decoding error
    }
  }

  // 2. Check Bearer token header
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const session = getSession(db, token);
    if (session) {
      return { id: session.user_id, username: session.username };
    }
  }

  // 3. Check X-Session-ID header
  const xSession = req.headers['x-session-id'] || req.headers['x-sessionid'];
  if (xSession) {
    const session = getSession(db, String(xSession).trim());
    if (session) {
      return { id: session.user_id, username: session.username };
    }
  }

  // 4. Check Cookie (supporting sessionid, session_id, and unquoted / quoted values)
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k ? k.trim() : '', v.join('=').trim()];
      })
    );
    const rawToken = cookies.sessionid || cookies.session_id || cookies.session;
    if (rawToken) {
      const cleanToken = rawToken.replace(/^["']|["']$/g, '').trim();
      const session = getSession(db, cleanToken);
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

export function extractActionsFromBody(body) {
  if (!body) return [];
  if (Array.isArray(body)) return body;

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return extractActionsFromBody(parsed);
    } catch {
      return [];
    }
  }

  if (body.actions !== undefined) {
    if (Array.isArray(body.actions)) {
      return body.actions;
    }
    if (typeof body.actions === 'string') {
      try {
        const parsed = JSON.parse(body.actions);
        return Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
      } catch {
        return [];
      }
    }
    if (typeof body.actions === 'object' && body.actions !== null) {
      return [body.actions];
    }
  }

  if (body.podcast || body.episode || body.guid) {
    return [body];
  }

  return [];
}

export async function handleGpodderRoutes(db, req, res, pathname, query, body) {
  const method = req.method.toUpperCase();

  // ----------------------------------------------------
  // Nextcloud Status endpoint: /status.php and /index.php/status.php
  // ----------------------------------------------------
  if (pathname === '/status.php' || pathname === '/index.php/status.php') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      installed: true,
      maintenance: false,
      needsDbUpgrade: false,
      version: '28.0.0.1',
      versionstring: '28.0.0',
      edition: '',
      productname: 'AntennaPodder Nextcloud Compatibility'
    }));
    return true;
  }

  // ----------------------------------------------------
  // Nextcloud Login Flow v2:
  // POST /index.php/login/v2 and POST /login/v2
  // ----------------------------------------------------
  if ((pathname === '/index.php/login/v2' || pathname === '/login/v2') && method === 'POST') {
    const pollToken = crypto.randomBytes(32).toString('hex');
    const flowToken = crypto.randomBytes(32).toString('hex');
    const host = req.headers.host || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${proto}://${host}`;

    // Associate poll token with flow token
    const flowData = {
      flowToken,
      pollToken,
      createdAt: Date.now(),
      approvedUser: null
    };
    nextcloudFlows.set(pollToken, flowData);
    nextcloudFlows.set(flowToken, flowData);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      poll: {
        token: pollToken,
        endpoint: `${baseUrl}/index.php/login/v2/poll`
      },
      login: `${baseUrl}/index.php/login/v2/flow/${flowToken}`
    }));
    return true;
  }

  // Nextcloud Login Flow Web UI:
  // GET /index.php/login/v2/flow/:flowToken or /login/v2/flow/:flowToken
  const flowMatch = pathname.match(/^\/(index\.php\/)?login\/v2\/flow\/([a-f0-9]+)$/);
  if (flowMatch && (method === 'GET' || method === 'POST')) {
    const flowToken = flowMatch[2];
    const flowData = nextcloudFlows.get(flowToken);
    if (!flowData) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Login flow expired or invalid');
      return true;
    }

    // If POST or auto-approve:
    const adminUser = getUserByUsername(db, process.env.ANTENNAPODDER_USER || 'admin');
    if (method === 'POST' || query.get('confirm') === '1') {
      flowData.approvedUser = adminUser;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(`<!DOCTYPE html>
        <html>
        <head><title>Authorization Successful</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; text-align: center; padding: 3rem 1rem;">
          <div style="max-width: 420px; margin: 0 auto; background: #181825; padding: 2rem; border-radius: 12px; border: 1px solid #313244;">
            <h2 style="color: #a6e3a1; margin-bottom: 0.5rem;">Connection Authorized</h2>
            <p style="color: #bac2de; font-size: 0.95rem; margin-bottom: 1.5rem;">AntennaPod has been granted access. You can now switch back to the AntennaPod app on your phone.</p>
          </div>
        </body></html>`);
      return true;
    }

    // Render approval page
    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end(`<!DOCTYPE html>
      <html>
      <head><title>Connect AntennaPod</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family: sans-serif; background: #1e1e2e; color: #cdd6f4; text-align: center; padding: 3rem 1rem;">
        <div style="max-width: 420px; margin: 0 auto; background: #181825; padding: 2rem; border-radius: 12px; border: 1px solid #313244;">
          <h2 style="margin-bottom: 0.5rem;">Connect to AntennaPodder</h2>
          <p style="color: #bac2de; font-size: 0.9rem; margin-bottom: 1.5rem;">Click below to authorize AntennaPod to sync with your account (<strong>${adminUser.username}</strong>).</p>
          <form method="POST">
            <button type="submit" style="background: #cba6f7; color: #11111b; border: 0; padding: 0.75rem 1.5rem; font-size: 1rem; font-weight: 700; border-radius: 8px; cursor: pointer; width: 100%;">Grant Access to AntennaPod</button>
          </form>
        </div>
      </body></html>`);
    return true;
  }

  // Nextcloud Poll endpoint:
  // POST /index.php/login/v2/poll or /login/v2/poll
  if ((pathname === '/index.php/login/v2/poll' || pathname === '/login/v2/poll') && method === 'POST') {
    const token = (body?.token || query.get('token') || '').trim();
    const flowData = nextcloudFlows.get(token);

    if (!flowData || !flowData.approvedUser) {
      // 404 signals client to keep polling according to Nextcloud spec
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'waiting' }));
      return true;
    }

    const host = req.headers.host || 'localhost:3000';
    const proto = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = `${proto}://${host}`;

    // Create session token used as appPassword
    const { token: appPassword } = createSession(db, flowData.approvedUser.id, 365 * 86400);

    // Clean up flow
    nextcloudFlows.delete(flowData.pollToken);
    nextcloudFlows.delete(flowData.flowToken);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      server: baseUrl,
      loginName: flowData.approvedUser.username,
      appPassword
    }));
    return true;
  }

  // ----------------------------------------------------
  // Authentication: POST /api/2/auth/:username/login.json
  // ----------------------------------------------------
  const authLoginMatch = pathname.match(/^\/api\/2\/auth\/([^/]+)\/login\.json$/);
  if (authLoginMatch && method === 'POST') {
    const targetUser = decodeURIComponent(authLoginMatch[1]).trim();
    let user = getUserByUsername(db, targetUser);

    let authenticated = false;
    // Check Basic Auth first
    const basicUser = authenticateGpodderRequest(db, req);
    if (basicUser) {
      authenticated = true;
      user = user || getUserByUsername(db, basicUser.username);
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
    const expiresDate = new Date(expiresAt * 1000).toUTCString();

    // Crucial for Android java.net.HttpCookie: Do NOT use SameSite=Lax here
    // Android's HttpCookie.parse throws an IllegalArgumentException on SameSite and discards the cookie!
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sessionid=${token}; Path=/; Expires=${expiresDate}; HttpOnly`
    });
    res.end(JSON.stringify({ status: 'ok', sessionid: token, token }));
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
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
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
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
      res.end('Unauthorized');
      return true;
    }

    const deviceId = decodeURIComponent(deviceDetailMatch[2]).trim();
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
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
      res.end('Unauthorized');
      return true;
    }

    const deviceId = decodeURIComponent(subDeltaMatch[2]).trim();
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
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
      res.end('Unauthorized');
      return true;
    }

    const deviceId = decodeURIComponent(subSimpleMatch[2]).trim();
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
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
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
      const actions = extractActionsFromBody(body);
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
      res.writeHead(401, {
        'Content-Type': 'text/plain',
        'WWW-Authenticate': 'Basic realm="AntennaPodder"'
      });
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
      let addList = [];
      if (Array.isArray(body?.add)) {
        addList = body.add;
      } else if (typeof body?.add === 'string') {
        try {
          const parsed = JSON.parse(body.add);
          addList = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          addList = [body.add];
        }
      } else if (body?.['add[]']) {
        addList = Array.isArray(body['add[]']) ? body['add[]'] : [body['add[]']];
      }

      let removeList = [];
      if (Array.isArray(body?.remove)) {
        removeList = body.remove;
      } else if (typeof body?.remove === 'string') {
        try {
          const parsed = JSON.parse(body.remove);
          removeList = Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          removeList = [body.remove];
        }
      } else if (body?.['remove[]']) {
        removeList = Array.isArray(body['remove[]']) ? body['remove[]'] : [body['remove[]']];
      }

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
      const actions = extractActionsFromBody(body);
      applyEpisodeActionsFromClient(db, authUser.id, actions);
      const now = Math.floor(Date.now() / 1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ timestamp: now }));
      return true;
    }
  }

  return false;
}
