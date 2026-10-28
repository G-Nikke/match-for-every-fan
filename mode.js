const $ = id => document.getElementById(id);
const video = $('matchVideo');
let source = 'sample', stream = null, fileUrl = null;
let aiOn = false, commentaryOn = true, voiceOn = false, fasterOn = true;
let style = 'simple', deliveryMode = 'description', imageModelReady = false, callsRemaining = 0;
let cloudBusy = false, lastCloudAt = 0, failures = 0;
let sourceGeneration = 0, modeGeneration = 0, seekGeneration = 0, lastVideoTime = 0;
let previousJpeg = null, previousCaption = null, pendingCue = null;
let availableVoices = [], recentCalls = [];
let recapLines = [], recapCallsRemaining = 0, recapBusy = false, samplingPaused = false;
let selectedVoiceURI = '';
try { selectedVoiceURI = localStorage.getItem('mfe-v4-voice') || ''; } catch { /* private mode */ }

function syncUI() {
  $('modeState').textContent = aiOn ? 'ON' : 'OFF';
  $('modeDot').classList.toggle('on', aiOn);
  $('aiModeButton').classList.toggle('on', aiOn);
  $('aiModeButton').setAttribute('aria-pressed', String(aiOn));
  $('aiModeButton').setAttribute('aria-expanded', String(aiOn));
  $('aiModeButton').textContent = aiOn ? 'Turn off AI mode' : 'Turn on AI mode';
  $('aiFeatures').hidden = !aiOn;
  $('pictureState').textContent = `${$('sourceBadge').textContent} · AI ${aiOn ? 'ON' : 'OFF'}`;
  $('modeHelp').textContent = aiOn
    ? 'Azure reads sampled pictures. Choose a scene guide or a live call.'
    : 'Off: watch normally. No Azure requests.';
  for (const [name, on] of [['commentary', commentaryOn], ['voice', voiceOn], ['speed', fasterOn]]) {
    $(name + 'Button').setAttribute('aria-pressed', String(on));
    $(name + 'State').textContent = on ? 'ON' : 'OFF';
  }
  for (const button of document.querySelectorAll('.style-button'))
    button.setAttribute('aria-pressed', String(button.dataset.style === style));
  for (const button of document.querySelectorAll('.delivery-button'))
    button.setAttribute('aria-pressed', String(button.dataset.delivery === deliveryMode));
  $('voiceButton').disabled = !commentaryOn;
  $('voicePanel').hidden = !aiOn || !voiceOn;
  $('recapButton').disabled = !aiOn || recapBusy || recapLines.length === 0 || recapCallsRemaining <= 0;
  $('recapHelp').textContent = `${recapLines.length} AI lines saved · ${recapCallsRemaining} recaps left. Summarize whenever you choose.`;
  $('commentaryReadout').hidden = !commentaryOn;
  $('caption').hidden = !aiOn || !commentaryOn;
  $('speedHelp').textContent = deliveryMode === 'description'
    ? `Scene guide checks about every ${fasterOn ? 6 : 9} seconds. 36 checks per launch.`
    : `Live call checks about every ${fasterOn ? 3 : 6} seconds. 36 checks per launch.`;
}

function refreshVoices() {
  if (!('speechSynthesis' in window)) return;
  const list = speechSynthesis.getVoices().filter(voice => /^en(-|$)/i.test(voice.lang));
  list.sort((a, b) => {
    const score = voice => (/natural|neural/i.test(voice.name) ? -4 : 0) +
      (/^en-GB$/i.test(voice.lang) ? 0 : 2);
    return score(a) - score(b) || a.name.localeCompare(b.name);
  });
  availableVoices = list;
  const select = $('voiceSelect');
  select.replaceChildren(new Option('System voice', ''));
  for (const voice of list) select.add(new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI));
  if (!list.some(voice => voice.voiceURI === selectedVoiceURI))
    selectedVoiceURI = list.find(voice => /^en-GB$/i.test(voice.lang) &&
      /Ryan.*Online.*Natural/i.test(voice.name))?.voiceURI ||
      list.find(voice => /^en-GB$/i.test(voice.lang) &&
        /natural|neural/i.test(voice.name))?.voiceURI ||
      list.find(voice => /^en-GB$/i.test(voice.lang))?.voiceURI || '';
  select.value = selectedVoiceURI;
}

function stopSpeech() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

function speak(text, emphatic = false, preview = false) {
  if (!('speechSynthesis' in window) || (!preview && (!aiOn || !voiceOn || !commentaryOn))) return;
  // The spoken sentence must always match the visible caption. Never queue an old call.
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\bGO{3,}AL\b/gi, 'Goal'));
  const selected = availableVoices.find(voice => voice.voiceURI === selectedVoiceURI);
  if (selected) utterance.voice = selected;
  utterance.lang = selected?.lang || 'en-GB';
  utterance.rate = deliveryMode === 'description'
    ? (style === 'simple' ? .98 : style === 'professional' ? 1.01 : 1.04)
    : (style === 'simple' ? .96 : style === 'professional' ? 1.03 : 1.08);
  utterance.pitch = emphatic ? 1.18 : style === 'excited' ? 1.06 : 1;
  speechSynthesis.speak(utterance);
}

function rememberCall(text, time) {
  recentCalls.unshift({ text, time: videoStamp(time) });
  recentCalls = recentCalls.slice(0, 3);
  const list = $('recentCalls');
  list.replaceChildren();
  for (const call of recentCalls) {
    const item = document.createElement('li');
    const stamp = document.createElement('time');
    stamp.textContent = call.time;
    item.append(stamp, document.createTextNode(call.text));
    list.append(item);
  }
}

function showInsight(text, origin, ball = null, emphatic = false, announce = true) {
  $('captionText').textContent = text;
  $('captionCue').hidden = !origin.includes('VIEWER CUE');
  $('insightText').textContent = text;
  $('insightSource').textContent = origin;
  $('insightTime').textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  if (ball !== null) $('ballState').textContent = ball;
  if (commentaryOn && announce) speak(text, emphatic);
}

function videoStamp(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function snapshot() {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight)
    throw new Error('Video frame is not ready.');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1600 / video.videoWidth, 1000 / video.videoHeight, 1);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .62).split(',')[1];
}

function resetHistory() {
  previousJpeg = null;
  previousCaption = null;
  lastVideoTime = 0;
  lastCloudAt = 0;
  failures = 0;
  pendingCue = null;
  recentCalls = [];
  $('recentCalls').replaceChildren(Object.assign(document.createElement('li'),
    { textContent: 'No commentary yet.' }));
  $('cueStatus').textContent = 'Manual cues are labelled separately from AI vision.';
  $('peopleCount').textContent = '—';
  $('ballState').textContent = '—';
  $('shapeState').textContent = '—';
  $('shapeChange').textContent = 'A full formation needs a wide view of the whole team.';
}

function setAi(on, reason = '') {
  if (on && !imageModelReady) return;
  aiOn = on;
  modeGeneration++;
  resetHistory();
  samplingPaused = false;
  if (!on) { $('recapOverlay').hidden = true; stopSpeech(); }
  syncUI();
  if (on) {
    $('aiStatus').textContent = `Azure image AI ready · ${callsRemaining} picture checks left.`;
    showInsight('Waiting for the first match call…', 'AI MODE STARTING', null, false, false);
  } else {
    $('aiStatus').textContent = reason || 'AI is off. No new pictures are sent to Azure.';
    $('captionText').textContent = 'Turn on AI mode for match commentary.';
    $('captionCue').hidden = true;
    $('insightText').textContent = 'AI is off.';
    $('insightSource').textContent = 'No analysis running';
    $('insightTime').textContent = '—';
    stopSpeech();
  }
}

async function analyzeCloud() {
  if (!aiOn || cloudBusy || samplingPaused || video.paused || video.readyState < 2 || !imageModelReady) return;
  if (callsRemaining <= 0) {
    samplingPaused = true;
    $('aiStatus').textContent = 'Picture check limit reached. You can still summarize this segment.';
    return;
  }
  cloudBusy = true;
  lastCloudAt = Date.now();
  const sourceAt = sourceGeneration, modeAt = modeGeneration, seekAt = seekGeneration;
  const sampledAt = video.currentTime;
  const cue = pendingCue;
  pendingCue = null;
  if (cue) $('cueStatus').textContent = 'Confirmed cue sent for one commentary line.';
  try {
    const currentJpeg = snapshot();
    const selectedStyle = style;
    const selectedDeliveryMode = deliveryMode;
    $('aiStatus').textContent = 'Azure is preparing the next match call…';
    const response = await fetch('/api/visual-commentary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jpeg: currentJpeg, previousJpeg, previousCaption,
        style: selectedStyle, deliveryMode: selectedDeliveryMode, viewerCue: cue })
    });
    callsRemaining = Math.max(0, callsRemaining - 1);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.error === 'string' ? body.error : `Request returned ${response.status}`);
    }
    const result = await response.json();
    if (!aiOn || video.paused || sourceAt !== sourceGeneration ||
        modeAt !== modeGeneration || seekAt !== seekGeneration) return;
    if (typeof result.text !== 'string' || result.source !== 'foundry-frame')
      throw new Error('Model answer was not accepted.');
    failures = 0;
    if (result.text) recapLines.push(result.text);
    syncUI();
    const repeated = Boolean(result.text) && result.text === previousCaption && !cue;
    previousCaption = result.text || null;
    previousJpeg = currentJpeg;
    $('peopleCount').textContent = Number.isInteger(result.visiblePlayers)
      ? `About ${result.visiblePlayers}` : 'Unclear';
    $('ballState').textContent = result.ballStatus === 'possible'
      ? `Possible · ${result.ballArea}` : 'Not confirmed';
    $('shapeState').textContent = result.formation
      ? `${result.formation} · ${result.shape}` : result.shape;
    const movement = { wider: 'The visible shape looks wider.', narrower: 'The visible shape looks narrower.',
      higher: 'The visible line looks higher.', deeper: 'The visible line looks deeper.',
      no_clear_change: 'No clear shape change between samples.',
      unknown: 'Shape change cannot be judged from these views.' };
    $('shapeChange').textContent = result.formation
      ? `${movement[result.shapeChange]} Formation is an AI estimate.`
      : `${movement[result.shapeChange]} Full formation unconfirmed.`;
    const origin = `AZURE IMAGE AI · ${selectedDeliveryMode.toUpperCase()} · ${selectedStyle.toUpperCase()} · VIDEO ${videoStamp(sampledAt)}` +
      (cue ? ' · VIEWER CUE' : '');
    if (!result.text) {
      stopSpeech();
      $('caption').hidden = true;
      $('captionCue').hidden = true;
      $('insightText').textContent = 'Watching for the next clear moment…';
      $('insightSource').textContent = origin;
      $('insightTime').textContent = new Date().toLocaleTimeString([], {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      if (cue) $('cueStatus').textContent = 'No usable call this time. Add the cue again if needed.';
      $('pictureState').textContent = `${$('sourceBadge').textContent} · AI ON · CHECKED ${videoStamp(sampledAt)}`;
      $('aiStatus').textContent = `AI mode on · ${callsRemaining} picture checks left.`;
      return;
    }
    $('caption').hidden = false;
    if (!repeated) rememberCall(result.text, sampledAt);
    showInsight(result.text, origin, null, cue?.event === 'goal', !repeated);
    $('pictureState').textContent = `${$('sourceBadge').textContent} · AI ON · CHECKED ${videoStamp(sampledAt)}`;
    $('aiStatus').textContent = `AI mode on · ${callsRemaining} picture checks left.`;
  } catch (error) {
    if (aiOn && sourceAt === sourceGeneration && modeAt === modeGeneration) {
      failures++;
      $('aiStatus').textContent = `Azure unavailable: ${error.message}`;
      if (cue) $('cueStatus').textContent = 'Cue was not used. Add it again if needed.';
      if (failures >= 2) setAi(false, `AI paused after two errors: ${error.message}`);
    }
  } finally { cloudBusy = false; }
}

function stopSource() {
  sourceGeneration++;
  recapLines = [];
  $('recapOverlay').hidden = true;
  if (stream) { for (const track of stream.getTracks()) track.stop(); stream = null; }
  if (fileUrl) { URL.revokeObjectURL(fileUrl); fileUrl = null; }
  video.pause();
  video.srcObject = null;
  video.removeAttribute('src');
  video.load();
  resetHistory();
  stopSpeech();
  if (aiOn) showInsight('New picture selected. Waiting for a match call…',
    'AI MODE STARTING', null, false, false);
}

function setSource(kind, label, help) {
  source = kind;
  $('sourceBadge').textContent = label;
  $('sourceHelp').textContent = help;
  for (const [button, value] of [['sampleButton','sample'],['captureButton','capture'],['fileButton','file']])
    $(button).classList.toggle('chosen', kind === value);
  syncUI();
}

function sample() {
  stopSource();
  setSource('sample', 'RECORDED SAMPLE', 'Real recorded football. AI comments as this sample plays.');
  video.loop = true;
  video.muted = true;
  video.src = '/tactical-video';
  video.play().catch(() => { $('aiStatus').textContent = 'Press play on the video to start the sample.'; });
}

async function capture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    $('aiStatus').textContent = 'Window capture needs Chrome or Edge on localhost.';
    return;
  }
  let picked;
  try { picked = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false }); }
  catch { return; }
  stopSource();
  stream = picked;
  setSource('capture', 'WINDOW CAPTURE', 'Choose a match window you may view. Protected video can appear black.');
  video.loop = false;
  video.muted = true;
  video.srcObject = stream;
  stream.getVideoTracks()[0].addEventListener('ended', () => { if (source === 'capture') sample(); });
  video.play().catch(() => { $('aiStatus').textContent = 'Press play to show the selected window.'; });
}

function localFile(file) {
  if (!file) return;
  stopSource();
  fileUrl = URL.createObjectURL(file);
  setSource('file', 'LOCAL CLIP', 'Your clip stays in this browser. AI reads samples only while on.');
  video.loop = true;
  video.muted = true;
  video.src = fileUrl;
  video.play().catch(() => { $('aiStatus').textContent = 'Press play to show your clip.'; });
}

$('aiModeButton').onclick = () => setAi(!aiOn);
$('commentaryButton').onclick = () => {
  commentaryOn = !commentaryOn;
  if (!commentaryOn) { voiceOn = false; stopSpeech(); }
  syncUI();
};
$('voiceButton').onclick = () => {
  if (!commentaryOn) return;
  voiceOn = !voiceOn;
  if (!voiceOn) stopSpeech();
  syncUI();
};
$('speedButton').onclick = () => { fasterOn = !fasterOn; syncUI(); };
async function summarizeSegment() {
  if (!aiOn || recapBusy || !recapLines.length || recapCallsRemaining <= 0) return;
  recapBusy = true;
  video.pause();
  stopSpeech();
  syncUI();
  $('aiStatus').textContent = 'Azure is summarizing the sampled views…';
  const currentSource = sourceGeneration;
  try {
    const response = await fetch('/api/phase-summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: recapLines })
    });
    recapCallsRemaining = Math.max(0, recapCallsRemaining - 1);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Request returned ${response.status}`);
    if (currentSource !== sourceGeneration) return;
    if (result.source !== 'foundry-recap' || !Array.isArray(result.bullets))
      throw new Error('Recap answer was not accepted.');
    const list = $('recapBullets');
    list.replaceChildren(...result.bullets.map(line => {
      const item = document.createElement('li'); item.textContent = line; return item;
    }));
    $('recapCoverage').textContent = `Based on ${result.lineCount} previous AI lines. Moments between picture checks may be missing.`;
    $('recapOverlay').hidden = false;
    $('caption').hidden = true;
    $('recapClose').focus();
    $('aiStatus').textContent = 'Recap ready. Match paused until you continue.';
    if (voiceOn) speak(result.bullets.join(' '), false, true);
  } catch (error) { $('aiStatus').textContent = `Recap unavailable: ${error.message}`; }
  finally { recapBusy = false; syncUI(); }
}
$('recapButton').onclick = summarizeSegment;
$('recapClose').onclick = () => {
  stopSpeech();
  $('recapOverlay').hidden = true;
  syncUI();
  video.play().catch(() => { $('aiStatus').textContent = 'Press play on the video to continue.'; });
};
function changePresentation() {
  modeGeneration++;
  previousJpeg = null;
  previousCaption = null;
  lastCloudAt = 0;
  stopSpeech();
  if (aiOn) showInsight('Finding the next moment…', 'AI MODE SWITCHING', null, false, false);
  syncUI();
}
for (const button of document.querySelectorAll('.delivery-button')) button.onclick = () => {
  if (deliveryMode === button.dataset.delivery) return;
  deliveryMode = button.dataset.delivery;
  changePresentation();
};
for (const button of document.querySelectorAll('.style-button')) button.onclick = () => {
  if (style === button.dataset.style) return;
  style = button.dataset.style;
  changePresentation();
};
$('voiceSelect').onchange = () => {
  selectedVoiceURI = $('voiceSelect').value;
  try { localStorage.setItem('mfe-v4-voice', selectedVoiceURI); } catch { /* private mode */ }
};
$('voicePreviewButton').onclick = () => speak('Here comes the move... what a chance!', false, true);
$('cueButton').onclick = () => {
  const player = $('cuePlayer').value.trim();
  const event = $('cueEvent').value;
  if ((event === 'on_ball' && !player) ||
      !/^[\p{L}\p{M}0-9 .'-]{0,50}$/u.test(player) ||
      !['on_ball', 'shot', 'goal'].includes(event)) {
    $('cueStatus').textContent = 'On-ball needs a name; use a short name with letters and spaces.';
    return;
  }
  pendingCue = { event, player };
  $('cueStatus').textContent = `Next call queued: ${event.replace('_', ' ')}${player ? ` · ${player}` : ''}.`;
  $('cuePlayer').value = '';
};
$('sampleButton').onclick = sample;
$('captureButton').onclick = capture;
$('fileInput').onchange = event => localFile(event.target.files?.[0]);
video.onerror = () => { $('aiStatus').textContent = 'This video cannot play here. Try an MP4 or WebM clip.'; };
video.addEventListener('pause', stopSpeech);
video.addEventListener('seeking', () => {
  seekGeneration++;
  previousJpeg = null;
  previousCaption = null;
  lastCloudAt = 0;
  stopSpeech();
});
setInterval(() => {
  if (!aiOn || video.paused || video.readyState < 2) return;
  if (video.loop && video.currentTime + 1 < lastVideoTime) {
    previousJpeg = null;
    previousCaption = null;
  }
  lastVideoTime = video.currentTime;
  const interval = deliveryMode === 'description'
    ? (fasterOn ? 6000 : 9000) : (fasterOn ? 3000 : 6000);
  if (Date.now() - lastCloudAt >= interval) analyzeCloud();
}, 400);

if ('speechSynthesis' in window) {
  refreshVoices();
  speechSynthesis.addEventListener?.('voiceschanged', refreshVoices);
}
try {
  const status = await fetch('/api/status').then(response => response.json());
  imageModelReady = status.frameAiConfigured === true;
  callsRemaining = Number.isInteger(status.frameCallsRemaining) ? status.frameCallsRemaining : 0;
  recapCallsRemaining = Number.isInteger(status.recapCallsRemaining) ? status.recapCallsRemaining : 0;
  $('aiModeButton').disabled = !imageModelReady;
  $('aiStatus').textContent = imageModelReady
    ? 'Azure image AI is connected. Choose a style and start the commentary.'
    : 'Image AI is not connected. Start the AI launcher with your gpt-4o deployment.';
} catch {
  $('aiStatus').textContent = 'Local server unavailable.';
}
syncUI();
sample();
