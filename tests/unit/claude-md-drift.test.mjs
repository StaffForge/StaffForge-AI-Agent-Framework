/**
 * Drift guard — root CLAUDE.md must equal the claude-code adapter output.
 *
 * Regression guard: the committed CLAUDE.md was stale (546-line legacy prompt)
 * while exports regenerated the current orchestrator body (200 lines), causing
 * churn on every test run. If the orchestrator body changes, this test fails
 * until CLAUDE.md is regenerated with `npm run export:claude`.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentRegistry } from '@staffforge/core';
import claudeCodeAdapter from '../../adapters/claude-code/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function assert(cond, name) {
  if (cond) {
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

{
  const agents = getAgentRegistry().all();
  const files = claudeCodeAdapter(agents, []);
  const claudeMd = files.find((f) => f.path === 'CLAUDE.md');
  assert(!!claudeMd, 'adapter emits CLAUDE.md');
  if (claudeMd) {
    const committed = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    assert(claudeMd.content === committed, 'root CLAUDE.md matches claude-code adapter output');
  }
  // Orchestrator must be present in the registry (CRLF regression guard)
  const orch = agents.find((a) => a.name.toLowerCase() === 'orchestrator');
  assert(!!orch, 'orchestrator present in agent registry');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
