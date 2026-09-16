/**
 * Integration test: setup → runtime → discovery (no re-setup required).
 *
 * Validates the core requirement:
 *   1. npm run setup (install)
 *   2. discover() → healthy
 *   3. Running application (simulated by reading config)
 *   4. Running application again
 *   5. discover() still → healthy (no re-setup needed)
 *
 * Also validates idempotency:
 *   1. setup()
 *   2. setup()
 *   3. discover() → healthy, no duplicates
 *
 * All 6 platforms tested.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { discoverPlatform, discover } from '../../tools/discover-installed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const cli = join(root, 'packages', 'cli', 'install.mjs');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { passed++; }
  else { console.error(`FAIL  ${name}`); failed++; }
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

function install(platform, dir) {
  return spawnSync('node', [cli, '--yes', '--platform', platform, '--agent', 'orchestrator'], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 60000,
  });
}

function countFiles(dir, pattern) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(pattern)).length;
  } catch {
    return -1;
  }
}

// ── Test 1: setup → discover → runtime (opencode) ──
{
  console.log('\n[Type 1] setup → discover → runtime (opencode)');
  const dir = tmp('int-setup-runtime-oc');
  const r = install('opencode', dir);
  assert(r.status === 0, 'opencode install exits 0');

  // Step 2: discover → healthy
  const d1 = discover(dir);
  assert(d1.healthy === true, 'after setup: discover healthy');
  assert(d1.installed.platform === 'opencode', 'after setup: platform detected');

  // Step 3: "runtime" — read config (simulates application startup)
  const oc = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf-8'));
  assert(oc.default_agent === 'orchestrator', 'runtime: default_agent=orchestrator');
  assert(oc.agent.orchestrator, 'runtime: orchestrator in agent map');
  const agentCount = Object.keys(oc.agent).length;
  assert(agentCount >= 140, `runtime: ${agentCount} agents loaded`);

  // Step 4: "runtime" again — no re-setup
  const oc2 = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf-8'));
  assert(oc2.default_agent === 'orchestrator', 'runtime again: config stable');

  // Step 5: discover still healthy
  const d2 = discover(dir);
  assert(d2.healthy === true, 'after runtime: discover still healthy');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 2: setup → discover → runtime (claude-code) ──
{
  console.log('\n[Type 2] setup → discover → runtime (claude-code)');
  const dir = tmp('int-setup-runtime-cc');
  install('claude-code', dir);

  const d1 = discover(dir);
  assert(d1.healthy === true, 'claude-code: after setup healthy');

  // Runtime: read CLAUDE.md
  const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf-8');
  assert(claude.includes('mode: primary'), 'claude-code runtime: orchestrator is primary');

  const d2 = discover(dir);
  assert(d2.healthy === true, 'claude-code: after runtime still healthy');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 3: setup → discover → runtime (cursor) ──
{
  console.log('\n[Type 3] setup → discover → runtime (cursor)');
  const dir = tmp('int-setup-runtime-cur');
  install('cursor', dir);

  const d1 = discover(dir);
  assert(d1.healthy === true, 'cursor: after setup healthy');

  // Runtime: read Orchestrator.mdc
  const orch = readFileSync(join(dir, '.cursor', 'rules', 'Orchestrator.mdc'), 'utf-8');
  assert(orch.includes('mode: primary'), 'cursor runtime: orchestrator is primary');

  const d2 = discover(dir);
  assert(d2.healthy === true, 'cursor: after runtime still healthy');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 4: setup → discover → runtime (copilot) ──
{
  console.log('\n[Type 4] setup → discover → runtime (copilot)');
  const dir = tmp('int-setup-runtime-cp');
  install('copilot', dir);

  const d1 = discover(dir);
  assert(d1.healthy === true, 'copilot: after setup healthy');

  // Runtime: read orchestrator.agent.md
  const orch = readFileSync(join(dir, '.github', 'agents', 'orchestrator.agent.md'), 'utf-8');
  assert(orch.includes('mode: primary'), 'copilot runtime: orchestrator is primary');

  const d2 = discover(dir);
  assert(d2.healthy === true, 'copilot: after runtime still healthy');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 5: setup → discover → runtime (aider) ──
{
  console.log('\n[Type 5] setup → discover → runtime (aider)');
  const dir = tmp('int-setup-runtime-aid');
  install('aider', dir);

  const d1 = discover(dir);
  assert(d1.healthy === true, 'aider: after setup healthy');

  // Runtime: read .aider.rules.md
  const rules = readFileSync(join(dir, '.aider.rules.md'), 'utf-8');
  assert(rules.length > 0, 'aider runtime: rules not empty');

  const d2 = discover(dir);
  assert(d2.healthy === true, 'aider: after runtime still healthy');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 6: setup → discover → runtime (gemini-cli) ──
{
  console.log('\n[Type 6] setup → discover → runtime (gemini-cli)');
  const dir = tmp('int-setup-runtime-gem');
  install('gemini-cli', dir);

  const d1 = discover(dir);
  assert(d1.healthy === true, 'gemini-cli: after setup healthy');

  // Runtime: read Orchestrator.md
  const orch = readFileSync(join(dir, '.gemini', 'Orchestrator.md'), 'utf-8');
  assert(orch.length > 0, 'gemini-cli runtime: orchestrator not empty');

  const d2 = discover(dir);
  assert(d2.healthy === true, 'gemini-cli: after runtime still healthy');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 7: repeated setup → no duplication, still healthy ──
{
  console.log('\n[Type 7] repeated setup (idempotency)');
  const dir = tmp('int-idempotent');
  install('opencode', dir);

  // Count agents before second install
  const agentsBefore = countFiles(join(dir, 'agents'), '.md');

  // Second install
  install('opencode', dir);

  const agentsAfter = countFiles(join(dir, 'agents'), '.md');
  assert(agentsBefore === agentsAfter, `idempotency: agents before=${agentsBefore}, after=${agentsAfter}`);

  const d = discover(dir);
  assert(d.healthy === true, 'idempotency: still healthy after double setup');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 8: setup → delete agents/ → discover unhealthy → repair ──
{
  console.log('\n[Type 8] setup → damage → discover unhealthy → repair');
  const dir = tmp('int-repair');
  install('opencode', dir);

  const d1 = discover(dir);
  assert(d1.healthy === true, 'initial: healthy');

  // Damage: delete agents/
  rmSync(join(dir, 'agents'), { recursive: true, force: true });

  const d2 = discover(dir);
  assert(d2.healthy === false, 'after damage: unhealthy');
  assert(d2.message.includes('incomplete') || d2.message.includes('not found'), 'damage detected');

  // Repair: re-install
  install('opencode', dir);

  const d3 = discover(dir);
  assert(d3.healthy === true, 'after repair: healthy again');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 9: --check flag validates without modifying ──
{
  console.log('\n[Type 9] --check flag (discovery only)');
  const dir = tmp('int-check-flag');
  install('opencode', dir);

  const r = spawnSync('node', [cli, '--check'], {
    cwd: dir,
    encoding: 'utf-8',
  });
  assert(r.status === 0, '--check exits 0 for healthy install');
  assert(r.stdout.includes('healthy'), '--check reports healthy');

  // --check should NOT modify anything
  const oc = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf-8'));
  assert(oc.default_agent === 'orchestrator', '--check did not modify config');

  rmSync(dir, { recursive: true, force: true });
}

// ── Test 10: --check flag on missing install exits 1 ──
{
  console.log('\n[Type 10] --check flag on missing install');
  const dir = tmp('int-check-missing');

  const r = spawnSync('node', [cli, '--check'], {
    cwd: dir,
    encoding: 'utf-8',
  });
  assert(r.status === 1, '--check exits 1 for missing install');
  assert(r.stdout.includes('No installation') || r.stdout.includes('incomplete'), '--check reports issue');

  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
