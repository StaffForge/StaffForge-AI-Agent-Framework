/**
 * Scoped skill discovery for framework, global, and project skills.
 *
 * Roots are ordered from highest to lowest precedence. A skill name is loaded
 * once, so a project skill overrides a global or framework skill with the same
 * name. Discovery reads SKILL.md only; it never executes bundled scripts.
 */

import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import yaml from 'js-yaml';
import { listSupportedPlatforms } from '../resource-scope.mjs';

const SKILL_NAME = /^[a-z][a-z0-9-]*$/;
const SUPPORTED_PLATFORMS = new Set(listSupportedPlatforms());

function isWithin(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel && !rel.startsWith('..') && !isAbsolute(rel));
}

function safeRoot(dir) {
  if (!dir || !existsSync(dir)) return null;
  try {
    const path = resolve(dir);
    const realPath = realpathSync(dir);
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || path !== realPath) return null;
    return { path, realPath };
  } catch {
    return null;
  }
}

function toTitle(name) {
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseSkill(file, content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`${file}: no valid frontmatter`);

  const frontmatter = yaml.load(match[1]);
  if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) {
    throw new Error(`${file}: frontmatter must be a mapping`);
  }
  if (typeof frontmatter.name !== 'string' || !SKILL_NAME.test(frontmatter.name)) {
    throw new Error(`${file}: frontmatter name must be kebab-case`);
  }
  if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
    throw new Error(`${file}: frontmatter description is required`);
  }
  if (
    frontmatter.compatible_platforms !== undefined &&
    (!Array.isArray(frontmatter.compatible_platforms) ||
      frontmatter.compatible_platforms.some((platform) => !SUPPORTED_PLATFORMS.has(platform)))
  ) {
    throw new Error(`${file}: compatible_platforms contains an unsupported platform`);
  }

  const body = (match[2] || '').trim();
  if (!body) throw new Error(`${file}: skill body is empty`);

  return {
    name: frontmatter.name,
    title: toTitle(frontmatter.name),
    file,
    frontmatter,
    body,
  };
}

/**
 * Build the standard skill roots. The array is ordered by precedence.
 *
 * @param {{
 *   frameworkDir?: string,
 *   frameworkSkillsDir?: string,
 *   workspaceDir?: string,
 *   homeDir?: string,
 * }} options
 * @returns {{dir: string, scope: string}[]}
 */
export function discoverSkillRoots({ frameworkDir, frameworkSkillsDir, workspaceDir, homeDir = homedir() } = {}) {
  const roots = [];
  const add = (dir, scope) => {
    if (!dir) return;
    const path = resolve(dir);
    if (!roots.some((root) => root.dir === path)) roots.push({ dir: path, scope });
  };

  add(workspaceDir && join(workspaceDir, '.staffforge', 'skills'), 'project');
  add(workspaceDir && join(workspaceDir, '.agents', 'skills'), 'project');
  if (workspaceDir && frameworkDir && resolve(workspaceDir) !== resolve(frameworkDir)) {
    add(join(workspaceDir, 'skills'), 'project');
  }

  add(homeDir && join(homeDir, '.agents', 'skills'), 'global');
  add(homeDir && join(homeDir, '.config', 'staffforge', 'skills'), 'global');

  add(frameworkSkillsDir || (frameworkDir && join(frameworkDir, 'skills')), 'framework');
  return roots;
}

/**
 * Discover skills without allowing symlinked roots or entries to escape their
 * declared scope. Invalid entries are reported and do not stop other skills.
 */
export class SkillRegistry {
  constructor(roots = []) {
    const input = typeof roots === 'string' ? [{ dir: roots, scope: 'framework' }] : roots;
    this._roots = input.map((root) => (typeof root === 'string' ? { dir: root, scope: 'framework' } : root));
    this._skills = null;
    this._errors = [];
  }

  load() {
    if (this._skills) return this;
    this._skills = [];
    const names = new Set();

    for (const root of this._roots) {
      const safe = safeRoot(root.dir);
      if (!safe) continue;

      let entries;
      try {
        entries = readdirSync(safe.path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
      } catch (err) {
        this._errors.push(`${safe.path}: ${err.message}`);
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || names.has(entry.name)) continue;
        if (!SKILL_NAME.test(entry.name)) {
          this._errors.push(`${entry.name}: directory name must be kebab-case`);
          continue;
        }

        const skillDir = join(safe.path, entry.name);
        let entryRealPath;
        try {
          entryRealPath = realpathSync(skillDir);
        } catch {
          this._errors.push(`${entry.name}: path cannot be resolved`);
          continue;
        }
        if (!isWithin(safe.realPath, entryRealPath)) {
          this._errors.push(`${entry.name}: path is outside skill root`);
          continue;
        }

        const skillPath = join(skillDir, 'SKILL.md');
        try {
          const stat = lstatSync(skillPath);
          if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error('SKILL.md must be a regular file');
          }
          const skill = parseSkill(`${entry.name}/SKILL.md`, readFileSync(skillPath, 'utf8'));
          if (skill.name !== entry.name) {
            throw new Error('frontmatter name must match directory name');
          }
          skill.scope = root.scope || 'framework';
          skill.root = safe.path;
          this._skills.push(skill);
          names.add(entry.name);
        } catch (err) {
          this._errors.push(`${root.scope || 'framework'}:${entry.name}: ${err.message}`);
        }
      }
    }

    return this;
  }

  all() {
    this.load();
    return this._skills;
  }

  errors() {
    this.load();
    return [...this._errors];
  }

  count() {
    return this.all().length;
  }

  findByName(name) {
    return this.all().find((skill) => skill.name === name) || null;
  }
}

export function getSkillRegistry(roots) {
  return new SkillRegistry(roots);
}
