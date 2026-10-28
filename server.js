import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainWithFoundry, explainObservationWithFoundry, inspectFrameWithFoundry,
  summarizePreviousLinesWithFoundry, validateRecapLines,
  validateObservation, validateCommentaryStyle, validateDeliveryMode,
  validateViewerCue } from './ai_explain.js';
import { createVisionBridge } from './vision_bridge.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3008);
const host = process.env.HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const configured = Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_DEPLOYMENT);
const frameAiConfigured = Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_VISION_DEPLOYMENT);
let frameCalls = 0;
const maxFrameCalls = 36;
let recapCalls = 0;
const maxRecapCalls = 3;
const match = JSON.parse(await fs.readFile(path.join(root, 'data/match.json'), 'utf8'));
const vision = createVisionBridge(root);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/status') return json(res, 200, {
    azureConfigured: configured, frameAiConfigured, frameCallsRemaining: maxFrameCalls - frameCalls,
    recapCallsRemaining: maxRecapCalls - recapCalls,
    visionAvailable: vision.available
  });
  if (url.pathname === '/api/frame' && req.method === 'POST') {
    if (!vision.available) return json(res, 503, { error: 'Local vision model is not installed.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1_700_000) return json(res, 413, { error: 'Frame is too large.' });
    }
    let jpeg;
    try { ({ jpeg } = JSON.parse(body)); } catch { return json(res, 400, { error: 'Invalid frame request.' }); }
    try { return json(res, 200, await vision.analyze(jpeg)); }
    catch (error) { return json(res, 502, { error: error.message }); }
  }
  if (url.pathname === '/api/vision-explain' && req.method === 'POST') {
    if (!configured) return json(res, 503, { error: 'Azure model is not configured.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 512) return json(res, 413, { error: 'Observation is too large.' });
    }
    let observation;
    try { observation = validateObservation(JSON.parse(body)); }
    catch { return json(res, 400, { error: 'Invalid observation.' }); }
    try {
      return json(res, 200, await explainObservationWithFoundry({ observation,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
        apiKey: process.env.AZURE_OPENAI_API_KEY }));
    } catch (error) { return json(res, 502, { error: error.message }); }
  }
  if (url.pathname === '/api/visual-commentary' && req.method === 'POST') {
    if (!frameAiConfigured) return json(res, 503, { error: 'No image-capable Foundry deployment configured.' });
    if (frameCalls >= maxFrameCalls) return json(res, 429, { error: 'AI mode frame limit reached for this server session.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 3_400_000) return json(res, 413, { error: 'Frames are too large.' });
    }
    let jpeg, previousJpeg, previousCaption, style, deliveryMode, viewerCue;
    try {
      ({ jpeg, previousJpeg = null, previousCaption = null,
        style = 'simple', deliveryMode = 'description', viewerCue = null } = JSON.parse(body));
      style = validateCommentaryStyle(style);
      deliveryMode = validateDeliveryMode(deliveryMode);
      viewerCue = validateViewerCue(viewerCue);
    }
    catch { return json(res, 400, { error: 'Invalid image request.' }); }
    const validFrame = value => typeof value === 'string' && value.length >= 100 &&
      value.length <= 1_600_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.startsWith('/9j/');
    if (!validFrame(jpeg) || (previousJpeg !== null && !validFrame(previousJpeg)) ||
        (previousCaption !== null && (typeof previousCaption !== 'string' || previousCaption.length > 180)))
      return json(res, 400, { error: 'Invalid JPEG frame.' });
    frameCalls += 1;
    try {
      return json(res, 200, await inspectFrameWithFoundry({ jpeg, previousJpeg, previousCaption,
        style, deliveryMode, viewerCue,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_VISION_DEPLOYMENT,
        apiKey: process.env.AZURE_OPENAI_API_KEY }));
    } catch (error) { return json(res, 502, { error: error.message }); }
  }
  if (url.pathname === '/api/phase-summary' && req.method === 'POST') {
    if (!frameAiConfigured) return json(res, 503, { error: 'No Foundry model configured.' });
    if (recapCalls >= maxRecapCalls) return json(res, 429, { error: 'Recap limit reached for this launch.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 15000) return json(res, 413, { error: 'Recap record is too large.' });
    }
    let lines;
    try { ({ lines } = validateRecapLines(JSON.parse(body))); }
    catch { return json(res, 400, { error: 'Invalid recap lines.' }); }
    recapCalls += 1;
    try {
      return json(res, 200, await summarizePreviousLinesWithFoundry({ lines,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_VISION_DEPLOYMENT,
        apiKey: process.env.AZURE_OPENAI_API_KEY }));
    } catch (error) { return json(res, 502, { error: error.message }); }
  }
  if (url.pathname === '/api/explain' && req.method === 'POST') {
    if (!configured) return json(res, 503, { error: 'Azure model is not configured.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) return json(res, 413, { error: 'Request too large.' });
    }
    let eventId, mode;
    try { ({ eventId, mode } = JSON.parse(body)); } catch { return json(res, 400, { error: 'Invalid JSON.' }); }
    if (!['tactical', 'emotion', 'casual'].includes(mode)) return json(res, 400, { error: 'Unknown perspective.' });
    if (!match.events.some(event => event.event_id === eventId)) return json(res, 404, { error: 'Unknown event.' });
    try {
      const result = await explainWithFoundry({ match, eventId, mode,
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
        apiKey: process.env.AZURE_OPENAI_API_KEY });
      json(res, 200, result);
    } catch (error) { json(res, 502, { error: error.message }); }
    return;
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  const videoRoutes = { '/sample-video': ['input/amateur_goal.webm', 'video/webm'], '/tactical-video': ['input/new_zealand_canada_2018_10s.webm', 'video/webm'], '/demo-video': ['output/MatchForEveryFan_RealFootage_Demo.mp4', 'video/mp4'] };
  if (videoRoutes[url.pathname]) {
    try {
      const [relative, mime] = videoRoutes[url.pathname];
      const file = path.join(root, relative);
      const stat = await fs.stat(file);
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0;
      const end = range && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      const handle = await fs.open(file, 'r');
      const data = Buffer.alloc(end - start + 1);
      try { await handle.read(data, 0, data.length, start); } finally { await handle.close(); }
      res.writeHead(range ? 206 : 200, { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Content-Length': data.length,
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stat.size}` } : {}) });
      return res.end(data);
    } catch { return json(res, 404, { error: 'Optional sample absent. Run scripts/download_tactical_clip.py. Synthetic demo is available.' }); }
  }
  let pathname = url.pathname === '/' ? '/mode.html' : url.pathname;
  if (!/^\/(mode\.html|mode\.js|mode\.css|live\.html|index\.html|replay\.html|live\.js|live\.css|app\.js|engine\.js|styles\.css|data\/(match|amateur_goal_annotations|tactical_frame_annotations)\.json)$/.test(pathname)) return json(res, 404, { error: 'Not found.' });
  try {
    const file = path.join(root, pathname.slice(1));
    const contents = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store' });
    res.end(contents);
  } catch { json(res, 404, { error: 'Not found.' }); }
});
server.listen(port, host, () => console.log(`Demo ready at http://${host}:${port}`));
export default server;
