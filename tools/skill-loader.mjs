/**
 * Skill loader — reads skill definitions from the skills/ directory.
 * Follows the same pattern as AgentRegistry but simpler.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function toTitle(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseSkill(file, content) {
  // \r?\n: tolerate CRLF line endings (same silent-failure class as the
  // agent-registry CRLF bug — a CRLF skill file would be dropped otherwise).
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`${file}: no valid frontmatter`);
  }

  const frontmatter = yaml.load(match[1]) || {};
  const body = (match[2] || '').trim();

  const name = frontmatter.name || file.replace(/\.md$/, '');
  const title = toTitle(name);

  return {
    name,
    title,
    file,
    frontmatter,
    body,
  };
}

export class SkillRegistry {
  constructor(skillDir = null) {
    this._skillDir = skillDir || join(root, 'skills');
    this._skills = null;
  }

  load() {
    if (this._skills) return this;
    const entries = readdirSync(this._skillDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    this._skills = [];
    for (const entry of entries) {
      const file = join(entry.name, 'SKILL.md');
      const skillPath = join(this._skillDir, file);
      try {
        const content = readFileSync(skillPath, 'utf-8');
        const skill = parseSkill(file, content);
        if (skill.name !== entry.name) {
          throw new Error(`${file}: frontmatter name must match its directory name`);
        }
        this._skills.push(skill);
      } catch (err) {
        console.warn(`skill-loader: ${file}: ${err.message}`);
      }
    }
    return this;
  }

  all() {
    this.load();
    return this._skills;
  }

  count() {
    this.load();
    return this._skills.length;
  }

  findByName(name) {
    this.load();
    return this._skills.find((s) => s.name === name) || null;
  }
}

let _defaultInstance = null;
export function getSkillRegistry() {
  if (!_defaultInstance) {
    _defaultInstance = new SkillRegistry();
  }
  return _defaultInstance;
}

export default getSkillRegistry;
