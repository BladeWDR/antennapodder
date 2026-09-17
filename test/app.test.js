import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getDatabase,
  getUserByUsername,
  verifyPassword,
  hashPassword,
  addSubscription,
  removeSubscription,
  getSubscriptionDeltas,
  upsertPodcast,
  upsertEpisode,
  getPodcastById,
  updateEpisodePlayback,
  getEpisodeActions,
  applyEpisodeActionsFromClient,
  getAllConfig,
  setConfig
} from '../src/db.js';
import { parsePodcastFeed } from '../src/feed-parser.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'data-test');

test('Database and User Auth', () => {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(TEST_DATA_DIR);
  assert.ok(db, 'Database initialized');

  // Verify default user creation
  const admin = getUserByUsername(db, 'admin');
  assert.ok(admin, 'Admin user should exist');
  assert.equal(admin.username, 'admin');
  assert.ok(verifyPassword('admin', admin.password_hash, admin.salt));
  assert.ok(!verifyPassword('wrongpassword', admin.password_hash, admin.salt));

  // Password hashing test
  const { hash, salt } = hashPassword('mysecretpassword');
  assert.ok(verifyPassword('mysecretpassword', hash, salt));
  assert.ok(!verifyPassword('otherpass', hash, salt));
});

test('Subscriptions and 2-way delta sync', () => {
  const db = getDatabase(TEST_DATA_DIR);
  const user = getUserByUsername(db, 'admin');
  const now = Math.floor(Date.now() / 1000);

  const feed1 = 'https://feeds.example.com/podcast1.xml';
  const feed2 = 'https://feeds.example.com/podcast2.xml';

  // Add feeds
  const added1 = addSubscription(db, user.id, feed1);
  assert.equal(added1, true);

  const added2 = addSubscription(db, user.id, feed2);
  assert.equal(added2, true);

  // Delta since before now should return both
  const delta1 = getSubscriptionDeltas(db, user.id, now - 10);
  assert.ok(delta1.add.includes(feed1));
  assert.ok(delta1.add.includes(feed2));
  assert.equal(delta1.remove.length, 0);

  // Remove one feed
  const removed = removeSubscription(db, user.id, feed1);
  assert.equal(removed, true);

  // Delta check after removal
  const delta2 = getSubscriptionDeltas(db, user.id, now - 5);
  assert.ok(delta2.remove.includes(feed1));
});

test('Episode playback state and gPodder actions sync', () => {
  const db = getDatabase(TEST_DATA_DIR);
  const user = getUserByUsername(db, 'admin');
  const podcastUrl = 'https://feeds.example.com/podcast2.xml';
  const episodeUrl = 'https://media.example.com/ep1.mp3';

  // Record playback action from web player
  updateEpisodePlayback(db, {
    userId: user.id,
    podcastUrl,
    episodeUrl,
    guid: 'ep-001',
    position: 450,
    total: 1800,
    isPlayed: 0,
    device: 'web',
    action: 'play'
  });

  // Query actions as AntennaPod would (GET /api/2/episodes/user.json?since=0)
  const actions = getEpisodeActions(db, user.id, 0);
  assert.ok(actions.actions.length >= 1);
  const lastAction = actions.actions[actions.actions.length - 1];
  assert.equal(lastAction.podcast, podcastUrl);
  assert.equal(lastAction.episode, episodeUrl);
  assert.equal(lastAction.position, 450);
  assert.equal(lastAction.device, 'web');

  // Push actions from AntennaPod to server (POST /api/2/episodes/user.json)
  const clientActions = [
    {
      podcast: podcastUrl,
      episode: episodeUrl,
      guid: 'ep-001',
      action: 'play',
      position: 1200,
      total: 1800,
      device: 'antennapod-android',
      timestamp: new Date().toISOString()
    }
  ];
  applyEpisodeActionsFromClient(db, user.id, clientActions);

  // Verify server state was updated from AntennaPod's sync
  const stateCheck = db.prepare('SELECT position, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?').get(user.id, episodeUrl);
  assert.equal(stateCheck.position, 1200);
});

test('RSS feed parser', () => {
  const sampleRss = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
    <channel>
      <title>Test Science Podcast</title>
      <link>https://science.example.com</link>
      <description>A test podcast about science.</description>
      <itunes:author>Dr. Jane Doe</itunes:author>
      <itunes:image href="https://science.example.com/cover.jpg"/>
      <item>
        <title>Episode 1: Quantum Wonders</title>
        <description>All about quantum entanglement.</description>
        <guid isPermaLink="false">sci-001</guid>
        <pubDate>Mon, 15 Sep 2026 12:00:00 GMT</pubDate>
        <enclosure url="https://science.example.com/ep1.mp3" length="12345678" type="audio/mpeg"/>
        <itunes:duration>45:30</itunes:duration>
        <itunes:episode>1</itunes:episode>
        <itunes:season>2</itunes:season>
      </item>
      <item>
        <title>Episode 2: Deep Space Video</title>
        <description>Telescope video footage.</description>
        <guid isPermaLink="false">sci-002</guid>
        <pubDate>Tue, 16 Sep 2026 12:00:00 GMT</pubDate>
        <enclosure url="https://science.example.com/ep2.mp4" length="98765432" type="video/mp4"/>
        <itunes:duration>01:15:00</itunes:duration>
        <itunes:episode>2</itunes:episode>
      </item>
    </channel>
  </rss>`;

  const result = parsePodcastFeed(sampleRss, 'https://science.example.com/feed.xml');
  assert.equal(result.podcast.title, 'Test Science Podcast');
  assert.equal(result.podcast.author, 'Dr. Jane Doe');
  assert.equal(result.podcast.imageUrl, 'https://science.example.com/cover.jpg');
  assert.equal(result.episodes.length, 2);

  // Audio episode
  assert.equal(result.episodes[0].title, 'Episode 1: Quantum Wonders');
  assert.equal(result.episodes[0].enclosureType, 'audio/mpeg');
  assert.equal(result.episodes[0].duration, 45 * 60 + 30);
  assert.equal(result.episodes[0].episodeNumber, '1');
  assert.equal(result.episodes[0].season, '2');

  // Video episode
  assert.equal(result.episodes[1].title, 'Episode 2: Deep Space Video');
  assert.equal(result.episodes[1].enclosureType, 'video/mp4');
  assert.equal(result.episodes[1].duration, 3600 + 15 * 60);
  assert.equal(result.episodes[1].episodeNumber, '2');

  // HTML entities and character references decoding test
  const sampleWithEntities = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>Driver&#39;s Seat &amp; &quot;Speed&quot;</title>
      <description>Author&#39;s notes &amp; reviews</description>
      <item>
        <title><![CDATA[Episode 1: Driver&#39;s Journey &rsquo;Special&rsquo;]]></title>
        <enclosure url="https://example.com/ep.mp3" type="audio/mpeg"/>
      </item>
    </channel>
  </rss>`;
  const parsedEntities = parsePodcastFeed(sampleWithEntities, 'https://example.com/feed.xml');
  assert.equal(parsedEntities.podcast.title, 'Driver\'s Seat & "Speed"');
  assert.equal(parsedEntities.podcast.description, 'Author\'s notes & reviews');
  assert.equal(parsedEntities.episodes[0].title, 'Episode 1: Driver\'s Journey \'Special\'');
});

test('Configuration storage', () => {
  const db = getDatabase(TEST_DATA_DIR);
  setConfig(db, 'skip_forward_sec', '45');
  setConfig(db, 'skip_back_sec', '15');
  const cfg = getAllConfig(db);
  assert.equal(cfg.skip_forward_sec, '45');
  assert.equal(cfg.skip_back_sec, '15');

  // Clean up test data dir
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }
});
