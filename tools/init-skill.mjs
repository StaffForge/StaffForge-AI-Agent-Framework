#!/usr/bin/env node

/**
 * init-skill.mjs — Scaffolds a new skill definition.
 * Usage: node tools/init-skill.mjs <skill-name>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const USAGE = `Usage: node tools/init-skill.mjs <skill-name>

Creates a new skill directory at skills/<skill-name>/ with SKILL.md from the template.
Skill names must be kebab-case (e.g. database-review).
`;

function ask(query, defaultValue = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

function toTitle(name) {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function main() {
  const name = process.argv[2];
  if (!name || name === '--help' || name === '-h') {
    console.log(USAGE);
    process.exit(name ? 0 : 1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    console.error('ERROR: skill name must be kebab-case (e.g. database-review)');
    process.exit(1);
  }

  const skillDir = join(root, 'skills', name);
  const outPath = join(skillDir, 'SKILL.md');
  if (existsSync(skillDir)) {
    console.error(`ERROR: skill already exists at ${skillDir}`);
    process.exit(1);
  }

  console.log(`\nCreating skill "${name}" — fill in the details:\n`);

  const title = await ask('Title', toTitle(name));
  const description = await ask('Description', `${name} specialist skill.`);
  const keywordsRaw = await ask('Keywords (comma-separated, optional)', '');
  const keywords = keywordsRaw
    ? keywordsRaw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : [];

  const template = readFileSync(join(root, 'templates', 'skill.md'), 'utf-8');
  let content = template
    .replace(/__NAME__/g, name)
    .replace(/__TITLE__/g, title)
    .replace(/__DESCRIPTION__/g, description)
    .replace(/__DOMAIN__/g, title);

  if (keywords.length) {
    const keywordsYaml = keywords.map((k) => `  - ${k}`).join('\n');
    content = content.replace(/^keywords: \[\]/m, `keywords:\n${keywordsYaml}`);
  }

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(outPath, content, 'utf-8');
  console.log(`\nCreated ${outPath}`);
  console.log('Next steps:');
  console.log('  1. Edit the file to add detailed skill instructions');
  console.log('  2. Run `npm run validate` to ensure the skill definition is valid');
  console.log('  3. Run `npm run export` to generate platform-specific output');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
