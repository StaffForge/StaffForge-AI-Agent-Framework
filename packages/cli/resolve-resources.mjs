#!/usr/bin/env node

/**
 * StaffForge — Resource resolver
 *
 * Single source of truth for locating framework resources (agents, adapters,
 * skills, tools) regardless of execution context:
 *
 *   A) Published npm package: @staffforge/core installed in node_modules
 *   B) Monorepo development: packages/core adjacent to packages/cli
 *   C) npx / git clone: repo checked out locally
 *
 * Resolution order (O(1) per check):
 *   1. Try `@staffforge/core` via import.meta.resolve (npm installed)
 *   2. Try monorepo path: ../../packages/core (relative to CLI)
 *   3. Try framework root detection (agents/orchestrator.md exists)
 *
 * Complexity: O(n) where n = candidate resolution strategies.
 * Dependencies: node:fs, node:path only (zero external).
 */

import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Resolution strategies ────────────────────────────────────────────

/**
 * Strategy 1: Resolve @staffforge/core from node_modules.
 * Works when installed via npm (npx, npm install).
 * Uses import.meta.resolve to find the package location.
 */
async function resolveFromNpm() {
  try {
    const specifier = '@staffforge/core';
    const resolved = await import.meta.resolve(specifier);
    if (resolved) {
      const coreDir = dirname(fileURLToPath(resolved));
      if (existsSync(join(coreDir, 'adapters')) && existsSync(join(coreDir, 'agents'))) {
        return coreDir;
      }
    }
  } catch {
    // import.meta.resolve fails when @staffforge/core is not installed
  }
  return null;
}

/**
 * Strategy 2: Monorepo path — ../../packages/core relative to CLI.
 * Works during development in the StaffForge monorepo.
 */
function resolveFromMonorepo() {
  const candidate = resolve(__dirname, '..', '..', 'packages', 'core');
  if (
    existsSync(join(candidate, 'adapters')) &&
    existsSync(join(candidate, 'agents')) &&
    existsSync(join(candidate, 'index.mjs'))
  ) {
    return candidate;
  }
  return null;
}

/**
 * Strategy 3: Framework root detection.
 * Walks up from CLI dir looking for agents/orchestrator.md.
 * Works for npx / git clone scenarios.
 */
function resolveFromFrameworkRoot() {
  const candidates = [
    __dirname,
    resolve(__dirname, '..'),
    resolve(__dirname, '..', '..'),
    resolve(__dirname, '..', '..', '..'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'agents', 'orchestrator.md')) && existsSync(join(dir, 'adapters'))) {
      return dir;
    }
  }
  return null;
}

// ── Cached resolution ────────────────────────────────────────────────

let _cachedCoreDir = null;
let _resolved = false;

/**
 * Resolve the core/framework directory.
 * Caches result after first successful resolution.
 *
 * @param {string} [hint] — optional hint directory to try first
 * @returns {string|null} path to core directory, or null if not found
 */
export async function resolveCoreDir(hint) {
  if (_resolved) return _cachedCoreDir;

  // Try hint first (e.g., from env STAFFFORGE_CORE_DIR)
  if (hint && existsSync(join(hint, 'adapters')) && existsSync(join(hint, 'agents'))) {
    _cachedCoreDir = resolve(hint);
    _resolved = true;
    return _cachedCoreDir;
  }

  // Try strategies in order: npm > monorepo > framework root
  const strategies = [resolveFromNpm, resolveFromMonorepo, resolveFromFrameworkRoot];

  for (const strategy of strategies) {
    const result = await strategy();
    if (result) {
      _cachedCoreDir = result;
      _resolved = true;
      return result;
    }
  }

  return null;
}

/**
 * Synchronous resolution (for contexts where async is not available).
 * Uses only filesystem checks — no import.meta.resolve.
 *
 * @param {string} [hint] — optional hint directory
 * @returns {string|null} path to core directory, or null if not found
 */
export function resolveCoreDirSync(hint) {
  if (_resolved) return _cachedCoreDir;

  if (hint && existsSync(join(hint, 'adapters')) && existsSync(join(hint, 'agents'))) {
    _cachedCoreDir = resolve(hint);
    _resolved = true;
    return _cachedCoreDir;
  }

  const monorepo = resolveFromMonorepo();
  if (monorepo) {
    _cachedCoreDir = monorepo;
    _resolved = true;
    return monorepo;
  }

  const framework = resolveFromFrameworkRoot();
  if (framework) {
    _cachedCoreDir = framework;
    _resolved = true;
    return framework;
  }

  return null;
}

/**
 * Reset cached resolution (for testing).
 */
export function resetResolution() {
  _cachedCoreDir = null;
  _resolved = false;
}

// ── Convenience accessors ────────────────────────────────────────────

/**
 * Get the adapters directory.
 * @returns {string|null}
 */
export async function getAdaptersDir() {
  const core = await resolveCoreDir();
  return core ? join(core, 'adapters') : null;
}

/**
 * Get the agents directory.
 * @returns {string|null}
 */
export async function getAgentsDir() {
  const core = await resolveCoreDir();
  return core ? join(core, 'agents') : null;
}

/**
 * Get the skills directory.
 * @returns {string|null}
 */
export async function getSkillsDir() {
  const core = await resolveCoreDir();
  if (!core) return null;

  const candidates = [
    join(core, 'skills'),
    // Canonical skills may live beside packages/ in the monorepo or published
    // top-level framework package rather than inside @staffforge/core.
    resolve(__dirname, '..', '..', 'skills'),
    resolve(core, '..', '..', 'skills'),
  ];
  return candidates.find((dir) => existsSync(dir)) || null;
}

/**
 * Get a specific adapter path.
 * @param {string} platform
 * @returns {string|null}
 */
export async function getAdapterPath(platform) {
  const core = await resolveCoreDir();
  if (!core) return null;
  const p = join(core, 'adapters', platform, 'index.mjs');
  return existsSync(p) ? p : null;
}

/**
 * Get the framework version from the root package.json.
 * @returns {string}
 */
export async function getFrameworkVersion() {
  const core = await resolveCoreDir();
  if (!core) return 'unknown';
  try {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(join(core, '..', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    // Try reading from core's own package.json
    try {
      const { readFileSync } = await import('node:fs');
      const pkg = JSON.parse(readFileSync(join(core, 'package.json'), 'utf8'));
      return pkg.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }
}
