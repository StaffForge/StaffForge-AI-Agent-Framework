#!/usr/bin/env node
/**
 * installer.mjs — StaffForge AI Agent Framework bootstrap installer.
 *
 * Bootstraps @staffforge/staffforge-ai-agent-framework (v2.7.0) in any
 * environment via a three-strategy cascade:
 *   A) npm direct install of the git dependency (allow-git flag by npm
 *      version: npm >= 11.10 -> --allow-git=all, npm < 11.10 -> no flag)
 *   B) git clone fallback (bypasses npm's git fetcher)
 *   C) codeload tarball fallback (bypasses npm git fetcher AND git binary)
 *
 * Root cause of EALLOWGIT: npm >= 11.10 git-fetch policy control. The
 * option name is `allow-git` with enum values all|root|none (npm >= 11.15
 * config; `--allow-git` flag since 11.10). `allow-git=true` is INVALID. npm
 * < 11.10 has no such option, so EALLOWGIT there implies a registry/proxy
 * policy blocking git fetches. All variants handled: version-detect -> flag.
 *
 * ESM only, Node >= 18, node builtins only, no external dependencies.
 * Complexity: template interpolation O(n); validation O(1) per field.
 */

import { spawn } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';

const GIT_URL =
  'https://github.com/StaffForge/StaffForge-AI-Agent-Framework.git';
const RELEASE_TAG = 'v2.7.0';
const NPM_SPEC = `github:StaffForge/StaffForge-AI-Agent-Framework#${RELEASE_TAG}`;
const TARBALL_URL =
  `https://codeload.github.com/StaffForge/StaffForge-AI-Agent-Framework/tar.gz/refs/tags/${RELEASE_TAG}`;
const PKG_NAME = '@staffforge/staffforge-ai-agent-framework';
const PLATFORMS = [
  'opencode',
  'claude-code',
  'cursor',
  'copilot',
  'aider',
  'gemini-cli',
];
const LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Portuguese',
  'Japanese',
];
const DEFAULT_CONFIG = {
  platform: 'opencode',
  agent: 'orchestrator',
  tokenBudget: 32000,
  maxIterations: 10,
  language: 'English',
};
const SETUP_TIMEOUT_MS = 120_000;

function log(message) {
  console.log(`[installer] ${message}`);
}

async function runCommand(cmd, args, opts = {}) {
  const { cwd, allowFailure = false, timeoutMs = 0 } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to run ${cmd}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0 || allowFailure) {
        resolve({ code, stdout, stderr });
      } else {
        const tail = stderr.trim().split('\n').slice(-5).join('\n').slice(-400);
        reject(
          new Error(
            `Command failed (${cmd} ${args.join(' ')}) exit ${code}: ${tail || '(no stderr)'}`
          )
        );
      }
    });
  });
}

async function detectNpmVersion() {
  const { stdout } = await runCommand('npm', ['--version']);
  const raw = stdout.trim().split(/\r?\n/)[0];
  const match = /^(\d+)\.(\d+)/.exec(raw);
  if (!match) throw new Error(`Unrecognized npm version "${raw}"`);
  return { raw, major: Number(match[1]), minor: Number(match[2]) };
}

function allowGitArgs(npm) {
  if (npm.major > 11 || (npm.major === 11 && npm.minor >= 10)) {
    return ['--allow-git=all'];
  }
  return [];
}

function assertNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    throw new Error(`Node.js >= 18 required (found ${process.versions.node})`);
  }
}

function printUsage() {
  console.log(`Usage: node installer.mjs [options]

Options:
  --yes            accept wizard defaults, skip prompts
  --dry-run        print the install plan, write nothing
  --force          overwrite existing AGENTS.md / AGENTS_ANEX.md
  --dir <path>     target directory (default: current directory)
  -h, --help       show this help
`);
}

function parseArgs(argv) {
  const out = { yes: false, dryRun: false, force: false, dir: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--yes' || arg === '-y') out.yes = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--force' || arg === '-f') out.force = true;
    else if (arg === '--dir') {
      out.dir = argv[++i];
      if (!out.dir) throw new Error('--dir requires a value');
    } else if (arg.startsWith('--dir=')) {
      out.dir = arg.slice('--dir='.length);
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      log(`ignoring unknown argument: ${arg}`);
    }
  }
  return out;
}

async function ask(rl, label, { defaultValue, isInvalid }) {
  while (true) {
    let answer;
    try {
      answer = (await rl.question(`${label} [${defaultValue}]: `)).trim();
    } catch {
      log(`no input available; using default "${defaultValue}"`);
      return defaultValue;
    }
    if (answer === '') return defaultValue;
    if (isInvalid && isInvalid(answer)) {
      log(`invalid ${label.toLowerCase()}; please try again`);
      continue;
    }
    return answer;
  }
}

async function askPositiveInt(rl, label, defaultValue) {
  const raw = await ask(rl, label, {
    defaultValue: String(defaultValue),
    isInvalid: (v) => !/^[1-9]\d*$/.test(v),
  });
  return Number(raw);
}

async function collectConfig(argv) {
  if (argv.yes) return { ...DEFAULT_CONFIG };
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const config = { ...DEFAULT_CONFIG };
    config.platform = await ask(rl, 'Platform', {
      defaultValue: config.platform,
      isInvalid: (v) => !PLATFORMS.includes(v),
    });
    config.agent = await ask(rl, 'Agent', {
      defaultValue: config.agent,
    });
    config.tokenBudget = await askPositiveInt(
      rl,
      'Token budget',
      config.tokenBudget
    );
    config.maxIterations = await askPositiveInt(
      rl,
      'Max iterations',
      config.maxIterations
    );
    config.language = await ask(rl, 'Language', {
      defaultValue: config.language,
      isInvalid: (v) => !LANGUAGES.includes(v),
    });
    return config;
  } finally {
    rl.close();
  }
}

async function download(url, dest, redirects = 0) {
  if (redirects > 5) throw new Error(`Too many redirects while downloading ${url}`);
  const res = await new Promise((resolve, reject) => {
    https.get(url, (r) => resolve(r)).on('error', reject);
  });
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    res.resume();
    const next = new URL(res.headers.location, url).href;
    return download(next, dest, redirects + 1);
  }
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`Download failed (HTTP ${res.statusCode}) for ${url}`);
  }
  const handle = await open(dest, 'w');
  try {
    for await (const chunk of res) await handle.write(chunk);
  } finally {
    await handle.close();
  }
}

async function auditPackageJson(dir) {
  const raw = await readFile(path.join(dir, 'package.json'), 'utf8');
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid package.json in ${dir}: ${err.message}`);
  }
  if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
    throw new Error(`package.json in ${dir} is missing a valid "name"`);
  }
  if (!pkg.scripts || typeof pkg.scripts !== 'object') {
    throw new Error(`package.json in ${dir} is missing "scripts"`);
  }
  if (!pkg.bin || typeof pkg.bin !== 'object') {
    throw new Error(`package.json in ${dir} is missing "bin"`);
  }
  if (pkg.name !== PKG_NAME) {
    log(`note: package name is "${pkg.name}" (expected "${PKG_NAME}")`);
  }
  return pkg;
}

async function runSetupEntry(dir) {
  log('running framework setup entry');
  const candidates = ['install.mjs', 'packages/cli/install.mjs'];
  let lastError = null;
  for (const entry of candidates) {
    try {
      await access(path.join(dir, entry));
    } catch {
      continue;
    }
    try {
      await runCommand('node', [entry, '--yes'], {
        cwd: dir,
        timeoutMs: SETUP_TIMEOUT_MS,
      });
      log(`setup entry finished: ${entry}`);
      return;
    } catch (err) {
      lastError = err;
      log(`setup entry ${entry} failed: ${err.message}`);
    }
  }
  if (lastError) throw new Error(`Framework setup failed: ${lastError.message}`);
  log('no setup entry found; skipping');
}

async function strategyA(targetDir, npm) {
  log('strategy A: npm install of git dependency');
  await mkdir(targetDir, { recursive: true });
  const pkgPath = path.join(targetDir, 'package.json');
  try {
    await access(pkgPath);
  } catch {
    await runCommand('npm', ['init', '-y'], {
      cwd: targetDir,
      allowFailure: true,
    });
  }
  await runCommand('npm', ['install', NPM_SPEC, ...allowGitArgs(npm)], {
    cwd: targetDir,
  });
  const frameworkDir = path.join(
    targetDir,
    'node_modules',
    '@staffforge',
    'staffforge-ai-agent-framework'
  );
  await access(frameworkDir);
  return frameworkDir;
}

async function strategyB(targetDir, npm) {
  log('strategy B: git clone fallback');
  const frameworkDir = path.join(targetDir, 'staffforge-ai-agent-framework');
  await mkdir(targetDir, { recursive: true });
  await rm(frameworkDir, { recursive: true, force: true });
  await runCommand('git', [
    'clone',
    '--branch',
    RELEASE_TAG,
    GIT_URL,
    frameworkDir,
  ]);
  await auditPackageJson(frameworkDir);
  await runCommand('npm', ['install', ...allowGitArgs(npm)], {
    cwd: frameworkDir,
  });
  await runSetupEntry(frameworkDir);
  return frameworkDir;
}

async function strategyC(targetDir, npm) {
  log('strategy C: codeload tarball fallback');
  const frameworkDir = path.join(targetDir, 'staffforge-ai-agent-framework');
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'staffforge-installer-'));
  try {
    const tarball = path.join(tmpDir, 'framework.tar.gz');
    await download(TARBALL_URL, tarball);
    await rm(frameworkDir, { recursive: true, force: true });
    await mkdir(frameworkDir, { recursive: true });
    await runCommand('tar', [
      '-xzf',
      tarball,
      '-C',
      frameworkDir,
      '--strip-components=1',
    ]);
    await auditPackageJson(frameworkDir);
    await runCommand('npm', ['install', ...allowGitArgs(npm)], {
      cwd: frameworkDir,
    });
    await runSetupEntry(frameworkDir);
    return frameworkDir;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

async function installFramework(targetDir, npm) {
  const strategies = [
    { label: 'A', run: () => strategyA(targetDir, npm) },
    { label: 'B', run: () => strategyB(targetDir, npm) },
    { label: 'C', run: () => strategyC(targetDir, npm) },
  ];
  let lastError = null;
  for (const strategy of strategies) {
    try {
      const frameworkDir = await strategy.run();
      log(`strategy ${strategy.label} succeeded`);
      return frameworkDir;
    } catch (err) {
      lastError = err;
      log(`strategy ${strategy.label} failed: ${err.message}`);
    }
  }
  throw new Error(
    `All install strategies failed. Last error: ${lastError.message}`
  );
}

function renderAgentsMd(config) {
  return `# Agent Configuration

## Role
You are the ${config.agent} agent for the ${config.platform} platform.

## Context
- Framework: ${PKG_NAME} v2.7.0
- Platform: ${config.platform}
- Active agent: ${config.agent}
- Language: ${config.language}
- Token budget: ${config.tokenBudget}
- Max iterations: ${config.maxIterations}

## Task
Service user requests through the orchestrator routing matrix using the
configured agent as the entry point. Route work to the canonical pipeline
(Feature, Bug, Refactor, Security, Deployment, Hotfix) defined in the matrix.

## Constraints
- Never create branches or commits outside the task pipeline.
- Stay within the active agent's declared tools and permissions.
- Escalate out-of-scope work to the orchestrator.
- Prefer non-breaking, maintainable, scalable solutions.
- Never invent missing APIs; inspect the codebase before proposing changes.

## Output
- Return concise markdown: findings, risks, and recommendations.
- No prose padding; token-frugal and structured output only.
`;
}

function renderAnexMd(config) {
  return `# Annex Configuration

This annex extends AGENTS.md. Conflicts resolve in favor of AGENTS_ANEX.md

## Effective Settings
- Platform: ${config.platform}
- Agent: ${config.agent}
- Language: ${config.language}
- Token budget: ${config.tokenBudget}
- Max iterations: ${config.maxIterations}

## Overrides
- Exports target the ${config.platform} adapter.
- Agent output honors the configured token budget and iteration limits.
- Setup and validation commands run with the configured defaults.
`;
}

async function renderTemplates(targetDir, config, force) {
  const files = [
    { name: 'AGENTS.md', content: renderAgentsMd(config) },
    { name: 'AGENTS_ANEX.md', content: renderAnexMd(config) },
  ];
  for (const file of files) {
    const dest = path.join(targetDir, file.name);
    let exists = true;
    try {
      await access(dest);
    } catch {
      exists = false;
    }
    if (exists && !force) {
      log(`skip ${file.name}: already exists (use --force to overwrite)`);
      continue;
    }
    await writeFile(dest, file.content, 'utf8');
    log(`${exists ? 'overwrite' : 'write'} ${dest}`);
  }
}

function printPlan(config, npm, targetDir, argv) {
  console.log('DRY RUN — no files or network will be touched.');
  console.log(`  target dir:     ${targetDir}`);
  console.log(`  platform:       ${config.platform}`);
  console.log(`  agent:          ${config.agent}`);
  console.log(`  token budget:   ${config.tokenBudget}`);
  console.log(`  max iterations: ${config.maxIterations}`);
  console.log(`  language:       ${config.language}`);
  console.log(`  release:        ${RELEASE_TAG}`);
  console.log(`  npm version:    ${npm ? npm.raw : 'not detected'}`);
  console.log(
    `  git flag:       ${
      npm
        ? allowGitArgs(npm).join(' ') || '(none — npm < 11.10)'
        : '(npm not detected)'
    }`
  );
  console.log(
    '  strategies:     A npm-git -> B git-clone -> C codeload tarball'
  );
  console.log(
    `  templates:      AGENTS.md, AGENTS_ANEX.md${
      argv.force ? ' (force overwrite)' : ' (skip if present)'
    }`
  );
}

async function main() {
  const argv = parseArgs(process.argv.slice(2));
  assertNodeVersion();
  const config = await collectConfig(argv);
  const targetDir = path.resolve(argv.dir || process.cwd());
  let npm = null;
  try {
    npm = await detectNpmVersion();
  } catch (err) {
    log(`npm version detection failed: ${err.message}`);
  }
  if (argv.dryRun) {
    printPlan(config, npm, targetDir, argv);
    return;
  }
  const frameworkDir = await installFramework(targetDir, npm);
  await renderTemplates(targetDir, config, argv.force);
  console.log('Install complete.');
  console.log(`  framework:  ${frameworkDir}`);
  console.log(
    `  config:     ${path.join(targetDir, 'AGENTS.md')}, ` +
      path.join(targetDir, 'AGENTS_ANEX.md')
  );
  console.log(
    '  next:       run "npm run setup" in the target directory to finish wiring.'
  );
}

main().catch((err) => {
  console.error(`installer failed: ${err.message}`);
  process.exit(1);
});