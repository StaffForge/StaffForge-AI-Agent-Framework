# Configuration scopes

StaffForge resolves rules and skills before an adapter renders files for a
runtime. The resolver is runtime-neutral: adapters receive already validated
resources and only translate them to native files.

## Rule locations and precedence

Rules are Markdown files. The resolver checks regular files only and rejects
symlinked files and roots.

```text
Global configuration (user home)
├── ~/.agents/AGENTS.md
├── ~/.agents/AGENTS_ANEX.md
├── ~/AGENTS.md
├── ~/AGENTS_ANEX.md
├── ~/.config/staffforge/AGENTS.md
└── ~/.config/staffforge/AGENTS_ANEX.md

Project configuration (workspace and its ancestors)
├── AGENTS.md
├── PROJECT_RULES.md
└── AGENTS_ANEX.md
```

Project ancestors are processed from the outermost directory to the workspace.
Duplicate paths and identical contents are emitted once. Global configuration is
provided through the resolver options (`workspaceDir`, `homeDir`, and an optional
`globalRulesDir`); it is not tied to any runtime-specific configuration file.

The effective order is:

```text
Global rules
    ↓
Project AGENTS.md
    ↓
Project PROJECT_RULES.md
    ↓
Project AGENTS_ANEX.md
    ↓
Agent-specific instructions
    ↓
Task-specific instructions
```

The last two levels are supplied by the caller or runtime. Export does not
execute tasks and therefore does not invent task-specific instructions.

The public core functions are:

```js
import { loadConfiguration, composeAgents } from '@staffforge/core';

const configuration = loadConfiguration({ workspaceDir: process.cwd() });
const agents = composeAgents(canonicalAgents, configuration);
```

Composition returns new agent objects and preserves the canonical registry.
Rules are instructions, not permissions: tool permissions continue to come
from validated agent metadata.

## Skill locations and precedence

Every skill has its own namespace and must use `SKILL.md` as its entry point.

```text
<skill-root>/
└── <skill-name>/
    ├── SKILL.md            # required
    ├── scripts/            # optional; never executed by discovery
    ├── references/         # optional
    ├── assets/             # optional
    └── ...
```

Roots are checked in this order:

```text
<workspace>/.staffforge/skills/
<workspace>/.agents/skills/
<workspace>/skills/              # only when separate from framework source
<home>/.agents/skills/
<home>/.config/staffforge/skills/
<framework>/skills/
```

The first valid skill with a given name wins. This makes project skills able to
intentionally override a lower-scope skill without copying unrelated skills.
The default `tools/skill-loader.mjs` entry point remains framework-only for
backward compatibility; pass workspace options to load all applicable scopes.

A valid `SKILL.md` requires YAML frontmatter containing:

```yaml
---
name: database-review
description: Reviews database changes for correctness
version: 0.1.0
compatible_platforms: []
---
```

The body must contain instructions. Invalid skills are skipped and reported;
valid skills continue to load. Discovery is deterministic and O(n) in the
number of entries inspected.

Discovery only reads `SKILL.md`. It does not execute scripts, follow symlinked
roots, follow symlinked skill directories, or read a symlinked `SKILL.md`.
Skill content remains untrusted instruction input and is not an authorization
mechanism.

## Platform compatibility

`compatible_platforms` is enforced before an adapter runs:

- missing field: all supported platforms;
- empty array: all supported platforms;
- non-empty array: only the listed platforms.

The supported values are `opencode`, `claude-code`, `cursor`, `copilot`,
`aider`, and `gemini-cli`. Adapters do not implement this policy themselves.

Native conditional behavior differs by runtime:

| Runtime | Output for skills | Native conditional metadata |
|---|---|---|
| OpenCode | `.opencode/skills/<name>.md` | `globs` metadata |
| Claude Code | `.claude/skills/<name>.md` | runtime-dependent; no claim of file activation |
| Cursor | `.cursor/rules/<name>.mdc` | `globs` metadata |
| Copilot | `.github/instructions/<name>.instructions.md` | `applyTo` generated from `globs` |
| Aider | `.aider.rules.md` | aggregate rules; no per-skill file activation |
| Gemini CLI | `.gemini/<name>.md` | separate instruction files |

## Creating configuration

Create a global rule in one of the documented user-level locations. Create
project rules in the workspace root. Do not place secrets or credentials in
rules or skills.

Create a project skill with:

```bash
node tools/init-skill.mjs release-review
```

For a project-only skill, place the generated directory under
`.staffforge/skills/` in the target workspace. Validate and export normally:

```bash
npm run validate
npm run export:opencode
```

The adapters remain independent of discovery, validation, precedence, and
security policy. This keeps generated output consistent across runtimes while
preserving each runtime's native limitations.
