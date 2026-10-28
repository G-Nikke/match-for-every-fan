import assert from 'node:assert/strict';
import { once } from 'node:events';
import server from '../server.js';

if (!server.listening) await once(server, 'listening');
const { address, port } = server.address();
const base = `http://${address}:${port}`;
try {
  for (const route of ['/', '/mode.html', '/mode.js', '/mode.css', '/live.html', '/live.js', '/live.css', '/replay.html', '/app.js', '/engine.js', '/styles.css', '/data/match.json', '/data/amateur_goal_annotations.json', '/data/tactical_frame_annotations.json', '/api/status']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok((await response.text()).length > 0, route);
  }
  const match = await fetch(base + '/data/match.json').then(response => response.json());
  assert.equal(match.events.length, 45);
  assert.deepEqual(match.events.at(-1).score_after, [2, 1]);
  const status = await fetch(base + '/api/status').then(response => response.json());
  assert.equal(typeof status.azureConfigured, 'boolean');
  assert.equal(typeof status.frameAiConfigured, 'boolean');
  assert.equal(status.frameCallsRemaining, 36);
  assert.equal(typeof status.visionAvailable, 'boolean');
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.equal((await fetch(base + '/line_tracker.js')).status, 404);
  assert.equal((await fetch(base + '/reference/anything')).status, 404);
  if (!status.azureConfigured) assert.equal((await fetch(base + '/api/explain', {method:'POST', body:'{}'})).status, 503);
  if (!status.azureConfigured) assert.equal((await fetch(base + '/api/vision-explain', {method:'POST', body:'{}'})).status, 503);
  if (!status.frameAiConfigured) assert.equal((await fetch(base + '/api/visual-commentary', {method:'POST', body:'{}'})).status, 503);
  const sample = await fetch(base + '/sample-video', {headers:{Range:'bytes=0-0'}});
  assert.ok([206,404].includes(sample.status), 'Optional clip works or gives a missing-file fallback');
  if (sample.status === 206) {
    assert.equal((await sample.arrayBuffer()).byteLength, 1);
    assert.match(sample.headers.get('content-range'), /^bytes 0-0\//);
    assert.equal((await fetch(base + '/sample-video', {headers:{Range:'bytes=999999999-'}})).status, 416);
  }
  for (const route of ['/tactical-video', '/demo-video']) {
    const response = await fetch(base + route, {headers:{Range:'bytes=0-15'}});
    assert.ok([206,404].includes(response.status), route);
    if(response.status===206) assert.equal((await response.arrayBuffer()).byteLength,16);
  }
  console.log('HTTP smoke check passed: page, assets, data and API status.');
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
