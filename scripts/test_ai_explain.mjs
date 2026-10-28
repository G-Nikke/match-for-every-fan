import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { modelRequest, validateModelReply, chatCompletionUrl, explainWithFoundry,
  validateObservation, explainObservationWithFoundry, inspectFrameWithFoundry,
  validateCommentaryStyle, validateViewerCue,
  validateRecapLines, summarizePreviousLinesWithFoundry } from '../ai_explain.js';

test('V5 recap uses previous AI lines only', async () => {
  const lines = ['White shirts move down the right.', 'Red defenders close the space.'];
  let sent;
  const reply = text => async (_url, options) => {
    sent = JSON.parse(options.body);
    return {ok:true,json:async () => ({choices:[{message:{content:JSON.stringify({bullets:[text]})}}]})};
  };
  const result = await summarizePreviousLinesWithFoundry({lines,
    endpoint:'https://demo.openai.azure.com/',deployment:'gpt-4o',apiKey:'fake',
    fetchImpl:reply('White shirts moved down the right while red defenders closed space.')});
  assert.equal(result.lineCount,2);
  assert.equal(result.source,'foundry-recap');
  assert.equal(sent.messages[1].content.includes('data:image'),false);
  assert.equal(sent.messages[1].content.includes(lines[0]),true);
  assert.throws(() => validateRecapLines({lines:['<script>']}));
});

const match = JSON.parse(fs.readFileSync(new URL('../data/match.json', import.meta.url), 'utf8'));

test('only verified synthetic event facts enter a Foundry request', async () => {
  const request = modelRequest(match, 'E015', 'tactical');
  assert.equal(request.event.event_id, 'E015');
  assert.ok(request.evidence.some(item => item.id === 'E014'));
  assert.ok(request.evidence.every(item => !('video' in item) && !('path' in item)));
  const calls = [];
  const answer = await explainWithFoundry({ match, eventId:'E015', mode:'tactical',
    endpoint:'https://demo.openai.azure.com/openai/v1/', deployment:'football-model', apiKey:'test-key',
    fetchImpl:async (url, options) => {
      calls.push({ url, options });
      return { ok:true, json:async () => ({ choices:[{message:{content:JSON.stringify({
        text:'The linked shot becomes a goal for Harbour FC.', evidence_ids:['E014','E015']
      })}}] }) };
    } });
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://demo.openai.azure.com/openai/v1/chat/completions');
  const outbound = JSON.parse(calls[0].options.body);
  assert.equal(outbound.model,'football-model');
  assert.equal(outbound.messages[1].content.includes('E015'),true);
  assert.deepEqual(answer.evidenceIds,['E014','E015']);
  assert.equal(answer.source,'foundry-model');
});

test('rejects unsupported citations, numeric claims and non-JSON output', () => {
  const request = modelRequest(match,'E015','emotion');
  const valid = JSON.stringify({text:'What a moment for Harbour FC as the recorded shot becomes a goal!',evidence_ids:['E014','E015']});
  assert.equal(validateModelReply(valid,request).source,'foundry-model');
  for (const content of [
    'GOAL!',
    JSON.stringify({text:'Harbour FC now lead 1-0!',evidence_ids:['E015']}),
    JSON.stringify({text:'A confirmed offside goal changes the match.',evidence_ids:['E015']}),
    JSON.stringify({text:'The recorded shot becomes a goal.',evidence_ids:['E999']}),
    JSON.stringify({text:'The recorded shot becomes a goal.',evidence_ids:['E014']})
  ]) assert.throws(() => validateModelReply(content,request));
  assert.throws(() => chatCompletionUrl('http://example.com'));
});

test('live AI receives bounded detections, never video frames', async () => {
  const observation = { peopleCount: 8, ballState: 'Possible', ballArea: 'right' };
  assert.deepEqual(validateObservation(observation), observation);
  assert.throws(() => validateObservation({ ...observation, image: 'data:image/jpeg;base64,secret',
    peopleCount: -1 }));
  let outbound;
  const result = await explainObservationWithFoundry({
    observation, endpoint: 'https://demo.openai.azure.com/', deployment: 'DeepSeek-V4-Flash',
    apiKey: 'test-key', fetchImpl: async (_url, options) => {
      outbound = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        text: 'A possible ball is on the right side of the picture.'
      }) } }] }) };
    }
  });
  assert.equal(result.source, 'foundry-observation');
  assert.equal(outbound.messages[1].content.includes('image'), false);
  assert.equal(outbound.messages[1].content.includes('right'), true);
  assert.equal(outbound.max_tokens, 400);
});

test('Foundry HTTP failures retain actionable status without exposing response bodies', async () => {
  await assert.rejects(
    explainObservationWithFoundry({
      observation: { peopleCount: 8, ballState: 'Not found', ballArea: null },
      endpoint: 'https://demo.openai.azure.com/', deployment: 'DeepSeek-V4-Flash',
      apiKey: 'test-key',
      fetchImpl: async () => ({ ok: false, status: 401, text: async () => 'secret response body' })
    }),
    error => error.message.includes('HTTP 401') && error.message.includes('API key') &&
      !error.message.includes('secret response body')
  );
});

test('manual frame mode sends exactly one JPEG to an image model and checks its answer', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  let outbound;
  const result = await inspectFrameWithFoundry({
    jpeg, endpoint: 'https://demo.openai.azure.com/', deployment: 'gpt-4o-mini', apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      outbound = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        caption: 'Several players are spread across the pitch; the ball is not clear in this frame.',
        ball_status: 'not_confirmed', ball_area: null, visible_players: 13,
        shape: 'White shirts are clustered near the penalty area.', shape_change: 'unknown',
        full_team_visible: false, formation: null,
        lines: [{ color: 'white', role: 'defence', points: [
          { x: 220, y: 590 }, { x: 340, y: 580 }, { x: 470, y: 600 }
        ] }]
      }) } }] }) };
    }
  });
  assert.equal(outbound.model, 'gpt-4o-mini');
  assert.equal(outbound.response_format.type, 'json_object');
  assert.match(outbound.messages[0].content, /SCENE GUIDE/);
  assert.match(outbound.messages[0].content, /10 to 18 words/);
  assert.doesNotMatch(outbound.messages[0].content, /"lines"/);
  const images = outbound.messages[1].content.filter(part => part.type === 'image_url');
  assert.equal(images.length, 1);
  assert.equal(images[0].image_url.url, `data:image/jpeg;base64,${jpeg}`);
  assert.equal(images[0].image_url.detail, 'high');
  assert.equal(result.source, 'foundry-frame');
  assert.equal(result.ballStatus, 'not_confirmed');
  assert.equal(result.visiblePlayers, 13);
  assert.equal(result.formation, null);
  assert.equal(result.style, 'simple');
  assert.equal(result.deliveryMode, 'description');
  assert.equal(result.cueUsed, false);
  assert.equal('lines' in result, false);
  assert.equal(result.framesCompared, 1);
  const compared = await inspectFrameWithFoundry({
    jpeg, previousJpeg: jpeg, previousCaption: 'Players are spread across the pitch.',
    endpoint: 'https://demo.openai.azure.com/', deployment: 'gpt-4o-mini', apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.messages[1].content.filter(part => part.type === 'image_url').length, 2);
      assert.match(request.messages[1].content[0].text, /Previous caption/);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        caption: 'Players are grouped near the goal as a corner kick moves into the box.',
        ball_status: 'not_confirmed', ball_area: null, visible_players: 14,
        shape: 'The white shirts appear spread across the middle.', shape_change: 'wider',
        full_team_visible: false, formation: null,
        lines: [{ color: 'white', role: 'midfield', points: [
          { x: -1, y: 500 }, { x: 400, y: 500 }, { x: 600, y: 500 }
        ] }]
      }) } }] }) };
    }
  });
  assert.equal(compared.framesCompared, 2);
  assert.equal('lines' in compared, false);
  await assert.rejects(inspectFrameWithFoundry({
    jpeg: 'not-a-jpeg', endpoint: 'https://demo.openai.azure.com/',
    deployment: 'gpt-4o-mini', apiKey: 'test-key', fetchImpl: async () => { throw new Error('must not call'); }
  }), /Invalid JPEG/);
  const unsafe = await inspectFrameWithFoundry({
    jpeg, endpoint: 'https://demo.openai.azure.com/', deployment: 'gpt-4o-mini', apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      caption: 'The team scores a goal in this frame.', ball_status: 'possible', ball_area: 'left'
    }) } }] }) })
  });
  assert.equal(unsafe.text, '');
  assert.equal(unsafe.ballStatus, 'possible');
});

test('V2.1 keeps valid guidance when the image model returns uncertain or inconsistent ball fields', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  for (const [status, area] of [
    ['not_confirmed', 'unknown'], ['uncertain', null], ['possible', null],
    [null, 'left'], ['possible', 'somewhere near the edge']
  ]) {
    const answer = await inspectFrameWithFoundry({
      jpeg, endpoint: 'https://demo.openai.azure.com/', deployment: 'gpt-4o', apiKey: 'test-key',
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: {
        content: JSON.stringify({
          caption: 'Several players are grouped near the right side of the pitch.',
          ball_status: status, ball_area: area, visible_players: 12,
          shape: 'White shirts form a narrow visible line.', shape_change: 'unknown',
          full_team_visible: false, formation: null
        })
      } }] }) })
    });
    assert.equal(answer.ballStatus, 'not_confirmed');
    assert.equal(answer.ballArea, null);
    assert.match(answer.text, /Several players/);
    assert.match(answer.shape, /White shirts/);
  }
  const americanSpelling = await inspectFrameWithFoundry({
    jpeg, endpoint: 'https://demo.openai.azure.com/', deployment: 'gpt-4o', apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: {
      content: JSON.stringify({
        caption: 'Players are visible near the middle of the pitch.',
        ball_status: 'possible', ball_area: 'center', visible_players: 10,
        shape: 'Red shirts are visible in a loose group.', shape_change: 'unknown',
        full_team_visible: false, formation: null
      })
    } }] }) })
  });
  assert.equal(americanSpelling.ballStatus, 'possible');
  assert.equal(americanSpelling.ballArea, 'centre');
});

test('V2.1 suppresses weak formation fields without discarding the whole AI reply', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  const answer = await inspectFrameWithFoundry({
    jpeg, endpoint: 'https://demo.openai.azure.com/', deployment: 'gpt-4o', apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: {
      content: JSON.stringify({ caption: 'A goal has definitely been scored.',
        ball_status: 'uncertain', ball_area: 'left', visible_players: 'many',
        shape: '4-2-3-1', shape_change: 'wider', full_team_visible: false,
        formation: '4-2-3-1', lines: [{color:'red', role:'midfield', points:[
          {x:200,y:500},{x:300,y:500},{x:400,y:500}]}] })
    } }] }) })
  });
  assert.equal(answer.text, '');
  assert.equal(answer.ballStatus, 'not_confirmed');
  assert.equal(answer.visiblePlayers, null);
  assert.equal(answer.shape, 'No reliable team shape visible.');
  assert.equal(answer.shapeChange, 'unknown');
  assert.equal(answer.formation, null);
  assert.equal('lines' in answer, false);
});

test('V4.1 switches between brief simple, professional and excited live calls', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  for (const [style, phrase] of [
    ['simple', 'familiar words'], ['professional', 'precise football vocabulary'], ['excited', 'lively rhythm']
  ]) {
    let outbound;
    const answer = await inspectFrameWithFoundry({ jpeg, style, deliveryMode:'commentary',
      endpoint:'https://demo.openai.azure.com/', deployment:'gpt-4o', apiKey:'test-key',
      fetchImpl:async (_url, options) => {
        outbound = JSON.parse(options.body);
        return { ok:true, json:async () => ({choices:[{message:{content:JSON.stringify({
          caption:'Down the flank they go... bodies waiting in the box!',
          ball_status:'not_confirmed',ball_area:null,visible_players:12,
          shape:'White shirts gather across the penalty area.',shape_change:'unknown',
          full_team_visible:false,formation:null
        })}}]}) };
      }
    });
    assert.equal(answer.style, style);
    assert.match(outbound.messages[0].content, new RegExp(phrase, 'i'));
    assert.match(outbound.messages[0].content, /LIVE CALL/);
    assert.match(outbound.messages[0].content, /Never narrate a photograph/);
  }
  assert.throws(() => validateCommentaryStyle('invented'));
});

test('V4.1 keeps short calls and permits silence instead of filler', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  const answerFor = (caption, deliveryMode = 'commentary') => inspectFrameWithFoundry({ jpeg, deliveryMode,
    endpoint:'https://demo.openai.azure.com/', deployment:'gpt-4o', apiKey:'test-key',
    fetchImpl:async () => ({ok:true,json:async () => ({choices:[{message:{content:JSON.stringify({
      caption, ball_status:'not_confirmed',ball_area:null,visible_players:12,
      shape:'No reliable team shape visible.',shape_change:'unknown',
      full_team_visible:false,formation:null
    })}}]})})
  });
  assert.equal((await answerFor('Down the left!')).text, 'Down the left!');
  assert.equal((await answerFor('')).text, '');
  assert.equal((await answerFor('A very long description of the whole pitch that keeps explaining every visible player and continues well past a normal live commentary beat.')).text, '');
  assert.match((await answerFor('White shirts move down the right as two red defenders close the space near the box.', 'description')).text, /White shirts move/);
});

test('V3 goal and player names require a structured viewer-confirmed cue', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  const reply = () => ({ ok:true, json:async () => ({choices:[{message:{content:JSON.stringify({
    caption:'GOAL! Bellingham finishes it!', ball_status:'not_confirmed', ball_area:null,
    visible_players:11, shape:'Players are grouped near the penalty area.',
    shape_change:'unknown', full_team_visible:false, formation:null
  })}}]}) });
  let outbound;
  const withCue = await inspectFrameWithFoundry({ jpeg, style:'excited',
    viewerCue:{event:'goal',player:'Bellingham'},
    endpoint:'https://demo.openai.azure.com/', deployment:'gpt-4o', apiKey:'test-key',
    fetchImpl:async (_url, options) => { outbound=JSON.parse(options.body); return reply(); }
  });
  assert.equal(withCue.text, 'GOAL! Bellingham finishes it!');
  assert.equal(withCue.cueUsed, true);
  assert.match(outbound.messages[1].content[0].text, /VIEWER-CONFIRMED CUE/);
  assert.match(outbound.messages[1].content[0].text, /Bellingham/);
  const withoutCue = await inspectFrameWithFoundry({ jpeg, style:'excited',
    endpoint:'https://demo.openai.azure.com/', deployment:'gpt-4o', apiKey:'test-key',
    fetchImpl:async () => reply()
  });
  assert.equal(withoutCue.text, '');
  assert.throws(() => validateViewerCue({event:'goal',player:'<script>'}));
  assert.throws(() => validateViewerCue({event:'score',player:'Bellingham'}));
  assert.throws(() => validateViewerCue({event:'on_ball',player:''}));
});

test('current GPT image deployment uses reasoning-model chat parameters', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(120, 7)]).toString('base64');
  let outbound;
  await inspectFrameWithFoundry({ jpeg, endpoint: 'https://demo.openai.azure.com/',
    deployment: 'gpt-5.4-mini', apiKey: 'test-key', fetchImpl: async (_url, options) => {
      outbound = JSON.parse(options.body);
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
        caption: 'Several players are visible across the pitch; the ball is not confirmed.',
        ball_status: 'not_confirmed', ball_area: null, visible_players: 13,
        shape: 'White shirts form a compact group near the box.', shape_change: 'unknown',
        full_team_visible: false, formation: null
      }) } }] }) };
    } });
  assert.equal(outbound.max_completion_tokens, 600);
  assert.equal(outbound.reasoning_effort, 'none');
  assert.equal('max_tokens' in outbound, false);
});
