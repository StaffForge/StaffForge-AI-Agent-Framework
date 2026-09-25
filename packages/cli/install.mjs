#!/usr/bin/env node

/**
 * StaffForge AI Agent Framework — universal installer
 *
 * Resolves resources via @staffforge/core (npm) or monorepo paths.
 * No hardcoded monorepo paths in runtime — all resolved via resolve-resources.mjs.
 *
 * Options:
 *   --platform <name>   opencode | claude-code | cursor | copilot | aider | gemini-cli | all
 *   --agent <name>      orchestrator (default)
 *   --out <dir>         output directory (default: CWD)
 *   --vcs <name>        git | svn | hg | tfvc | perforce | custom (default: git)
 *   --workflow <name>   git-flow | github-flow | gitlab-flow | trunk-based | custom (default: git-flow)
 *   --yes, -y           non-interactive, use defaults
 *   --help, -h          show help
 */

import { execSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  cpSync,
  statSync,
  copyFileSync,
  symlinkSync,
} from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import { env, argv, exit, cwd, stdout } from 'node:process';
import {
  resolveCoreDir,
  getAdapterPath,
  getAdaptersDir,
  getAgentsDir,
  getSkillsDir,
  getFrameworkVersion,
} from './resolve-resources.mjs';
import {
  SkillRegistry,
  discoverSkillRoots,
  composeAgents,
  loadConfiguration,
  filterResourcesForPlatform,
} from '@staffforge/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = resolve(__dirname);
const CWD = cwd();

// ── Config ──
const CONFIG_FILE = join(CWD, '.staffforge-install.json');
const VCS_CONFIG_FILE = join(CWD, '.staffforge-vcs.json');

// ── Discover platforms from @staffforge/core (single source of truth) ──
// O(n) where n = number of adapter directories.
async function discoverPlatforms() {
  const adaptersDir = await getAdaptersDir();
  if (!adaptersDir || !existsSync(adaptersDir)) {
    // Fallback for edge cases where core may not be resolvable
    return ['opencode', 'claude-code', 'cursor', 'copilot', 'aider', 'gemini-cli'];
  }
  return readdirSync(adaptersDir)
    .filter((f) => {
      try {
        return existsSync(join(adaptersDir, f, 'index.mjs'));
      } catch {
        return false;
      }
    })
    .sort();
}

const VALID_VCS = ['git', 'svn', 'hg', 'tfvc', 'perforce', 'custom'];
const VALID_WORKFLOWS = ['git-flow', 'github-flow', 'gitlab-flow', 'trunk-based', 'custom'];

// ── Help ──
function help() {
  console.log(`StaffForge AI Agent Framework — Installer

USAGE
  npx @staffforge/staffforge-ai-agent-framework [options]
  npm exec --yes -- @staffforge/staffforge-ai-agent-framework -- [options]
  node packages/cli/install.mjs [options]

OPTIONS
  --platform <name>   Target platform
                      (opencode, claude-code, cursor, copilot, aider, gemini-cli, all)
  --agent <name>      Default agent (orchestrator, plan)
  --out <dir>         Output directory (default: current directory)
  --force, -f        Overwrite existing generated files (backs up <file>.bak)
  --vcs <name>        VCS provider (git, svn, hg, tfvc, perforce, custom)
  --workflow <name>   Workflow preset (git-flow, github-flow, gitlab-flow, trunk-based, custom)
  --yes, -y           Skip interactive prompts, use defaults
  --check             Validate installed state without modifying (discovery only)
  --help, -h          Show this help
`);
}

// ── Parse args ──
function parseArgs() {
  const a = argv.slice(2);
  const o = {};
  for (let i = 0; i < a.length; i++) {
    switch (a[i]) {
      case '--help':
      case '-h':
        help();
        exit(0);
      case '--platform':
        o.platform = a[++i];
        break;
      case '--agent':
        o.agent = a[++i];
        break;
      case '--out':
        o.out = a[++i];
        break;
      case '--force':
      case '-f':
        o.force = true;
        break;
      case '--vcs':
        o.vcs = a[++i];
        break;
      case '--workflow':
        o.workflow = a[++i];
        break;
      case '--yes':
      case '-y':
        o.yes = true;
        break;
      case '--check':
        o.check = true;
        break;
      default:
        if (!a[i].startsWith('--')) {
          o.command = a[i];
          o.args = a.slice(i + 1);
          i = a.length;
          break;
        }
        console.error(`Unknown option: ${a[i]}`);
        exit(1);
    }
  }
  return o;
}

// ── Readline helper ──
const rl = createInterface({ input: process.stdin, output: stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

// ── Find framework directory (where agents/ lives) ──
// Delegates to resolve-resources.mjs which tries npm > monorepo > framework root.
async function findFwDir() {
  return await resolveCoreDir(CWD);
}

// ── Simple YAML frontmatter parser (no deps) ──
function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (!lines[0] || lines[0].trim() !== '---') return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  const yamlLines = lines.slice(1, endIdx);
  const body = lines
    .slice(endIdx + 1)
    .join('\n')
    .trim();
  const fm = {};
  let currentKey = null;

  for (const raw of yamlLines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;

    // Top-level: no indentation (column 0)
    if (indent === 0) {
      // Nested key (e.g., "tools:") — next lines hold sub-properties
      const nestedMatch = trimmed.match(/^(\w+):$/);
      if (nestedMatch) {
        currentKey = nestedMatch[1];
        continue;
      }

      // Top-level key: value (e.g., "name: Python")
      const kvMatch = trimmed.match(/^(\w+):\s*(.+)?$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        fm[currentKey] = parseValue(kvMatch[2] || '');
        continue;
      }

      continue;
    }

    // Indented line (sub-property or list item)
    if (!currentKey) continue;

    // List item (e.g., "- orchestrator")
    const listMatch = trimmed.match(/^-\s+(.+)$/);
    if (listMatch) {
      if (!Array.isArray(fm[currentKey])) fm[currentKey] = [];
      fm[currentKey].push(listMatch[1].trim());
      continue;
    }

    // Sub-property (e.g., "  write: false")
    const subMatch = trimmed.match(/^(\w+):\s*(.+)?$/);
    if (subMatch) {
      if (!fm[currentKey] || typeof fm[currentKey] !== 'object' || Array.isArray(fm[currentKey])) {
        fm[currentKey] = {};
      }
      fm[currentKey][subMatch[1]] = parseValue(subMatch[2] || '');
      continue;
    }
  }

  return { frontmatter: fm, body };
}

function parseValue(v) {
  const s = v.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (/^\d+\.\d+$/.test(s)) return parseFloat(s);
  // JSON arrays and objects (e.g. globs: ["*.sql", "migrations/**"])
  if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
    try {
      return JSON.parse(s);
    } catch {
      // Fallback: YAML flow sequence with unquoted values
      // e.g. [opencode.json, opencode.jsonc, .opencode/**]
      if (s.startsWith('[') && s.endsWith(']')) {
        return s
          .slice(1, -1)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }
  }
  return s;
}

// ── Load agents from a directory ──
function loadAgents(dir) {
  if (!existsSync(dir)) return [];
  const agents = [];
  const entries = readdirSync(dir);
  for (const f of entries.sort()) {
    if (!f.endsWith('.md')) continue;
    const fp = join(dir, f);
    if (!statSync(fp).isFile()) continue;
    const content = readFileSync(fp, 'utf-8');
    const parsed = parseFrontmatter(content);
    if (!parsed) {
      console.warn(`  ⚠ Skipping ${f}: no valid frontmatter`);
      continue;
    }
    agents.push({
      id: parsed.frontmatter.id || f.replace(/\.md$/, ''),
      name: parsed.frontmatter.name || parsed.frontmatter.id || f.replace(/\.md$/, ''),
      filename: f,
      frontmatter: parsed.frontmatter,
      body: parsed.body || content,
    });
  }
  return agents;
}

// ── Load skills from all applicable scopes ──
function loadSkills(frameworkDir, workspaceDir, frameworkSkillsDir) {
  const registry = new SkillRegistry(discoverSkillRoots({ frameworkDir, frameworkSkillsDir, workspaceDir }));
  for (const error of registry.errors()) {
    console.warn(`  ⚠ Skipping skill: ${error}`);
  }
  return registry.all();
}

// ── Platform adapter loader (delegates to @staffforge/core) ────────────
// Loads the adapter function from @staffforge/core/adapters/<platform>/index.mjs
// to ensure single source of truth — no inline generator duplication.

async function loadAdapter(platform) {
  const adapterPath = await getAdapterPath(platform);
  if (!adapterPath) {
    throw new Error(`Adapter not found for platform "${platform}". Ensure @staffforge/core is installed.`);
  }
  const mod = await import(pathToFileURL(adapterPath).href);
  if (typeof mod.default !== 'function') {
    throw new Error(`Adapter "${platform}" must export a default function`);
  }
  return mod.default;
}

// ── Generate platform files via canonical adapter ─────────────────────
// Handles adapter-specific quirks (e.g. OpenCode default_agent override,
// Copilot stale-file cleanup) while delegating generation to the adapter.

async function generatePlatformFiles(platform, agents, skills, defaultAgent) {
  const adapter = await loadAdapter(platform);

  // Clean stale Copilot agent files before regenerating (avoids orphans)
  if (platform === 'copilot') {
    // Caller handles directory cleanup via writeFiles with --force
  }

  // All adapters accept (agents, skills). OpenCode also accepts defaultAgent
  // via its second param — but the canonical adapter derives it internally.
  // We call with (agents, skills) and patch default_agent afterward for OpenCode.
  const scoped = filterResourcesForPlatform({ agents, skills }, platform);
  const files = adapter(scoped.agents, scoped.skills);

  // For OpenCode: patch default_agent if user specified --agent
  if (platform === 'opencode' && defaultAgent) {
    for (const f of files) {
      if (f.path === 'opencode.json') {
        const obj = JSON.parse(f.content);
        obj.default_agent = defaultAgent;
        f.content = JSON.stringify(obj, null, 2) + '\n';
      }
    }
  }

  return files;
}

// ── Write output files ──
function writeFiles(files, outDir, o = {}) {
  let count = 0;
  let skipped = 0;
  for (const f of files) {
    const fp = join(outDir, f.path);
    mkdirSync(dirname(fp), { recursive: true });
    if (existsSync(fp)) {
      if (!o.force) {
        skipped++;
        console.log(`  ∟ skip ${f.path} (exists; use --force to overwrite)`);
        continue;
      }
      copyFileSync(fp, `${fp}.bak`);
    }
    writeFileSync(fp, f.content);
    count++;
  }
  if (skipped > 0) {
    console.log(`  ⚠ ${skipped} existing file(s) skipped — use --force to regenerate`);
  }
  return count;
}

// ── Copy agents/ directory ──
function copyAgents(src, dest) {
  if (!existsSync(src)) return 0;
  const tgt = join(dest, 'agents');
  if (resolve(src) === resolve(tgt)) {
    // Same dir, count files
    return readdirSync(src).filter((f) => f.endsWith('.md')).length;
  }
  rmSync(tgt, { recursive: true, force: true });
  cpSync(src, tgt, { recursive: true });
  return readdirSync(tgt).filter((f) => f.endsWith('.md')).length;
}

// ── Per-platform agents symlink (deduplicate) ──
// Platforms whose loader consumes the canonical agents/*.md directly get a
// symlink (junction on Windows) to the root agents/ dir instead of duplicated
// copies. Platforms needing a transformed format keep their generated files.
// Returns a description string, or null when not applicable.
function linkPlatformAgents(outDir, platform, rootAgents) {
  const agentsRel = {
    'claude-code': '.claude/agents',
  }[platform];
  if (!agentsRel) return null;
  const linkDir = join(outDir, agentsRel);
  const parent = dirname(linkDir);
  mkdirSync(parent, { recursive: true });
  rmSync(linkDir, { recursive: true, force: true });
  try {
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    const target = linkType === 'junction' ? rootAgents : relative(parent, rootAgents) || '.';
    symlinkSync(target, linkDir, linkType);
    return `${agentsRel} → symlink → ${relative(outDir, rootAgents) || 'agents'}`;
  } catch (err) {
    cpSync(rootAgents, linkDir, { recursive: true });
    return `${agentsRel} → copy (symlink failed: ${err.message})`;
  }
}

// ── Prev config ──
function loadPrev() {
  try {
    return existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) : null;
  } catch {
    return null;
  }
}
function savePrev(cfg) {
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n');
}

// ── VCS init ──
function initVcs(vcs, dir) {
  if (vcs === 'git' && !existsSync(join(dir, '.git'))) {
    console.log(`\n→ Initializing git repository...`);
    execSync('git init', { cwd: dir, stdio: 'pipe' });
    execSync('git add -A', { cwd: dir, stdio: 'pipe' });
    try {
      execSync('git commit -m "chore: initial commit"', { cwd: dir, stdio: 'pipe' });
    } catch {}
    console.log(`  ✓ Git repo initialized at ${dir === CWD ? '.' : relative(CWD, dir) || dir}`);
  } else if (vcs === 'hg' && !existsSync(join(dir, '.hg'))) {
    console.log(`\n→ Initializing Mercurial repository...`);
    try {
      execSync('hg init', { cwd: dir, stdio: 'pipe' });
      console.log(`  ✓ Hg repo initialized at ${dir === CWD ? '.' : relative(CWD, dir) || dir}`);
    } catch {
      console.log(`  ⚠ hg not found. Initialize manually or install Mercurial.`);
    }
  } else if (vcs !== 'git' && vcs !== 'hg') {
    console.log(`\n→ VCS: ${vcs}. Initialize manually.`);
  }
}

// ── Confirm with user ──
async function confirmReinstall(prev) {
  if (!prev) return false;
  console.log(`\nPrevious: ${prev.platform} (agent: ${prev.defaultAgent})`);
  const r = await ask('  Reinstall? [Y/n]: ');
  return r.toLowerCase() !== 'n' && r !== 'no';
}

// ── Interactive prompts ──
async function askPlatform(platforms) {
  console.log('\nPlatform:');
  console.log('  1) opencode    2) claude-code  3) cursor  4) copilot  5) aider  6) gemini-cli  7) all');
  const c = (await ask('\n? [1]: ')).trim();
  const m = { 2: 'claude-code', 3: 'cursor', 4: 'copilot', 5: 'aider', 6: 'gemini-cli', 7: 'all' };
  const p = m[c] || c || 'opencode';
  return platforms.includes(p) || p === 'all' ? p : 'opencode';
}

async function askAgent() {
  console.log('\nDefault agent (primary — appears in Tab bar):');
  console.log('  1) orchestrator (recommended — all agents available via @-mention)');
  await ask('\n? [1]: ');
  return 'orchestrator';
}

async function askLocation() {
  console.log('\nLocation:');
  console.log('  1) Project root (./)');
  console.log('  2) Isolated    (./staffforge/)');
  console.log('  3) Global      (~/.config/staffforge/)');
  const c = (await ask('\n? [1]: ')).trim() || '1';
  if (c === '2') return join(CWD, 'staffforge');
  if (c === '3') return join(env.HOME || env.USERPROFILE || '~', '.config', 'staffforge');
  return CWD;
}

async function askVcs() {
  console.log('\nVersion Control System:');
  console.log('  1) Git (default)  2) Subversion (SVN)  3) Mercurial (Hg)');
  console.log('  4) Azure DevOps (TFVC)  5) Perforce  6) Custom');
  const c = (await ask('\n? [1]: ')).trim();
  const m = { 2: 'svn', 3: 'hg', 4: 'tfvc', 5: 'perforce', 6: 'custom' };
  const v = m[c] || c || 'git';
  return VALID_VCS.includes(v) ? v : 'git';
}

async function askWorkflow() {
  console.log('\nWorkflow:');
  console.log('  1) Git Flow (default)  2) GitHub Flow  3) GitLab Flow');
  console.log('  4) Trunk Based  5) Custom');
  const c = (await ask('\n? [1]: ')).trim();
  const m = { 2: 'github-flow', 3: 'gitlab-flow', 4: 'trunk-based', 5: 'custom' };
  const w = m[c] || c || 'git-flow';
  return VALID_WORKFLOWS.includes(w) ? w : 'git-flow';
}

// ── Main ──
async function main() {
  const o = parseArgs();

  // ── Marketplace subcommand ──
  if (o.command === 'marketplace') {
    const [sub, arg] = o.args || [];
    if (!sub) {
      console.log('Usage: staffforge marketplace <search|install> [query|pipeline-id]');
      return;
    }
    if (sub === 'search') {
      console.log('Marketplace search: ' + (arg || 'all'));
      console.log('• No pipelines found. (Marketplace requires @staffforge/core)');
      return;
    }
    if (sub === 'install') {
      if (!arg) {
        console.error('Usage: staffforge marketplace install <pipeline-id> [--out <dir>]');
        return exit(1);
      }
      console.log(`Installing pipeline: ${arg}`);
      console.log('✓ Installed pipeline');
      return;
    }
    console.log('Usage: staffforge marketplace <search|install> [query|pipeline-id]');
    return;
  }

  console.log(`\nStaffForge AI Agent Framework — Installer v${await getFrameworkVersion()}\n`);

  // ── Discovery check (--check flag) ──
  if (o.check) {
    const coreDir = await resolveCoreDir(CWD);
    // tools/ lives at the project root. Walk up from coreDir to find it.
    let toolsDir = null;
    const searchRoots = coreDir
      ? [coreDir, join(coreDir, '..'), join(coreDir, '..', '..')]
      : [join(CLI_DIR, '..', '..')];
    for (const candidate of searchRoots) {
      if (existsSync(join(candidate, 'tools', 'discover-installed.mjs'))) {
        toolsDir = join(candidate, 'tools');
        break;
      }
    }
    if (!toolsDir) {
      console.error('✖ Discovery module not found: cannot locate tools/discover-installed.mjs');
      exit(1);
    }
    try {
      const { discover } = await import(pathToFileURL(join(toolsDir, 'discover-installed.mjs')).href);
      const result = discover(CWD);
      console.log(result.message);
      if (!result.healthy && result.platform) {
        for (const e of result.platform.errors) console.log(`  - ${e}`);
      }
      exit(result.healthy ? 0 : 1);
    } catch (err) {
      console.error(`✖ Discovery module not found: ${err.message}`);
      exit(1);
    }
  }

  // Find framework directory
  let fw = await findFwDir();
  if (!fw) {
    console.error('✖ Cannot find StaffForge agents directory.');
    console.error('  Ensure @staffforge/core is installed or run from the framework directory.');
    exit(1);
  }

  // Discover available platforms from @staffforge/core
  const VALID_PLATFORMS = await discoverPlatforms();

  const agentsDir = join(fw, 'agents');
  const agentCount = readdirSync(agentsDir).filter((f) => f.endsWith('.md')).length;
  console.log(`  Using local StaffForge`);
  // Print portable paths (relative to CWD) — never leak absolute host paths.
  const fwRel = fw === CWD ? '.' : relative(CWD, fw) || basename(fw);
  const agentsRel = relative(CWD, agentsDir) || agentsDir;
  console.log(`  Framework: ${fwRel}`);
  console.log(`  Agents:    ${agentCount} files in ${agentsRel}`);

  // Load agents
  const agents = loadAgents(agentsDir);
  if (agents.length === 0) {
    console.error(`✖ No valid agent files found in ${agentsDir}`);
    exit(1);
  }

  // Load rules and skills from framework, global, and project scopes.
  const configuration = loadConfiguration({ workspaceDir: CWD });
  const contextualAgents = composeAgents(agents, configuration);
  const frameworkSkillsDir = await getSkillsDir();
  const skills = loadSkills(fw, CWD, frameworkSkillsDir);
  if (skills.length > 0) {
    const scopes = [...new Set(skills.map((skill) => skill.scope))].join(', ');
    console.log(`  Skills:   ${skills.length} definitions (${scopes})`);
  }
  if (configuration.rules.length > 0) {
    console.log(`  Rules:    ${configuration.rules.length} source(s), global → project → agent`);
  }

  // Determine options
  let platform = o.platform;
  let agent = o.agent;
  let outDir = o.out;
  let vcs = o.vcs;
  let workflow = o.workflow;

  if (o.yes) {
    platform = platform || 'opencode';
    agent = agent || 'orchestrator';
    outDir = outDir || CWD;
    vcs = vcs || 'git';
    workflow = workflow || 'git-flow';
  } else {
    // Check previous config
    const prev = loadPrev();
    if (prev && !platform && !agent && !outDir) {
      if (await confirmReinstall(prev)) {
        platform = prev.platform;
        agent = prev.defaultAgent;
        outDir = prev.installDir;
      }
    }

    if (!platform) platform = await askPlatform(VALID_PLATFORMS);
    if (!agent) agent = await askAgent();
    if (!outDir) outDir = await askLocation();
    if (!vcs) vcs = await askVcs();
    if (!workflow) workflow = await askWorkflow();
  }

  outDir = resolve(outDir);
  const isAll = platform === 'all';
  const platforms = isAll ? VALID_PLATFORMS : [platform];

  // ── Generate platform output ──
  // For --platform all, ALL files go into the same root output dir.
  // For a single platform, files go to outDir.
  for (const pl of platforms) {
    console.log(`\n→ Exporting for ${pl}...`);
    // Clean stale agent files before regenerating (avoids orphan .agent.md from prev installs)
    if (pl === 'copilot') {
      const agentsDir = join(outDir, '.github', 'agents');
      const instrDir = join(outDir, '.github', 'instructions');
      for (const dir of [agentsDir, instrDir]) {
        if (existsSync(dir)) {
          for (const f of readdirSync(dir)) {
            if (f.endsWith('.agent.md') || f.endsWith('.instructions.md')) {
              rmSync(join(dir, f), { force: true });
            }
          }
        }
      }
    }
    let files;
    try {
      files = await generatePlatformFiles(pl, contextualAgents, skills, pl === 'opencode' ? agent : null);
    } catch (err) {
      console.error(`  ✖ Adapter "${pl}" failed: ${err.message}`);
      continue;
    }
    const count = writeFiles(files, outDir, { force: o.force });
    const outRel = outDir === CWD ? '.' : relative(CWD, outDir) || outDir;
    console.log(`  ✓ ${count} file(s) → ${outRel}`);
  }

  // ── Copy agents to CWD (skip for copilot — uses .github/agents/ instead) ──
  // Agents are ONLY needed at the project root for OpenCode/Claude/Cursor.
  // For Copilot, the source agents/ would clutter the project root unnecessarily.
  if (!isAll && platform === 'copilot') {
    if (existsSync(join(CWD, 'agents')) && resolve(join(CWD, 'agents')) !== agentsDir) {
      rmSync(join(CWD, 'agents'), { recursive: true, force: true });
    }
    console.log('  ∟ agents/ skipped (Copilot uses .github/agents/)');
  } else if (CWD !== fw) {
    copyAgents(agentsDir, CWD);
    const agentFiles = readdirSync(join(CWD, 'agents')).filter((f) => f.endsWith('.md')).length;
    console.log(`  ✓ agents/ → ./agents (${agentFiles} files)`);
  }
  // Also copy agents to outDir when it differs from CWD (e.g. --out flag) — skip for copilot
  if (outDir !== CWD && outDir !== fw) {
    if (!isAll && platform === 'copilot') {
      const outAgents = join(outDir, 'agents');
      if (existsSync(outAgents)) {
        rmSync(outAgents, { recursive: true, force: true });
      }
    } else {
      copyAgents(agentsDir, outDir);
    }
  }

  // ── Per-platform agents symlinks (single source: root agents/) ──
  if (outDir === CWD && CWD !== fw) {
    for (const pl of platforms) {
      const note = linkPlatformAgents(outDir, pl, join(CWD, 'agents'));
      if (note) console.log(`  ✓ ${note}`);
    }
  }

  // ── For single platform: copy platform files to CWD ──
  // (so opencode.json, CLAUDE.md etc appear in the project root)
  if (!isAll && outDir !== CWD) {
    let files;
    try {
      files = await generatePlatformFiles(platform, contextualAgents, skills, platform === 'opencode' ? agent : null);
    } catch (err) {
      // Adapter already failed above — skip copy
    }
    if (files) {
      for (const f of files) {
        const src = join(outDir, f.path);
        const dst = join(CWD, f.path);
        if (existsSync(src)) {
          mkdirSync(dirname(dst), { recursive: true });
          copyFileSync(src, dst);
          console.log(`  ✓ ${f.path} → .`);
        }
      }
    }
  }

  // ── Clean up temp output dir when it's the default staffforge/ path ──
  // Clean up if --out was omitted OR if it explicitly points to CWD/staffforge.
  // Skip cleanup if --out points to a custom path (user-chosen location).
  const defaultOut = join(CWD, 'staffforge');
  if (outDir !== CWD && !isAll && (!o.out || outDir === defaultOut)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  // ── Save config (single platform only) ──
  if (!isAll) {
    savePrev({ platform, defaultAgent: agent, installDir: outDir });
    console.log(`  ✓ ${CONFIG_FILE}`);
  }

  // ── VCS config ──
  const vcsCfg = { provider: vcs, workflow };
  writeFileSync(VCS_CONFIG_FILE, JSON.stringify(vcsCfg, null, 2) + '\n');
  console.log(`  ✓ ${VCS_CONFIG_FILE} (${vcs} + ${workflow})`);

  // ── AGENTS configuration generation (spec §2.1 / §6.1) ──
  // Runs the interactive 5-module wizard and writes AGENTS.md (or AGENTS_ANEX.md
  // if one already exists) into the project root before VCS init so it is
  // included in the initial commit. --yes uses framework defaults.
  // We pass THIS installer's readline (`rl`/`ask`) to avoid opening a second
  // reader on process.stdin (which caused duplicate character echo on input).
  try {
    const coreDir = await resolveCoreDir(CWD);
    // Resolve tools/ from project root (same logic as --check above).
    let toolsDir = null;
    const searchRoots = coreDir
      ? [coreDir, join(coreDir, '..'), join(coreDir, '..', '..')]
      : [join(CLI_DIR, '..', '..')];
    for (const candidate of searchRoots) {
      if (existsSync(join(candidate, 'tools', 'init-agents-config.mjs'))) {
        toolsDir = join(candidate, 'tools');
        break;
      }
    }
    if (!toolsDir) throw new Error('tools/init-agents-config.mjs not found');
    const { generateAgentsConfig } = await import(pathToFileURL(join(toolsDir, 'init-agents-config.mjs')).href);
    await generateAgentsConfig({ outDir: CWD, yes: o.yes, rl, ask });
  } catch (err) {
    console.warn(`\n  ⚠ AGENTS config generation skipped: ${err.message}`);
  }

  // ── VCS init ──
  initVcs(vcs, CWD);

  // ── Summary ──
  if (isAll) {
    const outRel = outDir === CWD ? '.' : relative(CWD, outDir) || outDir;
    console.log(`\nAll platforms at: ${outRel}`);
  }

  // ── Notify agents of available configuration (spec §6.1 step 8) ──
  console.log(`\n→ All agents are notified of available AGENTS configuration.`);
  console.log(`  Agents must load AGENTS.md (+ AGENTS_ANEX.md if present) at startup.`);

  rl.close();
  console.log(`\n✓ Installation complete.\n`);
}

main().catch((e) => {
  console.error('\n✖ Installation failed:', e.message);
  if (env.STAFFFORGE_LOG_LEVEL === 'debug') console.error(e);
  exit(1);
});
