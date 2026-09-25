import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillRegistry, discoverRules, composeAgentInstructions } from '@staffforge/core';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) passed++;
  else {
    console.error(`FAIL  ${message}`);
    failed++;
  }
}

function temp(name) {
  return mkdtempSync(join(tmpdir(), `staffforge-${name}-`));
}

function writeSkill(root, name, body = `# ${name}`) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`);
}

// Skills: deterministic precedence, malformed entries do not abort discovery.
{
  const project = temp('project-skills');
  const global = temp('global-skills');
  writeSkill(global, 'shared', 'global');
  writeSkill(global, 'valid', 'valid');
  mkdirSync(join(global, 'bad-platform'), { recursive: true });
  writeFileSync(
    join(global, 'bad-platform', 'SKILL.md'),
    '---\nname: bad-platform\ndescription: invalid platform\ncompatible_platforms: [unknown]\n---\n\ninvalid\n',
  );
  mkdirSync(join(global, 'missing-entry'), { recursive: true });
  mkdirSync(join(global, 'invalid-name'), { recursive: true });
  writeFileSync(join(global, 'invalid-name', 'SKILL.md'), 'not frontmatter');
  writeSkill(project, 'shared', 'project override');
  mkdirSync(join(project, 'linked-file'), { recursive: true });
  let symlinkCreated = false;
  try {
    symlinkSync(join(global, 'valid', 'SKILL.md'), join(project, 'linked-file', 'SKILL.md'));
    const linked = join(project, 'linked');
    symlinkSync('/tmp', linked, 'dir');
    symlinkCreated = true;
  } catch {
    // Symlink creation may be unavailable on restricted platforms.
  }

  const registry = new SkillRegistry([
    { dir: project, scope: 'project' },
    { dir: global, scope: 'global' },
  ]);
  const skills = registry.all();
  assert(
    skills.map((skill) => skill.name).join(',') === 'shared,valid',
    'scoped discovery is deterministic and invalid entries are skipped',
  );
  assert(registry.findByName('shared')?.body === 'project override', 'project skill has precedence');
  assert(
    registry.errors().some((error) => error.includes('missing-entry')),
    'missing SKILL.md is reported',
  );
  assert(
    registry.errors().some((error) => error.includes('invalid-name')),
    'invalid skill is reported',
  );
  assert(
    registry.errors().some((error) => error.includes('bad-platform')),
    'invalid platform metadata is reported without aborting discovery',
  );
  if (symlinkCreated) {
    assert(!skills.some((skill) => skill.name === 'linked'), 'symlinked skill directories are ignored');
    assert(
      registry.errors().some((error) => error.includes('linked-file')),
      'symlinked entry files are reported',
    );
    const linkedRoot = join(project, 'linked-root');
    symlinkSync(global, linkedRoot, 'dir');
    assert(new SkillRegistry([{ dir: linkedRoot, scope: 'project' }]).count() === 0, 'symlinked roots are ignored');
  }

  const scoped = new SkillRegistry([
    { dir: global, scope: 'global' },
    { dir: project, scope: 'project' },
  ]).all();
  assert(
    scoped.some((skill) => skill.name === 'valid'),
    'valid skill is discovered',
  );
  assert(scoped.filter((skill) => skill.name === 'shared').length === 1, 'duplicate names are deduplicated');
}

// Rules: global sources precede project sources and duplicate content is removed.
{
  const home = temp('home');
  const workspace = temp('workspace');
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents', 'AGENTS.md'), 'global rules');
  writeFileSync(join(workspace, 'AGENTS.md'), 'project rules');
  writeFileSync(join(workspace, 'PROJECT_RULES.md'), 'project settings');
  writeFileSync(join(workspace, 'AGENTS_ANEX.md'), 'project annex');

  const configuration = discoverRules({ workspaceDir: workspace, homeDir: home });
  assert(configuration.rules.length === 4, 'all distinct rule sources are loaded');
  assert(configuration.rules[0].scope === 'global', 'global rules load first');
  assert(configuration.rules[1].kind === 'AGENTS.md', 'project AGENTS.md follows global rules');
  assert(configuration.rules[2].kind === 'PROJECT_RULES.md', 'project rules follow project AGENTS.md');
  assert(configuration.rules[3].kind === 'AGENTS_ANEX.md', 'project annex has highest project precedence');

  const agent = { name: 'Example', body: 'agent instructions' };
  const composed = composeAgentInstructions(agent, configuration);
  assert(composed !== agent, 'composition does not mutate the agent object');
  assert(
    composed.body.indexOf('global rules') < composed.body.indexOf('agent instructions'),
    'rules precede agent instructions',
  );
  assert(agent.body === 'agent instructions', 'original agent remains unchanged');
  assert(composeAgentInstructions(agent, { rules: [] }) === agent, 'no rules preserves the original object');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
