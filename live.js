const $ = id => document.getElementById(id);
const video = $('matchVideo');
const overlay = $('detections');
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
let visionAvailable = false, azureConfigured = false, frameAiConfigured = false;
let source = 'sample', stream = null, localUrl = null, generation = 0;
let busy = false, latestObservation = null, lastSpoken = '', lastSpeechAt = 0;
let aiUntil = 0, aiBusy = false;
let aiCalls = 0, lastAiAt = 0;
let frameBusy = false, frameCallsRemaining = 0;
let overlayToken = 0;

function setCaption(text, origin = 'LOCAL CAPTION') {
  $('caption').textContent = text;
  $('insightText').textContent = text;
  $('captionOrigin').textContent = origin;
  if ($('speechToggle').checked && text !== lastSpoken && Date.now() - lastSpeechAt > 7000 &&
      'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; utterance.rate = 0.98;
    speechSynthesis.speak(utterance);
    lastSpoken = text; lastSpeechAt = Date.now();
  }
}

function updateButtons() {
  $('sampleButton').classList.toggle('selected', source === 'sample');
  $('captureButton').classList.toggle('selected', source === 'capture');
  $('fileButton').classList.toggle('selected', source === 'file');
  $('playButton').textContent = video.paused ? '▶ Play' : 'Ⅱ Pause';
  $('muteButton').textContent = video.muted ? '🔇 Muted' : '🔊 Sound on';
  $('muteButton').disabled = source === 'capture';
  $('aiButton').disabled = !azureConfigured || !latestObservation || aiBusy || frameBusy || aiCalls >= 12;
  $('autoAiToggle').disabled = !azureConfigured || aiCalls >= 12;
  $('frameAiButton').disabled = !frameAiConfigured || frameBusy || aiBusy || frameCallsRemaining <= 0 || video.readyState < 2;
}

function clearOverlay() {
  overlayToken += 1;
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

function positionOverlay() {
  if (!video.videoWidth || !video.videoHeight || !overlay.width) return;
  const width = $('stage').clientWidth, height = $('stage').clientHeight;
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  const shownWidth = video.videoWidth * scale, shownHeight = video.videoHeight * scale;
  Object.assign(overlay.style, {
    left: `${(width - shownWidth) / 2}px`, top: `${(height - shownHeight) / 2}px`,
    width: `${shownWidth}px`, height: `${shownHeight}px`
  });
}

function paint(objects, width, height) {
  overlay.width = width; overlay.height = height;
  positionOverlay();
  const pen = overlay.getContext('2d');
  if (!$('boxesToggle').checked) return;
  for (const item of objects) {
    if (!Array.isArray(item.box) || item.box.length !== 4) continue;
    const [x1, y1, x2, y2] = item.box;
    const ball = item.kind === 'ball';
    pen.strokeStyle = item.source === 'last_seen' ? '#ffffff' : ball ? '#f7df55' : '#5ce4ef';
    pen.lineWidth = ball ? 4 : 2;
    pen.setLineDash(item.source === 'last_seen' ? [8, 5] : []);
    pen.strokeRect(x1, y1, x2 - x1, y2 - y1);
    if (ball) {
      pen.font = 'bold 19px Segoe UI, sans-serif';
      pen.fillStyle = '#f7df55';
      pen.fillText(item.source === 'last_seen' ? 'BALL LAST SEEN' : 'POSSIBLE BALL',
        Math.max(4, x1), Math.max(24, y1 - 8));
    }
  }
}

function draw(objects, width, height, ageMs) {
  if (ageMs > 450) { clearOverlay(); return; }
  const token = ++overlayToken;
  const people = objects.filter(item => item.kind === 'person');
  paint(ageMs <= 250 ? objects : people, width, height);
  if (ageMs <= 250 && objects.some(item => item.kind === 'ball')) {
    setTimeout(() => { if (overlayToken === token) paint(people, width, height); }, 150);
  }
  setTimeout(() => { if (overlayToken === token) clearOverlay(); }, 650);
}

function describe(data) {
  const people = data.objects.filter(item => item.kind === 'person');
  const ball = data.objects.find(item => item.kind === 'ball');
  const count = people.length;
  const state = ball ? ball.source === 'last_seen' ? 'Last seen' : 'Possible' : 'Not found';
  $('peopleCount').textContent = String(count);
  $('ballState').textContent = state;
  const peoplePhrase = count ? `about ${count} people visible` : 'no people confirmed';
  let text;
  if (ball) {
    const middle = (ball.box[0] + ball.box[2]) / 2;
    const area = middle < data.width / 3 ? 'left' : middle > data.width * 2 / 3 ? 'right' : 'centre';
    text = ball.source === 'last_seen'
      ? `The ball was last seen near the ${area} of the picture. Its current position is uncertain.`
      : `Recent frame: possible ball near the ${area}; ${peoplePhrase}.`;
  } else {
    text = `Recent frame: ${peoplePhrase}; ball not confirmed.`;
  }
  latestObservation = {
    peopleCount: count, ballState: state,
    ballArea: ball ? ((ball.box[0] + ball.box[2]) / 2 < data.width / 3 ? 'left'
      : (ball.box[0] + ball.box[2]) / 2 > data.width * 2 / 3 ? 'right' : 'centre') : null
  };
  if (Date.now() >= aiUntil) setCaption(text);
  updateButtons();
  if ($('autoAiToggle').checked && !aiBusy && !frameBusy && aiCalls < 12 &&
      Date.now() - lastAiAt >= 20000) requestAi();
}

async function analyzeFrame() {
  if (busy || !visionAvailable || video.paused || video.readyState < 2 ||
      !video.videoWidth || !video.videoHeight) return;
  busy = true;
  const at = generation;
  const capturedAt = performance.now();
  try {
    const scale = Math.min(1600 / video.videoWidth, 1000 / video.videoHeight, 1);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.width = width; canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    const jpeg = canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
    $('analysisState').textContent = 'ANALYSING FRAME';
    const response = await fetch('/api/frame', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jpeg })
    });
    if (!response.ok) throw new Error(`Local vision returned ${response.status}`);
    const data = await response.json();
    if (at !== generation) return;
    draw(data.objects, data.width, data.height, performance.now() - capturedAt);
    describe(data);
    $('analysisState').textContent = `LOCAL VISION · ${data.processingMs} ms`;
  } catch (error) {
    if (at === generation) {
      $('analysisState').textContent = 'VISION PAUSED';
      setCaption(`Local analysis unavailable: ${error.message}`);
    }
  } finally { busy = false; }
}

function stopPrevious() {
  generation += 1;
  if (stream) { for (const track of stream.getTracks()) track.stop(); stream = null; }
  if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; }
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
  latestObservation = null;
  aiUntil = 0;
  $('autoAiToggle').checked = false;
  $('peopleCount').textContent = '—';
  $('ballState').textContent = 'Checking…';
  clearOverlay();
}

function setSource(kind, label, note, help) {
  source = kind;
  $('sourceType').textContent = label;
  $('sourceNote').textContent = note;
  $('sourceHelp').textContent = help;
  $('livePill').textContent = kind === 'capture' ? 'LIVE CAPTURE' : 'LOCAL VIDEO';
  $('analysisState').textContent = 'Starting local analysis…';
  setCaption('Loading football picture…');
  updateButtons();
}

function sample() {
  stopPrevious();
  setSource('sample', 'RECORDED SAMPLE', 'Recorded clip · analysed as it plays',
    'This is real, recorded footage. To watch another match, choose a local clip or share an unprotected match window. Your frames stay on this computer.');
  video.loop = true;
  video.muted = true;
  video.src = '/tactical-video';
  video.play().catch(() => { setCaption('Press Play to start the real football sample.'); });
}

async function capture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setCaption('Screen capture is unavailable in this browser. Try Chrome or Edge on localhost.');
    return;
  }
  let picked;
  try { picked = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
  catch { return; }
  stopPrevious();
  stream = picked;
  setSource('capture', 'WINDOW CAPTURE', 'Window shared by you · analysed as it plays',
    'Choose the window showing your permitted match. You can stop sharing in the browser at any time. Protected streams may appear black.');
  video.loop = false;
  video.muted = true;
  video.srcObject = stream;
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    if (source === 'capture') sample();
  });
  video.play().catch(() => { setCaption('Press Play to view the selected match window.'); });
}

function localFile(file) {
  if (!file) return;
  stopPrevious();
  localUrl = URL.createObjectURL(file);
  setSource('file', 'YOUR LOCAL CLIP', 'Private local clip · analysed as it plays',
    'The chosen video stays in this browser. Local vision receives frames through the loopback server on this computer.');
  video.loop = true;
  video.muted = true;
  video.src = localUrl;
  video.play().catch(() => { setCaption('Press Play to view your clip.'); });
}

$('sampleButton').onclick = sample;
$('captureButton').onclick = capture;
$('fileInput').onchange = event => localFile(event.target.files?.[0]);
$('playButton').onclick = () => { if (video.paused) video.play(); else video.pause(); };
$('muteButton').onclick = () => { video.muted = !video.muted; updateButtons(); };
$('fullButton').onclick = () => $('stage').requestFullscreen?.();
async function requestAi() {
  if (!azureConfigured || !latestObservation || aiBusy || frameBusy || aiCalls >= 12) return;
  aiBusy = true;
  aiCalls += 1;
  lastAiAt = Date.now();
  $('aiState').textContent = 'Foundry is writing a caption from local detections (no video sent)…';
  updateButtons();
  try {
    const response = await fetch('/api/vision-explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(latestObservation)
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(typeof failure.error === 'string' ? failure.error : `Request returned ${response.status}`);
    }
    const result = await response.json();
    if (result.source !== 'foundry-observation' || typeof result.text !== 'string')
      throw new Error('The model answer was not accepted.');
    aiUntil = Date.now() + 12000;
    setCaption(result.text, 'CLOUD AI CAPTION');
    $('aiState').textContent = 'Cloud AI caption shown for 12 seconds. It used the local detection summary only.';
  } catch (error) {
    $('aiState').textContent = `AI unavailable: ${error.message}. Local vision continues.`;
  } finally {
    aiBusy = false;
    if (aiCalls >= 12) {
      $('autoAiToggle').checked = false;
      $('aiState').textContent += ' Session AI limit reached.';
    }
    updateButtons();
  }
}
$('aiButton').onclick = requestAi;
async function inspectOneFrame() {
  if (!frameAiConfigured || frameBusy || frameCallsRemaining <= 0 || video.readyState < 2) return;
  frameBusy = true;
  const at = generation;
  $('frameAiState').textContent = 'Sending one selected frame to Foundry for visual analysis…';
  updateButtons();
  try {
    const snapshot = document.createElement('canvas');
    const scale = Math.min(1600 / video.videoWidth, 1000 / video.videoHeight, 1);
    snapshot.width = Math.max(1, Math.round(video.videoWidth * scale));
    snapshot.height = Math.max(1, Math.round(video.videoHeight * scale));
    snapshot.getContext('2d').drawImage(video, 0, 0, snapshot.width, snapshot.height);
    const jpeg = snapshot.toDataURL('image/jpeg', 0.65).split(',')[1];
    const response = await fetch('/api/visual-commentary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jpeg })
    });
    frameCallsRemaining -= 1;
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(typeof failure.error === 'string' ? failure.error : `Request returned ${response.status}`);
    }
    const result = await response.json();
    if (at !== generation) return;
    if (result.source !== 'foundry-frame' || typeof result.text !== 'string')
      throw new Error('The image model answer was not accepted.');
    aiUntil = Date.now() + 12000;
    setCaption(result.text, 'CLOUD FRAME CAPTION');
    const ballReview = result.ballStatus === 'possible'
      ? `Possible ball in the ${result.ballArea} of this frame` : 'Ball not confirmed in this frame';
    $('frameAiState').textContent = `${ballReview}. ${frameCallsRemaining} manual frame checks left.`;
  } catch (error) {
    if (at === generation) $('frameAiState').textContent = `Image AI unavailable: ${error.message}`;
  } finally {
    frameBusy = false;
    updateButtons();
  }
}
$('frameAiButton').onclick = inspectOneFrame;
$('boxesToggle').onchange = () => { if (!$('boxesToggle').checked) clearOverlay(); };
$('captionsToggle').onchange = () => $('caption').classList.toggle('hidden', !$('captionsToggle').checked);
$('captionSize').onchange = () => { $('caption').classList.remove('large', 'extra'); if ($('captionSize').value !== 'normal') $('caption').classList.add($('captionSize').value); };
video.onplay = updateButtons;
video.onpause = updateButtons;
video.onloadedmetadata = () => { positionOverlay(); updateButtons(); };
video.onloadeddata = updateButtons;
video.onerror = () => setCaption('This video could not be played. Try a browser-compatible MP4 or WebM file.');
new ResizeObserver(positionOverlay).observe($('stage'));
setInterval(analyzeFrame, 350);

try {
  const status = await fetch('/api/status').then(response => response.json());
  visionAvailable = status.visionAvailable === true;
  azureConfigured = status.azureConfigured === true;
  frameAiConfigured = status.frameAiConfigured === true;
  frameCallsRemaining = Number.isInteger(status.frameCallsRemaining) ? status.frameCallsRemaining : 0;
  $('aiState').textContent = azureConfigured
    ? 'Foundry ready for text commentary. It does not inspect the video.'
    : 'Optional — start with the Foundry launcher to enable.';
  $('frameAiState').textContent = frameAiConfigured
    ? `Image deployment entered; not yet verified. No frame sent. ${frameCallsRemaining} manual checks available.`
    : 'Optional — enter an image-capable deployment in the AI launcher.';
  $('connectionDot').classList.toggle('ready', visionAvailable);
  $('connectionText').textContent = visionAvailable ? 'Local vision ready' : 'Local vision model unavailable';
  updateButtons();
} catch {
  $('connectionText').textContent = 'Local server unavailable';
}
sample();
