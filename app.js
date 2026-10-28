import { narrative, clock, recentStats, demoIndex, demoTime, activeAnnotation, validateAnnotations } from '/engine.js';
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const match = await fetch('/data/match.json').then(r => { if (!r.ok) throw new Error('Match data unavailable'); return r.json(); });
let mode = 'tactical', source = 'synthetic', time = 0, playing = false, index = 0, lastTick = performance.now();
let annotations = null, localFile = null, objectURL = null, lastKey = '', current = null, pendingSample = null, pendingSeek = null;
let aiConfigured = false;
const aiCache = new Map(), aiPending = new Set(), aiFailures = new Set();
const video = $('video');
$('reduceMotion').checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
const colors = { harbour: '#c5f26a', ridge: '#a6bafa', A: '#c5f26a', B: '#a6bafa', unknown: '#ffffff' };
const node = (tag, attrs = {}, text = '') => { const e = document.createElementNS(NS, tag); for (const [k,v] of Object.entries(attrs)) e.setAttribute(k,v); if (text) e.textContent = text; return e; };
function pitchBase(svg) {
  svg.replaceChildren();
  svg.append(node('rect',{x:0,y:0,width:105,height:68,fill:'#17482f',rx:1}));
  for (let x = 0; x < 105; x += 21) svg.append(node('rect',{x,y:0,width:10.5,height:68,fill:'#ffffff04'}));
  const g = node('g',{fill:'none',stroke:'#a6c9ad', 'stroke-opacity':'.45','stroke-width':'.35'});
  for (const [x,y,w,h] of [[0,0,105,68],[0,13.84,16.5,40.32],[88.5,13.84,16.5,40.32],[0,24.84,5.5,18.32],[99.5,24.84,5.5,18.32],[-2,30.34,2,7.32],[105,30.34,2,7.32]]) g.append(node('rect',{x,y,width:w,height:h}));
  g.append(node('line',{x1:52.5,y1:0,x2:52.5,y2:68}),node('circle',{cx:52.5,cy:34,r:9.15}),node('circle',{cx:52.5,cy:34,r:.5,fill:'#c6d7c6'}));
  svg.append(g);
}
function drawPitch(svg, event, mini = false) {
  pitchBase(svg);
  if (!event) return;
  const recent = match.events.slice(Math.max(0,index-4),index+1).filter(e => e.scene_id === event.scene_id);
  if ($('showPaths').checked) {
    recent.forEach(e => {
      if (!['pass','shot','goal'].includes(e.event_type)) return;
      const [x,y] = e.start_xy, [xx,yy] = e.end_xy;
      const color = colors[e.team_id];
      svg.append(node('line',{x1:x,y1:y,x2:xx,y2:yy,stroke:color,'stroke-width':e === event ? .9 : .45,'stroke-dasharray':e.event_type === 'shot'?'1.5 1':'none',opacity:e === event?'.95':'.3'}));
      const angle = Math.atan2(yy-y,xx-x), size = 1.8;
      svg.append(node('polygon',{points:`${xx},${yy} ${xx-size*Math.cos(angle-.45)},${yy-size*Math.sin(angle-.45)} ${xx-size*Math.cos(angle+.45)},${yy-size*Math.sin(angle+.45)}`,fill:color,opacity:e === event?'1':'.4'}));
    });
  }
  if ($('showMarkers').checked) {
    recent.forEach((e,i) => svg.append(node('circle',{cx:e.start_xy[0],cy:e.start_xy[1],r:mini?1:1.1,fill:colors[e.team_id],opacity:.3+i*.14})));
    svg.append(node('circle',{cx:event.end_xy[0],cy:event.end_xy[1],r:2.1,fill:'none',stroke:'#fff','stroke-width':'.25',opacity:'.8'}),node('circle',{cx:event.end_xy[0],cy:event.end_xy[1],r:1,fill:'#fff'}));
    if (!mini) svg.append(node('text',{x:event.end_xy[0],y:event.end_xy[1]-3.5,fill:'#eaffdf','font-size':2,'text-anchor':'middle','font-family':'Consolas,monospace'},event.event_id));
  }
}
function drawVideo(event) {
  const svg = $('videoOverlay'); svg.replaceChildren();
  if (!event) return;
  const w=video.videoWidth||1280,h=video.videoHeight||720;
  svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  const point=p=>[p[0]*w/100,p[1]*h/100];
  if ($('showLines').checked) for (const l of event.lines) {
    const pts=l.points.map(point),color=l.team==='A'?'#67e8f9':'#ff926f';
    svg.append(node('polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none',stroke:color,'stroke-width':4,'stroke-linejoin':'round'}));
    svg.append(node('text',{x:pts[0][0],y:pts[0][1]-26,fill:color,'font-size':22,'font-weight':'bold',class:'annotation-text'},`${l.label.toUpperCase()} · VISIBLE GROUP`));
  }
  if ($('showMarkers').checked) for (const m of event.markers) {const [x,y]=point(m.xy);svg.append(node('circle',{cx:x,cy:y,r:9,fill:m.team==='unknown'?'white':m.team==='A'?'#67e8f9':'#ff926f',stroke:'#06120b','stroke-width':2}));}
}
function positionVideoOverlay() {
  if (!video.videoWidth) return;
  const {width,height} = video.getBoundingClientRect();
  const scale = Math.min(width/video.videoWidth,height/video.videoHeight);
  const w = video.videoWidth*scale, h = video.videoHeight*scale;
  Object.assign($('videoOverlay').style,{left:`${(width-w)/2}px`,top:`${(height-h)/2}px`,width:`${w}px`,height:`${h}px`});
}
new ResizeObserver(positionVideoOverlay).observe($('stage'));
function stopSpeech() { window.speechSynthesis?.cancel(); $('polite').textContent=''; $('urgent').textContent=''; }
function aiKey(event, perspective = mode) { return `${event.event_id}:${perspective}`; }
function currentNarrative(event) {
  const local = narrative(match,event,mode);
  const ai = source === 'synthetic' ? aiCache.get(aiKey(event)) : null;
  return ai ? { ...local, text: ai.text, evidence: ai.evidenceIds,
    speech: `${clock(event.match_clock_ms)}. ${local.title}. ${ai.text}` } : local;
}
async function requestAi() {
  if (source !== 'synthetic' || !current || !aiConfigured) return;
  const eventId = current.event_id, perspective = mode, key = aiKey(current);
  if (aiCache.has(key) || aiPending.has(key)) return;
  aiFailures.delete(key); aiPending.add(key); render(false,true);
  try {
    const response = await fetch('/api/explain', { method:'POST',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({eventId,mode:perspective}) });
    if (!response.ok) throw new Error('Model request failed.');
    const answer = await response.json();
    if (answer.source !== 'foundry-model' || typeof answer.text !== 'string' ||
        !Array.isArray(answer.evidenceIds)) throw new Error('Invalid model answer.');
    aiCache.set(key,answer);
  } catch { aiFailures.add(key); }
  finally {
    aiPending.delete(key);
    if (source === 'synthetic' && current?.event_id === eventId && mode === perspective) render(false,true);
  }
}
function announce(text, goal = false) {
  stopSpeech();
  $('polite').textContent = ''; $('urgent').textContent = '';
  // Screen readers get one announcement per event, never one per rendered frame.
  const speech = $('output').value !== 'captions' && 'speechSynthesis' in window;
  if (speech) {
    const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = mode === 'casual' ? .95 : 1.05;
    speechSynthesis.speak(u);
  } else $(goal?'urgent':'polite').textContent = text;
}
function duration() { return source === 'synthetic' ? match.events.length*4 : (Number.isFinite(video.duration)?video.duration:0); }
function selectedEvent() { return source === 'synthetic' ? match.events[index] : activeAnnotation(annotations?.events ?? [], time); }
function render(shouldAnnounce = false, force = false) {
  const total = duration();
  $('timeline').max = Math.max(0,total-.01); $('timeline').value = time;
  $('elapsed').textContent = `${clock(time*1000)} / ${clock(total*1000)}`;
  $('play').textContent = playing ? 'Ⅱ Pause' : '▶ Play';
  $('play').setAttribute('aria-label',playing?'Pause replay':'Play replay');
  index = source === 'synthetic' ? demoIndex(time, match.events.length) : -1;
  const e = selectedEvent(); current = e;
  const key = `${source}:${e?.event_id ?? 'none'}:${mode}`;
  if (key === lastKey && !force) return;
  const changed = key !== lastKey; lastKey = key;
  const n = e ? currentNarrative(e) : null;
  const isVideo = source === 'video';
  $('homeName').textContent = isVideo ? 'LOCAL' : 'HARBOUR'; $('awayName').textContent = isVideo ? 'CLIP' : 'RIDGE';
  // Score remains unknown unless an annotation explicitly provides it.
  $('score').textContent = n?.score ? n.score.join(' : ') : '— : —';
  $('clock').textContent = isVideo ? clock(time*1000) : clock(e.match_clock_ms);
  $('sceneTitle').textContent = isVideo ? localFile.name : match.scenes.find(s=>s.id === e.scene_id).title;
  $('sourceBadge').textContent = isVideo ? (annotations?'MANUALLY ANNOTATED':'LOCAL VIDEO') : 'SYNTHETIC DEMO';
  $('stageLabel').textContent = isVideo ? (e?'MANUAL ANNOTATION · NOT AUTOMATIC':'LOCAL PLAYBACK · NO VERIFIED EVENTS') : 'EVIDENCE-BACKED REPLAY';
  $('eventTag').textContent = e?.event_id ?? '—';
  $('stage').classList.toggle('tactical-snapshot',Boolean(e?.event_id==='T001'));
  $('listenNow').disabled=!e;
  const modelKey = !isVideo && e ? aiKey(e) : '';
  $('aiRequest').disabled = isVideo || !e || !aiConfigured || aiPending.has(modelKey) || aiCache.has(modelKey);
  $('aiRequest').textContent = aiPending.has(modelKey) ? '✦ Generating…' : aiCache.has(modelKey) ? '✓ AI insight ready' : '✦ Generate AI insight for this event';
  $('engineStatus').textContent = isVideo ? 'MANUAL ANNOTATION + SYSTEM VOICE\nAI is not applied to real footage.'
    : aiCache.has(modelKey) ? 'MICROSOFT FOUNDRY MODEL + SYSTEM VOICE\nGenerated text checked against event IDs; score remains local.'
    : aiPending.has(modelKey) ? 'LOCAL TEMPLATE + SYSTEM VOICE\nWaiting for Foundry model response…'
    : aiFailures.has(modelKey) ? 'LOCAL TEMPLATE + SYSTEM VOICE\nModel request failed or was rejected; retry available.'
    : aiConfigured ? 'LOCAL TEMPLATE + SYSTEM VOICE\nFoundry ready; generate only when you click.'
    : 'LOCAL TEMPLATE + SYSTEM VOICE\nFoundry model not configured on this computer.';
  $('modeLabel').textContent = `${mode.toUpperCase()} PERSPECTIVE`;
  $('insightTitle').textContent = n?.title ?? 'Your footage. Your view.';
  $('insightText').textContent = n?.text ?? 'No verified annotation at this time. Play your video, or import a matching annotation file to add factual commentary and tactical lines.';
  $('evidence').textContent = n?.evidence.join(' · ') ?? 'Not annotated';
  $('captionKicker').textContent = e?.event_type === 'goal' ? `${n.title} · ${n.score?.join('–') ?? 'Goal'}` : `${mode.toUpperCase()} / ${e?.event_type?.toUpperCase() ?? 'LOCAL VIDEO'}`;
  $('captionTitle').textContent = e?.event_type === 'goal' && mode === 'emotion' ? 'GOOOOAL!' : (n?.title ?? 'Local video studio');
  $('captionText').textContent = n?.text ?? 'Import verified annotations to bring this match to life.';
  if(e?.event_id==='T001') $('captionTitle').textContent='CORNER · MANUAL POSITION SNAPSHOT';
  $('caption').className = `caption ${e?.event_type ?? ''}`;
  if (changed && e?.event_type === 'goal' && !$('reduceMotion').checked) { $('caption').style.animation = 'none'; void $('caption').offsetWidth; $('caption').style.animation = ''; }
  $('caption').hidden = $('output').value === 'speech' || (isVideo && !e);
  $('repeat').disabled = !e;
  $('statsArea').hidden = isVideo || mode !== 'tactical';
  $('mapArea').hidden = isVideo || !$('showMap').checked || mode === 'casual';
  $('provenance').textContent = isVideo ? 'Local file · manual annotations only · no automatic tactical inference.' : 'Fictional clubs. Validated events. Recorded event coordinates.';
  if (!isVideo) {
    const stats = recentStats(match.events,index);
    $('passes').textContent = stats.passes; $('shots').textContent = stats.shots; $('possession').textContent = e.possession_team === 'harbour'?'HFC':'RGU';
    $('statsClock').textContent = `· ${clock(e.match_clock_ms)}`;
    drawPitch($('pitch'),e); drawPitch($('minimap'),e,true);
  } else drawVideo(e);
  renderFeed();
  if (shouldAnnounce && changed && n) announce(n.speech,e.event_type === 'goal');
}
function renderFeed() {
  const feed = $('eventFeed'); feed.replaceChildren();
  const list = source === 'synthetic' ? match.events.slice(Math.max(0,index-3),index+1) : (annotations?.events ?? []).filter(e=>e.time_s<=time).slice(-4);
  for (const e of list) {
    const b = document.createElement('button'); b.type='button'; b.classList.toggle('current',current?.event_id===e.event_id);
    const small = document.createElement('small'); small.textContent = `${clock(e.match_clock_ms ?? e.time_s*1000)} / ${e.event_type.toUpperCase()}`;
    const strong = document.createElement('strong'); strong.textContent=narrative(match,e,mode).title;
    const span = document.createElement('span'); span.textContent=e.event_id;
    b.append(small,strong,span); b.onclick=()=>seek(source==='synthetic'?demoTime(match.events.indexOf(e)):e.time_s,true); feed.append(b);
  }
}
function moments() {
  const container=$('momentButtons'); container.replaceChildren();
  const list=source==='synthetic' ? match.events.filter(e=>e.event_type==='goal') : (annotations?.events??[]).filter(e=>['observation','goal','shot','tackle'].includes(e.event_type));
  for (const [i,e] of list.entries()) {
    const b=document.createElement('button'), span=document.createElement('span'); span.textContent=clock(e.match_clock_ms??e.time_s*1000);
    b.append(span,document.createTextNode(source==='synthetic'?['Opening goal','The equalizer','The winner'][i]:e.title));
    b.onclick=()=>{pause();seek(source==='synthetic'?demoTime(match.events.indexOf(e)):e.time_s,true);}; container.append(b);
  }
  if (!list.length) container.textContent='Import annotations to add key moments.';
}
function pause() { playing=false; if(source==='video') video.pause(); stopSpeech(); render(); }
function seek(value, announceEvent=false) {
  stopSpeech();
  time=Math.max(0,Math.min(value,duration()-.01));
  if(source==='video') video.currentTime=time;
  lastKey=''; render(announceEvent,true);
}
async function toggle() {
  if(playing){pause();return;}
  if(time>=duration()-.1) seek(0);
  if(source==='video') {
    try { await video.play(); } catch { $('videoStatus').textContent='This video cannot play here. Choose another browser-compatible MP4 or WebM, or return to the synthetic demo.'; return; }
  }
  playing=true;lastTick=performance.now(); render(true,true);
  if(current) announce(currentNarrative(current).speech,current.event_type==='goal');
}
function tick(now) {
  if(playing) {
    const dt=Math.min((now-lastTick)/1000,.3);
    time=source==='synthetic'?time+dt*Number($('speed').value):video.currentTime;
    if(time>=duration()-.01) { time=Math.max(0,duration()-.01);pause(); }
    render(true);
  }
  lastTick=now;requestAnimationFrame(tick);
}
$('play').onclick=toggle;
$('restart').onclick=()=>{pause();seek(0,true);};
$('next').onclick=()=>{
  pause();
  const next=source==='synthetic'?demoTime(index+1):(annotations?.events??[]).find(e=>e.time_s>time+.05)?.time_s;
  if(next!==undefined) seek(next,true);
};
$('timeline').oninput=e=>{ const value=Number(e.target.value);pause();seek(value); };
$('timeline').onchange=()=>{if(current)announce(currentNarrative(current).speech,current.event_type==='goal');};
$('speed').onchange=()=>{video.playbackRate=Number($('speed').value);};
$('repeat').onclick=()=>{if(current) announce(currentNarrative(current).speech,current.event_type==='goal');};
$('listenNow').onclick=()=>{if(current){$('output').value='both';preferences();announce(currentNarrative(current).speech,current.event_type==='goal');}};
$('aiRequest').onclick=requestAi;
for(const b of document.querySelectorAll('[data-mode]')) b.onclick=()=>{
  mode=b.dataset.mode;
  for(const item of document.querySelectorAll('[data-mode]'))item.setAttribute('aria-pressed',String(item===b));
  document.body.classList.remove('tactical','emotion','casual');document.body.classList.add(mode);stopSpeech();render(true,true);
};
function preferences() {
  document.body.classList.toggle('reduce-motion',$('reduceMotion').checked);
  document.body.classList.toggle('high-contrast',$('contrast').checked);
  document.documentElement.style.setProperty('--caption-scale',$('fontSize').value);
  stopSpeech();render(false,true);
}
for(const id of ['output','fontSize','reduceMotion','contrast','showPaths','showMarkers','showLines','showMap'])$(id).onchange=preferences;
document.addEventListener('keydown',e=>{
  if(e.key==='F6'){e.preventDefault();$('repeat').click();return;}
  if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName))return;
  if(e.code==='Space'){e.preventDefault();toggle();}
});
video.addEventListener('timeupdate',()=>{if(source==='video'){time=video.currentTime;$('clock').textContent=clock(time*1000);render(playing);}});
video.addEventListener('seeking',()=>{stopSpeech(); time=video.currentTime;render(false,true);});
video.addEventListener('ended',()=>{playing=false;render();stopSpeech();});
video.addEventListener('error',()=>{playing=false;render();$('videoStatus').textContent='Video decode failed. Use a compatible MP4 / WebM, or choose Synthetic demo.';});
$('videoFile').onchange=()=>{
  const f=$('videoFile').files[0];if(!f)return;
  pause(); if(objectURL)URL.revokeObjectURL(objectURL);
  localFile=f;source='video';annotations=null;pendingSample=null;time=0;lastKey='';
  $('polite').textContent='';$('urgent').textContent='';$('sampleStatus').textContent='';
  objectURL=URL.createObjectURL(f);video.src=objectURL;video.hidden=false;
  $('synthetic').hidden=true;$('videoOverlay').removeAttribute('hidden');$('annotationFile').value='';$('annotationFile').disabled=true;$('exportTemplate').disabled=true;
  $('videoStatus').textContent='Opening local video…';moments();render(false,true);
};
video.addEventListener('loadedmetadata',()=>{
  if(!Number.isFinite(video.duration)){ $('videoStatus').textContent='A finite-duration local clip is required.';return; }
  $('annotationFile').disabled=false;$('exportTemplate').disabled=false;
  $('videoStatus').textContent=`${localFile.name} · ${video.duration.toFixed(2)} s · local only · no annotations loaded.`;
  if(pendingSample) {
    try { annotations=validateAnnotations(pendingSample,{name:localFile.name,duration:video.duration}); $('videoStatus').textContent='Manually reviewed intervals loaded. Positions are snapshots, not tracking. Full match score and player identities unknown.'; }
    catch(error) { $('videoStatus').textContent=`Sample annotations rejected: ${error.message}`; }
    pendingSample=null;moments();
  }
  positionVideoOverlay();render(false,true);
  if(pendingSeek!==null){const target=pendingSeek;pendingSeek=null;seek(target);}
});
$('annotationFile').onchange=async()=>{
  const f=$('annotationFile').files[0];if(!f)return;
  pause();
  try {
    if(f.size>2_000_000)throw new Error('Annotation file is too large (maximum 2 MB).');
    const parsed=JSON.parse(await f.text());
    annotations=validateAnnotations(parsed,{name:localFile.name,duration:video.duration});
    $('videoStatus').textContent=`${annotations.events.length} verified manual intervals loaded. Video coordinates only; no full-pitch calibration is assumed.`;
    lastKey='';moments();render(false,true);
  } catch(error){$('videoStatus').textContent=`Annotations rejected: ${error.message}`;}
};
$('exportTemplate').onclick=()=>{
  const starter={schema_version:1,source:'manual_annotation',video_id:localFile.name,duration_s:video.duration,notes:'Replace the empty events list with verified observations. See ANNOTATIONS.md. Video coordinates are percentages of the video image, not pitch coordinates.',events:[]};
  const url=URL.createObjectURL(new Blob([JSON.stringify(starter,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='video_event_annotations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('backSynthetic').onclick=()=>{
  pause();video.removeAttribute('src');video.load();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;
  source='synthetic';time=0;annotations=null;pendingSample=null;lastKey='';video.hidden=true;$('videoOverlay').setAttribute('hidden','');$('synthetic').hidden=false;
  $('sampleStatus').textContent='';
  $('annotationFile').disabled=true;$('exportTemplate').disabled=true;$('videoStatus').textContent='Synthetic demo restored.';moments();render(false,true);
};
$('syntheticTop').onclick=()=>$('backSynthetic').click();
async function loadSample(tactical=false){
  const button=$(tactical?'tacticalClip':'sampleClip');button.disabled=true;
  try {
    const route=tactical?'/tactical-video':'/sample-video';
    const response=await fetch(route,{headers:{Range:'bytes=0-0'}});
    if(!response.ok)throw new Error(`Sample not installed. Run .venv\\Scripts\\python.exe scripts/${tactical?'download_sample.py':'download_tactical_clip.py'}, then retry.`);
    const data=await fetch(tactical?'/data/tactical_frame_annotations.json':'/data/amateur_goal_annotations.json').then(r=>r.json());
    pause();if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;
    source='video';time=0;annotations=null;pendingSample=data;pendingSeek=tactical?6:17;localFile={name:data.video_id};lastKey='';
    if(tactical){mode='tactical';document.body.classList.remove('emotion','casual');document.body.classList.add('tactical');for(const b of document.querySelectorAll('[data-mode]'))b.setAttribute('aria-pressed',String(b.dataset.mode===mode));}
    $('polite').textContent='';$('urgent').textContent='';
    video.hidden=false;$('synthetic').hidden=true;$('videoOverlay').removeAttribute('hidden');
    $('sampleStatus').textContent=tactical?'Footage: NaBUru38 · CC BY-SA 4.0 · 2018 U-17 New Zealand vs Canada, clip 22. Changes: manual freeze-frame markers and visible defending/attacking groups. Not a full-team formation; no midfield or offside line inferred.':'Footage: Maximilian Schönherr · CC BY-SA 4.0 · Commons: Amateurfußball Torschuss von oben. Changes: manual captions and opening markers. Approximate editorial event timing. No endorsement implied.';
    video.src=route;video.load();moments();render(false,true);
  } catch(error) { $('sampleStatus').textContent=`${error.message} Synthetic demo remains available.`; }
  finally { button.disabled=false; }
}
$('sampleClip').onclick=()=>loadSample(false);
$('tacticalClip').onclick=()=>loadSample(true);
moments();preferences();requestAnimationFrame(tick);
fetch('/api/status').then(response => response.json()).then(status => {
  aiConfigured = status.azureConfigured === true;
  render(false,true);
}).catch(() => { aiConfigured = false; render(false,true); });
if(new URLSearchParams(location.search).get('demo')==='tactics')loadSample(true);
if(new URLSearchParams(location.search).get('demo')==='goal')loadSample(false);
