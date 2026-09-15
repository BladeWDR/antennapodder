import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { getDatabase, getUserByUsername, getUserSubscriptionUrls } from '../src/db.js';
import { handleGpodderRoutes } from '../src/gpodder.js';

const SAFETY_DATA_DIR = path.join(process.cwd(), 'data-safety-test');

test('Safety Guarantees: Connecting new AntennaPod never wipes podcasts in either direction', async (t) => {
  if (fs.existsSync(SAFETY_DATA_DIR)) {
    fs.rmSync(SAFETY_DATA_DIR, { recursive: true, force: true });
  }

  const db = getDatabase(SAFETY_DATA_DIR);
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
      const handled = await handleGpodderRoutes(db, req, res, pathname, query, body);
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeader = 'Basic ' + Buffer.from('admin:admin').toString('base64');

  t.after(() => {
    server.close();
    if (fs.existsSync(SAFETY_DATA_DIR)) {
      fs.rmSync(SAFETY_DATA_DIR, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Test Scenario 1:
  // Empty AntennaPodder database + AntennaPod with 10 existing podcasts connects.
  // Must NOT wipe out the 10 podcasts from the phone, and must import them into AntennaPodder.
  // =========================================================================
  const phone1Podcasts = [
    'https://feeds.example.com/podcast-1.xml',
    'https://feeds.example.com/podcast-2.xml',
    'https://feeds.example.com/podcast-3.xml',
    'https://feeds.example.com/podcast-4.xml',
    'https://feeds.example.com/podcast-5.xml',
    'https://feeds.example.com/podcast-6.xml',
    'https://feeds.example.com/podcast-7.xml',
    'https://feeds.example.com/podcast-8.xml',
    'https://feeds.example.com/podcast-9.xml',
    'https://feeds.example.com/podcast-10.xml'
  ];

  // 1a. Phone 1 queries initial subscription delta (since=0)
  const p1InitRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/phone1.json?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(p1InitRes.status, 200);
  const p1InitData = await p1InitRes.json();

  // Crucial check: remove MUST BE EMPTY so AntennaPod does not delete its local podcasts
  assert.equal(p1InitData.remove.length, 0, 'Server must never send removal on empty database');
  assert.equal(p1InitData.add.length, 0, 'Server has 0 additions initially');

  // 1b. Phone 1 pushes its 10 existing local podcasts to AntennaPodder
  const p1PushRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/phone1.json`, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: phone1Podcasts, remove: [] })
  });
  assert.equal(p1PushRes.status, 200);

  // Verify AntennaPodder now has all 10 podcasts
  const serverSubsAfterP1 = getUserSubscriptionUrls(db, adminUser.id);
  assert.equal(serverSubsAfterP1.length, 10);
  for (const url of phone1Podcasts) {
    assert.ok(serverSubsAfterP1.includes(url), `Server contains ${url}`);
  }

  // =========================================================================
  // Test Scenario 2:
  // AntennaPodder has 10 podcasts + Brand new AntennaPod installation (0 podcasts) connects.
  // Must send all 10 podcasts to the new phone without wiping server data.
  // =========================================================================
  
  // 2a. Brand new Phone 2 queries initial subscription delta (since=0)
  const p2InitRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/phone2-brand-new.json?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(p2InitRes.status, 200);
  const p2InitData = await p2InitRes.json();

  // Phone 2 must receive all 10 podcasts to add, and 0 to remove
  assert.equal(p2InitData.add.length, 10, 'New phone receives all 10 existing podcasts');
  assert.equal(p2InitData.remove.length, 0, 'New phone receives 0 removals');

  // 2b. Phone 2 uploads its local delta (it has nothing to add and nothing to remove)
  const p2PushRes = await fetch(`${baseUrl}/api/2/subscriptions/admin/phone2-brand-new.json`, {
    method: 'POST',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ add: [], remove: [] })
  });
  assert.equal(p2PushRes.status, 200);

  // Verify server subscriptions were NOT wiped
  const serverSubsAfterP2 = getUserSubscriptionUrls(db, adminUser.id);
  assert.equal(serverSubsAfterP2.length, 10, 'Server subscriptions remain completely intact');

  // =========================================================================
  // Test Scenario 3:
  // Non-destructive safeguard on PUT /subscriptions/:user/:device.json
  // If an uninitialized client accidentally sends an empty PUT list, it must NOT wipe data.
  // =========================================================================
  const emptyPutRes = await fetch(`${baseUrl}/subscriptions/admin/some-device.json`, {
    method: 'PUT',
    headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify([])
  });
  assert.equal(emptyPutRes.status, 200);

  const serverSubsAfterEmptyPut = getUserSubscriptionUrls(db, adminUser.id);
  assert.equal(serverSubsAfterEmptyPut.length, 10, 'Empty PUT payload did not wipe subscriptions');

  // =========================================================================
  // Test Scenario 4:
  // Nextcloud gpoddersync compatibility endpoint verification under same conditions
  // =========================================================================
  const ncInitRes = await fetch(`${baseUrl}/index.php/apps/gpoddersync/subscriptions?since=0`, {
    headers: { 'Authorization': authHeader }
  });
  assert.equal(ncInitRes.status, 200);
  const ncInitData = await ncInitRes.json();
  assert.equal(ncInitData.add.length, 10, 'Nextcloud endpoint returns all 10 podcasts');
  assert.equal(ncInitData.remove.length, 0, 'Nextcloud endpoint returns 0 removals');
});
