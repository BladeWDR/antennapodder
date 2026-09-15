import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { getDatabase, getUserByUsername } from '../src/db.js';
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
});
