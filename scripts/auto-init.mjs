#!/usr/bin/env node

/**
 * StaffForge auto-init — self-healing OpenCode configuration.
 *
 * Validates installed state via the discovery module before acting.
 * If the installation is healthy (opencode.json + agents/ present and valid),
 * exits silently. If missing or stale, regenerates by delegating to
 * packages/cli/install.mjs — the same installer used by `npm run setup`.
 *
 * Non-destructive: never touches a valid config. After regeneration, restart
 * OpenCode (config is read at startup — there is no hot reload).
 *
 * Usage:
 *   npm run auto-init
 *   npx --yes @staffforge/staffforge-ai-agent-framework auto-init
 *   node scripts/auto-init.mjs --check     # discovery only, no repair
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlatform } from '../tools/discover-installed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const CWD = process.cwd();

// ── Parse args ──
const checkOnly = process.argv.includes('--check');

// ── Discovery (Phase: discover-installed) ──
const result = discoverPlatform('opencode', CWD);

if (result.ok) {
  console.log('✓ OpenCode installation healthy (orchestrator is the default agent, agents/ present).');
  if (checkOnly) console.log('  (--check mode — no repair performed)');
  process.exit(0);
}

// Report discovery issues
console.log('… OpenCode installation incomplete:');
for (const e of result.errors) console.log(`  - ${e}`);

if (checkOnly) {
  console.log('\n  Run "npm run setup" to repair the installation.');
  process.exit(1);
}

// ── Self-healing: regenerate ──
console.log('\n… regenerating with orchestrator as default agent …');
const installer = join(root, 'packages', 'cli', 'install.mjs');
const { existsSync } = await import('node:fs');
if (!existsSync(installer)) {
  console.error(`✖ CLI installer not found at ${installer}`);
  process.exit(1);
}

const args = [installer, '--platform', 'opencode', '--agent', 'orchestrator', '--yes', '--force'];
const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: CWD });
child.on('error', (err) => {
  console.error(`✖ auto-init failed to start installer: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code) => {
  if (code === 0) {
    console.log('✓ opencode.json regenerated. Restart OpenCode to pick it up (no hot reload).');
  } else {
    console.error(`✖ auto-init failed (installer exit code ${code}).`);
  }
  process.exit(code ?? 1);
});
child.on('exit', (code) => {
  if (code === 0) {
    console.log('✓ opencode.json regenerated. Restart OpenCode to pick it up (no hot reload).');
  } else {
    console.error(`✖ auto-init failed (installer exit code ${code}).`);
  }
  process.exit(code ?? 1);
});
