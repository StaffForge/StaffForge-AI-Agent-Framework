/**
 * GitHub Copilot adapter — generates:
 *   .github/copilot-instructions.md              (orchestrator's full prompt — makes it the DEFAULT agent)
 *   .github/agents/*.agent.md                    (ALL agents @mention-able, including orchestrator)
 *   .github/instructions/<skill>.instructions.md  (Skills as topic-specific instructions)
 *
 * Accepts skills as second parameter.
 *
 * ARCHITECTURE (per AGENTS.md Copilot Architecture):
 *   Layer 1 — copilot-instructions.md (default agent)
 *     Contains the orchestrator's full prompt — makes @orchestrator the default
 *     chat experience. Has applyTo: "**" → applies to ALL Copilot conversations.
 *     Built-in agents (@ask, @plan, @workspace) remain in the dropdown but share
 *     the orchestrator's base context as instructions.
 *
 *   Layer 2 — .github/agents/*.agent.md (all agents @mention-able)
 *     Every agent gets its own .agent.md. All 150+ agents are @mention-able
 *     alongside @ask, @plan, and @workspace.
 *
 *   Layer 3 — .github/instructions/*.instructions.md (skills)
 *     Load conditionally based on file glob patterns.
 */

function mapTools(frontmatter) {
  const tools = frontmatter.tools || {};
  const allowed = [];

  // read/search are baseline — include when agent has any write/edit capability
  if (tools.write || tools.edit) {
    allowed.push('read', 'edit');
  }
  if (tools.bash) {
    allowed.push('execute');
  }
  // agent tool allows invoking other custom agents
  allowed.push('agent');

  return allowed.length > 0 ? allowed : undefined;
}

function buildAgentFrontmatter(agent) {
  const lines = ['---'];
  lines.push(`name: ${agent.name}`);
  const desc = agent.frontmatter.description || '';
  if (desc) lines.push(`description: ${desc}`);

  const tools = mapTools(agent.frontmatter);
  if (tools) {
    lines.push(`tools: [${tools.map((t) => `'${t}'`).join(', ')}]`);
  }
  lines.push('---');
  return lines.join('\n');
}

export default function copilotAdapter(agents, skills = []) {
  const files = [];

  // ── 1. copilot-instructions.md — orchestrator as DEFAULT agent ─────────
  // Per AGENTS.md Copilot Architecture — Layer 1:
  // Contains the orchestrator's full prompt — makes @orchestrator the default
  // chat experience. Has applyTo: "**" → applies to ALL Copilot conversations.
  // Tradeoff: built-in agents (@ask, @plan, @workspace) remain in the dropdown
  // but share the orchestrator's base context.
  const orchestrator = agents.find((a) => a.id === 'orchestrator');
  const instructionsBody = orchestrator
    ? orchestrator.body
    : 'StaffForge AI Agent Framework — Multi-provider agent system.';
  files.push({
    path: '.github/copilot-instructions.md',
    content: `---
applyTo: "**"
---

${instructionsBody}
`,
  });

  // ── 2. .github/agents/<name>.agent.md — ALL agents @mention-able ──────
  // Every agent gets its own .agent.md so it can be @mentioned directly.
  // Built-in Copilot agents (@ask, @plan, @workspace) remain available
  // in the @mention dropdown alongside custom agents.
  for (const agent of agents) {
    const frontmatter = buildAgentFrontmatter(agent);
    files.push({
      path: `.github/agents/${agent.id}.agent.md`,
      content: `${frontmatter}\n\n${agent.body}\n`,
    });
  }

  // ── 3. .github/instructions/<skill>.instructions.md — Skills ───────────
  for (const skill of skills) {
    const globs = skill.frontmatter.globs?.length ? skill.frontmatter.globs.join(', ') : '**';
    files.push({
      path: `.github/instructions/${skill.name}.instructions.md`,
      content: `---
applyTo: "${globs}"
---

${skill.body}\n`,
    });
  }

  return files;
}
