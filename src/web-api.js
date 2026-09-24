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
  podcastExists,
  getPodcastByUrl,
  getEpisodeById,
  getInProgressEpisodes,
  getFavoriteEpisodes,
  updateEpisodePlayback,
  toggleEpisodePlayed,
  markEpisodesPlayedBatch,
  markAllEpisodesPlayed,
  togglePodcastFavorite,
  toggleEpisodeFavorite,
  getConfig,
  setConfig,
  getAllConfig,
  getUserDevices,
  updateUserPassword
} from './db.js';
import { fetchAndParseFeed, generateOpml, parseOpml } from './feed-parser.js';
import { syncFeedInBackground } from './gpodder.js';

export function getAuthenticatedUser(db, req) {
  const cookieHeader = req.headers['cookie'];
  if (!cookieHeader) return null;

  const pairs = cookieHeader.split(';').map(c => {
    const [k, ...v] = c.trim().split('=');
    return [k.trim(), v.join('=').trim().replace(/^"|"$/g, '')];
  });

  const sessionTokens = pairs.filter(([k]) => k === 'sessionid').map(([, v]) => v);
  for (const token of sessionTokens) {
    if (!token) continue;
    const session = getSession(db, token);
    if (session) {
      return { id: session.user_id, username: session.username, token: session.token };
    }
  }

  return null;
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
    const expiresDate = new Date(expiresAt * 1000).toUTCString();
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
    const secureFlag = isSecure ? '; Secure' : '';
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sessionid=${token}; Path=/; Expires=${expiresDate}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureFlag}`
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
    const isSecure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted;
    const secureFlag = isSecure ? '; Secure' : '';
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': `sessionid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag}`
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

  // OPML Export: GET /api/library/export.opml or /api/subscriptions/export.opml
  if ((pathname === '/api/library/export.opml' || pathname === '/api/subscriptions/export.opml' || pathname === '/api/export/opml') && method === 'GET') {
    const subscriptions = getUserSubscriptions(db, authUser.id);
    const opml = generateOpml(subscriptions);
    res.writeHead(200, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': 'attachment; filename="antennapodder-subscriptions.opml"',
      'Content-Length': Buffer.byteLength(opml, 'utf8')
    });
    res.end(opml);
    return true;
  }

  // OPML Import: POST /api/library/import.opml or /api/subscriptions/import.opml or /api/library/import-opml
  if ((pathname === '/api/library/import.opml' || pathname === '/api/subscriptions/import.opml' || pathname === '/api/library/import-opml') && method === 'POST') {
    let xmlText = '';
    if (typeof body === 'string') {
      xmlText = body;
    } else if (body && typeof body.opml === 'string') {
      xmlText = body.opml;
    } else if (body && typeof body.xml === 'string') {
      xmlText = body.xml;
    }

    if (!xmlText || !xmlText.trim()) {
      sendError(400, 'OPML XML content is required');
      return true;
    }

    const feeds = parseOpml(xmlText);
    if (feeds.length === 0) {
      sendError(400, 'No podcast feeds found in OPML');
      return true;
    }

    let imported = 0;
    let alreadySubscribed = 0;

    for (const feed of feeds) {
      try {
        upsertPodcast(db, {
          url: feed.url,
          title: feed.title || feed.url,
          description: null,
          imageUrl: null,
          author: null,
          link: null
        });
        const added = addSubscription(db, authUser.id, feed.url);
        if (added) {
          imported++;
        } else {
          alreadySubscribed++;
        }
        syncFeedInBackground(db, feed.url);
      } catch (err) {
        console.error(`[OPML Import Error] ${feed.url}:`, err.message);
      }
    }

    sendJson(200, {
      success: true,
      total: feeds.length,
      imported,
      alreadySubscribed,
      message: `Imported ${imported} podcast subscription${imported === 1 ? '' : 's'}${alreadySubscribed > 0 ? ` (${alreadySubscribed} already subscribed)` : ''}.`
    });
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
    const limitParam = parseInt(query.get('limit'), 10);
    const offsetParam = parseInt(query.get('offset'), 10);
    const options = {};
    if (Number.isInteger(limitParam) && limitParam > 0) {
      options.limit = limitParam;
      options.offset = Number.isInteger(offsetParam) && offsetParam > 0 ? offsetParam : 0;
    }
    const podcast = getPodcastById(db, podcastId, authUser.id, options);
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

  const podcastMarkAllMatch = pathname.match(/^\/api\/podcasts\/(\d+)\/mark-all-played$/);
  if (podcastMarkAllMatch && method === 'POST') {
    const podcastId = parseInt(podcastMarkAllMatch[1], 10);
    if (!podcastExists(db, podcastId)) {
      sendError(404, 'Podcast not found');
      return true;
    }
    const result = markAllEpisodesPlayed(db, authUser.id, podcastId);
    sendJson(200, { success: true, count: result.count });
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

  // Batch Mark Episodes Played: POST /api/episodes/mark-played-batch
  if (pathname === '/api/episodes/mark-played-batch' && method === 'POST') {
    const { episodeIds } = body || {};
    if (!Array.isArray(episodeIds)) {
      sendError(400, 'episodeIds must be an array');
      return true;
    }
    const result = markEpisodesPlayedBatch(db, authUser.id, episodeIds);
    sendJson(200, { success: true, count: result.count });
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
        theme: config.theme || 'mocha',
        accent_color: config.accent_color || 'mauve'
      },
      user,
      devices
    });
    return true;
  }

  if (pathname === '/api/settings' && method === 'POST') {
    const { skip_forward_sec, skip_back_sec, theme, accent_color } = body || {};

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
    if (accent_color && typeof accent_color === 'string') {
      let trimmed = accent_color.trim().toLowerCase();
      if (!trimmed.startsWith('#') && /^[0-9a-f]{3,6}$/i.test(trimmed)) {
        trimmed = '#' + trimmed;
      }
      const validPresets = ['mauve', 'lavender', 'blue', 'sapphire', 'sky', 'teal', 'green', 'yellow', 'peach', 'maroon', 'red', 'pink'];
      const hexRegex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
      if (validPresets.includes(trimmed) || hexRegex.test(trimmed)) {
        setConfig(db, 'accent_color', trimmed);
      }
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
