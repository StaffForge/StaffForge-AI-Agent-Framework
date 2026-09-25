import { AdapterRegistry } from '@staffforge/core';

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

const reg = new AdapterRegistry();
const sampleSkill = {
  name: 'opencode-only',
  title: 'Opencode Only',
  frontmatter: {
    description: 'Platform filtering test skill.',
    compatible_platforms: ['opencode'],
  },
  body: 'Platform-specific skill body.',
};

const allPlatformsSkill = {
  name: 'shared-export-skill',
  title: 'Shared Export Skill',
  frontmatter: {
    description: 'Cross-runtime export test skill.',
    compatible_platforms: [],
  },
  body: 'Cross-runtime skill body.',
};

const sampleAgent = {
  id: 'test-agent',
  name: 'Test Agent',
  file: 'test-agent.md',
  frontmatter: {
    description: 'Test agent for export validation.',
    mode: 'subagent',
    tools: { write: false, bash: false, edit: false },
    keywords: ['test', 'validate'],
    capabilities: ['testing'],
  },
  body: 'This is a test agent body.',
};

// Test: export to opencode
{
  const result = await reg.export([sampleAgent], 'opencode', null, [sampleSkill]);
  assert(result.platform === 'opencode', 'export opencode platform');
  assert(result.fileCount >= 2, 'compatible skill is exported to opencode');
}

// Test: export to claude-code
{
  const result = await reg.export([sampleAgent], 'claude-code', null, [allPlatformsSkill]);
  assert(result.platform === 'claude-code', 'export claude-code platform');
  assert(result.fileCount >= 2, 'compatible skill is exported to claude-code');
}

// Test: export to cursor
{
  const result = await reg.export([sampleAgent], 'cursor', null, [sampleSkill]);
  assert(result.platform === 'cursor', 'export cursor platform');
  assert(result.fileCount === 1, 'incompatible skill is not exported to cursor');
}

// Test: export to copilot
{
  const result = await reg.export([sampleAgent], 'copilot', null, [allPlatformsSkill]);
  assert(result.platform === 'copilot', 'export copilot platform');
  assert(result.fileCount >= 3, 'compatible skill is exported to copilot');
}

// Test: export to aider
{
  const result = await reg.export([sampleAgent], 'aider', null, [allPlatformsSkill]);
  assert(result.platform === 'aider', 'export aider platform');
  assert(result.fileCount === 1, 'compatible skill is aggregated for aider');
}

// Test: export to gemini-cli
{
  const result = await reg.export([sampleAgent], 'gemini-cli', null, [allPlatformsSkill]);
  assert(result.platform === 'gemini-cli', 'export gemini-cli platform');
  assert(result.fileCount >= 2, 'compatible skill is exported to gemini-cli');
}

// Test: exportToAll with sample agent
{
  const results = await reg.exportToAll([sampleAgent], [allPlatformsSkill]);
  assert(results.length >= 6, 'exportToAll all platforms');
  for (const r of results) {
    // copilot always generates files: neutral copilot-instructions.md + .agent.md for all agents
    if (r.platform === 'copilot') {
      assert(r.fileCount >= 1, 'copilot exports at least 1 file (neutral copilot-instructions.md + agent files)');
    } else {
      assert(r.fileCount >= 1, `${r.platform} exported at least 1 file`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
