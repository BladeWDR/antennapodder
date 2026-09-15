import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { getDatabase, getUserByUsername } from '../src/db.js';
import { handleGpodderRoutes } from '../src/gpodder.js';
import { handleWebRoutes } from '../src/web-api.js';

const E2E_DATA_DIR = path.join(process.cwd(), 'data-e2e');

test('End-to-End 2-way sync between Web UI and AntennaPod', async (t) => {
  if (fs.existsSync(E2E_DATA_DIR)) {
    fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(E2E_DATA_DIR);
  const adminUser = getUserByUsername(db, 'admin');
  assert.ok(adminUser);

  // Spin up a test server
  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const query = urlObj.searchParams;

    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', async () => {
      let body = null;
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }

      if (pathname === '/mock-feed.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <title>Daily Tech Talk</title>
              <link>http://127.0.0.1/daily</link>
              <description>A daily podcast about technology</description>
              <item>
                <title>Episode 101: Web Standards</title>
                <enclosure url="http://127.0.0.1/episodes/101.mp3" length="1000" type="audio/mpeg" />
                <guid>ep-101</guid>
                <pubDate>Mon, 15 Sep 2026 10:00:00 GMT</pubDate>
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

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => {
    server.close();
    if (fs.existsSync(E2E_DATA_DIR)) {
      fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
    }
  });

  // Step 1: Web UI Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie && cookie.includes('sessionid='));

  // Step 2: Web UI user subscribes to a podcast feed
  const testFeedUrl = `${baseUrl}/mock-feed.xml`;
  const episodeUrl = 'http://127.0.0.1/episodes/101.mp3';

  // Add subscription in Web UI (fetches mock feed, parses episodes, stores in db)
  const subRes = await fetch(`${baseUrl}/api/library/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: testFeedUrl })
  });
  assert.equal(subRes.status, 200);
  const subData = await subRes.json();
  const podcastId = subData.podcast.id;

  // Step 3: AntennaPod connects via gPodder API v2
  // AntennaPod logs in
  const authHeader = 'Basic ' + Buffer.from('admin:admin').toString('base64');
  const apLoginRes = await fetch(`${baseUrl}/api/2/auth/admin/login.json`, {
    method: 'POST',
    headers: { 'Authorization': authHeader }
  });
  assert.equal(apLoginRes.status, 200);

  // AntennaPod pulls subscription delta
  const apSubRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/antennapod-phone.json?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(apSubRes.status, 200);
  const apSubData = await apSubRes.json();
  assert.ok(apSubData.add.includes(testFeedUrl), 'AntennaPod received the new subscription from the web');

  // Step 4: Web UI user listens to episode, scrubs to 450 seconds (25%), pauses
  const epRow = db.prepare('SELECT id FROM episodes WHERE enclosure_url = ?').get(episodeUrl);
  const stateRes = await fetch(`${baseUrl}/api/episodes/${epRow.id}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ position: 450, total: 1800, is_played: 0, action: 'play' })
  });
  assert.equal(stateRes.status, 200);

  // Step 5: AntennaPod performs scheduled sync: queries episode actions
  const apActionsRes = await fetch(`${baseUrl}/api/2/episodes/admin.json?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(apActionsRes.status, 200);
  const apActionsData = await apActionsRes.json();
  assert.ok(apActionsData.actions.length > 0);
  const syncedAction = apActionsData.actions.find(a => a.episode === episodeUrl);
  assert.ok(syncedAction, 'AntennaPod found the action recorded in web app');
  assert.equal(syncedAction.position, 450, 'AntennaPod received exact playback position from web player');

  // Step 6: User finishes listening on AntennaPod on their phone (position 1800, played)
  // AntennaPod pushes episode action to server
  const pushRes = await fetch(`${baseUrl}/api/2/episodes/admin.json`, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        podcast: testFeedUrl,
        episode: episodeUrl,
        guid: 'ep-101',
        action: 'play',
        position: 1800,
        total: 1800,
        device: 'antennapod-phone',
        timestamp: new Date().toISOString()
      }
    ])
  });
  assert.equal(pushRes.status, 200);

  // Step 7: Web UI re-queries podcast detail; episode is now marked as played!
  const podDetailRes = await fetch(`${baseUrl}/api/podcasts/${podcastId}`, {
    headers: { 'Cookie': cookie }
  });
  const podDetailData = await podDetailRes.json();
  const epCheck = podDetailData.podcast.episodes.find(e => e.enclosure_url === episodeUrl);
  assert.equal(epCheck.is_played, 1, 'Episode is marked as played in Web UI after AntennaPod sync');
  assert.equal(epCheck.position, 1800, 'Position is 1800 in Web UI');

  // Step 8: Nextcloud compatibility endpoint test
  const ncSubRes = await fetch(`${baseUrl}/index.php/apps/gpoddersync/subscriptions?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(ncSubRes.status, 200);
  const ncSubData = await ncSubRes.json();
  assert.ok(ncSubData.add.includes(testFeedUrl));

  const ncActionRes = await fetch(`${baseUrl}/index.php/apps/gpoddersync/episode_action?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(ncActionRes.status, 200);
  const ncActionData = await ncActionRes.json();
  assert.ok(ncActionData.actions.length > 0);

  // Step 9: Web UI user removes feed; AntennaPod receives removal delta
  const unsubRes = await fetch(`${baseUrl}/api/library/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: testFeedUrl })
  });
  assert.equal(unsubRes.status, 200);

  const apSubRemovalRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/antennapod-phone.json?since=${Math.floor(Date.now() / 1000) - 2}`, {
    headers: { 'Authorization': authHeader }
  });
  const apRemovalData = await apSubRemovalRes.json();
  assert.ok(apRemovalData.remove.includes(testFeedUrl), 'AntennaPod received feed removal delta');
});
