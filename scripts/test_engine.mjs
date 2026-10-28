import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { narrative, recentStats, activeAnnotation, validateAnnotations, demoIndex } from '../engine.js';
const match=JSON.parse(fs.readFileSync(new URL('../data/match.json',import.meta.url),'utf8'));
const sample=JSON.parse(fs.readFileSync(new URL('../data/amateur_goal_annotations.json',import.meta.url),'utf8'));
const video={name:'amateur_goal.webm',duration:31.988};
test('all 45 events preserve scores and evidence in all three styles',()=>{
 for(const e of match.events){
  const results=['tactical','emotion','casual'].map(mode=>narrative(match,e,mode));
  assert.equal(new Set(results.map(n=>n.text)).size,3,e.event_id);
  for(const n of results){assert.deepEqual(n.score,e.score_after);assert.ok(n.evidence.includes(e.event_id));assert.ok(n.speech.includes(n.text));}
  assert.deepEqual(results[0].evidence,results[2].evidence);
 }
});
test('opening goal cites shot and does not infer an unsupported formation',()=>{
 const e=match.events.find(e=>e.event_id==='E015');
 for(const mode of ['tactical','emotion','casual']){const n=narrative(match,e,mode);assert.deepEqual(n.evidence,['E014','E015']);assert.deepEqual(n.score,[1,0]);assert.ok(!n.text.includes('4-3-3'));}
});
test('last-minute statistics exclude future events and other excerpts',()=>{
 for(const i of [0,14,15,29,30,44]){
  const s=recentStats(match.events,i),e=match.events[i];
  for(const id of s.evidence){const item=match.events.find(v=>v.event_id===id);assert.equal(item.scene_id,e.scene_id);assert.ok(e.match_clock_ms-item.match_clock_ms<=60000);assert.ok(match.events.indexOf(item)<=i);}
 }
 assert.deepEqual(recentStats(match.events,0),{passes:0,shots:0,evidence:['E001']});
});
test('synthetic seeks clamp to valid event indices',()=>{
 assert.equal(demoIndex(56,45),14);assert.equal(demoIndex(179.99,45),44);assert.equal(demoIndex(-10,45),0);assert.equal(demoIndex(999,45),44);
});
test('sample validates without inventing score, identity or formation',()=>{
 assert.equal(validateAnnotations(sample,video),sample);
 for(const e of sample.events){assert.equal(e.score_after,null);assert.equal(e.lines.length,0);}
});
test('absolute timeline handles backward seek, gaps, boundary and replay',()=>{
 assert.equal(activeAnnotation(sample.events,0)?.event_id,'V001');
 assert.equal(activeAnnotation(sample.events,.25),null);
 assert.equal(activeAnnotation(sample.events,19.4)?.event_id,'V002');
 assert.equal(activeAnnotation(sample.events,19.8)?.event_id,'V003');
 assert.equal(activeAnnotation(sample.events,25),null);
 assert.equal(activeAnnotation(sample.events,19.4)?.event_id,'V002');
 assert.equal(activeAnnotation(sample.events,0)?.event_id,'V001');
});
test('rejects mismatched video, duration, interval and malformed positions',()=>{
 assert.throws(()=>validateAnnotations(sample,{...video,name:'another.mp4'}));
 assert.throws(()=>validateAnnotations(sample,{...video,duration:2}));
 for(const mutate of [
  d=>d.events[1].time_s=-1,
  d=>d.events[1].time_s=.1,
  d=>d.events[1].end_s=99,
  d=>d.events[1].event_id='V001',
  d=>d.events[0].markers[0].xy=[101,3],
  d=>d.events[0].markers[0].xy=['0',3],
  d=>d.events[0].score_after=[-1,0],
  d=>d.events[0].narratives.casual='',
  d=>d.events[0].evidence=[],
  d=>d.events[0].lines=[{team:'A',label:'Defence',points:[[1,2],[3,Infinity]]}],
 ]){const data=structuredClone(sample);mutate(data);assert.throws(()=>validateAnnotations(data,video));}
});
test('tactical lines are accepted only as explicit manual coordinates',()=>{
 const data=structuredClone(sample);
 data.events[0].lines=[{team:'A',label:'Defence',points:[[10,10],[20,20]]}];
 assert.doesNotThrow(()=>validateAnnotations(data,video));
 data.events[0].lines[0].label='Automatic 4-3-3';assert.throws(()=>validateAnnotations(data,video));
});

test('actual corner snapshot validates and clears on resume or backward seek',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../data/tactical_frame_annotations.json',import.meta.url),'utf8'));
 validateAnnotations(data,{name:'new_zealand_canada_2018_10s.webm',duration:10.017});
 assert.equal(activeAnnotation(data.events,6).event_id,'T001');
 assert.equal(activeAnnotation(data.events,6.06),null);
 assert.equal(activeAnnotation(data.events,5),null);
 assert.equal(data.events[0].markers.length,15);
 assert.equal(data.events[0].lines.length,2);
 assert.deepEqual(data.events[0].lines.map(l=>l.label),['Defence','Attack']);
 assert.equal(data.events[0].score_after,null);
});
