// Pure, independently testable facts and timeline logic. No browser dependencies.
export const clock = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
export function narrative(match, event, mode = 'tactical') {
  if (event.source === 'manual_annotation') {
    const text = event.narratives[mode];
    return { title: event.title, text, evidence: event.evidence, score: event.score_after, speech: `${event.title}. ${text}` };
  }
  const team = match.teams[event.team_id];
  const who = team.players[event.player_id];
  const to = team.players[event.recipient_id];
  const kind = event.event_type;
  const metres = Math.round(Math.hypot(event.end_xy[0] - event.start_xy[0], event.end_xy[1] - event.start_xy[1]));
  const facts = {
    pass: [`${who} → ${to}`, `A completed ${metres} m pass retains possession for ${team.name}.`, `Keep it moving! ${who} finds ${to}.`, `${who} passes to a teammate. Their team keeps the ball.`],
    goal: [`${who} scores`, `The linked shot becomes a goal. ${team.name} change the score to ${event.score_after.join('–')}.`, `GOOOOAL! ${who} finishes it! ${team.name} make it ${event.score_after.join('–')}!`, `${team.name} score. It is now ${event.score_after.join('–')}.`],
    shot: [`${who} shoots`, `A shot is recorded for ${team.name}. Its outcome is not known at this point.`, `${who} goes for goal! The outcome comes next.`, `${who} tries to score. Watch for the result next.`],
    save: [`${who} makes a save`, `The linked shot is stopped; possession goes to ${team.name}.`, `Denied! ${who} stops the shot.`, `The shot is saved. ${team.name} have the ball.`],
    tackle: [`${who} wins the ball`, `The recorded tackle changes possession to ${team.name}.`, `Won back! ${who} takes possession.`, `${team.name} win the ball from the other team.`],
    interception: [`${who} intercepts`, `The interception changes possession to ${team.name}.`, `${who} cuts it out! Possession won.`, `${who} stops the other team's pass and wins the ball.`],
    pressure: [`${who} applies pressure`, 'Pressure is recorded. This event alone does not prove a turnover or a team pressing system.', `${who} puts the opponent under pressure. What comes next?`, `${who} challenges the opponent. We do not know the result yet.`],
    substitution: [`${to} replaces ${who}`, 'A substitution changes the available players. Its performance impact is not yet known.', `${to} comes on. A fresh chapter begins!`, `${to} enters the match and ${who} leaves.`],
    restart: [`${team.name} restart`, `${team.name} have possession at this recorded restart.`, 'Back in play. Here we go!', `${team.name} start play again.`],
    kickoff: [`${team.name} kick off`, `${team.name} have possession at the restart.`, 'We are back underway!', `${team.name} start play again.`]
  };
  const row = facts[kind];
  if (!row) throw new Error(`Unsupported event: ${kind}`);
  const text = row[{ tactical: 1, emotion: 2, casual: 3 }[mode] ?? 1];
  return { title: row[0], text, score: event.score_after, evidence: [...new Set([...event.related_event_ids, event.event_id])], speech: `${clock(event.match_clock_ms)}. ${row[0]}. ${text}` };
}
export function recentStats(events, index) {
  const current = events[index];
  const recent = events.slice(0, index + 1).filter(e => e.scene_id === current.scene_id && current.match_clock_ms - e.match_clock_ms <= 60000);
  return { passes: recent.filter(e => e.event_type === 'pass' && e.outcome === 'complete').length, shots: recent.filter(e => e.event_type === 'shot').length, evidence: recent.map(e => e.event_id) };
}
// Synthetic time is presentation time: excerpts intentionally skip match-clock gaps.
export const demoTime = index => index * 4;
export const demoIndex = (time, length) => Math.max(0, Math.min(length - 1, Math.floor(time / 4)));
export function activeAnnotation(events, time) {
  // Absolute lookup makes pause, backward seek, rate changes and replay idempotent.
  return events.findLast(e => e.time_s <= time && time < e.end_s) ?? null;
}
export function validateAnnotations(data, video) {
  const fail = message => { throw new Error(message); };
  if (data.schema_version !== 1 || data.source !== 'manual_annotation') fail('Expected version 1 manual_annotation data.');
  if (data.video_id !== video.name || !Number.isFinite(data.duration_s) || Math.abs(data.duration_s - video.duration) > 0.5) fail('Annotations must match this video filename and duration.');
  if (!Array.isArray(data.events) || data.events.length > 1000) fail('Expected at most 1,000 events.');
  const ids = new Set();
  let end = 0;
  const point = p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0 && n <= 100);
  for (const e of data.events) {
    if (!e.event_id || ids.has(e.event_id) || e.source !== 'manual_annotation') fail('Events need unique IDs and manual_annotation source.');
    ids.add(e.event_id);
    if (!Number.isFinite(e.time_s) || !Number.isFinite(e.end_s) || e.time_s < end || e.end_s <= e.time_s || e.end_s > video.duration + 0.1) fail('Intervals must be sorted, non-overlapping, and within the video.');
    end = e.end_s;
    if (!['observation', 'pass', 'shot', 'goal', 'save', 'tackle', 'interception', 'pressure', 'restart', 'substitution', 'sound'].includes(e.event_type)) fail('Unknown annotation event type.');
    if (typeof e.title !== 'string' || !e.title.trim() || e.title.length > 180 || !['tactical', 'emotion', 'casual'].every(k => typeof e.narratives?.[k] === 'string' && e.narratives[k].length > 0 && e.narratives[k].length < 600)) fail('Provide a title and all three verified narratives.');
    if (!Array.isArray(e.evidence) || !e.evidence.length || !e.evidence.every(v => typeof v === 'string' && v.length < 200)) fail('Each annotation needs evidence references.');
    if (e.score_after !== null && (!Array.isArray(e.score_after) || e.score_after.length !== 2 || !e.score_after.every(n => Number.isInteger(n) && n >= 0 && n < 100))) fail('Score must be null or two non-negative integers.');
    if (!Array.isArray(e.markers) || e.markers.length > 30 || !e.markers.every(m => point(m.xy) && ['A', 'B', 'unknown'].includes(m.team))) fail('Player markers use team A/B/unknown and normalized video coordinates 0–100.');
    if (!Array.isArray(e.lines) || e.lines.length > 12 || !e.lines.every(l => ['Defence', 'Midfield', 'Attack'].includes(l.label) && ['A', 'B'].includes(l.team) && Array.isArray(l.points) && l.points.length >= 2 && l.points.length <= 20 && l.points.every(point))) fail('Lines require Defence/Midfield/Attack, team A/B and normalized points.');
  }
  return data;
}
