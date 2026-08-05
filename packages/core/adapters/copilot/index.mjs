/**
 * GitHub Copilot adapter — generates:
 *   .github/copilot-instructions.md              (NEUTRAL project context — NOT the orchestrator)
 *   .github/agents/*.agent.md                    (ALL agents @mention-able, including orchestrator)
 *   .github/instructions/<skill>.instructions.md  (Skills as topic-specific instructions)
 *
 * Accepts skills as second parameter.
 *
 * ARCHITECTURE (per AGENTS.md Copilot Architecture):
 *   Layer 1 — copilot-instructions.md (NEUTRAL context)
 *     Intentionally neutral. It has applyTo: "**" → applies to EVERY Copilot
 *     conversation (including built-in @ask, @plan, @workspace). Embedding the
 *     orchestrator identity here would override Copilot's built-in agents.
 *     This file provides only project-level context. The main agent is
 *     @orchestrator — its FULL prompt lives in .github/agents/orchestrator.agent.md
 *     and is applied when you invoke @orchestrator.
 *
 *   Layer 2 — .github/agents/*.agent.md (all agents @mention-able)
 *     Every agent gets its own .agent.md. All 150+ agents are @mention-able
 *     alongside @ask, @plan, and @workspace. @orchestrator (the primary agent)
 *     is here with its complete body.
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

  // ── 1. copilot-instructions.md — NEUTRAL project context ───────────────
  // CRITICAL: applyTo: "**" applies to EVERY Copilot conversation (including
  // built-in @ask, @plan, @workspace). We MUST NOT put the orchestrator's
  // identity here or it overrides Copilot's built-in agents. This file stays
  // neutral — project-level context only. The @orchestrator rules live in
  // .github/agents/orchestrator.agent.md and apply when @orchestrator is used.
  files.push({
    path: '.github/copilot-instructions.md',
    content: `---
applyTo: "**"
---

StaffForge AI Agent Framework — Multi-provider agent system.
Use @orchestrator for multi-agent pipeline execution.
Technology agents (@python, @typescript, @react, etc.) are available via @mention.
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
