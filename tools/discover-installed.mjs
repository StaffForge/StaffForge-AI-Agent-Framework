#!/usr/bin/env node

/**
 * StaffForge — Discovery module (Phase: discover-installed)
 *
 * Validates that the installed state is healthy and available for runtime.
 * Separates discovery from installation: this module NEVER creates or
 * modifies files — it only reads and reports.
 *
 * Usage:
 *   import { discoverPlatform, discoverAll } from './discover-installed.mjs';
 *   const result = discoverPlatform('opencode', '/path/to/project');
 *   // result: { ok: boolean, platform: string, files: string[], errors: string[] }
 *
 *   node tools/discover-installed.mjs [--platform <name>] [--json]
 *
 * Complexity: O(n) where n = files checked per platform.
 * Dependencies: node:fs, node:path only (zero external).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Platform discovery rules ─────────────────────────────────────────
// Each platform defines the files that MUST exist for it to be considered
// "installed and healthy". The runtime expectation is derived from the
// adapter output + platform loader behavior.

const PLATFORM_RULES = {
  opencode: {
    required: ['opencode.json'],
    validate: (dir) => {
      const errors = [];
      const ocPath = join(dir, 'opencode.json');
      if (!existsSync(ocPath)) {
        errors.push('opencode.json not found');
        return { ok: false, errors };
      }
      try {
        const cfg = JSON.parse(readFileSync(ocPath, 'utf-8'));
        if (!cfg.agent || typeof cfg.agent !== 'object') {
          errors.push('opencode.json missing "agent" map');
        } else if (!cfg.agent.orchestrator) {
          errors.push('opencode.json missing orchestrator agent');
        }
        if (cfg.default_agent !== 'orchestrator') {
          errors.push(`opencode.json default_agent is "${cfg.default_agent}", expected "orchestrator"`);
        }
      } catch (e) {
        errors.push(`opencode.json invalid JSON: ${e.message}`);
      }
      // agents/ directory is expected at project root for OpenCode
      const agentsDir = join(dir, 'agents');
      if (!existsSync(agentsDir)) {
        errors.push('agents/ directory not found');
      } else {
        const orchPath = join(agentsDir, 'orchestrator.md');
        if (!existsSync(orchPath)) {
          errors.push('agents/orchestrator.md not found');
        }
      }
      return { ok: errors.length === 0, errors };
    },
  },

  'claude-code': {
    required: ['CLAUDE.md', '.claude/agents/'],
    validate: (dir) => {
      const errors = [];
      const claudeMd = join(dir, 'CLAUDE.md');
      if (!existsSync(claudeMd)) {
        errors.push('CLAUDE.md not found');
      } else {
        const content = readFileSync(claudeMd, 'utf-8');
        if (!content.includes('mode: primary')) {
          errors.push('CLAUDE.md missing mode: primary (orchestrator not default)');
        }
      }
      const agentsDir = join(dir, '.claude', 'agents');
      if (!existsSync(agentsDir)) {
        errors.push('.claude/agents/ not found');
      } else {
        const orchPath = join(agentsDir, 'orchestrator.md');
        if (!existsSync(orchPath)) {
          errors.push('.claude/agents/orchestrator.md not found');
        }
      }
      return { ok: errors.length === 0, errors };
    },
  },

  cursor: {
    required: ['.cursor/rules/'],
    validate: (dir) => {
      const errors = [];
      const rulesDir = join(dir, '.cursor', 'rules');
      if (!existsSync(rulesDir)) {
        errors.push('.cursor/rules/ not found');
      } else {
        const orchPath = join(rulesDir, 'Orchestrator.mdc');
        if (!existsSync(orchPath)) {
          errors.push('.cursor/rules/Orchestrator.mdc not found');
        }
      }
      return { ok: errors.length === 0, errors };
    },
  },

  copilot: {
    required: ['.github/copilot-instructions.md', '.github/agents/'],
    validate: (dir) => {
      const errors = [];
      const instPath = join(dir, '.github', 'copilot-instructions.md');
      if (!existsSync(instPath)) {
        errors.push('.github/copilot-instructions.md not found');
      }
      const agentsDir = join(dir, '.github', 'agents');
      if (!existsSync(agentsDir)) {
        errors.push('.github/agents/ not found');
      } else {
        const orchPath = join(agentsDir, 'orchestrator.agent.md');
        if (!existsSync(orchPath)) {
          errors.push('.github/agents/orchestrator.agent.md not found');
        }
      }
      return { ok: errors.length === 0, errors };
    },
  },

  aider: {
    required: ['.aider.rules.md'],
    validate: (dir) => {
      const errors = [];
      const rulesPath = join(dir, '.aider.rules.md');
      if (!existsSync(rulesPath)) {
        errors.push('.aider.rules.md not found');
      }
      return { ok: errors.length === 0, errors };
    },
  },

  'gemini-cli': {
    required: ['.gemini/'],
    validate: (dir) => {
      const errors = [];
      const geminiDir = join(dir, '.gemini');
      if (!existsSync(geminiDir)) {
        errors.push('.gemini/ not found');
      } else {
        const orchPath = join(geminiDir, 'Orchestrator.md');
        if (!existsSync(orchPath)) {
          errors.push('.gemini/Orchestrator.md not found');
        }
      }
      return { ok: errors.length === 0, errors };
    },
  },
};

// ── Core discovery functions ─────────────────────────────────────────

/**
 * Discover installed state for a single platform.
 *
 * @param {string} platform — platform identifier (opencode, claude-code, etc.)
 * @param {string} dir — project directory to check (default: CWD)
 * @returns {{ ok: boolean, platform: string, files: string[], errors: string[] }}
 */
export function discoverPlatform(platform, dir = process.cwd()) {
  const rules = PLATFORM_RULES[platform];
  if (!rules) {
    return {
      ok: false,
      platform,
      files: [],
      errors: [`Unknown platform: "${platform}"`],
    };
  }

  const resolvedDir = resolve(dir);
  const errors = [];
  const files = [];

  // Check required files exist
  for (const req of rules.required) {
    const fullPath = join(resolvedDir, req);
    if (existsSync(fullPath)) {
      files.push(req);
    }
    // validate() will report missing files with specific messages
  }

  // Run platform-specific validation
  const validation = rules.validate(resolvedDir);
  errors.push(...validation.errors);

  return {
    ok: errors.length === 0,
    platform,
    files,
    errors,
  };
}

/**
 * Discover installed state for all supported platforms.
 *
 * @param {string} dir — project directory to check (default: CWD)
 * @returns {{ ok: boolean, platforms: object[] }}
 */
export function discoverAll(dir = process.cwd()) {
  const platforms = Object.keys(PLATFORM_RULES).map((p) => discoverPlatform(p, dir));
  const ok = platforms.some((p) => p.ok); // At least one platform healthy
  return { ok, platforms };
}

/**
 * Detect which platform was last installed (from .staffforge-install.json).
 *
 * @param {string} dir — project directory (default: CWD)
 * @returns {{ platform: string|null, agent: string|null, installDir: string|null }}
 */
export function detectLastInstall(dir = process.cwd()) {
  const configPath = join(resolve(dir), '.staffforge-install.json');
  if (!existsSync(configPath)) {
    return { platform: null, agent: null, installDir: null };
  }
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
    return {
      platform: cfg.platform || null,
      agent: cfg.defaultAgent || null,
      installDir: cfg.installDir || null,
    };
  } catch {
    return { platform: null, agent: null, installDir: null };
  }
}

/**
 * Full discovery: detect last installed platform and validate its state.
 *
 * @param {string} dir — project directory (default: CWD)
 * @returns {{
 *   installed: { platform: string|null, agent: string|null },
 *   healthy: boolean,
 *   platform: object|null,
 *   message: string
 * }}
 */
export function discover(dir = process.cwd()) {
  const last = detectLastInstall(dir);
  if (!last.platform) {
    return {
      installed: last,
      healthy: false,
      platform: null,
      message: 'No installation detected. Run "npm run setup" to install agents.',
    };
  }

  const platformResult = discoverPlatform(last.platform, dir);
  const message = platformResult.ok
    ? `✓ ${last.platform} installation healthy (${platformResult.files.length} files)`
    : `✗ ${last.platform} installation incomplete: ${platformResult.errors.join('; ')}`;

  return {
    installed: last,
    healthy: platformResult.ok,
    platform: platformResult,
    message,
  };
}

// ── CLI entry point ──────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { platform: null, json: false, dir: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--platform' && argv[i + 1]) {
      opts.platform = argv[++i];
    } else if (argv[i] === '--json') {
      opts.json = true;
    } else if (argv[i] === '--dir' && argv[i + 1]) {
      opts.dir = argv[++i];
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log(`StaffForge Discovery — validates installed state

Usage:
  node tools/discover-installed.mjs [options]

Options:
  --platform <name>   Check a specific platform
  --dir <path>        Project directory (default: CWD)
  --json              Output as JSON
  --help, -h          Show this help
`);
      process.exit(0);
    }
  }
  return opts;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const opts = parseArgs(process.argv);
  const dir = opts.dir || process.cwd();

  if (opts.platform) {
    const result = discoverPlatform(opts.platform, dir);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.ok ? `✓ ${opts.platform} healthy` : `✗ ${opts.platform} unhealthy`);
      for (const e of result.errors) console.log(`  - ${e}`);
    }
    process.exit(result.ok ? 0 : 1);
  } else {
    const result = discover(dir);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.message);
      if (result.platform && !result.healthy) {
        for (const e of result.platform.errors) console.log(`  - ${e}`);
      }
    }
    process.exit(result.healthy ? 0 : 1);
  }
}
