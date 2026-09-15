import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let dbInstance = null;

export function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

export function getDatabase(dataDir = null) {
  if (dbInstance) return dbInstance;

  const targetDir = dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const dbPath = path.join(targetDir, 'antennapodder.db');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE COLLATE NOCASE NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS devices (
      user_id INTEGER NOT NULL,
      id TEXT NOT NULL,
      caption TEXT,
      type TEXT,
      last_sync_at INTEGER,
      PRIMARY KEY(user_id, id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS podcasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      author TEXT,
      link TEXT,
      last_fetched_at INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id INTEGER NOT NULL,
      podcast_url TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, podcast_url),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscription_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      podcast_url TEXT NOT NULL,
      action TEXT NOT NULL, -- 'add' or 'remove'
      timestamp INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      podcast_id INTEGER NOT NULL,
      guid TEXT NOT NULL,
      title TEXT NOT NULL,
      enclosure_url TEXT NOT NULL,
      enclosure_type TEXT,
      enclosure_length INTEGER,
      duration INTEGER DEFAULT 0,
      pub_date INTEGER DEFAULT 0,
      description TEXT,
      image_url TEXT,
      link TEXT,
      UNIQUE(podcast_id, guid),
      FOREIGN KEY(podcast_id) REFERENCES podcasts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS episode_states (
      user_id INTEGER NOT NULL,
      podcast_url TEXT NOT NULL,
      episode_url TEXT NOT NULL,
      guid TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      is_played INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, episode_url),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS episode_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      podcast_url TEXT NOT NULL,
      episode_url TEXT NOT NULL,
      guid TEXT,
      action TEXT NOT NULL,
      position INTEGER,
      started INTEGER,
      total INTEGER,
      device TEXT,
      action_timestamp TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_podcast ON episodes(podcast_id, pub_date DESC);
    CREATE INDEX IF NOT EXISTS idx_episodes_enclosure ON episodes(enclosure_url);
    CREATE INDEX IF NOT EXISTS idx_episode_actions_sync ON episode_actions(user_id, created_at_epoch);
    CREATE INDEX IF NOT EXISTS idx_subscription_log_sync ON subscription_log(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_episode_states_user_pod ON episode_states(user_id, podcast_url);
  `);

  // Default configuration
  const getConfigStmt = db.prepare('SELECT value FROM config WHERE key = ?');
  const setConfigStmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');

  if (!getConfigStmt.get('skip_forward_sec')) {
    setConfigStmt.run('skip_forward_sec', '30');
  }
  if (!getConfigStmt.get('skip_back_sec')) {
    setConfigStmt.run('skip_back_sec', '10');
  }
  if (!getConfigStmt.get('theme')) {
    setConfigStmt.run('theme', 'mocha');
  }

  // Ensure initial user exists
  const userCountRow = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCountRow.count === 0) {
    const initialUser = process.env.ANTENNAPODDER_USER || 'admin';
    const initialPass = process.env.ANTENNAPODDER_PASS || 'admin';
    const { hash, salt } = hashPassword(initialPass);
    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)').run(
      initialUser,
      hash,
      salt,
      now
    );
    console.log(`[Database] Initial user created: "${initialUser}" (default password)`);
  }

  dbInstance = db;
  return dbInstance;
}

// User & Auth operations
export function getUserByUsername(db, username) {
  if (!username) return null;
  const clean = String(username).trim();
  return db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(clean);
}

export function getUserById(db, id) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

export function createSession(db, userId, durationSeconds = 30 * 86400) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + durationSeconds;
  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    userId,
    now,
    expiresAt
  );
  return { token, expiresAt };
}

export function getSession(db, token) {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT s.token, s.user_id, s.expires_at, u.username
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, now);
  return row || null;
}

export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function updateUserPassword(db, userId, newPassword) {
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, userId);
}

// Config operations
export function getConfig(db, key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setConfig(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

export function getAllConfig(db) {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const config = {};
  for (const r of rows) {
    config[r.key] = r.value;
  }
  return config;
}

// Device operations
export function upsertDevice(db, userId, deviceId, caption = null, type = 'phone') {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT id FROM devices WHERE user_id = ? AND id = ?').get(userId, deviceId);
  if (existing) {
    db.prepare('UPDATE devices SET caption = COALESCE(?, caption), type = COALESCE(?, type), last_sync_at = ? WHERE user_id = ? AND id = ?').run(
      caption,
      type,
      now,
      userId,
      deviceId
    );
  } else {
    db.prepare('INSERT INTO devices (user_id, id, caption, type, last_sync_at) VALUES (?, ?, ?, ?, ?)').run(
      userId,
      deviceId,
      caption || deviceId,
      type || 'phone',
      now
    );
  }
}

export function getUserDevices(db, userId) {
  return db.prepare('SELECT id, caption, type, last_sync_at FROM devices WHERE user_id = ? ORDER BY last_sync_at DESC').all(userId);
}

// Subscriptions & Library
export function getUserSubscriptions(db, userId) {
  return db.prepare(`
    SELECT s.podcast_url, p.id, p.title, p.description, p.image_url, p.author, p.link, p.last_fetched_at,
           (SELECT COUNT(*) FROM episodes e WHERE e.podcast_id = p.id) as total_episodes,
           (SELECT COUNT(*) FROM episodes e 
            LEFT JOIN episode_states es ON es.episode_url = e.enclosure_url AND es.user_id = ?
            WHERE e.podcast_id = p.id AND (es.is_played IS NULL OR es.is_played = 0)
           ) as unplayed_episodes
    FROM subscriptions s
    JOIN podcasts p ON p.url = s.podcast_url
    WHERE s.user_id = ? AND s.is_active = 1
    ORDER BY p.title COLLATE NOCASE ASC
  `).all(userId, userId);
}

export function getUserSubscriptionUrls(db, userId) {
  const rows = db.prepare('SELECT podcast_url FROM subscriptions WHERE user_id = ? AND is_active = 1').all(userId);
  return rows.map(r => r.podcast_url);
}

export function addSubscription(db, userId, podcastUrl) {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT is_active FROM subscriptions WHERE user_id = ? AND podcast_url = ?').get(userId, podcastUrl);
  
  if (!existing) {
    db.prepare('INSERT INTO subscriptions (user_id, podcast_url, is_active, updated_at) VALUES (?, ?, 1, ?)').run(userId, podcastUrl, now);
    db.prepare("INSERT INTO subscription_log (user_id, podcast_url, action, timestamp) VALUES (?, ?, 'add', ?)").run(userId, podcastUrl, now);
    return true;
  } else if (existing.is_active === 0) {
    db.prepare('UPDATE subscriptions SET is_active = 1, updated_at = ? WHERE user_id = ? AND podcast_url = ?').run(now, userId, podcastUrl);
    db.prepare("INSERT INTO subscription_log (user_id, podcast_url, action, timestamp) VALUES (?, ?, 'add', ?)").run(userId, podcastUrl, now);
    return true;
  }
  return false;
}

export function removeSubscription(db, userId, podcastUrl) {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT is_active FROM subscriptions WHERE user_id = ? AND podcast_url = ?').get(userId, podcastUrl);
  if (existing && existing.is_active === 1) {
    db.prepare('UPDATE subscriptions SET is_active = 0, updated_at = ? WHERE user_id = ? AND podcast_url = ?').run(now, userId, podcastUrl);
    db.prepare("INSERT INTO subscription_log (user_id, podcast_url, action, timestamp) VALUES (?, ?, 'remove', ?)").run(userId, podcastUrl, now);
    return true;
  }
  return false;
}

export function getSubscriptionDeltas(db, userId, sinceTimestamp) {
  const now = Math.floor(Date.now() / 1000);
  const since = parseInt(sinceTimestamp, 10) || 0;

  if (since === 0) {
    // Return all active subscriptions as "add"
    const active = db.prepare('SELECT podcast_url FROM subscriptions WHERE user_id = ? AND is_active = 1').all(userId);
    return {
      add: active.map(r => r.podcast_url),
      remove: [],
      timestamp: now
    };
  }

  const logs = db.prepare(`
    SELECT podcast_url, action, timestamp 
    FROM subscription_log 
    WHERE user_id = ? AND timestamp >= ? 
    ORDER BY id ASC
  `).all(userId, since);

  const finalState = new Map();
  for (const log of logs) {
    finalState.set(log.podcast_url, log.action);
  }

  const add = [];
  const remove = [];
  for (const [url, action] of finalState.entries()) {
    if (action === 'add') {
      add.push(url);
    } else if (action === 'remove') {
      // Safety guarantee: Never send a podcast in remove unless it is currently marked inactive
      const current = db.prepare('SELECT is_active FROM subscriptions WHERE user_id = ? AND podcast_url = ?').get(userId, url);
      if (!current || current.is_active === 0) {
        remove.push(url);
      }
    }
  }

  return { add, remove, timestamp: now };
}

// Podcasts & Episodes
export function upsertPodcast(db, { url, title, description, imageUrl, author, link }) {
  const now = Math.floor(Date.now() / 1000);
  const existing = db.prepare('SELECT id FROM podcasts WHERE url = ?').get(url);

  if (existing) {
    db.prepare(`
      UPDATE podcasts 
      SET title = COALESCE(?, title),
          description = COALESCE(?, description),
          image_url = COALESCE(?, image_url),
          author = COALESCE(?, author),
          link = COALESCE(?, link),
          last_fetched_at = ?
      WHERE id = ?
    `).run(title, description, imageUrl, author, link, now, existing.id);
    return existing.id;
  } else {
    const res = db.prepare(`
      INSERT INTO podcasts (url, title, description, image_url, author, link, last_fetched_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(url, title, description, imageUrl, author, link, now, now);
    return Number(res.lastInsertRowid);
  }
}

export function upsertEpisode(db, podcastId, episode) {
  const { guid, title, enclosureUrl, enclosureType, enclosureLength, duration, pubDate, description, imageUrl, link } = episode;
  const existing = db.prepare('SELECT id FROM episodes WHERE podcast_id = ? AND guid = ?').get(podcastId, guid);

  if (existing) {
    db.prepare(`
      UPDATE episodes 
      SET title = ?,
          enclosure_url = ?,
          enclosure_type = ?,
          enclosure_length = ?,
          duration = ?,
          pub_date = ?,
          description = ?,
          image_url = COALESCE(?, image_url),
          link = ?
      WHERE id = ?
    `).run(title, enclosureUrl, enclosureType, enclosureLength || 0, duration || 0, pubDate || 0, description, imageUrl, link, existing.id);
    return existing.id;
  } else {
    const res = db.prepare(`
      INSERT INTO episodes (podcast_id, guid, title, enclosure_url, enclosure_type, enclosure_length, duration, pub_date, description, image_url, link)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(podcastId, guid, title, enclosureUrl, enclosureType, enclosureLength || 0, duration || 0, pubDate || 0, description, imageUrl, link);
    return Number(res.lastInsertRowid);
  }
}

export function getPodcastById(db, podcastId, userId) {
  const podcast = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(podcastId);
  if (!podcast) return null;

  const isSubscribed = db.prepare('SELECT is_active FROM subscriptions WHERE user_id = ? AND podcast_url = ?').get(userId, podcast.url);
  podcast.is_subscribed = isSubscribed ? Boolean(isSubscribed.is_active) : false;

  const episodes = db.prepare(`
    SELECT e.*, 
           COALESCE(es.position, 0) as position, 
           COALESCE(es.total, e.duration) as total_duration, 
           COALESCE(es.is_played, 0) as is_played,
           es.updated_at as state_updated_at
    FROM episodes e
    LEFT JOIN episode_states es ON es.episode_url = e.enclosure_url AND es.user_id = ?
    WHERE e.podcast_id = ?
    ORDER BY e.pub_date DESC
  `).all(userId, podcastId);

  podcast.episodes = episodes;
  return podcast;
}

export function getPodcastByUrl(db, url) {
  return db.prepare('SELECT * FROM podcasts WHERE url = ?').get(url);
}

export function getEpisodeById(db, episodeId, userId) {
  return db.prepare(`
    SELECT e.*, p.title as podcast_title, p.url as podcast_url, p.image_url as podcast_image_url,
           COALESCE(es.position, 0) as position,
           COALESCE(es.total, e.duration) as total_duration,
           COALESCE(es.is_played, 0) as is_played
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN episode_states es ON es.episode_url = e.enclosure_url AND es.user_id = ?
    WHERE e.id = ?
  `).get(userId, episodeId);
}

export function getEpisodeByUrl(db, episodeUrl) {
  return db.prepare(`
    SELECT e.*, p.title as podcast_title, p.url as podcast_url, p.image_url as podcast_image_url
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.enclosure_url = ?
  `).get(episodeUrl);
}

// Playback & Episode Actions (gPodder Sync engine)
export function updateEpisodePlayback(db, {
  userId,
  podcastUrl,
  episodeUrl,
  guid = null,
  position = 0,
  total = 0,
  isPlayed = null,
  device = 'web',
  action = 'play',
  actionTimestamp = null
}) {
  const now = Math.floor(Date.now() / 1000);
  const isoTimestamp = actionTimestamp || new Date().toISOString();

  // If isPlayed was not explicitly passed, mark played if position >= 95% of total
  let played = isPlayed;
  if (played === null) {
    if (total > 0 && position >= total * 0.95) {
      played = 1;
    } else {
      played = 0;
    }
  }

  // Update or insert into episode_states
  const existingState = db.prepare('SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?').get(userId, episodeUrl);

  if (existingState) {
    db.prepare(`
      UPDATE episode_states 
      SET podcast_url = ?,
          guid = COALESCE(?, guid),
          position = ?,
          total = CASE WHEN ? > 0 THEN ? ELSE total END,
          is_played = ?,
          updated_at = ?
      WHERE user_id = ? AND episode_url = ?
    `).run(podcastUrl, guid, position, total, total, played, now, userId, episodeUrl);
  } else {
    db.prepare(`
      INSERT INTO episode_states (user_id, podcast_url, episode_url, guid, position, total, is_played, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, podcastUrl, episodeUrl, guid, position, total, played, now);
  }

  // Record episode action for gpodder delta sync
  db.prepare(`
    INSERT INTO episode_actions (user_id, podcast_url, episode_url, guid, action, position, started, total, device, action_timestamp, created_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(userId, podcastUrl, episodeUrl, guid, action, position, total, device, isoTimestamp, now);

  return { position, total, is_played: played, timestamp: now };
}

export function toggleEpisodePlayed(db, userId, episodeId) {
  const episode = db.prepare('SELECT e.*, p.url as podcast_url FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE e.id = ?').get(episodeId);
  if (!episode) return null;

  const now = Math.floor(Date.now() / 1000);
  const state = db.prepare('SELECT is_played FROM episode_states WHERE user_id = ? AND episode_url = ?').get(userId, episode.enclosure_url);
  const nextPlayed = state && state.is_played === 1 ? 0 : 1;
  const nextPos = nextPlayed === 1 ? (episode.duration || 0) : 0;
  const action = nextPlayed === 1 ? 'play' : 'new';

  return updateEpisodePlayback(db, {
    userId,
    podcastUrl: episode.podcast_url,
    episodeUrl: episode.enclosure_url,
    guid: episode.guid,
    position: nextPos,
    total: episode.duration || 0,
    isPlayed: nextPlayed,
    device: 'web',
    action
  });
}

export function getEpisodeActions(db, userId, sinceTimestamp, podcastFilter = null, deviceFilter = null) {
  const now = Math.floor(Date.now() / 1000);
  const since = parseInt(sinceTimestamp, 10) || 0;

  let query = `
    SELECT podcast_url as podcast, episode_url as episode, guid, action, position, started, total, device, action_timestamp as timestamp, created_at_epoch
    FROM episode_actions
    WHERE user_id = ? AND created_at_epoch >= ?
  `;
  const params = [userId, since];

  if (podcastFilter) {
    query += ' AND podcast_url = ?';
    params.push(podcastFilter);
  }
  if (deviceFilter) {
    // If deviceFilter is specified, some clients request actions excluding their own device, or matching it
    // In gPodder protocol, device is optional
  }

  query += ' ORDER BY id ASC';
  const actions = db.prepare(query).all(...params);

  return {
    actions: actions.map(a => ({
      podcast: a.podcast,
      episode: a.episode,
      guid: a.guid || undefined,
      action: a.action,
      position: a.position != null ? a.position : 0,
      started: a.started != null ? a.started : 0,
      total: a.total != null ? a.total : 0,
      device: a.device || 'unknown',
      timestamp: a.timestamp
    })),
    timestamp: now
  };
}

export function applyEpisodeActionsFromClient(db, userId, actions) {
  const now = Math.floor(Date.now() / 1000);
  if (!Array.isArray(actions)) return { update_urls: [], timestamp: now };

  for (const act of actions) {
    if (!act.podcast || !act.episode) continue;

    const podcastUrl = act.podcast;
    const episodeUrl = act.episode;
    const guid = act.guid || null;
    const position = parseInt(act.position, 10) || 0;
    const total = parseInt(act.total, 10) || 0;
    const device = act.device || 'antennapod';
    const action = act.action || 'play';
    const actionTimestamp = act.timestamp || new Date().toISOString();

    let isPlayed = 0;
    if (action === 'play') {
      if (total > 0 && position >= total * 0.95) {
        isPlayed = 1;
      }
    } else if (action === 'new') {
      isPlayed = 0;
    }

    // Upsert episode_states
    const existing = db.prepare('SELECT position, total, is_played, updated_at FROM episode_states WHERE user_id = ? AND episode_url = ?').get(userId, episodeUrl);

    if (existing) {
      db.prepare(`
        UPDATE episode_states 
        SET podcast_url = ?,
            guid = COALESCE(?, guid),
            position = ?,
            total = CASE WHEN ? > 0 THEN ? ELSE total END,
            is_played = ?,
            updated_at = ?
        WHERE user_id = ? AND episode_url = ?
      `).run(podcastUrl, guid, position, total, total, isPlayed, now, userId, episodeUrl);
    } else {
      db.prepare(`
        INSERT INTO episode_states (user_id, podcast_url, episode_url, guid, position, total, is_played, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, podcastUrl, episodeUrl, guid, position, total, isPlayed, now);
    }

    // Record action in log
    db.prepare(`
      INSERT INTO episode_actions (user_id, podcast_url, episode_url, guid, action, position, started, total, device, action_timestamp, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, podcastUrl, episodeUrl, guid, action, position, act.started || 0, total, device, actionTimestamp, now);
  }

  return { update_urls: [], timestamp: now };
}
