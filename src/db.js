import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { decodeHtmlEntities } from './feed-parser.js';

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
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.accessSync(targetDir, fs.constants.W_OK);
  } catch (err) {
    console.error(`[Database Error] Target directory "${targetDir}" is not writable: ${err.message}`);
    console.error(`[Database Error] Current process UID: ${process.getuid ? process.getuid() : 'unknown'}, GID: ${process.getgid ? process.getgid() : 'unknown'}`);
    throw err;
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
      episode_number TEXT,
      season TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_episodes_podcast_stats ON episodes(podcast_id, pub_date);
    CREATE INDEX IF NOT EXISTS idx_episode_actions_sync ON episode_actions(user_id, created_at_epoch);
    CREATE INDEX IF NOT EXISTS idx_subscription_log_sync ON subscription_log(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_episode_states_user_pod ON episode_states(user_id, podcast_url);
    CREATE INDEX IF NOT EXISTS idx_episode_states_user_played ON episode_states(user_id, is_played, podcast_url);
    CREATE INDEX IF NOT EXISTS idx_episode_states_inprogress ON episode_states(user_id, is_played, position, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_episode_states_user_guid ON episode_states(user_id, guid);
  `);

  // Migrations for favorites & episode metadata
  try {
    db.exec('ALTER TABLE subscriptions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE episode_states ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE episode_actions ADD COLUMN is_favorite INTEGER DEFAULT 0');
  } catch {}
  try {
    db.exec('ALTER TABLE episodes ADD COLUMN episode_number TEXT');
  } catch {}
  try {
    db.exec('ALTER TABLE episodes ADD COLUMN season TEXT');
  } catch {}

  // Decode legacy HTML entities stored in existing databases
  try {
    const podcastsWithEntities = db.prepare(`SELECT id, title, author FROM podcasts WHERE title LIKE '%&%' OR author LIKE '%&%'`).all();
    for (const p of podcastsWithEntities) {
      const decodedTitle = decodeHtmlEntities(p.title);
      const decodedAuthor = decodeHtmlEntities(p.author);
      if (decodedTitle !== p.title || decodedAuthor !== p.author) {
        db.prepare(`UPDATE podcasts SET title = ?, author = ? WHERE id = ?`).run(decodedTitle, decodedAuthor, p.id);
      }
    }

    const episodesWithEntities = db.prepare(`SELECT id, title FROM episodes WHERE title LIKE '%&%'`).all();
    for (const e of episodesWithEntities) {
      const decodedTitle = decodeHtmlEntities(e.title);
      if (decodedTitle !== e.title) {
        db.prepare(`UPDATE episodes SET title = ? WHERE id = ?`).run(decodedTitle, e.id);
      }
    }
  } catch {}

  // Reconcile any episode states where is_played was wiped by non-playback actions (e.g. delete after playback)
  try {
    const wipedEpisodes = db.prepare(`
      WITH latest_playback AS (
        SELECT 
          ea.user_id,
          ea.episode_url,
          ea.guid,
          ea.action,
          ea.position,
          ea.total,
          ROW_NUMBER() OVER (
            PARTITION BY ea.user_id, COALESCE(ea.guid, ea.episode_url)
            ORDER BY ea.id DESC
          ) as rn
        FROM episode_actions ea
        WHERE ea.action IN ('play', 'pause', 'new')
      )
      SELECT es.user_id, es.episode_url, lp.position as last_pos, lp.total as last_total
      FROM episode_states es
      JOIN latest_playback lp ON lp.user_id = es.user_id AND (
        lp.episode_url = es.episode_url
        OR (lp.guid IS NOT NULL AND es.guid IS NOT NULL AND lp.guid = es.guid)
      ) AND lp.rn = 1
      WHERE es.is_played = 0
        AND es.position = 0
        AND lp.action = 'play'
        AND lp.total > 0
        AND lp.position >= lp.total * 0.95
    `).all();

    for (const ep of wipedEpisodes) {
      db.prepare(`
        UPDATE episode_states
        SET is_played = 1,
            position = ?,
            total = CASE WHEN total > 0 THEN total ELSE ? END
        WHERE user_id = ? AND episode_url = ?
      `).run(ep.last_pos, ep.last_total, ep.user_id, ep.episode_url);
    }
  } catch {}

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
  return db.prepare(`
    SELECT d.id,
           COALESCE(d.caption, d.id) AS caption,
           COALESCE(d.type, 'phone') AS type,
           d.last_sync_at,
           COALESCE((SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = d.user_id AND s.is_active = 1), 0) AS subscriptions
    FROM devices d
    WHERE d.user_id = ?
    ORDER BY d.last_sync_at DESC
  `).all(userId);
}

// Subscriptions & Library
export function getUserSubscriptions(db, userId) {
  return db.prepare(`
    SELECT s.podcast_url, p.id, COALESCE(p.title, s.podcast_url) as title, p.description, p.image_url, p.author, p.link, COALESCE(p.last_fetched_at, 0) as last_fetched_at,
           COALESCE(s.is_favorite, 0) as is_favorite,
           COALESCE(NULLIF(stats.latest_pub_date, 0), p.last_fetched_at, 0) as latest_pub_date,
           COALESCE(stats.total_episodes, 0) as total_episodes,
           MAX(0, COALESCE(stats.total_episodes, 0) - COALESCE(played.played_count, 0)) as unplayed_episodes
    FROM subscriptions s
    LEFT JOIN podcasts p ON p.url = s.podcast_url
    LEFT JOIN (
      SELECT podcast_id, COUNT(*) as total_episodes, MAX(pub_date) as latest_pub_date
      FROM episodes
      GROUP BY podcast_id
    ) stats ON stats.podcast_id = p.id
    LEFT JOIN (
      SELECT podcast_url, COUNT(*) as played_count
      FROM episode_states
      WHERE user_id = ? AND is_played = 1
      GROUP BY podcast_url
    ) played ON played.podcast_url = s.podcast_url
    WHERE s.user_id = ? AND s.is_active = 1
    ORDER BY COALESCE(p.title, s.podcast_url) COLLATE NOCASE ASC
  `).all(userId, userId);
}

export function togglePodcastFavorite(db, userId, podcastId) {
  const podcast = db.prepare('SELECT url FROM podcasts WHERE id = ?').get(podcastId);
  if (!podcast) return null;

  const sub = db.prepare('SELECT is_favorite FROM subscriptions WHERE user_id = ? AND podcast_url = ?').get(userId, podcast.url);
  if (!sub) return null;

  const nextFavorite = sub.is_favorite === 1 ? 0 : 1;
  const now = Math.floor(Date.now() / 1000);
  db.prepare('UPDATE subscriptions SET is_favorite = ?, updated_at = ? WHERE user_id = ? AND podcast_url = ?').run(nextFavorite, now, userId, podcast.url);

  return { podcastId, is_favorite: nextFavorite };
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
export function upsertPodcast(db, { url, title, description = null, imageUrl = null, author = null, link = null }) {
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
  const {
    guid,
    title,
    enclosureUrl,
    enclosureType,
    enclosureLength = 0,
    duration = 0,
    pubDate = 0,
    description = null,
    imageUrl = null,
    link = null,
    episodeNumber = null,
    episode_number = null,
    season = null
  } = episode;
  const epNum = episodeNumber || episode_number || null;
  const encUrl = enclosureUrl || episode.enclosure_url || '';
  const encType = enclosureType || episode.enclosure_type || null;
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
          link = ?,
          episode_number = COALESCE(?, episode_number),
          season = COALESCE(?, season)
      WHERE id = ?
    `).run(title, encUrl, encType, enclosureLength || 0, duration || 0, pubDate || 0, description, imageUrl, link, epNum, season, existing.id);
    return existing.id;
  } else {
    const res = db.prepare(`
      INSERT INTO episodes (podcast_id, guid, title, enclosure_url, enclosure_type, enclosure_length, duration, pub_date, description, image_url, link, episode_number, season)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(podcastId, guid, title, encUrl, encType, enclosureLength || 0, duration || 0, pubDate || 0, description, imageUrl, link, epNum, season);
    return Number(res.lastInsertRowid);
  }
}

export function getPodcastById(db, podcastId, userId, options = {}) {
  const { limit, offset = 0 } = options;

  const podcast = db.prepare('SELECT * FROM podcasts WHERE id = ?').get(podcastId);
  if (!podcast) return null;

  const sub = db.prepare('SELECT is_active, is_favorite FROM subscriptions WHERE user_id = ? AND podcast_url = ?').get(userId, podcast.url);
  podcast.is_subscribed = sub ? Boolean(sub.is_active) : false;
  podcast.is_favorite = sub ? Boolean(sub.is_favorite) : false;

  const totalRow = db.prepare('SELECT COUNT(*) as count FROM episodes WHERE podcast_id = ?').get(podcastId);
  podcast.total_episodes = totalRow.count;

  let query = `
    SELECT e.*,
           COALESCE(es.position, 0) as position,
           COALESCE(es.total, e.duration) as total_duration,
           COALESCE(es.is_played, 0) as is_played,
           COALESCE(es.is_favorite, 0) as is_favorite,
           es.updated_at as state_updated_at
    FROM episodes e
    LEFT JOIN episode_states es ON es.user_id = ? AND (
      es.episode_url = e.enclosure_url
      OR (e.guid IS NOT NULL AND es.guid IS NOT NULL AND es.guid = e.guid)
      OR (e.guid IS NOT NULL AND es.episode_url = e.guid)
    )
    WHERE e.podcast_id = ?
    ORDER BY e.pub_date DESC
  `;
  const params = [userId, podcastId];
  if (typeof limit === 'number') {
    query += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);
  }

  podcast.episodes = db.prepare(query).all(...params);
  return podcast;
}

export function podcastExists(db, podcastId) {
  return Boolean(db.prepare('SELECT 1 FROM podcasts WHERE id = ?').get(podcastId));
}

export function getPodcastByUrl(db, url) {
  return db.prepare('SELECT * FROM podcasts WHERE url = ?').get(url);
}

export function getEpisodeById(db, episodeId, userId) {
  return db.prepare(`
    SELECT e.*, p.title as podcast_title, p.url as podcast_url, p.image_url as podcast_image_url,
           COALESCE(es.position, 0) as position,
           COALESCE(es.total, e.duration) as total_duration,
           COALESCE(es.is_played, 0) as is_played,
           COALESCE(es.is_favorite, 0) as is_favorite
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    LEFT JOIN episode_states es ON es.user_id = ? AND (
      es.episode_url = e.enclosure_url
      OR (e.guid IS NOT NULL AND es.guid IS NOT NULL AND es.guid = e.guid)
      OR (e.guid IS NOT NULL AND es.episode_url = e.guid)
    )
    WHERE e.id = ?
  `).get(userId, episodeId);
}

export function getInProgressEpisodes(db, userId, limit = 12) {
  return db.prepare(`
    SELECT e.*, p.id as podcast_id, p.title as podcast_title, p.url as podcast_url, p.image_url as podcast_image_url,
           es.position,
           COALESCE(es.total, e.duration) as total_duration,
           es.is_played,
           COALESCE(es.is_favorite, 0) as is_favorite,
           es.updated_at as state_updated_at
    FROM episode_states es
    JOIN episodes e ON (
      e.enclosure_url = es.episode_url
      OR (e.guid IS NOT NULL AND es.guid IS NOT NULL AND e.guid = es.guid)
      OR (e.guid IS NOT NULL AND e.guid = es.episode_url)
    )
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN subscriptions s ON s.podcast_url = p.url AND s.user_id = es.user_id AND s.is_active = 1
    WHERE es.user_id = ? AND es.position > 0 AND es.is_played = 0
    ORDER BY es.updated_at DESC
    LIMIT ?
  `).all(userId, limit);
}

export function getFavoriteEpisodes(db, userId, limit = 50) {
  return db.prepare(`
    SELECT e.*, p.id as podcast_id, p.title as podcast_title, p.url as podcast_url, p.image_url as podcast_image_url,
           COALESCE(es.position, 0) as position,
           COALESCE(es.total, e.duration) as total_duration,
           COALESCE(es.is_played, 0) as is_played,
           1 as is_favorite,
           es.updated_at as state_updated_at
    FROM episode_states es
    JOIN episodes e ON (
      e.enclosure_url = es.episode_url
      OR (e.guid IS NOT NULL AND es.guid IS NOT NULL AND e.guid = es.guid)
      OR (e.guid IS NOT NULL AND e.guid = es.episode_url)
    )
    JOIN podcasts p ON p.id = e.podcast_id
    JOIN subscriptions s ON s.podcast_url = p.url AND s.user_id = es.user_id AND s.is_active = 1
    WHERE es.user_id = ? AND es.is_favorite = 1
    ORDER BY es.updated_at DESC
    LIMIT ?
  `).all(userId, limit);
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

export function markEpisodesPlayedBatch(db, userId, episodeIds) {
  if (!Array.isArray(episodeIds) || episodeIds.length === 0) {
    return { count: 0 };
  }

  const now = Math.floor(Date.now() / 1000);
  const isoTimestamp = new Date().toISOString();

  const getEpStmt = db.prepare(`
    SELECT e.id, e.guid, e.enclosure_url, e.duration, p.url as podcast_url
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE e.id = ?
  `);

  const existingStateStmt = db.prepare(`
    SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?
  `);

  const updateStateStmt = db.prepare(`
    UPDATE episode_states 
    SET podcast_url = ?,
        guid = COALESCE(?, guid),
        position = ?,
        total = CASE WHEN ? > 0 THEN ? ELSE total END,
        is_played = 1,
        updated_at = ?
    WHERE user_id = ? AND episode_url = ?
  `);

  const insertStateStmt = db.prepare(`
    INSERT INTO episode_states (user_id, podcast_url, episode_url, guid, position, total, is_played, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);

  const insertActionStmt = db.prepare(`
    INSERT INTO episode_actions (user_id, podcast_url, episode_url, guid, action, position, started, total, device, action_timestamp, created_at_epoch)
    VALUES (?, ?, ?, ?, 'play', ?, 0, ?, 'web', ?, ?)
  `);

  let count = 0;
  db.exec('BEGIN');
  try {
    for (const rawId of episodeIds) {
      const id = parseInt(rawId, 10);
      if (!id) continue;
      const episode = getEpStmt.get(id);
      if (!episode) continue;

      const dur = episode.duration || 0;
      const existing = existingStateStmt.get(userId, episode.enclosure_url);
      if (existing) {
        updateStateStmt.run(episode.podcast_url, episode.guid, dur, dur, dur, now, userId, episode.enclosure_url);
      } else {
        insertStateStmt.run(userId, episode.podcast_url, episode.enclosure_url, episode.guid, dur, dur, now);
      }

      insertActionStmt.run(userId, episode.podcast_url, episode.enclosure_url, episode.guid, dur, dur, isoTimestamp, now);
      count++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { count };
}

export function markAllEpisodesPlayed(db, userId, podcastId) {
  const unplayedEpisodes = db.prepare(`
    SELECT e.id
    FROM episodes e
    LEFT JOIN episode_states s ON s.user_id = ? AND s.episode_url = e.enclosure_url
    WHERE e.podcast_id = ? AND COALESCE(s.is_played, 0) = 0
  `).all(userId, podcastId);

  const episodeIds = unplayedEpisodes.map(e => e.id);
  return markEpisodesPlayedBatch(db, userId, episodeIds);
}

export function toggleEpisodeFavorite(db, userId, episodeId) {
  const episode = db.prepare('SELECT e.*, p.url as podcast_url FROM episodes e JOIN podcasts p ON p.id = e.podcast_id WHERE e.id = ?').get(episodeId);
  if (!episode) return null;

  const now = Math.floor(Date.now() / 1000);
  const state = db.prepare(`
    SELECT rowid, is_favorite, position, total, is_played
    FROM episode_states
    WHERE user_id = ? AND (
      episode_url = ?
      OR (guid IS NOT NULL AND ? IS NOT NULL AND guid = ?)
      OR (? IS NOT NULL AND episode_url = ?)
    )
    LIMIT 1
  `).get(userId, episode.enclosure_url, episode.guid, episode.guid, episode.guid, episode.guid);

  const nextFavorite = state && state.is_favorite === 1 ? 0 : 1;

  if (state) {
    db.prepare('UPDATE episode_states SET is_favorite = ?, updated_at = ? WHERE rowid = ?').run(nextFavorite, now, state.rowid);
  } else {
    db.prepare(`
      INSERT INTO episode_states (user_id, podcast_url, episode_url, guid, position, total, is_played, is_favorite, updated_at)
      VALUES (?, ?, ?, ?, 0, ?, 0, ?, ?)
      ON CONFLICT(user_id, episode_url) DO UPDATE SET
        is_favorite = excluded.is_favorite,
        updated_at = excluded.updated_at
    `).run(userId, episode.podcast_url, episode.enclosure_url, episode.guid, episode.duration || 0, nextFavorite, now);
  }

  // Record episode action for 2-way sync
  const actionName = nextFavorite === 1 ? 'favorite' : 'unfavorite';
  db.prepare(`
    INSERT INTO episode_actions (user_id, podcast_url, episode_url, guid, action, position, started, total, device, action_timestamp, created_at_epoch, is_favorite)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'web', ?, ?, ?)
  `).run(
    userId,
    episode.podcast_url,
    episode.enclosure_url,
    episode.guid,
    actionName,
    state ? state.position : 0,
    state ? state.total : (episode.duration || 0),
    new Date().toISOString(),
    now,
    nextFavorite
  );

  return { episodeId, is_favorite: nextFavorite };
}

export function getEpisodeActions(db, userId, sinceTimestamp, podcastFilter = null, deviceFilter = null) {
  const now = Math.floor(Date.now() / 1000);
  const since = parseInt(sinceTimestamp, 10) || 0;

  let query = `
    SELECT podcast_url as podcast, episode_url as episode, guid, action, position, started, total, device, action_timestamp as timestamp, created_at_epoch, is_favorite
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
      timestamp: a.timestamp,
      is_favorite: a.is_favorite === 1 || a.action === 'favorite' ? 1 : 0
    })),
    timestamp: now
  };
}

export function applyEpisodeActionsFromClient(db, userId, actions) {
  const now = Math.floor(Date.now() / 1000);
  if (!Array.isArray(actions)) return { update_urls: [], timestamp: now };

  for (const act of actions) {
    if (!act) continue;

    const podcastUrl = act.podcast ? String(act.podcast).trim() : null;
    let episodeUrl = act.episode ? String(act.episode).trim() : null;
    let guid = act.guid ? String(act.guid).trim() : null;

    // Must have at least episodeUrl or guid
    if (!episodeUrl && !guid) continue;

    const rawPos = parseInt(act.position, 10);
    const position = isNaN(rawPos) || rawPos < 0 ? 0 : rawPos;
    const rawTotal = parseInt(act.total, 10);
    let total = isNaN(rawTotal) || rawTotal < 0 ? 0 : rawTotal;
    const device = act.device || 'antennapod';
    const action = act.action || 'play';
    const actionTimestamp = act.timestamp || new Date().toISOString();

    // Resolve matching episode in DB
    let epRow = null;
    if (guid) {
      epRow = db.prepare('SELECT id, guid, enclosure_url, duration, podcast_id FROM episodes WHERE guid = ? LIMIT 1').get(guid);
    }
    if (!epRow && episodeUrl) {
      epRow = db.prepare('SELECT id, guid, enclosure_url, duration, podcast_id FROM episodes WHERE enclosure_url = ? LIMIT 1').get(episodeUrl);
    }
    if (!epRow && episodeUrl) {
      epRow = db.prepare('SELECT id, guid, enclosure_url, duration, podcast_id FROM episodes WHERE guid = ? LIMIT 1').get(episodeUrl);
    }
    if (!epRow && episodeUrl && episodeUrl.includes('?')) {
      const baseEpUrl = episodeUrl.split('?')[0];
      epRow = db.prepare('SELECT id, guid, enclosure_url, duration, podcast_id FROM episodes WHERE enclosure_url LIKE ? LIMIT 1').get(`${baseEpUrl}%`);
    }

    let canonicalEpisodeUrl = episodeUrl || (epRow ? epRow.enclosure_url : (guid || null)) || null;
    let canonicalGuid = guid || (epRow ? epRow.guid : null) || null;
    if (epRow) {
      canonicalEpisodeUrl = epRow.enclosure_url;
      if (!canonicalGuid && epRow.guid) canonicalGuid = epRow.guid;
      if (total <= 0 && epRow.duration > 0) {
        total = epRow.duration;
      }
    }

    let isFavorite = null;
    if (action === 'favorite' || action === 'star' || act.favorite === true || act.favorite === 1 || act.is_favorite === 1) {
      isFavorite = 1;
    } else if (action === 'unfavorite' || action === 'unstar' || act.favorite === false || act.favorite === 0 || act.is_favorite === 0) {
      isFavorite = 0;
    }

    const isPlaybackAction = (action === 'play' || action === 'pause' || action === 'new');
    let isPlayed = 0;
    let newPosition = position;
    if (action === 'play' || action === 'pause') {
      if (total > 0 && position >= total * 0.95) {
        isPlayed = 1;
      } else {
        isPlayed = 0;
      }
    } else if (action === 'new') {
      isPlayed = 0;
      newPosition = 0;
    }

    let resolvedPodcastUrl = podcastUrl;
    if (!resolvedPodcastUrl && epRow) {
      const pRow = db.prepare('SELECT url FROM podcasts WHERE id = ?').get(epRow.podcast_id);
      if (pRow) resolvedPodcastUrl = pRow.url;
    }
    if (!resolvedPodcastUrl) resolvedPodcastUrl = 'unknown';

    // Find existing state by canonical URL or GUID
    const existing = db.prepare(`
      SELECT rowid, position, total, is_played, is_favorite, updated_at
      FROM episode_states
      WHERE user_id = ? AND (
        episode_url = ?
        OR (guid IS NOT NULL AND ? IS NOT NULL AND guid = ?)
        OR (? IS NOT NULL AND episode_url = ?)
      )
      LIMIT 1
    `).get(userId, canonicalEpisodeUrl, canonicalGuid, canonicalGuid, canonicalGuid, canonicalGuid);

    if (existing) {
      db.prepare(`
        UPDATE episode_states 
        SET podcast_url = ?,
            episode_url = ?,
            guid = COALESCE(?, guid),
            position = CASE WHEN ? = 1 THEN ? ELSE position END,
            total = CASE WHEN ? > 0 THEN ? ELSE total END,
            is_played = CASE WHEN ? = 1 THEN ? ELSE is_played END,
            is_favorite = CASE WHEN ? IS NOT NULL THEN ? ELSE is_favorite END,
            updated_at = CASE WHEN ? = 1 OR ? IS NOT NULL THEN ? ELSE updated_at END
        WHERE rowid = ?
      `).run(
        resolvedPodcastUrl,
        canonicalEpisodeUrl,
        canonicalGuid,
        isPlaybackAction ? 1 : 0,
        newPosition,
        total,
        total,
        isPlaybackAction ? 1 : 0,
        isPlayed,
        isFavorite,
        isFavorite,
        isPlaybackAction ? 1 : 0,
        isFavorite,
        now,
        existing.rowid
      );
    } else if (isPlaybackAction || isFavorite !== null) {
      db.prepare(`
        INSERT INTO episode_states (user_id, podcast_url, episode_url, guid, position, total, is_played, is_favorite, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), ?)
        ON CONFLICT(user_id, episode_url) DO UPDATE SET
          podcast_url = excluded.podcast_url,
          guid = COALESCE(excluded.guid, episode_states.guid),
          position = CASE WHEN ? = 1 THEN excluded.position ELSE episode_states.position END,
          total = CASE WHEN excluded.total > 0 THEN excluded.total ELSE episode_states.total END,
          is_played = CASE WHEN ? = 1 THEN excluded.is_played ELSE episode_states.is_played END,
          is_favorite = CASE WHEN ? IS NOT NULL THEN excluded.is_favorite ELSE episode_states.is_favorite END,
          updated_at = CASE WHEN ? = 1 OR ? IS NOT NULL THEN excluded.updated_at ELSE episode_states.updated_at END
      `).run(
        userId,
        resolvedPodcastUrl,
        canonicalEpisodeUrl,
        canonicalGuid,
        newPosition,
        total,
        isPlayed,
        isFavorite,
        now,
        isPlaybackAction ? 1 : 0,
        isPlaybackAction ? 1 : 0,
        isFavorite,
        isPlaybackAction ? 1 : 0,
        isFavorite
      );
    }

    // Record action in log
    db.prepare(`
      INSERT INTO episode_actions (user_id, podcast_url, episode_url, guid, action, position, started, total, device, action_timestamp, created_at_epoch, is_favorite)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      resolvedPodcastUrl,
      canonicalEpisodeUrl,
      canonicalGuid,
      action,
      position,
      parseInt(act.started, 10) || 0,
      total,
      device,
      actionTimestamp,
      now,
      isFavorite !== null ? isFavorite : 0
    );
  }

  return { update_urls: [], timestamp: now };
}
