import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {
  getDatabase,
  getUserByUsername,
  upsertPodcast,
  upsertEpisode,
  applyEpisodeActionsFromClient
} from '../src/db.js';
import { handleGpodderRoutes } from '../src/gpodder.js';
import { handleWebRoutes } from '../src/web-api.js';

const TEST_DATA_DIR = path.join(process.cwd(), 'data-test-inprogress');

test('In-progress episode sync and Nextcloud form-urlencoded actions support', async (t) => {
  if (fs.existsSync(TEST_DATA_DIR)) {
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(TEST_DATA_DIR);
  const adminUser = getUserByUsername(db, 'admin');
  assert.ok(adminUser);

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const query = urlObj.searchParams;

    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      let body = null;
      const contentType = req.headers['content-type'] || '';
      if (raw) {
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(raw);
          body = {};
          for (const [k, v] of params.entries()) {
            body[k] = v;
          }
        } else {
          try { body = JSON.parse(raw); } catch { body = raw; }
        }
      }

      if (pathname === '/mock-feed.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <title>Deep Dives Tech</title>
              <link>http://127.0.0.1/deepdives</link>
              <description>Deep tech dives</description>
              <item>
                <title>Episode 1: Architecture</title>
                <enclosure url="http://127.0.0.1/episodes/1.mp3" length="3600" type="audio/mpeg" />
                <guid>guid-ep-1</guid>
                <pubDate>Mon, 15 Sep 2026 10:00:00 GMT</pubDate>
              </item>
              <item>
                <title>Episode 2: Distributed Systems</title>
                <enclosure url="http://127.0.0.1/episodes/2.mp3" length="4200" type="audio/mpeg" />
                <guid>guid-ep-2</guid>
                <pubDate>Tue, 16 Sep 2026 10:00:00 GMT</pubDate>
              </item>
            </channel>
          </rss>`);
        return;
      }

      const gpodderHandled = await handleGpodderRoutes(db, req, res, pathname, query, body);
      if (gpodderHandled) return;

      const webHandled = await handleWebRoutes(db, req, res, pathname, query, body);
      if (webHandled) return;

      res.writeHead(404);
      res.end('Not Found');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  t.after(() => {
    server.close();
    fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  const authHeader = 'Basic ' + Buffer.from('admin:admin').toString('base64');

  // 1. Subscribe to podcast via Web API
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie);

  const subRes = await fetch(`${baseUrl}/api/library/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: `${baseUrl}/mock-feed.xml` })
  });
  assert.equal(subRes.status, 200);

  // 2. AntennaPod sends Nextcloud episode action as form-urlencoded actions string
  // Simulate 2 in-progress episodes: Ep 1 at 1200s, Ep 2 at 850s
  const actionPayload = JSON.stringify([
    {
      podcast: `${baseUrl}/mock-feed.xml`,
      episode: 'http://127.0.0.1/episodes/1.mp3',
      guid: 'guid-ep-1',
      action: 'play',
      position: 1200,
      total: 3600,
      device: 'antennapod-android',
      timestamp: new Date().toISOString()
    },
    {
      podcast: `${baseUrl}/mock-feed.xml`,
      episode: 'http://127.0.0.1/episodes/2.mp3',
      guid: 'guid-ep-2',
      action: 'play',
      position: 850,
      total: 4200,
      device: 'antennapod-android',
      timestamp: new Date().toISOString()
    }
  ]);

  const formBody = new URLSearchParams({ actions: actionPayload }).toString();
  const ncActionRes = await fetch(`${baseUrl}/index.php/apps/gpoddersync/episode_action/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': authHeader
    },
    body: formBody
  });
  assert.equal(ncActionRes.status, 200);
  const ncActionData = await ncActionRes.json();
  assert.ok(ncActionData.timestamp > 0);

  // 3. Web UI requests /api/episodes/in-progress
  const inProgRes = await fetch(`${baseUrl}/api/episodes/in-progress`, {
    headers: { 'Cookie': cookie }
  });
  assert.equal(inProgRes.status, 200);
  const inProgData = await inProgRes.json();
  assert.equal(inProgData.episodes.length, 2, 'Both in-progress episodes returned');
  
  const ep1 = inProgData.episodes.find(e => e.guid === 'guid-ep-1');
  assert.ok(ep1);
  assert.equal(ep1.position, 1200);
  assert.equal(ep1.is_played, 0);
  assert.equal(ep1.podcast_title, 'Deep Dives Tech');

  const ep2 = inProgData.episodes.find(e => e.guid === 'guid-ep-2');
  assert.ok(ep2);
  assert.equal(ep2.position, 850);
  assert.equal(ep2.is_played, 0);

  // 4. Also verify podcast detail reflects in-progress position
  const podRes = await fetch(`${baseUrl}/api/podcasts/${ep1.podcast_id}`, {
    headers: { 'Cookie': cookie }
  });
  const podData = await podRes.json();
  const detailEp1 = podData.podcast.episodes.find(e => e.guid === 'guid-ep-1');
  assert.equal(detailEp1.position, 1200);
  assert.equal(detailEp1.is_played, 0);

  // 5. User finishes Ep 1 on web -> updates state to played
  const stateUpdateRes = await fetch(`${baseUrl}/api/episodes/${ep1.id}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ position: 3600, total: 3600, is_played: 1, action: 'play' })
  });
  assert.equal(stateUpdateRes.status, 200);

  // In-progress list should now only contain Ep 2
  const inProgAfterRes = await fetch(`${baseUrl}/api/episodes/in-progress`, {
    headers: { 'Cookie': cookie }
  });
  const inProgAfterData = await inProgAfterRes.json();
  assert.equal(inProgAfterData.episodes.length, 1);
  assert.equal(inProgAfterData.episodes[0].guid, 'guid-ep-2');

  // 6. Unsubscribe from podcast -> in-progress list should exclude its episodes
  const unsubRes = await fetch(`${baseUrl}/api/library/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: `${baseUrl}/mock-feed.xml` })
  });
  assert.equal(unsubRes.status, 200);

  const inProgAfterUnsubRes = await fetch(`${baseUrl}/api/episodes/in-progress`, {
    headers: { 'Cookie': cookie }
  });
  const inProgAfterUnsubData = await inProgAfterUnsubRes.json();
  assert.equal(inProgAfterUnsubData.episodes.length, 0, 'In-progress episodes from unsubscribed podcast are removed');

  // 7. Resubscribing brings active in-progress episodes back
  const resubRes = await fetch(`${baseUrl}/api/library/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: `${baseUrl}/mock-feed.xml` })
  });
  assert.equal(resubRes.status, 200);

  const inProgAfterResubRes = await fetch(`${baseUrl}/api/episodes/in-progress`, {
    headers: { 'Cookie': cookie }
  });
  const inProgAfterResubData = await inProgAfterResubRes.json();
  assert.equal(inProgAfterResubData.episodes.length, 1);
  assert.equal(inProgAfterResubData.episodes[0].guid, 'guid-ep-2');
});

test('Playback state is preserved across client download, delete, and file management actions', async () => {
  const testDir = path.join(process.cwd(), 'data-test-delete-preservation');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }

  const db = getDatabase(testDir);
  const admin = getUserByUsername(db, 'admin');

  const podId = upsertPodcast(db, {
    url: 'https://example.com/test-show.xml',
    title: 'Test Show',
    description: 'A podcast for testing',
    imageUrl: 'https://example.com/test.jpg',
    author: 'Tester',
    link: 'https://example.com'
  });

  const epId = upsertEpisode(db, podId, {
    guid: 'test-ep-159',
    title: 'Episode 159',
    enclosure_url: 'https://example.com/audio/159.mp3',
    duration: 1500,
    pub_date: 1700000000
  });

  // 1. Client sends play action finishing the episode (100% played)
  applyEpisodeActionsFromClient(db, admin.id, [{
    podcast: 'https://example.com/test-show.xml',
    episode: 'https://example.com/audio/159.mp3',
    guid: 'test-ep-159',
    action: 'play',
    position: 1500,
    total: 1500,
    device: 'antennapod',
    timestamp: '2026-09-21T20:00:00Z'
  }]);

  let state = db.prepare('SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?')
    .get(admin.id, 'https://example.com/audio/159.mp3');
  assert.equal(state.is_played, 1, 'Episode should be played after play action');
  assert.equal(state.position, 1500, 'Position should be 1500');

  // 2. Client auto-deletes the downloaded file after playback: sends action: 'delete' with position: 0
  applyEpisodeActionsFromClient(db, admin.id, [{
    podcast: 'https://example.com/test-show.xml',
    episode: 'https://example.com/audio/159.mp3',
    guid: 'test-ep-159',
    action: 'delete',
    position: 0,
    total: 1500,
    device: 'antennapod',
    timestamp: '2026-09-21T20:00:01Z'
  }]);

  state = db.prepare('SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?')
    .get(admin.id, 'https://example.com/audio/159.mp3');
  assert.equal(state.is_played, 1, 'Episode played status MUST NOT be wiped by delete action');
  assert.equal(state.position, 1500, 'Episode playback position MUST NOT be wiped by delete action');

  // 3. Client re-downloads the file: sends action: 'download' with position: 0
  applyEpisodeActionsFromClient(db, admin.id, [{
    podcast: 'https://example.com/test-show.xml',
    episode: 'https://example.com/audio/159.mp3',
    guid: 'test-ep-159',
    action: 'download',
    position: 0,
    total: 1500,
    device: 'antennapod',
    timestamp: '2026-09-21T20:00:02Z'
  }]);

  state = db.prepare('SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?')
    .get(admin.id, 'https://example.com/audio/159.mp3');
  assert.equal(state.is_played, 1, 'Download action MUST NOT overwrite played status');
  assert.equal(state.position, 1500, 'Download action MUST NOT overwrite playback position');

  // 4. Batch action upload with play + delete together in the same sync batch (typical AntennaPod sync)
  const ep2Id = upsertEpisode(db, podId, {
    guid: 'test-ep-160',
    title: 'Episode 160',
    enclosure_url: 'https://example.com/audio/160.mp3',
    duration: 2000,
    pub_date: 1700001000
  });

  applyEpisodeActionsFromClient(db, admin.id, [
    {
      podcast: 'https://example.com/test-show.xml',
      episode: 'https://example.com/audio/160.mp3',
      guid: 'test-ep-160',
      action: 'play',
      position: 2000,
      total: 2000,
      device: 'antennapod',
      timestamp: '2026-09-21T20:10:00Z'
    },
    {
      podcast: 'https://example.com/test-show.xml',
      episode: 'https://example.com/audio/160.mp3',
      guid: 'test-ep-160',
      action: 'delete',
      position: 0,
      total: 2000,
      device: 'antennapod',
      timestamp: '2026-09-21T20:10:00Z'
    }
  ]);

  state = db.prepare('SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?')
    .get(admin.id, 'https://example.com/audio/160.mp3');
  assert.equal(state.is_played, 1, 'Play followed by delete in the same batch must preserve is_played = 1');
  assert.equal(state.position, 2000, 'Play followed by delete in the same batch must preserve position = 2000');

  // 5. Explicit "Mark as unplayed" (action: 'new') should reset state
  applyEpisodeActionsFromClient(db, admin.id, [{
    podcast: 'https://example.com/test-show.xml',
    episode: 'https://example.com/audio/160.mp3',
    guid: 'test-ep-160',
    action: 'new',
    position: 0,
    total: 2000,
    device: 'antennapod',
    timestamp: '2026-09-21T20:15:00Z'
  }]);

  state = db.prepare('SELECT position, total, is_played FROM episode_states WHERE user_id = ? AND episode_url = ?')
    .get(admin.id, 'https://example.com/audio/160.mp3');
  assert.equal(state.is_played, 0, 'Explicit action "new" resets is_played to 0');
  assert.equal(state.position, 0, 'Explicit action "new" resets position to 0');

  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
});

