import { filterResourcesForPlatform, supportsPlatform } from '@staffforge/core';

let passed = 0;
let failed = 0;
function assert(condition, message) {
  if (condition) passed++;
  else {
    console.error(`FAIL  ${message}`);
    failed++;
  }
}

const make = (name, compatible_platforms) => ({
  name,
  frontmatter: compatible_platforms === undefined ? {} : { compatible_platforms },
});

const agents = [make('all-agent'), make('open-agent', ['opencode']), make('none-agent', [])];
const skills = [make('all-skill'), make('cursor-skill', ['cursor'])];
const filtered = filterResourcesForPlatform({ agents, skills }, 'opencode');

assert(
  filtered.agents.map((agent) => agent.name).join(',') === 'all-agent,open-agent,none-agent',
  'empty and missing scopes mean all platforms',
);
assert(filtered.skills.map((skill) => skill.name).join(',') === 'all-skill', 'platform filtering applies to skills');
assert(supportsPlatform(make('cursor-only', ['cursor']), 'cursor'), 'declared platform is supported');
assert(!supportsPlatform(make('cursor-only', ['cursor']), 'aider'), 'undeclared platform is rejected');
assert(agents.length === 3 && skills.length === 2, 'filtering does not mutate inputs');

let threw = false;
try {
  filterResourcesForPlatform({ skills: [make('bad', ['unknown'])] }, 'opencode');
} catch {
  threw = true;
}
assert(threw, 'invalid platform metadata is rejected');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
