/**
 * Drift guard — packages/core/adapters/<p>/index.mjs must behave identically
 * to the canonical root adapters/<p>/index.mjs.
 *
 * Context: the published `@staffforge/core` tarball ships its own copies of
 * the platform adapters. A stale copy (opencode missing `prompt`, no skills
 * support) already shipped once, producing agents without system prompts.
 * This test fails if any core adapter diverges from its root counterpart.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentRegistry } from '@staffforge/core';
import { getSkillRegistry } from '../../tools/skill-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');

const PLATFORMS = ['opencode', 'claude-code', 'cursor', 'copilot', 'aider', 'gemini-cli'];

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
  const skills = getSkillRegistry().all();
  assert(agents.length >= 150, `agent registry populated (${agents.length})`);
  assert(skills.length >= 4, `skill registry populated (${skills.length})`);

  for (const platform of PLATFORMS) {
    const rootMod = await import(`../../adapters/${platform}/index.mjs`);
    const coreMod = await import(`../../packages/core/adapters/${platform}/index.mjs`);

    const rootFiles = rootMod.default(agents, skills);
    const coreFiles = coreMod.default(agents, skills);

    assert(Array.isArray(rootFiles) && Array.isArray(coreFiles), `${platform}: both emit file arrays`);

    const rootMap = new Map(rootFiles.map((f) => [f.path, f.content]));
    const coreMap = new Map(coreFiles.map((f) => [f.path, f.content]));

    assert(rootMap.size === coreMap.size, `${platform}: same file count (root=${rootMap.size}, core=${coreMap.size})`);

    let pathsMatch = true;
    for (const p of rootMap.keys()) {
      if (!coreMap.has(p)) {
        pathsMatch = false;
        break;
      }
    }
    assert(pathsMatch, `${platform}: same file paths`);

    let contentsMatch = true;
    let firstDiff = '';
    for (const [p, content] of rootMap) {
      if (coreMap.get(p) !== content) {
        contentsMatch = false;
        firstDiff = p;
        break;
      }
    }
    assert(contentsMatch, `${platform}: identical file contents${firstDiff ? ` (first diff: ${firstDiff})` : ''}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
