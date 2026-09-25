import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSkillRegistry } from '../../tools/skill-loader.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const skillsDir = join(root, 'skills');

let passed = 0;
let failed = 0;
function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    console.error(`FAIL  ${name}`);
    failed++;
  }
}

const entries = readdirSync(skillsDir, { withFileTypes: true });
const rootMarkdownFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
const skillDirectories = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

assert(rootMarkdownFiles.length === 0, 'skills root contains no legacy Markdown skill files');
assert(skillDirectories.length >= 4, `skill directories discovered (${skillDirectories.length})`);

for (const entry of skillDirectories) {
  const skillPath = join(skillsDir, entry.name, 'SKILL.md');
  assert(existsSync(skillPath) && statSync(skillPath).isFile(), `${entry.name}: has SKILL.md entry point`);
}

const skills = getSkillRegistry().all();
assert(skills.length === skillDirectories.length, `loader discovers every skill directory (${skills.length})`);

for (const skill of skills) {
  assert(skill.name === skill.frontmatter.name, `${skill.file}: loader preserves frontmatter name`);
  assert(skill.file === join(skill.name, 'SKILL.md'), `${skill.name}: deterministic entry point`);
  assert(existsSync(join(skillsDir, skill.file)), `${skill.name}: resolved entry point exists`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
