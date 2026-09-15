import {
  getUserByUsername,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  getUserById,
  getUserSubscriptions,
  addSubscription,
  removeSubscription,
  upsertPodcast,
  upsertEpisode,
  getPodcastById,
  getPodcastByUrl,
  getEpisodeById,
  getInProgressEpisodes,
  getFavoriteEpisodes,
  updateEpisodePlayback,
  toggleEpisodePlayed,
  togglePodcastFavorite,
  toggleEpisodeFavorite,
  getConfig,
  setConfig,
  getAllConfig,
  getUserDevices,
  updateUserPassword
} from './db.js';
import { fetchAndParseFeed } from './feed-parser.js';

export function getAuthenticatedUser(db, req) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => {
      const [k, ...v] = c.trim().split('=');
      return [k, v.join('=')];
    })
  );

  if (!cookies.sessionid) return null;
  const session = getSession(db, cookies.sessionid);
  if (!session) return null;

  return { id: session.user_id, username: session.username, token: session.token };
}

export async function handleWebRoutes(db, req, res, pathname, query, body) {
  // Only handle /api/ routes; let static assets and index.html fall through
  if (!pathname.startsWith('/api/')) {
    return false;
  }

  const method = req.method.toUpperCase();

  // Helper JSON responder
  const sendJson = (statusCode, data) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // Helper Error responder
  const sendError = (statusCode, message) => {
    sendJson(statusCode, { error: message });
  };

  // ----------------------------------------------------
  // Auth: /api/auth/*
  // ----------------------------------------------------
  if (pathname === '/api/auth/login' && method === 'POST') {
    const { username, password } = body || {};
    if (!username || !password) {
      sendError(400, 'Username and password required');
      return true;
    }

    const user = getUserByUsername(db, username);
    if (!user || !verifyPassword(password, user.password_hash, user.salt)) {
      sendError(401, 'Invalid username or password');
      return true;
    }

    const { token, expiresAt } = createSession(db, user.id);
    const maxAge = expiresAt - Math.floor(Date.now() / 1000);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sessionid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`
    });
    res.end(JSON.stringify({
      user: { id: user.id, username: user.username }
    }));
    return true;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const authUser = getAuthenticatedUser(db, req);
    if (authUser) {
      deleteSession(db, authUser.token);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sessionid=; Path=/; HttpOnly; Max-Age=0`
    });
    res.end(JSON.stringify({ status: 'ok' }));
    return true;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const authUser = getAuthenticatedUser(db, req);
    if (!authUser) {
      sendJson(200, { user: null });
      return true;
    }

    const config = getAllConfig(db);
    sendJson(200, {
      user: { id: authUser.id, username: authUser.username },
      config
    });
    return true;
  }

  // All subsequent routes require authentication
  const authUser = getAuthenticatedUser(db, req);
  if (!authUser) {
    sendError(401, 'Unauthorized');
    return true;
  }

  // ----------------------------------------------------
  // Library: /api/library
  // ----------------------------------------------------
  if (pathname === '/api/library' && method === 'GET') {
    const subscriptions = getUserSubscriptions(db, authUser.id);
    sendJson(200, { subscriptions });
    return true;
  }

  // Subscribe: POST /api/library/subscribe
  if (pathname === '/api/library/subscribe' && method === 'POST') {
    const { url } = body || {};
    if (!url || typeof url !== 'string') {
      sendError(400, 'Feed URL is required');
      return true;
    }

    const feedUrl = url.trim();
    try {
      // 1. Fetch & parse feed
      const parsed = await fetchAndParseFeed(feedUrl);
      const podcastId = upsertPodcast(db, parsed.podcast);
      for (const ep of parsed.episodes) {
        upsertEpisode(db, podcastId, ep);
      }

      // 2. Add subscription & log action
      addSubscription(db, authUser.id, feedUrl);

      const podcast = getPodcastById(db, podcastId, authUser.id);
      sendJson(200, { success: true, podcast });
      return true;
    } catch (err) {
      console.error(`[Subscribe Error] ${feedUrl}:`, err);
      sendError(500, `Failed to subscribe: ${err.message}`);
      return true;
    }
  }

  // Unsubscribe: POST /api/library/unsubscribe
  if (pathname === '/api/library/unsubscribe' && method === 'POST') {
    const { url } = body || {};
    if (!url) {
      sendError(400, 'Feed URL is required');
      return true;
    }

    removeSubscription(db, authUser.id, url.trim());
    sendJson(200, { success: true });
    return true;
  }

  // Refresh feeds: POST /api/library/refresh
  if (pathname === '/api/library/refresh' && method === 'POST') {
    const { podcastId } = body || {};
    const subs = getUserSubscriptions(db, authUser.id);
    const toRefresh = podcastId 
      ? subs.filter(s => s.id === parseInt(podcastId, 10)) 
      : subs;

    let updatedCount = 0;
    for (const sub of toRefresh) {
      try {
        const parsed = await fetchAndParseFeed(sub.podcast_url);
        const pId = upsertPodcast(db, parsed.podcast);
        for (const ep of parsed.episodes) {
          upsertEpisode(db, pId, ep);
        }
        updatedCount++;
      } catch (err) {
        console.error(`[Refresh Error] ${sub.podcast_url}:`, err.message);
      }
    }

    sendJson(200, { success: true, refreshed: updatedCount });
    return true;
  }

  // ----------------------------------------------------
  // Podcast Detail: GET /api/podcasts/:id
  // ----------------------------------------------------
  const podcastMatch = pathname.match(/^\/api\/podcasts\/(\d+)$/);
  if (podcastMatch && method === 'GET') {
    const podcastId = parseInt(podcastMatch[1], 10);
    const podcast = getPodcastById(db, podcastId, authUser.id);
    if (!podcast) {
      sendError(404, 'Podcast not found');
      return true;
    }
    sendJson(200, { podcast });
    return true;
  }

  const podcastFavMatch = pathname.match(/^\/api\/podcasts\/(\d+)\/favorite$/);
  if (podcastFavMatch && method === 'POST') {
    const podcastId = parseInt(podcastFavMatch[1], 10);
    const result = togglePodcastFavorite(db, authUser.id, podcastId);
    if (!result) {
      sendError(404, 'Podcast not found or not subscribed');
      return true;
    }
    sendJson(200, { success: true, ...result });
    return true;
  }

  // ----------------------------------------------------
  // Episode Operations: /api/episodes/:id/*
  // ----------------------------------------------------
  const episodeMatch = pathname.match(/^\/api\/episodes\/(\d+)$/);
  if (episodeMatch && method === 'GET') {
    const episodeId = parseInt(episodeMatch[1], 10);
    const episode = getEpisodeById(db, episodeId, authUser.id);
    if (!episode) {
      sendError(404, 'Episode not found');
      return true;
    }
    sendJson(200, { episode });
    return true;
  }

  const epStateMatch = pathname.match(/^\/api\/episodes\/(\d+)\/state$/);
  if (epStateMatch && method === 'POST') {
    const episodeId = parseInt(epStateMatch[1], 10);
    const episode = getEpisodeById(db, episodeId, authUser.id);
    if (!episode) {
      sendError(404, 'Episode not found');
      return true;
    }

    const { position, total, is_played, action } = body || {};
    const posSec = Math.floor(parseFloat(position) || 0);
    const totSec = Math.floor(parseFloat(total) || episode.duration || 0);
    const played = is_played !== undefined ? (is_played ? 1 : 0) : null;

    const result = updateEpisodePlayback(db, {
      userId: authUser.id,
      podcastUrl: episode.podcast_url,
      episodeUrl: episode.enclosure_url,
      guid: episode.guid,
      position: posSec,
      total: totSec,
      isPlayed: played,
      device: 'web',
      action: action || 'play'
    });

    sendJson(200, { success: true, state: result });
    return true;
  }

  const epToggleMatch = pathname.match(/^\/api\/episodes\/(\d+)\/toggle-played$/);
  if (epToggleMatch && method === 'POST') {
    const episodeId = parseInt(epToggleMatch[1], 10);
    const result = toggleEpisodePlayed(db, authUser.id, episodeId);
    if (!result) {
      sendError(404, 'Episode not found');
      return true;
    }
    sendJson(200, { success: true, state: result });
    return true;
  }

  const epFavMatch = pathname.match(/^\/api\/episodes\/(\d+)\/(toggle-favorite|favorite)$/);
  if (epFavMatch && method === 'POST') {
    const episodeId = parseInt(epFavMatch[1], 10);
    const result = toggleEpisodeFavorite(db, authUser.id, episodeId);
    if (!result) {
      sendError(404, 'Episode not found');
      return true;
    }
    sendJson(200, { success: true, state: result });
    return true;
  }

  // In-Progress Episodes: GET /api/episodes/in-progress
  if (pathname === '/api/episodes/in-progress' && method === 'GET') {
    const limit = parseInt(query.get('limit'), 10) || 12;
    const episodes = getInProgressEpisodes(db, authUser.id, limit);
    sendJson(200, { episodes });
    return true;
  }

  // Favorite Episodes: GET /api/episodes/favorites
  if (pathname === '/api/episodes/favorites' && method === 'GET') {
    const limit = parseInt(query.get('limit'), 10) || 50;
    const episodes = getFavoriteEpisodes(db, authUser.id, limit);
    sendJson(200, { episodes });
    return true;
  }

  // ----------------------------------------------------
  // Podcast Directory Search: GET /api/search?q=query
  // ----------------------------------------------------
  if (pathname === '/api/search' && method === 'GET') {
    const q = query.get('q');
    if (!q || !q.trim()) {
      sendJson(200, { results: [] });
      return true;
    }

    try {
      const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(q.trim())}&entity=podcast&limit=15`;
      const searchRes = await fetch(itunesUrl, {
        headers: { 'User-Agent': 'AntennaPodder/1.0' },
        signal: AbortSignal.timeout(8000)
      });
      if (!searchRes.ok) {
        sendError(502, 'Failed to search iTunes directory');
        return true;
      }
      const data = await searchRes.json();
      const results = (data.results || []).map(r => ({
        feedUrl: r.feedUrl,
        title: r.collectionName || r.trackName,
        author: r.artistName,
        imageUrl: r.artworkUrl600 || r.artworkUrl100,
        genres: r.genres || []
      })).filter(r => Boolean(r.feedUrl));

      sendJson(200, { results });
      return true;
    } catch (err) {
      console.error('[Search Error]:', err.message);
      sendError(500, `Search error: ${err.message}`);
      return true;
    }
  }

  // ----------------------------------------------------
  // Settings & Sync Info: /api/settings
  // ----------------------------------------------------
  if (pathname === '/api/settings' && method === 'GET') {
    const config = getAllConfig(db);
    const devices = getUserDevices(db, authUser.id);
    const user = getUserById(db, authUser.id);

    sendJson(200, {
      config: {
        skip_forward_sec: parseInt(config.skip_forward_sec, 10) || 30,
        skip_back_sec: parseInt(config.skip_back_sec, 10) || 10,
        theme: config.theme || 'mocha'
      },
      user,
      devices
    });
    return true;
  }

  if (pathname === '/api/settings' && method === 'POST') {
    const { skip_forward_sec, skip_back_sec, theme } = body || {};

    if (skip_forward_sec !== undefined) {
      const val = Math.max(1, Math.min(300, parseInt(skip_forward_sec, 10) || 30));
      setConfig(db, 'skip_forward_sec', val);
    }
    if (skip_back_sec !== undefined) {
      const val = Math.max(1, Math.min(300, parseInt(skip_back_sec, 10) || 10));
      setConfig(db, 'skip_back_sec', val);
    }
    if (theme && (theme === 'mocha' || theme === 'latte')) {
      setConfig(db, 'theme', theme);
    }

    sendJson(200, { success: true, config: getAllConfig(db) });
    return true;
  }

  if (pathname === '/api/settings/password' && method === 'POST') {
    const { oldPassword, newPassword } = body || {};
    if (!oldPassword || !newPassword) {
      sendError(400, 'Current and new password are required');
      return true;
    }

    const user = getUserByUsername(db, authUser.username);
    if (!verifyPassword(oldPassword, user.password_hash, user.salt)) {
      sendError(400, 'Current password does not match');
      return true;
    }

    if (newPassword.length < 4) {
      sendError(400, 'New password must be at least 4 characters');
      return true;
    }

    updateUserPassword(db, authUser.id, newPassword);
    sendJson(200, { success: true });
    return true;
  }

  return false;
}
