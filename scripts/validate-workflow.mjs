#!/usr/bin/env node
// Checks an n8n workflow JSON file for the mistakes that make an import fail or a run break.
// Usage: node scripts/validate-workflow.mjs workflows/my-workflow.json [more.json ...]
// No dependencies. Needs Node 18 or newer.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STICKY = 'n8n-nodes-base.stickyNote';

// Token shapes that should never be pasted into a workflow file. Secrets belong in n8n credentials.
const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key starting with "sk-"'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'a Google API key'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{20,}/, 'a hard-coded Bearer token'],
];

const isTrigger = (type) => /trigger$/i.test(type) || type === 'n8n-nodes-base.webhook';

// Every string inside a node's parameters, however deeply nested.
function* strings(value) {
  if (typeof value === 'string') yield value;
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* strings(v);
}

export function validate(workflow) {
  const errors = [];
  const warnings = [];

  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    return { errors: ['The file must contain one workflow object.'], warnings };
  }
  if (!Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return { errors: ['"nodes" must be a list with at least one node.'], warnings };
  }
  if (!workflow.connections || typeof workflow.connections !== 'object' || Array.isArray(workflow.connections)) {
    return { errors: ['"connections" must be an object (use {} when there are none).'], warnings };
  }

  const names = new Set();
  const ids = new Set();
  for (const [i, node] of workflow.nodes.entries()) {
    const label = node?.name ? `Node "${node.name}"` : `Node #${i + 1}`;
    if (!node || typeof node !== 'object') { errors.push(`${label} is not an object.`); continue; }
    if (typeof node.name !== 'string' || !node.name) errors.push(`${label} has no "name".`);
    else if (names.has(node.name)) errors.push(`Two nodes are both named "${node.name}". Names must be unique.`);
    else names.add(node.name);
    if (node.id !== undefined) {
      if (ids.has(node.id)) errors.push(`${label} reuses the id "${node.id}".`);
      ids.add(node.id);
    }
    if (typeof node.type !== 'string' || !node.type.includes('.')) errors.push(`${label} needs a "type" such as "n8n-nodes-base.set".`);
    if (typeof node.typeVersion !== 'number') errors.push(`${label} needs a numeric "typeVersion".`);
    if (!Array.isArray(node.position) || node.position.length !== 2 || !node.position.every(Number.isFinite)) {
      errors.push(`${label} needs a "position" of two numbers, for example [0, 0].`);
    }
    if (node.parameters === undefined || node.parameters === null || typeof node.parameters !== 'object') {
      errors.push(`${label} needs a "parameters" object (use {} when empty).`);
    }
    for (const text of strings(node.parameters)) {
      for (const [pattern, what] of SECRET_PATTERNS) {
        if (pattern.test(text)) errors.push(`${label} contains ${what}. Move it into an n8n credential.`);
      }
      // $('Name') and $node["Name"] must point at a node that exists.
      for (const m of text.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)|\$node\[\s*['"]([^'"]+)['"]\s*\]/g)) {
        const ref = m[1] ?? m[2];
        if (!workflow.nodes.some((n) => n?.name === ref)) errors.push(`${label} refers to a node named "${ref}" that does not exist.`);
      }
    }
    if (node.credentials && Object.values(node.credentials).some((c) => c?.id)) {
      warnings.push(`${label} carries a credential id. Ids only work on the n8n instance they came from; reselect the credential after import.`);
    }
  }

  const real = workflow.nodes.filter((n) => n && n.type !== STICKY);
  if (!real.some((n) => typeof n.type === 'string' && isTrigger(n.type))) {
    errors.push('No trigger node found. A workflow needs one (Manual Trigger, Schedule Trigger, Webhook, ...).');
  }

  const hasIncoming = new Set();
  for (const [source, outputs] of Object.entries(workflow.connections)) {
    if (!names.has(source)) { errors.push(`Connections start from "${source}", which is not a node in this workflow.`); continue; }
    if (!outputs || typeof outputs !== 'object') { errors.push(`Connections of "${source}" are malformed.`); continue; }
    for (const [kind, branches] of Object.entries(outputs)) {
      if (!Array.isArray(branches)) { errors.push(`Connections of "${source}" (${kind}) must be a list of lists.`); continue; }
      for (const branch of branches) {
        if (branch === null) continue; // an unused output, n8n writes these itself
        if (!Array.isArray(branch)) { errors.push(`Connections of "${source}" (${kind}) must be a list of lists.`); continue; }
        for (const link of branch) {
          if (!link || typeof link.node !== 'string') errors.push(`A connection from "${source}" has no target node.`);
          else if (!names.has(link.node)) errors.push(`"${source}" connects to "${link.node}", which does not exist.`);
          else hasIncoming.add(link.node);
        }
      }
    }
  }

  for (const node of real) {
    if (typeof node.type !== 'string' || isTrigger(node.type) || hasIncoming.has(node.name)) continue;
    // Sub-nodes (models, tools, memory) connect outwards to their parent, so they have no incoming link.
    const outs = workflow.connections[node.name];
    if (outs && Object.keys(outs).some((kind) => kind !== 'main')) continue;
    warnings.push(`Node "${node.name}" has nothing connected into it, so it will never run.`);
  }

  return { errors, warnings };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/validate-workflow.mjs <workflow.json> [more.json ...]');
    process.exit(2);
  }
  let failed = false;
  for (const file of files) {
    let result;
    try {
      result = validate(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      result = { errors: [`Could not read it as JSON: ${e.message}`], warnings: [] };
    }
    console.log(`${result.errors.length ? 'FAIL' : 'OK  '} ${file}`);
    for (const e of result.errors) console.log(`  error:   ${e}`);
    for (const w of result.warnings) console.log(`  warning: ${w}`);
    if (result.errors.length) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
