/**
 * Unit tests: tools/discover-installed.mjs
 *
 * Tests discovery of installed state for each platform:
 * - Healthy installation detected
 * - Missing files detected
 * - Invalid config detected
 * - Unknown platform rejected
 * - detectLastInstall reads config correctly
 * - discover() returns coherent results
 */
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  discoverPlatform,
  discoverAll,
  detectLastInstall,
  discover,
} from '../../tools/discover-installed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) { passed++; }
  else { console.error(`FAIL  ${name}`); failed++; }
}

function tmp(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

// ── Test 1: unknown platform returns error ──
{
  const r = discoverPlatform('nonexistent', '/tmp');
  assert(r.ok === false, 'unknown platform returns ok=false');
  assert(r.errors.length === 1, 'unknown platform returns 1 error');
  assert(r.errors[0].includes('Unknown platform'), 'error mentions unknown platform');
}

// ── Test 2: opencode — healthy installation ──
{
  const dir = tmp('disc-oc-healthy');
  // Create opencode.json with orchestrator
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    default_agent: 'orchestrator',
    agent: {
      orchestrator: { description: 'Test', mode: 'primary', prompt: 'test' },
    },
  }));
  // Create agents/ with orchestrator.md
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'orchestrator.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('opencode', dir);
  assert(r.ok === true, 'opencode healthy: ok=true');
  assert(r.errors.length === 0, 'opencode healthy: no errors');
  assert(r.files.includes('opencode.json'), 'opencode healthy: opencode.json found');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 3: opencode — missing opencode.json ──
{
  const dir = tmp('disc-oc-nojson');
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'orchestrator.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('opencode', dir);
  assert(r.ok === false, 'opencode missing json: ok=false');
  assert(r.errors.some((e) => e.includes('opencode.json not found')), 'opencode missing json: error about json');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 4: opencode — missing agents/ ──
{
  const dir = tmp('disc-oc-noagents');
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    default_agent: 'orchestrator',
    agent: { orchestrator: {} },
  }));

  const r = discoverPlatform('opencode', dir);
  assert(r.ok === false, 'opencode missing agents: ok=false');
  assert(r.errors.some((e) => e.includes('agents/ directory not found')), 'opencode missing agents: error about agents');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 5: opencode — missing orchestrator in agent map ──
{
  const dir = tmp('disc-oc-noorch');
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    default_agent: 'orchestrator',
    agent: { python: {} },
  }));
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'orchestrator.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('opencode', dir);
  assert(r.ok === false, 'opencode missing orchestrator: ok=false');
  assert(r.errors.some((e) => e.includes('missing orchestrator')), 'error mentions missing orchestrator');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 6: opencode — wrong default_agent ──
{
  const dir = tmp('disc-oc-wrongdef');
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    default_agent: 'build',
    agent: { orchestrator: {}, build: {} },
  }));
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'orchestrator.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('opencode', dir);
  assert(r.ok === false, 'opencode wrong default: ok=false');
  assert(r.errors.some((e) => e.includes('default_agent')), 'error about default_agent');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 7: opencode — invalid JSON ──
{
  const dir = tmp('disc-oc-badjson');
  writeFileSync(join(dir, 'opencode.json'), '{ invalid json }}}');
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'orchestrator.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('opencode', dir);
  assert(r.ok === false, 'opencode bad json: ok=false');
  assert(r.errors.some((e) => e.includes('invalid JSON') || e.includes('Unexpected')), 'error about invalid JSON');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 8: claude-code — healthy installation ──
{
  const dir = tmp('disc-cc-healthy');
  writeFileSync(join(dir, 'CLAUDE.md'), '---\nname: Orchestrator\nmode: primary\n---\nBody');
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', 'orchestrator.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('claude-code', dir);
  assert(r.ok === true, 'claude-code healthy: ok=true');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 9: claude-code — missing CLAUDE.md ──
{
  const dir = tmp('disc-cc-noclaude');
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', 'orchestrator.md'), 'x');

  const r = discoverPlatform('claude-code', dir);
  assert(r.ok === false, 'claude-code missing CLAUDE.md: ok=false');
  assert(r.errors.some((e) => e.includes('CLAUDE.md not found')), 'error about CLAUDE.md');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 10: claude-code — missing mode: primary ──
{
  const dir = tmp('disc-cc-nomode');
  writeFileSync(join(dir, 'CLAUDE.md'), '---\nname: Orchestrator\n---\nBody');
  mkdirSync(join(dir, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'agents', 'orchestrator.md'), 'x');

  const r = discoverPlatform('claude-code', dir);
  assert(r.ok === false, 'claude-code missing mode: ok=false');
  assert(r.errors.some((e) => e.includes('mode: primary')), 'error about mode: primary');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 11: cursor — healthy installation ──
{
  const dir = tmp('disc-cur-healthy');
  mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(dir, '.cursor', 'rules', 'Orchestrator.mdc'), '---\nmode: primary\n---\nBody');

  const r = discoverPlatform('cursor', dir);
  assert(r.ok === true, 'cursor healthy: ok=true');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 12: cursor — missing .cursor/rules/ ──
{
  const dir = tmp('disc-cur-norules');

  const r = discoverPlatform('cursor', dir);
  assert(r.ok === false, 'cursor missing rules: ok=false');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 13: copilot — healthy installation ──
{
  const dir = tmp('disc-cp-healthy');
  mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), '---\napplyTo: "**"\n---\nContext');
  writeFileSync(join(dir, '.github', 'agents', 'orchestrator.agent.md'), '---\nname: Orchestrator\n---\nBody');

  const r = discoverPlatform('copilot', dir);
  assert(r.ok === true, 'copilot healthy: ok=true');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 14: copilot — missing orchestrator.agent.md ──
{
  const dir = tmp('disc-cp-noorch');
  mkdirSync(join(dir, '.github', 'agents'), { recursive: true });
  writeFileSync(join(dir, '.github', 'copilot-instructions.md'), 'x');

  const r = discoverPlatform('copilot', dir);
  assert(r.ok === false, 'copilot missing orchestrator: ok=false');
  assert(r.errors.some((e) => e.includes('orchestrator.agent.md')), 'error about orchestrator.agent.md');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 15: aider — healthy installation ──
{
  const dir = tmp('disc-aid-healthy');
  writeFileSync(join(dir, '.aider.rules.md'), 'Rules content');

  const r = discoverPlatform('aider', dir);
  assert(r.ok === true, 'aider healthy: ok=true');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 16: aider — missing file ──
{
  const dir = tmp('disc-aid-missing');

  const r = discoverPlatform('aider', dir);
  assert(r.ok === false, 'aider missing: ok=false');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 17: gemini-cli — healthy installation ──
{
  const dir = tmp('disc-gem-healthy');
  mkdirSync(join(dir, '.gemini'), { recursive: true });
  writeFileSync(join(dir, '.gemini', 'Orchestrator.md'), 'Body');

  const r = discoverPlatform('gemini-cli', dir);
  assert(r.ok === true, 'gemini-cli healthy: ok=true');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 18: gemini-cli — missing .gemini/ ──
{
  const dir = tmp('disc-gem-missing');

  const r = discoverPlatform('gemini-cli', dir);
  assert(r.ok === false, 'gemini-cli missing: ok=false');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 19: detectLastInstall — no config ──
{
  const dir = tmp('disc-noconfig');
  const r = detectLastInstall(dir);
  assert(r.platform === null, 'no config: platform=null');
  assert(r.agent === null, 'no config: agent=null');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 20: detectLastInstall — valid config ──
{
  const dir = tmp('disc-validconfig');
  writeFileSync(join(dir, '.staffforge-install.json'), JSON.stringify({
    platform: 'opencode',
    defaultAgent: 'orchestrator',
    installDir: '/some/path',
  }));
  const r = detectLastInstall(dir);
  assert(r.platform === 'opencode', 'valid config: platform=opencode');
  assert(r.agent === 'orchestrator', 'valid config: agent=orchestrator');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 21: detectLastInstall — corrupt config ──
{
  const dir = tmp('disc-corruptconfig');
  writeFileSync(join(dir, '.staffforge-install.json'), '{ bad json }}}');
  const r = detectLastInstall(dir);
  assert(r.platform === null, 'corrupt config: platform=null');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 22: discoverAll — returns all platforms ──
{
  const r = discoverAll('/tmp');
  assert(Array.isArray(r.platforms), 'discoverAll returns platforms array');
  assert(r.platforms.length === 6, 'discoverAll returns 6 platforms');
  const names = r.platforms.map((p) => p.platform);
  assert(names.includes('opencode'), 'discoverAll includes opencode');
  assert(names.includes('copilot'), 'discoverAll includes copilot');
}

// ── Test 23: discover — no installation ──
{
  const dir = tmp('disc-discover-none');
  const r = discover(dir);
  assert(r.healthy === false, 'discover no install: healthy=false');
  assert(r.installed.platform === null, 'discover no install: platform=null');
  assert(r.message.includes('No installation detected'), 'discover: mentions no installation');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 24: discover — healthy opencode installation ──
{
  const dir = tmp('disc-discover-oc');
  writeFileSync(join(dir, '.staffforge-install.json'), JSON.stringify({
    platform: 'opencode',
    defaultAgent: 'orchestrator',
  }));
  writeFileSync(join(dir, 'opencode.json'), JSON.stringify({
    default_agent: 'orchestrator',
    agent: { orchestrator: {} },
  }));
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'orchestrator.md'), 'x');

  const r = discover(dir);
  assert(r.healthy === true, 'discover healthy oc: healthy=true');
  assert(r.installed.platform === 'opencode', 'discover healthy oc: platform=opencode');
  assert(r.message.includes('healthy'), 'discover: mentions healthy');
  rmSync(dir, { recursive: true, force: true });
}

// ── Test 25: discover — unhealthy installation ──
{
  const dir = tmp('disc-discover-unhealthy');
  writeFileSync(join(dir, '.staffforge-install.json'), JSON.stringify({
    platform: 'opencode',
    defaultAgent: 'orchestrator',
  }));
  // Missing opencode.json and agents/

  const r = discover(dir);
  assert(r.healthy === false, 'discover unhealthy: healthy=false');
  assert(r.message.includes('incomplete'), 'discover: mentions incomplete');
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
