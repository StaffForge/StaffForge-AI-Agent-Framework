/**
 * Runtime-neutral discovery and composition of StaffForge rules.
 *
 * Precedence, from lowest to highest:
 *   global rules → project AGENTS.md → PROJECT_RULES.md → AGENTS_ANEX.md
 *   → agent-specific instructions → task-specific instructions
 *
 * Only files in the user's home configuration roots or workspace ancestors are
 * considered. Symlinks are rejected at the trust boundary.
 */

import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const RULE_FILES = ['AGENTS.md', 'PROJECT_RULES.md', 'AGENTS_ANEX.md'];

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function readRegularFile(file, allowedRoot) {
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const realFile = realpathSync(file);
    if (!isWithin(realpathSync(allowedRoot), realFile)) return null;
    return { path: resolve(file), content: readFileSync(file, 'utf8') };
  } catch {
    return null;
  }
}

function addRule(rules, seenPaths, seenContent, file, scope, kind, root) {
  if (!existsSync(file)) return;
  const rule = readRegularFile(file, root);
  if (!rule || seenPaths.has(rule.path) || seenContent.has(rule.content)) return;
  seenPaths.add(rule.path);
  seenContent.add(rule.content);
  rules.push({ ...rule, scope, kind });
}

function addRuleSet(rules, state, root, scope, kinds = RULE_FILES) {
  if (!root || !existsSync(root)) return;
  try {
    const path = resolve(root);
    const realRoot = realpathSync(root);
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path !== realRoot) return;
  } catch {
    return;
  }
  for (const kind of kinds) {
    addRule(rules, state.paths, state.content, join(root, kind), scope, kind, root);
  }
}

function ancestorRoots(workspace) {
  const roots = [];
  let current = resolve(workspace);
  while (true) {
    roots.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots.reverse();
}

/**
 * Discover rules deterministically for a workspace.
 *
 * @param {{
 *   workspaceDir?: string,
 *   homeDir?: string,
 *   globalRulesDir?: string,
 * }} options
 * @returns {{rules: object[], errors: string[]}}
 */
export function discoverRules({ workspaceDir = process.cwd(), homeDir = homedir(), globalRulesDir } = {}) {
  const rules = [];
  const errors = [];
  const state = { paths: new Set(), content: new Set() };

  const globalRoots = [
    globalRulesDir,
    homeDir && join(homeDir, '.agents'),
    homeDir,
    homeDir && join(homeDir, '.config', 'staffforge'),
  ].filter(Boolean);
  for (const root of globalRoots) {
    addRuleSet(rules, state, root, 'global', ['AGENTS.md', 'AGENTS_ANEX.md']);
  }

  for (const root of ancestorRoots(workspaceDir)) {
    addRuleSet(rules, state, root, 'project');
  }

  return { rules, errors };
}

/** Load the ordered rule sources used by an adapter/exporter. */
export function loadConfiguration(options = {}) {
  const discovered = discoverRules(options);
  return {
    rules: discovered.rules,
    errors: discovered.errors,
    precedence: ['global', 'project:AGENTS.md', 'project:PROJECT_RULES.md', 'project:AGENTS_ANEX.md', 'agent', 'task'],
  };
}

/**
 * Compose shared rules with one canonical agent definition.
 * Returns a new object and never mutates the registry entry.
 */
export function composeAgentInstructions(agent, configuration) {
  const rules = configuration?.rules || [];
  if (rules.length === 0) return agent;

  const shared = rules
    .map((rule) => `## ${rule.scope} rule: ${rule.kind}\n\n${rule.content.trim()}`)
    .join('\n\n---\n\n');

  return {
    ...agent,
    body: `${shared}\n\n---\n\n## Agent-specific instructions\n\n${agent.body}`,
  };
}

/**
 * Apply the same resolved rule context to all agents before adapter translation.
 */
export function composeAgents(agents, configuration) {
  return agents.map((agent) => composeAgentInstructions(agent, configuration));
}
