import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { getDatabase, getUserByUsername, getUserSubscriptionUrls } from '../src/db.js';
import { handleGpodderRoutes } from '../src/gpodder.js';
import { handleWebRoutes } from '../src/web-api.js';

const TEST_DIR = path.join(process.cwd(), 'data-three-way-test');

test('3-way subscription synchronization (Mobile Device 1, Mobile Device 2, and Web UI)', async (t) => {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(TEST_DIR);
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
      if (raw) {
        try { body = JSON.parse(raw); } catch { body = raw; }
      }

      if (pathname.startsWith('/mock-feed-')) {
        const feedNum = pathname.replace('/mock-feed-', '').replace('.xml', '');
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <title>Podcast ${feedNum}</title>
              <link>http://127.0.0.1/podcast-${feedNum}</link>
              <description>Description for podcast ${feedNum}</description>
              <item>
                <title>Episode 1</title>
                <enclosure url="http://127.0.0.1/audio-${feedNum}.mp3" length="1000" type="audio/mpeg" />
                <guid>ep-${feedNum}-1</guid>
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
  const authHeader = 'Basic ' + Buffer.from('admin:admin').toString('base64');

  t.after(() => {
    server.close();
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // Log in to Web UI
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin' })
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie');
  assert.ok(cookie);

  // Helper to fetch active subscriptions from Web UI
  async function getWebSubscriptions() {
    const res = await fetch(`${baseUrl}/api/library`, {
      headers: { 'Cookie': cookie }
    });
    const data = await res.json();
    return data.subscriptions.map(s => s.podcast_url);
  }

  // Device simulation states
  const phone1 = {
    deviceId: 'phone-1',
    lastSync: 0,
    subscriptions: new Set()
  };

  const phone2 = {
    deviceId: 'phone-2',
    lastSync: 0,
    subscriptions: new Set()
  };

  // Helper to simulate AntennaPod sync algorithm on a device
  async function syncDevice(device, localAdd = [], localRemove = []) {
    // 1. Get remote delta
    const getRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/${device.deviceId}.json?since=${device.lastSync}`, {
      headers: { 'Authorization': authHeader }
    });
    assert.equal(getRes.status, 200);
    const delta = await getRes.json();
    let newTimestamp = delta.timestamp;

    // Apply remote additions
    for (const url of delta.add) {
      device.subscriptions.add(url);
    }
    // Apply remote removals
    for (const url of delta.remove) {
      device.subscriptions.delete(url);
    }

    // Apply local changes
    for (const url of localAdd) {
      device.subscriptions.add(url);
    }
    for (const url of localRemove) {
      device.subscriptions.delete(url);
    }

    // 2. Upload local changes if any
    if (localAdd.length > 0 || localRemove.length > 0) {
      const postRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/${device.deviceId}.json`, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ add: localAdd, remove: localRemove })
      });
      assert.equal(postRes.status, 200);
      const postData = await postRes.json();
      newTimestamp = postData.timestamp;
    }

    device.lastSync = newTimestamp;
  }

  const feedA = `${baseUrl}/mock-feed-A.xml`;
  const feedB = `${baseUrl}/mock-feed-B.xml`;
  const feedC = `${baseUrl}/mock-feed-C.xml`;

  // --- SCENARIO 1: Phone 1 subscribes to feedA ---
  // Phone 1 pushes feedA
  await syncDevice(phone1, [feedA], []);
  assert.ok(phone1.subscriptions.has(feedA), 'Phone 1 has feedA');

  // Web UI should immediately have feedA
  const webSubsAfter1 = await getWebSubscriptions();
  assert.ok(webSubsAfter1.includes(feedA), 'Web UI immediately shows feedA added from Phone 1');

  // Phone 2 syncs for the first time (since=0) -> receives feedA
  await syncDevice(phone2, [], []);
  assert.ok(phone2.subscriptions.has(feedA), 'Phone 2 receives feedA during initial sync');

  // --- SCENARIO 2: Web UI subscribes to feedB ---
  const subRes = await fetch(`${baseUrl}/api/library/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: feedB })
  });
  assert.equal(subRes.status, 200);

  // Web UI has both feedA and feedB
  const webSubsAfter2 = await getWebSubscriptions();
  assert.ok(webSubsAfter2.includes(feedA));
  assert.ok(webSubsAfter2.includes(feedB));

  // Phone 1 syncs -> receives feedB
  await syncDevice(phone1, [], []);
  assert.ok(phone1.subscriptions.has(feedB), 'Phone 1 receives feedB from Web UI');

  // Phone 2 syncs -> receives feedB
  await syncDevice(phone2, [], []);
  assert.ok(phone2.subscriptions.has(feedB), 'Phone 2 receives feedB from Web UI');

  // --- SCENARIO 3: Phone 2 subscribes to feedC ---
  await syncDevice(phone2, [feedC], []);
  assert.ok(phone2.subscriptions.has(feedC), 'Phone 2 has feedC');

  // Web UI should immediately have feedC
  const webSubsAfter3 = await getWebSubscriptions();
  assert.ok(webSubsAfter3.includes(feedC), 'Web UI immediately shows feedC added from Phone 2');

  // Phone 1 syncs -> receives feedC
  await syncDevice(phone1, [], []);
  assert.ok(phone1.subscriptions.has(feedC), 'Phone 1 receives feedC from Phone 2');

  // All 3 currently have feedA, feedB, feedC
  assert.deepEqual(Array.from(phone1.subscriptions).sort(), [feedA, feedB, feedC].sort());
  assert.deepEqual(Array.from(phone2.subscriptions).sort(), [feedA, feedB, feedC].sort());
  assert.deepEqual(webSubsAfter3.sort(), [feedA, feedB, feedC].sort());

  // --- SCENARIO 4: Phone 1 unsubscribes from feedA ---
  await syncDevice(phone1, [], [feedA]);
  assert.ok(!phone1.subscriptions.has(feedA), 'Phone 1 removed feedA');

  // Web UI should immediately NOT have feedA
  const webSubsAfter4 = await getWebSubscriptions();
  assert.ok(!webSubsAfter4.includes(feedA), 'Web UI removed feedA');
  assert.ok(webSubsAfter4.includes(feedB));
  assert.ok(webSubsAfter4.includes(feedC));

  // Phone 2 syncs -> should receive removal of feedA
  await syncDevice(phone2, [], []);
  assert.ok(!phone2.subscriptions.has(feedA), 'Phone 2 removed feedA after Phone 1 unsubscribed');
  assert.ok(phone2.subscriptions.has(feedB));
  assert.ok(phone2.subscriptions.has(feedC));

  // --- SCENARIO 5: Web UI unsubscribes from feedB ---
  const unsubRes = await fetch(`${baseUrl}/api/library/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ url: feedB })
  });
  assert.equal(unsubRes.status, 200);

  const webSubsAfter5 = await getWebSubscriptions();
  assert.ok(!webSubsAfter5.includes(webSubsAfter5.find(u => u === feedB)), 'Web UI removed feedB');

  // Phone 1 syncs -> receives removal of feedB
  await syncDevice(phone1, [], []);
  assert.ok(!phone1.subscriptions.has(feedB), 'Phone 1 removed feedB');
  assert.ok(phone1.subscriptions.has(feedC));

  // Phone 2 syncs -> receives removal of feedB
  await syncDevice(phone2, [], []);
  assert.ok(!phone2.subscriptions.has(feedB), 'Phone 2 removed feedB');
  assert.ok(phone2.subscriptions.has(feedC));

  // --- SCENARIO 6: Phone 2 unsubscribes from feedC ---
  await syncDevice(phone2, [], [feedC]);
  assert.ok(!phone2.subscriptions.has(feedC), 'Phone 2 removed feedC');

  // Web UI should be empty
  const webSubsAfter6 = await getWebSubscriptions();
  assert.equal(webSubsAfter6.length, 0, 'Web UI has 0 subscriptions');

  // Phone 1 syncs -> receives removal of feedC
  await syncDevice(phone1, [], []);
  assert.equal(phone1.subscriptions.size, 0, 'Phone 1 has 0 subscriptions');
  assert.equal(phone2.subscriptions.size, 0, 'Phone 2 has 0 subscriptions');
});
