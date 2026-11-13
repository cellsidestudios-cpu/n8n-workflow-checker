// Run from the kit folder with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './validate-workflow.mjs';

const node = (name, type = 'n8n-nodes-base.set', extra = {}) => ({
  name, type, typeVersion: 1, position: [0, 0], parameters: {}, ...extra,
});
const good = () => ({
  nodes: [node('Start', 'n8n-nodes-base.manualTrigger'), node('Edit')],
  connections: { Start: { main: [[{ node: 'Edit', type: 'main', index: 0 }]] } },
});
const errorsOf = (wf) => validate(wf).errors.join('\n');

test('a correct workflow passes with no warnings', () => {
  assert.deepEqual(validate(good()), { errors: [], warnings: [] });
});

test('rejects things that are not a workflow', () => {
  assert.match(errorsOf([]), /one workflow object/);
  assert.match(errorsOf({ nodes: [], connections: {} }), /at least one node/);
  assert.match(errorsOf({ nodes: [node('A')] }), /"connections" must be an object/);
});

test('duplicate names and missing fields are errors', () => {
  const wf = good();
  wf.nodes.push(node('Edit'));
  assert.match(errorsOf(wf), /both named "Edit"/);
  const bare = good();
  bare.nodes[1] = { name: 'Edit', type: 'set' };
  const e = errorsOf(bare);
  assert.match(e, /needs a "type"/);
  assert.match(e, /numeric "typeVersion"/);
  assert.match(e, /"position"/);
  assert.match(e, /"parameters"/);
});

test('a workflow without a trigger is an error', () => {
  assert.match(errorsOf({ nodes: [node('Edit')], connections: {} }), /No trigger node/);
});

test('connections to or from missing nodes are errors', () => {
  const wf = good();
  wf.connections.Start.main[0][0].node = 'Gone';
  assert.match(errorsOf(wf), /connects to "Gone"/);
  const wf2 = good();
  wf2.connections.Ghost = { main: [[]] };
  assert.match(errorsOf(wf2), /start from "Ghost"/);
});

test('expressions that name a missing node are errors', () => {
  const wf = good();
  wf.nodes[1].parameters = { a: { b: "={{ $('Fetch').item.json.id }}" }, c: '={{ $node["Start"].json.x }}' };
  const e = errorsOf(wf);
  assert.match(e, /node named "Fetch"/);
  assert.doesNotMatch(e, /node named "Start"/);
});

test('pasted secrets are errors', () => {
  const wf = good();
  wf.nodes[1].parameters = { headers: [{ value: 'Bearer abcdefghijklmnopqrstuvwxyz123456' }] };
  assert.match(errorsOf(wf), /hard-coded Bearer token/);
});

test('unconnected nodes and credential ids are warnings, not errors', () => {
  const wf = good();
  wf.nodes.push(node('Lonely'), node('Note', 'n8n-nodes-base.stickyNote'));
  wf.nodes[1].credentials = { httpHeaderAuth: { id: '12', name: 'My API' } };
  const r = validate(wf);
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings.join('\n'), /"Lonely" has nothing connected/);
});

test('AI sub-nodes that connect outwards are not flagged as unconnected', () => {
  const wf = good();
  wf.nodes.push(node('Model', '@n8n/n8n-nodes-langchain.lmChatAnthropic'));
  wf.connections.Model = { ai_languageModel: [[{ node: 'Edit', type: 'ai_languageModel', index: 0 }]] };
  assert.deepEqual(validate(wf).warnings, []);
});
