import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDatabase,
  getUserByUsername,
  addSubscription,
  upsertPodcast,
  upsertEpisode,
  getInProgressEpisodes,
  getFavoriteEpisodes,
  applyEpisodeActionsFromClient
} from '../src/db.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'data-test-dedupe');

test('Deduplicate episode rows when feed guid changes but enclosure_url remains identical', () => {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(TEST_DATA_DIR);
  const admin = getUserByUsername(db, 'admin');
  assert.ok(admin);

  const podId = upsertPodcast(db, {
    url: 'https://example.com/show.xml',
    title: 'Example Show'
  });
  addSubscription(db, admin.id, 'https://example.com/show.xml');

  // Insert original episode row
  const ep1 = upsertEpisode(db, podId, {
    guid: 'old-guid-123',
    title: 'Episode 10',
    enclosure_url: 'https://example.com/audio/ep10.mp3',
    duration: 3600
  });

  // Client plays partially and favorites
  applyEpisodeActionsFromClient(db, admin.id, [
    {
      podcast: 'https://example.com/show.xml',
      episode: 'https://example.com/audio/ep10.mp3',
      guid: 'old-guid-123',
      action: 'play',
      position: 1200,
      total: 3600,
      timestamp: '2026-09-23T10:00:00Z'
    }
  ]);
  db.prepare('UPDATE episode_states SET is_favorite = 1 WHERE user_id = ? AND episode_url = ?')
    .run(admin.id, 'https://example.com/audio/ep10.mp3');

  // Now the podcast feed updates: same enclosure_url, but new guid
  const ep2 = upsertEpisode(db, podId, {
    guid: 'new-guid-456',
    title: 'Episode 10 (Remastered / Feed Migration)',
    enclosure_url: 'https://example.com/audio/ep10.mp3',
    duration: 3600
  });

  assert.notEqual(ep1, ep2, 'Two episode records exist due to guid change');

  // Verify getInProgressEpisodes returns exactly 1 item, not 2
  const inProgress = getInProgressEpisodes(db, admin.id);
  assert.equal(inProgress.length, 1, `Expected 1 in-progress episode, got ${inProgress.length}`);
  assert.equal(inProgress[0].id, ep2, 'Should pick newest canonical episode');

  // Verify getFavoriteEpisodes returns exactly 1 item, not 2
  const favorites = getFavoriteEpisodes(db, admin.id);
  assert.equal(favorites.length, 1, `Expected 1 favorite episode, got ${favorites.length}`);
  assert.equal(favorites[0].id, ep2, 'Should pick newest canonical episode');

  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});
