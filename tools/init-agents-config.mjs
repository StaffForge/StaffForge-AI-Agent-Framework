#!/usr/bin/env node

/**
 * StaffForge AI Agent Framework — AGENTS configuration generator (the "system")
 *
 * Implements the AGENTS Configuration Framework specification:
 *   §2.1  File Management Strategy (Scenario A: AGENTS.md / Scenario B: AGENTS_ANEX.md)
 *   §3    Interactive Configuration Questionnaire (8 modules)
 *   §4.1  AGENTS.md template
 *   §5.1  AGENTS_ANEX.md template
 *   §6.1  Initialization Sequence
 *   §6.2  Validation Rules
 *
 * The 5 legacy modules (stack, conventions, rules, workflow, docs) return
 * markdown section bodies. The 3 spec blocks (Context, Guardrails, Output
 * Format) return structured objects under data.spec that are rendered into
 * high-density markdown tables at template time. Free-text answers are
 * sanitized against prompt-injection patterns and secret leakage before
 * rendering (securityPass stage).
 *
 * Zero external dependencies. Usable both as a standalone CLI
 * (`node tools/init-agents-config.mjs [--yes] [--out <dir>]`) and as an
 * imported function from packages/cli/install.mjs.
 *
 * Options:
 *   --out <dir>   Target project directory (default: CWD)
 *   --yes, -y     Non-interactive: use framework defaults for all 8 modules
 *   --help, -h    Show help
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { env, argv, exit, cwd } from 'node:process';
// Reuse the canonical guardrail pattern lists (zero deps, single source of truth).
import { sanitizeInput } from '../packages/core/lib/guardrails/input-sanitizer.mjs';
import { scanSecrets } from '../packages/core/lib/guardrails/output-dlp.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = cwd();
const ROOT = resolve(__dirname, '..');
const TEMPLATE_CONFIG = join(ROOT, 'templates', 'agents-config.md');
const TEMPLATE_ANEX = join(ROOT, 'templates', 'agents-anex.md');

// ── Help ──
function help() {
  console.log(`StaffForge — AGENTS configuration generator

USAGE
  node tools/init-agents-config.mjs [--out <dir>] [--yes] [--help]

OPTIONS
  --out <dir>   Project directory to configure (default: current directory)
  --yes, -y     Skip interactive prompts, use framework defaults
  --help, -h    Show this help

BEHAVIOR (spec §2.1)
  If AGENTS.md does not exist      → create AGENTS.md (Scenario A)
  If AGENTS.md already exists       → create AGENTS_ANEX.md (Scenario B)

MODULES (spec §3)
  1-5  Technology Stack / Conventions / Rules / Workflow / Documentation
  6    Context Spec (description, exact stack, domain restrictions, language)
  7    Guardrails Spec (token budgets, DLP mode, anti-injection, max iterations)
  8    Output Format Spec (schema, verbosity, LaTeX/code handling)

DEFAULTS (spec §6.2 — standard production defaults)
  Token budget call = 32000, session = 128000, max iterations = 10,
  DLP mode = redact, anti-injection = true, language = English,
  output schema = structured markdown, verbosity = minimal, LaTeX = allow
`);
}

// ── Args ──
function parseArgs() {
  const a = argv.slice(2);
  const o = { out: cwd() };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--help' || a[i] === '-h') {
      help();
      exit(0);
    } else if (a[i] === '--out') {
      o.out = a[++i];
    } else if (a[i] === '--yes' || a[i] === '-y') {
      o.yes = true;
    }
  }
  return o;
}

// ── Readline (injectable) ──
// IMPORTANT: do NOT create a second readline over process.stdin when called from
// another CLI that already opened one (e.g. install.mjs). Passing `rl`/`ask` from
// the caller prevents duplicate-echo of typed characters (two readers on same TTY).
// When run standalone, we create our own (and close it on exit).
let _rl = null;
let _ownRl = false;
let ask = null;

function bindReadline(injected) {
  if (injected && injected.rl && injected.ask) {
    _rl = injected.rl;
    ask = injected.ask;
  } else {
    _rl = createInterface({ input: process.stdin, output: process.stdout });
    _ownRl = true;
    ask = (q, def = '') =>
      new Promise((r) => {
        const p = def ? `${q} [${def}]: ` : `${q}: `;
        _rl.question(p, (a) => r(a.trim() || def));
      });
  }
}
function closeReadlineIfOwn() {
  if (_ownRl && _rl) {
    _rl.close();
    _ownRl = false;
  }
}

// ── Timestamp ──
function nowStamp() {
  // spec §6.2 requires timestamp + version; ISO-ish, human readable
  return new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

// ── Technology Dependency Graph (spec §3.1) ──
// Runtime → Framework → ORM/Persistence — strict coherence validation
const TECH_GRAPH = {
  'Node.js (JavaScript/TypeScript)': {
    label: 'Node.js (JavaScript/TypeScript)',
    frameworks: {
      'Express.js': ['Prisma', 'TypeORM', 'Mongoose (MongoDB)', 'Knex.js', 'Drizzle ORM', 'Other'],
      NestJS: ['Prisma', 'TypeORM', 'Mongoose (MongoDB)', 'Knex.js', 'Drizzle ORM', 'Other'],
      Fastify: ['Prisma', 'TypeORM', 'Mongoose (MongoDB)', 'Knex.js', 'Drizzle ORM', 'Other'],
      'Next.js (Full-stack)': ['Prisma', 'TypeORM', 'Drizzle ORM', 'Other'],
      'None (CLI/Tooling)': ['None (file-based)', 'better-sqlite3', 'Other'],
    },
  },
  '.NET (C#)': {
    label: '.NET (C#)',
    frameworks: {
      'ASP.NET Core Web API': ['Entity Framework Core', 'Dapper', 'NHibernate', 'Other'],
      Blazor: ['Entity Framework Core', 'Dapper', 'Other'],
      'Minimal API': ['Entity Framework Core', 'Dapper', 'Other'],
      'None (CLI/Library)': ['None (file-based)', 'Dapper', 'Other'],
    },
  },
  Python: {
    label: 'Python',
    frameworks: {
      FastAPI: ['SQLAlchemy', 'Tortoise ORM', 'Django ORM', 'Other'],
      Django: ['Django ORM', 'SQLAlchemy (via django-extensions)', 'Other'],
      Flask: ['SQLAlchemy', 'Tortoise ORM', 'Other'],
      'None (CLI/Tooling)': ['None (file-based)', 'SQLite (sqlite3)', 'Other'],
    },
  },
  Java: {
    label: 'Java',
    frameworks: {
      'Spring Boot': ['Hibernate/JPA', 'MyBatis', 'jOOQ', 'Other'],
      Quarkus: ['Hibernate/JPA', 'MyBatis', 'Other'],
      Micronaut: ['Hibernate/JPA', 'jOOQ', 'Other'],
      'None (CLI/Library)': ['None (file-based)', 'JDBC', 'Other'],
    },
  },
  Go: {
    label: 'Go',
    frameworks: {
      Gin: ['GORM', 'sqlx', 'ent', 'Other'],
      Echo: ['GORM', 'sqlx', 'ent', 'Other'],
      Fiber: ['GORM', 'sqlx', 'ent', 'Other'],
      'None (CLI/Tooling)': ['None (file-based)', 'database/sql', 'Other'],
    },
  },
};

// Testing frameworks per runtime
const TESTING_MAP = {
  'Node.js (JavaScript/TypeScript)': ['Jest', 'Vitest', 'Mocha', 'Playwright (E2E)', 'Cypress (E2E)'],
  '.NET (C#)': ['xUnit', 'NUnit', 'MSTest', 'Playwright (E2E)'],
  Python: ['pytest', 'unittest', 'behave (BDD)', 'Playwright (E2E)', 'Other'],
  Java: ['JUnit', 'TestNG', 'Mockito', 'Cucumber (BDD)', 'Other'],
  Go: ['testing (go test)', 'Testify', 'Ginkgo', 'Other'],
};

// ── Default answers (framework self-description, used by --yes) ──
const DEFAULTS = {
  projectName: 'StaffForge AI Agent Framework',
  stack: `## Technology Stack
- **Languages**: JavaScript (Node.js 20+, ESM), YAML (agent/skill config)
- **Web Framework**: None as app framework — CLI/tooling (Node.js scripts, platform adapters)
- **Database(s)**: None (file-based YAML/JSON configuration)
- **Architecture Pattern**: Modular monorepo with platform adapter exporters
- **Testing Framework**: Jest/Vitest (unit), custom test runner (tests/run-all.mjs)
- **DevOps & Deployment**: npm scripts, GitHub Actions (CI), multi-platform export (opencode/claude-code/cursor/copilot/aider/gemini-cli)`,
  conventions: `## Code Conventions & Standards
- **Variable Naming**: camelCase - JavaScript convention
- **Class/Type Naming**: PascalCase - consistent across files
- **File Naming**: kebab-case for files (e.g. init-agent.mjs), snake_case for modules
- **Indentation**: 2 spaces - consistent across all files
- **Max Line Length**: 100 characters - enforced by Prettier
- **Code Formatter**: Prettier (config: .prettierrc) + ESLint (config: .eslintrc.json)
- **Documentation Format**: JSDoc-style block comments with mandatory coverage for public APIs`,
  rules: `## Operational Rules & Constraints

### Forbidden Operations (NEVER)
- Modify AGENTS.md directly: PROJECT_RULES.md is the append-only addendum - base conventions must stay stable
- Run VCS commands outside the orchestrator: only @vcs/@git may manage branches/commits - prevents repo corruption
- Generate code without an initialized VCS branch: every task starts on a dedicated branch - ensures traceability

### Required Approvals
- Architecture changes: require @architect review before implementation
- Production deployment: require release manager + security sign-off

### Performance Requirements
- CLI startup: < 2s cold start for tool scripts
- Validation suite (npm run validate): completes under CI timeout

### Security Constraints
- Never log secrets or tokens: redact in all outputs
- All agent frontmatter permissions explicit: no implicit full-access grants

### Data Handling Rules
- No PII stored in repo: configuration is code-only
- Secrets via env vars: never committed

### Deployment Rules
- Only hotfix/* and release/* touch main: feature/bugfix merge to develop only
- Rollback: tag-based revert via @vcs`,
  workflow: `## Workflow & Process Definition

### Version Control Strategy
- **Branching Model**: Git Flow - feature/bugfix → develop; release/hotfix → main
- **Commit Message Format**: Conventional Commits - "feat:", "fix:", "refactor:", "docs:"
- **Versioning Scheme**: Semantic Versioning (MAJOR.MINOR.PATCH)

### Code Review Process
- **Minimum Reviewers**: 1
- **Approval Requirements**: At least 1 approval from a maintainer
- **Review Timeline**: Within 3 business days
- **Automated Checks**: npm run validate + npm test must pass in CI

### Issue & Task Management
- **Tool**: GitHub Issues
- **Issue Labeling**: feature / bug / refactor / security / docs
- **Task Assignment**: Assignee field on issue

### Release & Deployment Workflow
- **Deployment Frequency**: On-demand per release/*
- **Release Process**: Hybrid (CI build + manual tag)
- **Rollback Procedure**: Manual - git revert tagged commit
- **Canary/Staged Deployment**: No

### Decision Making & Communication
- **Decision Documentation**: ADRs in repo (docs/adr/)
- **Architecture Review**: Required for any cross-agent contract change
- **Communication Channels**: GitHub Discussions

### Team Synchronization
- **Standup Cadence**: Not mandated (OSS)
- **Team Review Meetings**: Weekly maintainer sync`,
  docs: `## Documentation Requirements

### Documentation Scope & Coverage
- **Architecture**: Required - ARCHITECTURE.md in repo
- **API Specifications**: Required for published packages - JSDoc
- **Deployment Guides**: Required - README.md + per-platform export docs
- **Operational Runbooks**: Optional
- **Module READMEs**: Required sections for packages/ (name, usage, API)

### Documentation Tools & Format
- **Primary Format**: Markdown in repo
- **Location**: Repository (docs/ + root .md files)
- **Version Control**: In-repo
- **Tool Stack**: Markdown + JSDoc (tools), OpenAPI where applicable

### Documentation Standards
- **Code Comments**: Mandatory for public APIs
- **Change Logs**: Required - CHANGELOG.md (Keep a Changelog format)
- **Deprecation Notice**: 1 minor release notice before removal
- **Migration Guides**: Required for breaking changes

### Documentation Review
- **Included in Code Review**: Yes
- **Separate Review Process**: No
- **Approval Required**: Yes (maintainer)
- **SLA for Review**: Same as code review`,

  // ── Spec defaults (Block A/B/C — standard production defaults, spec §6.2) ──
  // Structured objects (not markdown bodies): validated strictly, rendered to
  // high-density markdown tables at template time, emitted in the JSON audit.
  spec: {
    context: {
      technicalDescription:
        'Token-optimized multi-agent framework. Orchestrator interprets high-level requests, crafts specialized sub-prompts, coordinates expert agents via parallel/sequential execution.',
      exactTechStack: 'Derived from Technology Stack section',
      domainRestrictions: 'None specified',
      defaultLanguage: 'English',
    },
    guardrails: {
      // Mirrors GuardrailManager.DEFAULT_POLICY (packages/core/lib/guardrails/guardrail-manager.mjs)
      tokenBudgetPerCall: 32000, // per agent call, int 1000–64000
      tokenBudgetPerSession: 128000, // per pipeline session, int >= perCall
      dlpMode: 'redact', // enum: scan | redact
      antiInjection: true, // boolean: sanitize free-text against prompt injection
      maxIterations: 10, // int 1–20
    },
    output: {
      outputSchema: 'structured markdown', // enum: structured markdown | json
      verbosity: 'minimal', // enum: minimal | standard | detailed
      latexHandling: 'allow', // enum: allow | escape
    },
  },
};

// ── Structured choice helper ──
// Presents a numbered list of options, returns the selected value.
// If the selected option is "Other" (case-insensitive), prompts for custom text.
async function askChoice(prompt, options, defaultIdx = 1) {
  console.log(`\n${prompt}:`);
  for (let i = 0; i < options.length; i++) {
    const mark = i + 1 === defaultIdx ? ' (default)' : '';
    console.log(`  ${i + 1}) ${options[i]}${mark}`);
  }
  const raw = await ask(`? [${defaultIdx}]`, String(defaultIdx));
  const num = parseInt(raw, 10);
  if (num >= 1 && num <= options.length) {
    const value = options[num - 1];
    if (value.toLowerCase() === 'other') {
      return await ask('  » Specify custom value', value);
    }
    return value;
  }
  // Free-text fallback: user typed something custom (not a number)
  return raw || options[defaultIdx - 1];
}

// ── Module questionnaires (spec §3) ──
// Each returns the populated body for its section.

async function moduleStack(yes) {
  if (yes) return DEFAULTS.stack;
  console.log('\n=== Module 1: Technology Stack ===');

  // Step 1 — Runtime/Language (root of the graph)
  const runtimeNames = Object.keys(TECH_GRAPH);
  const runtimeOptions = [...runtimeNames, 'Other'];
  const runtime = await askChoice('Runtime / Programming Language', runtimeOptions, 1);
  const rtKey = runtimeNames.find((k) => k === runtime) || runtime;
  const rtNode = TECH_GRAPH[rtKey];

  if (!rtNode) {
    // Custom runtime not in graph — generic fallback
    const customFw = await ask('Web / App Framework', 'None');
    const customDb = await ask('Database / Persistencia', 'None');
    const arch = await askChoice(
      'Architecture Pattern',
      ['Monolith', 'Modular Monorepo', 'Microservices', 'Clean Architecture', 'Hexagonal (Ports & Adapters)', 'Other'],
      2,
    );
    const test = await askChoice('Testing Framework', ['Jest', 'pytest', 'Vitest', 'Other'], 1);
    const devops = await askChoice(
      'DevOps / Deployment',
      ['GitHub Actions', 'GitLab CI', 'Jenkins', 'Docker + docker-compose', 'Kubernetes', 'Other'],
      1,
    );
    return `## Technology Stack\n- **Languages**: ${rtKey}\n- **Web Framework**: ${customFw}\n- **Database(s)**: ${customDb}\n- **Architecture Pattern**: ${arch}\n- **Testing Framework**: ${test}\n- **DevOps & Deployment**: ${devops}`;
  }

  // Step 2 — Framework (filtered by runtime)
  const fwNames = Object.keys(rtNode.frameworks);
  const fwOptions = [...fwNames, 'Other'];
  const framework = await askChoice(`Web / App Framework (for ${rtKey})`, fwOptions, fwNames.length);

  // Step 3 — ORM / Persistence (filtered by runtime + framework)
  let orm;
  const fwOrms = rtNode.frameworks[framework];
  if (fwOrms) {
    orm = await askChoice(`Database ORM / Persistencia (for ${rtKey} + ${framework})`, fwOrms, fwOrms.length);
  } else {
    // Custom framework — ask for persistence directly
    orm = await ask('Database ORM / Persistencia (for custom framework)', 'None');
  }

  // Step 4 — Architecture pattern
  const archPatterns = [
    'Monolith',
    'Modular Monorepo',
    'Microservices',
    'Clean Architecture',
    'Hexagonal (Ports & Adapters)',
    'Other',
  ];
  const arch = await askChoice('Architecture Pattern', archPatterns, 2);

  // Step 5 — Testing framework (based on runtime)
  const testOpts = TESTING_MAP[rtKey] || ['Jest', 'pytest', 'Vitest', 'Other'];
  const test = await askChoice('Testing Framework', testOpts, 1);

  // Step 6 — DevOps / Deployment
  const devOpsOpts = ['GitHub Actions', 'GitLab CI', 'Jenkins', 'Docker + docker-compose', 'Kubernetes', 'Other'];
  const devops = await askChoice('DevOps / Deployment', devOpsOpts, 1);

  return `## Technology Stack
- **Languages**: ${rtKey}
- **Web Framework**: ${framework}
- **Database(s)**: ${orm}
- **Architecture Pattern**: ${arch}
- **Testing Framework**: ${test}
- **DevOps & Deployment**: ${devops}`;
}

async function moduleConventions(yes) {
  if (yes) return DEFAULTS.conventions;
  console.log('\n=== Module 2: Code Conventions & Standards ===');
  const varN = await askChoice(
    'Variable / Function naming convention',
    ['camelCase', 'snake_case', 'PascalCase', 'kebab-case', 'Other'],
    1,
  );
  const classN = await askChoice(
    'Class / Type naming convention',
    ['PascalCase', 'camelCase', 'CONSTANT_CASE', 'Other'],
    1,
  );
  const fileN = await askChoice(
    'File naming convention',
    ['kebab-case', 'snake_case', 'camelCase', 'PascalCase', 'Other'],
    1,
  );
  const indent = await askChoice('Indentation style', ['2 spaces', '4 spaces', 'tabs'], 1);
  const maxLine = await askChoice('Max line length', ['80', '100', '120', 'Other'], 2);
  const fmt = await askChoice(
    'Code formatter / linter',
    [
      'Prettier + ESLint',
      'Prettier + ESLint + TypeScript',
      'Black + Ruff (Python)',
      'rustfmt (Rust)',
      'gofmt (Go)',
      'Other',
    ],
    1,
  );
  const doc = await askChoice(
    'Documentation format',
    [
      'JSDoc (JavaScript/TypeScript)',
      'docstrings (Python)',
      'XML Docs (.NET)',
      'Rustdoc (Rust)',
      'Go Doc (Go)',
      'Other',
    ],
    1,
  );
  return `## Code Conventions & Standards
- **Variable Naming**: ${varN} - project convention
- **Class/Type Naming**: ${classN} - project convention
- **File Naming**: ${fileN} - consistent file naming
- **Indentation**: ${indent} - consistent across all files
- **Max Line Length**: ${maxLine} characters - enforced by formatter
- **Code Formatter**: ${fmt}
- **Documentation Format**: ${doc} with mandatory coverage for public APIs`;
}

async function moduleRules(yes) {
  if (yes) return DEFAULTS.rules;
  console.log('\n=== Module 3: Operational Rules & Constraints ===');
  const forbidden = await askChoice(
    'Forbidden operations (NEVER do X) — choose most critical',
    [
      'Never run VCS outside orchestrator | Never commit secrets',
      'Never modify AGENTS.md directly | Never commit secrets',
      'Never deploy to production without PR | Never run DB migrations blindly',
      'Never use production data in dev | Never disable security checks',
      'Other',
    ],
    1,
  );
  const approvals = await askChoice(
    'Required approvals',
    ['PR review by maintainer', 'PR review + QA sign-off', 'PR review + security review + QA', 'Other'],
    1,
  );
  const perf = await askChoice(
    'Performance requirements',
    [
      'None specified',
      'Response SLA < 500ms (P95)',
      'Response SLA < 200ms (P95)',
      'Throughput > 1000 req/s',
      'Startup < 2s cold start',
      'Other',
    ],
    1,
  );
  const sec = await askChoice(
    'Security constraints',
    [
      'Never log secrets/tokens',
      'Never log secrets + enforce input validation',
      'Never log secrets + enforce auth on every endpoint',
      'Other',
    ],
    1,
  );
  const data = await askChoice(
    'Data handling rules',
    ['No PII in repo', 'No PII + data retention policy', 'No PII + GDPR compliance required', 'Other'],
    1,
  );
  const deploy = await askChoice(
    'Deployment rules',
    [
      'Tagged releases only',
      'Tagged releases + CI gate',
      'Continuous deployment (CI/CD auto)',
      'Blue-green deployments',
      'Other',
    ],
    1,
  );

  const forbiddenItems = forbidden
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((r) => `- ${r}: documented project constraint`)
    .join('\n');

  return `## Operational Rules & Constraints

### Forbidden Operations (NEVER)
${forbiddenItems || '- (none specified)'}

### Required Approvals
- ${approvals}: as defined by project process

### Performance Requirements
- ${perf}

### Security Constraints
- ${sec}

### Data Handling Rules
- ${data}

### Deployment Rules
- ${deploy}`;
}

async function moduleWorkflow(yes) {
  if (yes) return DEFAULTS.workflow;
  console.log('\n=== Module 4: Workflow & Process Definition ===');
  const branching = await askChoice(
    'Branching model',
    ['Git Flow', 'GitHub Flow', 'GitLab Flow', 'Trunk-Based Development', 'Other'],
    1,
  );
  const commit = await askChoice(
    'Commit message format',
    ['Conventional Commits', 'Angular Convention', 'Custom', 'Other'],
    1,
  );
  const versioning = await askChoice(
    'Versioning scheme',
    ['Semantic Versioning (SemVer)', 'CalVer', 'ZeroVer', 'Custom', 'Other'],
    1,
  );
  const reviewers = await askChoice('Minimum required reviewers', ['1', '2', '3', 'Other'], 1);
  const issues = await askChoice(
    'Issue / Task tracking tool',
    ['GitHub Issues', 'GitLab Issues', 'Jira', 'Linear', 'Trello', 'Notion', 'Other'],
    1,
  );
  const release = await askChoice(
    'Release / Deploy workflow',
    [
      'Hybrid (CI build + manual tag)',
      'Fully automated (CI/CD)',
      'Manual (tag + deploy)',
      'GitOps (ArgoCD / Flux)',
      'Other',
    ],
    1,
  );
  const comms = await askChoice(
    'Decision communication channel',
    ['GitHub Discussions', 'Slack', 'Discord', 'ADR (docs/adr/)', 'Email', 'Other'],
    1,
  );
  return `## Workflow & Process Definition

### Version Control Strategy
- **Branching Model**: ${branching} - project branching strategy
- **Commit Message Format**: ${commit} - standardized format
- **Versioning Scheme**: ${versioning}

### Code Review Process
- **Minimum Reviewers**: ${reviewers}
- **Approval Requirements**: At least ${reviewers} approval(s)
- **Review Timeline**: Per project SLA
- **Automated Checks**: CI validation + tests required

### Issue & Task Management
- **Tool**: ${issues}
- **Issue Labeling**: feature / bug / refactor / security / docs
- **Task Assignment**: Assignee on issue

### Release & Deployment Workflow
- **Deployment Frequency**: Per release schedule
- **Release Process**: ${release}
- **Rollback Procedure**: Manual revert of tagged commit
- **Canary/Staged Deployment**: Per project decision

### Decision Making & Communication
- **Decision Documentation**: ADRs / ${comms}
- **Architecture Review**: Required for contract changes
- **Communication Channels**: ${comms}

### Team Synchronization
- **Standup Cadence**: Per team
- **Team Review Meetings**: Per team`;
}

async function moduleDocs(yes) {
  if (yes) return DEFAULTS.docs;
  console.log('\n=== Module 5: Documentation Requirements ===');
  const scope = await askChoice(
    'What must be documented?',
    [
      'Architecture + API',
      'Architecture + API + Deployment runbooks',
      'Everything (Architecture + API + Runbooks + User guides)',
      'Other',
    ],
    2,
  );
  const fmt = await askChoice(
    'Documentation format / tools',
    ['Markdown in repo', 'Markdown + Confluence', 'OpenAPI + Markdown', 'Storybook + Markdown', 'Other'],
    1,
  );
  const review = await askChoice(
    'Documentation review process',
    ['In code review', 'Separate documentation review', 'In code review + automated docs check', 'Other'],
    1,
  );
  const api = await askChoice(
    'API documentation standard',
    ['JSDoc / TypeScript (TSDoc)', 'OpenAPI / Swagger', 'Sphinx (Python)', 'XML Docs (.NET)', 'None', 'Other'],
    1,
  );
  const readme = await askChoice('Mandatory README per module?', ['yes', 'no'], 1);

  return `## Documentation Requirements

### Documentation Scope & Coverage
- **Architecture**: Required - ${scope}
- **API Specifications**: Required - ${api}
- **Deployment Guides**: Required - README + per-platform docs
- **Operational Runbooks**: Optional
- **Module READMEs**: ${readme === 'no' ? 'Optional' : 'Required sections'}

### Documentation Tools & Format
- **Primary Format**: ${fmt}
- **Location**: Repository
- **Version Control**: In-repo
- **Tool Stack**: Markdown + ${api}

### Documentation Standards
- **Code Comments**: Mandatory for public APIs
- **Change Logs**: Required - CHANGELOG.md
- **Deprecation Notice**: 1 release notice before removal
- **Migration Guides**: Required for breaking changes

### Documentation Review
- **Included in Code Review**: ${review.includes('separate') ? 'No' : 'Yes'}
- **Separate Review Process**: ${review.includes('separate') ? 'Yes' : 'No'}
- **Approval Required**: Yes (maintainer)`;
}

// ── Strict integer prompt (spec §6.2) ──
// ADR-004: strict /^\d+$/ parse + range. On invalid input warn, retry at most
// once, then fall back to the DEFAULTS value (never hang piped CI input).
// Returns the accepted value and appends a fallback note to changes.
// brief() is module-scope (also used by validateConfig diagnostics): 4 chars
// so even a short pasted secret is not echoed verbatim into logs/audit.
const brief = (s) => (s ? String(s).slice(0, 4) + '…' : '(empty)');

async function askInt(prompt, def, min, max, changes) {
  let raw = await ask(`${prompt} (${min}-${max})`, String(def));
  const parse = (s) => (/^\d+$/.test(s) ? Number(s) : NaN);
  if (!Number.isNaN(parse(raw)) && parse(raw) >= min && parse(raw) <= max) return parse(raw);
  console.log(`  ⚠ Invalid integer "${brief(raw)}" — expected ${min}-${max}. Retrying once...`);
  raw = await ask(`${prompt} (${min}-${max})`, String(def));
  if (!Number.isNaN(parse(raw)) && parse(raw) >= min && parse(raw) <= max) return parse(raw);
  changes.push(`${prompt} fell back to default ${def} (invalid input "${brief(raw)}")`);
  return def;
}

// ── Spec modules (Blocks A/B/C) ──
// Each returns a structured object (data.spec.*). Validation of types, ranges
// and enums is performed again in validateConfig as the final gate.

// Block A — Context Spec (spec §3.2)
async function moduleContext(yes, stackBody) {
  const def = DEFAULTS.spec.context;

  // Derive exact tech stack from Module 1 answers — avoids double-asking and
  // guarantees coherence between the two sections. Runs in --yes mode too.
  const extract = (section, pattern) => {
    const m = (section || '').match(new RegExp(pattern));
    return m ? m[1].trim() : '-';
  };
  const exactTechStack =
    [
      extract(stackBody, /Languages\*\*:\s*([^\n]*)/),
      extract(stackBody, /Web Framework\*\*:\s*([^\n]*)/),
      extract(stackBody, /Database\(s\)\*\*:\s*([^\n]*)/),
    ]
      .filter((v) => v && v !== '-')
      .join(' / ') || def.exactTechStack;

  if (yes) return { ...def, exactTechStack };
  console.log('\n=== Module 6: Context Spec ===');

  const technicalDescription =
    (await ask('Technical description (one line)', def.technicalDescription)).trim() || def.technicalDescription;

  const domainRestrictions =
    (await ask('Domain restrictions (comma separated, blank = none)', def.domainRestrictions)).trim() ||
    def.domainRestrictions;

  const defaultLanguage = await askChoice(
    'Default language for agent output',
    ['English', 'Spanish', 'French', 'German', 'Japanese', 'Other'],
    1,
  );

  return { technicalDescription, exactTechStack, domainRestrictions, defaultLanguage };
}

// Block B — Guardrails Spec (spec §3.3)
async function moduleGuardrails(yes) {
  const def = DEFAULTS.spec.guardrails;
  if (yes) return { ...def };
  console.log('\n=== Module 7: Guardrails Spec ===');
  const changes = [];

  const tokenBudgetPerCall = await askInt('Token budget per agent call', def.tokenBudgetPerCall, 1000, 64000, changes);
  const tokenBudgetPerSession = await askInt(
    'Token budget per pipeline session',
    def.tokenBudgetPerSession,
    tokenBudgetPerCall,
    512000,
    changes,
  );
  const dlpMode = await askChoice('DLP mode for secrets', ['redact', 'scan'], 1);
  const antiInjection = (await askChoice('Anti-injection sanitization', ['true', 'false'], 1)) === 'true';
  const maxIterations = await askInt('Max iterations per pipeline', def.maxIterations, 1, 20, changes);

  for (const c of changes) console.log(`  • ${c}`);
  return { tokenBudgetPerCall, tokenBudgetPerSession, dlpMode, antiInjection, maxIterations };
}

// Block C — Output Format Spec (spec §3.4)
async function moduleOutputFormat(yes) {
  const def = DEFAULTS.spec.output;
  if (yes) return { ...def };
  console.log('\n=== Module 8: Output Format Spec ===');
  const outputSchema = await askChoice('Output schema for system responses', ['structured markdown', 'json'], 1);
  const verbosity = await askChoice('Verbosity level', ['minimal', 'standard', 'detailed'], 1);
  const latexHandling = await askChoice('LaTeX / math notation handling', ['allow', 'escape'], 1);
  return { outputSchema, verbosity, latexHandling };
}

// ── Spec render helpers (deterministic, high-density markdown) ──
// No user text is echoed unsanitized: securityPass has already scrubbed the
// values before rendering.
function mdCell(v) {
  const s = String(v ?? '-')
    .replace(/\r/g, ' ') // CR is a CommonMark line terminator — would break table rows
    .replace(/\n/g, ' ')
    .replace(/[|]/g, '\\|')
    .replace(/[<]/g, '&lt;')
    .replace(/[>]/g, '&gt;')
    .replace(/`/g, '\\`');
  return s || '-';
}

export function renderContextSpec(ctx = {}) {
  const d = DEFAULTS.spec.context;
  const c = { ...d, ...ctx };
  return `| Field | Value |
|---|---|
| Technical Description | ${mdCell(c.technicalDescription)} |
| Exact Tech Stack | ${mdCell(c.exactTechStack)} |
| Domain Restrictions | ${mdCell(c.domainRestrictions)} |
| Default Language | ${mdCell(c.defaultLanguage)} |`;
}

export function renderGuardrailsSpec(g = {}) {
  const d = DEFAULTS.spec.guardrails;
  const gr = { ...d, ...g };
  return `| Guardrail | Value |
|---|---|
| Token Budget (per call) | ${gr.tokenBudgetPerCall} |
| Token Budget (per session) | ${gr.tokenBudgetPerSession} |
| DLP Mode (secrets) | ${gr.dlpMode} |
| Anti-Injection Sanitize | ${gr.antiInjection ? 'true' : 'false'} |
| Max Iterations | ${gr.maxIterations} |
| Secrets | Environment variable placeholders only — never stored in this file (\$VAR_NAME) |`;
}

export function renderOutputFormatSpec(o = {}) {
  const d = DEFAULTS.spec.output;
  const op = { ...d, ...o };
  return `| Output Control | Value |
|---|---|
| Output Schema | ${mdCell(op.outputSchema)} |
| Verbosity | ${mdCell(op.verbosity)} |
| LaTeX / Code Handling | ${mdCell(op.latexHandling)} |`;
}

// ── Sanitization & Coherence Layer (spec §2, §3) ──
// Gatekeeper that runs AFTER the 8-module questionnaire and BEFORE rendering.
// Four stages (spec §3 pipeline):
//   1. Structural  — dedupe markdown headers, drop empty list items
//   2. Technical   — Python standards, framework mutex resolution
//   3. Security    — prompt-injection scrub + secret → $ENV placeholder (Block A/B)
//   4. Syntax Guard— empty/placeholder cleanup, typo correction
// Returns { data, changes } where changes is a human-readable changelog.

// Keyword sets (spec §2.2)
const PY_FRAMEWORKS = ['fastapi', 'flask', 'django'];
const NODE_FRAMEWORKS = ['express', 'nestjs', 'fastify'];

function lowerList(s) {
  return String(s || '')
    .split(/[,\n|]/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

// ── Secret → env placeholder mapping (spec §4: never store secrets) ──
// High/critical-confidence patterns only. DEFAULTS and template literals are
// trusted and never scanned; only user-originated free text is processed.
const SECRET_PLACEHOLDERS = {
  'openai-api-key': 'OPENAI_API_KEY',
  'anthropic-api-key': 'ANTHROPIC_API_KEY',
  'github-token': 'GITHUB_TOKEN',
  'github-oauth-token': 'GITHUB_TOKEN',
  'github-user-token': 'GITHUB_TOKEN',
  'slack-token': 'SLACK_TOKEN',
  'aws-access-key': 'AWS_ACCESS_KEY_ID',
  'private-key': 'PRIVATE_KEY',
  'jwt-token': 'JWT_SECRET',
  'database-connection-string': 'DATABASE_URL',
  'message-broker-connection': 'BROKER_URL',
  certificate: 'CERTIFICATE',
  'credential-assignment': 'SECRET',
  'high-entropy-token': 'TOKEN',
};

export function secretPlaceholder(type) {
  return `$${SECRET_PLACEHOLDERS[type] || 'SECRET'}`;
}

// Stage 3: security — prompt-injection scrub + secret redaction.
// Runs on ALL user-originated free text (project name, spec fields, legacy
// markdown bodies that may carry custom "Other" answers). Injection hits become
// "[blocked: <category>]" (whole line for short lines, phrase otherwise);
// secrets become "$ENV_PLACEHOLDER". Never echoes the raw value.
// Complexity is $O(n·p)$ (n = text length, p = pattern count); inputs longer
// than 1 MB are skipped with a note (ReDoS guard).
const MAX_SCAN_LENGTH = 1_000_000;
const MAX_LINE_BLOCK = 200; // whole-line blocking below this line length

function classifyInjectionTag(tag) {
  const t = tag.toLowerCase();
  if (t.includes('system prompt')) return 'system-override';
  if (t.includes('you are') || t.includes('act as') || t.includes('pretend') || t.includes('from now on'))
    return 'role-play';
  if (t.includes('run the following') || t.includes('execute the following')) return 'exec-injection';
  if (
    t.includes('print') ||
    t.includes('reveal') ||
    t.includes('show') ||
    t.includes('repeat') ||
    t.includes('what is')
  ) {
    return 'prompt-extraction';
  }
  return 'instruction-override';
}

function securityPass(data, changes) {
  const scanFields = [
    ['projectName', data.projectName],
    ['spec.context.technicalDescription', data.spec?.context?.technicalDescription],
    ['spec.context.domainRestrictions', data.spec?.context?.domainRestrictions],
    ['spec.context.exactTechStack', data.spec?.context?.exactTechStack],
    ['spec.context.defaultLanguage', data.spec?.context?.defaultLanguage],
    ['stack', data.stack],
    ['conventions', data.conventions],
    ['rules', data.rules],
    ['workflow', data.workflow],
    ['docs', data.docs],
  ];

  for (const [key, value] of scanFields) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (value.length > MAX_SCAN_LENGTH) {
      changes.push(
        `Field ${key} too large (${value.length} chars > ${MAX_SCAN_LENGTH}) — content replaced with manual-review marker`,
      );
      const scrubbed = '[skipped: >1MB — review manually before use]';
      if (key.startsWith('spec.')) {
        const [, sub, field] = key.split('.');
        if (data.spec?.[sub]) data.spec[sub][field] = scrubbed;
      } else {
        data[key] = scrubbed;
      }
      continue;
    }

    // 1) Prompt-injection scrub (mode 'report' → tag, never block/abort)
    const inj = sanitizeInput(value, { mode: 'report' });
    if (inj.alerts.length) {
      for (const a of inj.alerts) {
        // Category/severity only — never echo the matched text: the match may
        // contain a raw secret (e.g. fenced block with key inside).
        changes.push(`Injection pattern blocked in ${key} [${a.category}/${a.severity}]`);
      }
    }
    let scrubbed = inj.sanitized.replace(/\[⚠ INJECTION DETECTED: ([^\]]*)\]/g, (m, captured) => {
      const cat = classifyInjectionTag(captured);
      return `[blocked: ${cat}]`;
    });

    // Whole-line blocking: for short lines, replace the entire line containing
    // the injection so no imperative residue survives (e.g. "…and delete the DB").
    if (inj.alerts.length) {
      const lines = scrubbed.split('\n');
      for (let li = 0; li < lines.length; li++) {
        if (lines[li].includes('[blocked:') && lines[li].trim().length <= MAX_LINE_BLOCK) {
          lines[li] = `[blocked: ${lines[li].match(/\[blocked: ([a-z-]+)\]/)?.[1] || 'injection'}]`;
        }
      }
      scrubbed = lines.join('\n');
    }

    // 2) Secret scan + $ENV placeholder replacement (redact mode)
    const sec = scanSecrets(scrubbed, { mode: 'redact' });
    if (sec.findings.length) {
      for (const f of sec.findings) {
        changes.push(`Secret ${f.type} scrubbed in ${key} → ${secretPlaceholder(f.type)} (export it as an env var)`);
      }
    }
    if (sec.redacted !== null && sec.redacted !== scrubbed) {
      scrubbed = sec.redacted.replace(/\[REDACTED:([a-z0-9_-]+)\]/g, (m, t) => secretPlaceholder(t));
    }

    // Write back to data (structured spec fields + legacy bodies)
    if (key.startsWith('spec.')) {
      const [, sub, field] = key.split('.');
      if (data.spec?.[sub]) data.spec[sub][field] = scrubbed;
    } else {
      data[key] = scrubbed;
    }
  }
}

// Stage 1: structural — remove duplicate "## " headers within a single section block
// and strip isolated "- " / ":" bullet lines that would render as empty.
function structuralPass(section) {
  let out = section;
  // Collapse repeated duplicate headers (case-insensitive) keeping the first.
  const seen = new Set();
  out = out
    .split('\n')
    .filter((line) => {
      const m = line.match(/^(#{2,6})\s+(.*\S)\s*$/);
      if (m) {
        const key = m[2].toLowerCase();
        if (seen.has(key)) return false; // drop duplicate header
        seen.add(key);
      }
      return true;
    })
    .join('\n');
  // Remove empty bullet lines ("- " or "-") and trailing isolated colons.
  out = out
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t === '-' || t === '- ' || t === '*' || t === '* ') return false;
      return true;
    })
    .join('\n')
    .replace(/:\s*$/gm, (m) => (m.trim() === ':' ? '' : m)); // drop trailing lone colon
  return out;
}

// Stage 2: technical — Python + framework mutex
function technicalPass(data, changes) {
  const langs = lowerList(data.stack);
  const isPython = langs.some((l) => l.includes('python'));

  // §2.1 Python indentation override
  if (isPython) {
    const indentMatch = data.conventions.match(/\*\*Indentation\*\*:([^\n]*)/);
    if (indentMatch) {
      const cur = indentMatch[1].trim();
      if (!/4\s*spaces/.test(cur)) {
        // Scrub the quoted value before it reaches the generated doc / audit
        // log (technicalPass runs BEFORE securityPass, so secrets may be raw).
        const safeCur = (scanSecrets(cur, { mode: 'redact' }).redacted ?? cur)
          .replace(/\[REDACTED:([a-z0-9_-]+)\]/g, (m, t) => secretPlaceholder(t))
          .slice(0, 40);
        data.conventions = data.conventions.replace(
          /\*\*Indentation\*\*:[^\n]*/,
          '**Indentation**: 4 spaces - PEP 8 (overridden from "' + safeCur + '")',
        );
        changes.push(`Indentation set to "4 spaces" (PEP 8) — Python detected, was "${safeCur}"`);
      }
    }
    // §2.1 Formatter coherence
    const fmtMatch = data.conventions.match(/\*\*Code Formatter\*\*:([^\n]*)/);
    if (fmtMatch) {
      const fmt = fmtMatch[1].toLowerCase();
      if (fmt.includes('prettier') && !fmt.includes('ruff') && !fmt.includes('black')) {
        data.conventions = data.conventions.replace(
          /\*\*Code Formatter\*\*:[^\n]*/,
          '**Code Formatter**: Ruff (with Black-compatible formatting) - Prettier lacks native Python support',
        );
        changes.push('Formatter changed to "Ruff/Black" — Prettier selected without Python plugin (Python detected)');
      }
    }
  }

  // §2.2 Framework mutex — detect competing frameworks in same runtime
  const fwText = (data.stack + ' ' + data.conventions).toLowerCase();
  const pyHits = PY_FRAMEWORKS.filter((f) => fwText.includes(f));
  const nodeHits = NODE_FRAMEWORKS.filter((f) => fwText.includes(f));

  if (pyHits.length > 1) {
    const promoted = 'FastAPI'; // modern async standard (spec §3.1)
    data.stack = data.stack.replace(
      /(Web Framework[^*]*:\s*)([^\n]*)/,
      `$1${promoted} (microservices) - mutex resolved: detected ${pyHits.join(' + ')}`,
    );
    changes.push(
      `Framework mutex resolved: ${pyHits.join(' + ')} → promoted "${promoted}" (spec §2.2). Clarify if they are separate microservices.`,
    );
  }
  if (nodeHits.length > 1) {
    const promoted = 'Express';
    data.stack = data.stack.replace(
      /(Web Framework[^*]*:\s*)([^\n]*)/,
      `$1${promoted} - mutex resolved: detected ${nodeHits.join(' + ')}`,
    );
    changes.push(
      `Framework mutex resolved: ${nodeHits.join(' + ')} → promoted "${promoted}" (spec §2.2). Clarify if they are separate services.`,
    );
  }
  return isPython;
}

// Stage 3: syntax guard — empty/placeholder → N/A, typo correction
function syntaxPass(data, changes) {
  const EMPTY = ['', '-', ':', 'n/a', 'na', '.'];
  // Typo map (spec §4)
  const TYPOS = [
    [/Convetional\s+commits/gi, 'Conventional Commits'],
    [/Conventional\s+commit\b/gi, 'Conventional Commits'],
    [/git\s*flow\b/gi, 'Git Flow'],
  ];

  for (const key of ['stack', 'conventions', 'rules', 'workflow', 'docs']) {
    let txt = data[key];
    // typo correction
    for (const [re, rep] of TYPOS) {
      if (re.test(txt)) {
        txt = txt.replace(re, rep);
        changes.push(`Typo corrected in ${key} → "${rep}"`);
      }
    }
    // Empty sub-bullets / placeholder values
    const lines = txt.split('\n').map((l) => {
      // bullet with empty/placeholder content
      const bm = l.match(/^(\s*[-*]\s+)(.*)$/);
      if (bm && EMPTY.includes(bm[2].trim().toLowerCase())) {
        return l.replace(/[-*]\s+.*$/, `- N/A (Not Applicable yet)`);
      }
      // "**Key**:" with empty value
      const km = l.match(/^(\*\*[^*]+\*\*:\s*)(.*)$/);
      if (km && EMPTY.includes(km[2].trim().toLowerCase())) {
        return l.replace(/:\s*.*$/, ': N/A (Not Applicable yet)');
      }
      return l;
    });
    data[key] = lines.join('\n');
  }
}

// Orchestrator entry
// ── Project description summary ──
function projectSummary(data) {
  // Extract key facts from each section
  const extract = (section, pattern) => {
    const m = section.match(new RegExp(pattern));
    return m ? m[1].trim() : '-';
  };
  const langs = extract(data.stack, /Languages\*\*:\s*([^\n]*)/);
  const framework = extract(data.stack, /Web Framework\*\*:\s*([^\n]*)/);
  const db = extract(data.stack, /Database\(s\)\*\*:\s*([^\n]*)/);
  const arch = extract(data.stack, /Architecture Pattern\*\*:\s*([^\n]*)/);
  const test = extract(data.stack, /Testing Framework\*\*:\s*([^\n]*)/);
  const devops = extract(data.stack, /DevOps & Deployment\*\*:\s*([^\n]*)/);
  const naming = extract(data.conventions, /Variable Naming\*\*:\s*([^\n]*)/);
  const formatter = extract(data.conventions, /Code Formatter\*\*:\s*([^\n]*)/);
  const indent = extract(data.conventions, /Indentation\*\*:\s*([^\n]*)/);
  const branching = extract(data.workflow, /Branching Model\*\*:\s*([^\n]*)/);
  const docScope = extract(data.docs, /Architecture\*\*:\s*Required\s*-\s*([^\n]*)/);

  console.log('\n' + '='.repeat(56));
  console.log('  PROJECT CONFIGURATION SUMMARY');
  console.log('='.repeat(56));
  console.log(`  Project         : ${data.projectName}`);
  console.log(`  Language        : ${langs}`);
  console.log(`  Framework       : ${framework}`);
  console.log(`  Database        : ${db}`);
  console.log(`  Architecture    : ${arch}`);
  console.log(`  Testing         : ${test}`);
  console.log(`  DevOps          : ${devops}`);
  console.log(`  Naming          : ${naming}`);
  console.log(`  Formatter       : ${formatter}`);
  console.log(`  Indentation     : ${indent}`);
  console.log(`  Branching       : ${branching}`);
  console.log(`  Documentation   : ${docScope}`);
  console.log('='.repeat(56));
}

export function sanitize(data) {
  const changes = [];
  // Stage 1 — structural dedupe on every section
  for (const key of ['stack', 'conventions', 'rules', 'workflow', 'docs']) {
    data[key] = structuralPass(data[key]);
  }
  // Stage 2 — technical
  const isPython = technicalPass(data, changes);
  // Stage 3 — security (injection + secrets) — runs before syntax guard so
  // scrubbed markers are preserved, and after technical so framework mutex
  // messages (which quote user text) are themselves sanitized downstream.
  securityPass(data, changes);
  // Stage 4 — syntax guard
  syntaxPass(data, changes);
  // Re-run only the redaction pass after syntax rewrites, so any secret that
  // reached the final text is never emitted raw.
  for (const [key, value] of [
    ['projectName', data.projectName],
    ['stack', data.stack],
    ['conventions', data.conventions],
    ['rules', data.rules],
    ['workflow', data.workflow],
    ['docs', data.docs],
  ]) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (value.length > MAX_SCAN_LENGTH) continue; // securityPass already handled the cap note
    const sec = scanSecrets(value, { mode: 'redact' });
    if (sec.findings.length) {
      for (const f of sec.findings) {
        changes.push(`Secret ${f.type} scrubbed post-syntax in ${key} → ${secretPlaceholder(f.type)}`);
      }
      const scrubbed = sec.redacted.replace(/\[REDACTED:([a-z0-9_-]+)\]/g, (m, t) => secretPlaceholder(t));
      if (key === 'projectName') data.projectName = scrubbed;
      else data[key] = scrubbed;
    }
  }
  return { data, changes, isPython };
}

// ── Render ──
// Each data section carries its own "## Header" (from the questionnaire modules).
// The template ALSO declares that header, so we strip the leading "## X" from each
// section block to avoid duplicate headers in the final document (spec §3 stage 1).
export function stripLeadingHeader(section) {
  return section.replace(/^\s*##\s+.*\n/, '');
}

function renderConfig(tpl, data) {
  return (
    tpl
      .replace(/\{project_name\}/g, data.projectName)
      .replace(/\{version\}/g, data.version)
      .replace(/\{created\}/g, data.created)
      .replace(/\{stack\}/g, stripLeadingHeader(data.stack))
      .replace(/\{conventions\}/g, stripLeadingHeader(data.conventions))
      .replace(/\{rules\}/g, stripLeadingHeader(data.rules))
      .replace(/\{workflow\}/g, stripLeadingHeader(data.workflow))
      .replace(/\{docs\}/g, stripLeadingHeader(data.docs))
      // Spec blocks (optional chaining → legacy data objects render unchanged)
      .replace(/\{context\}/g, renderContextSpec(data.spec?.context))
      .replace(/\{guardrails\}/g, renderGuardrailsSpec(data.spec?.guardrails))
      .replace(/\{output_format\}/g, renderOutputFormatSpec(data.spec?.output))
      // CR normalization (defense-in-depth — legacy bodies may embed CR).
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  );
}

function renderAnex(tpl, data) {
  return (
    tpl
      .replace(/\{project_name\}/g, data.projectName)
      .replace(/\{version\}/g, data.version)
      .replace(/\{created\}/g, data.created)
      .replace(/\{base_version\}/g, data.baseVersion)
      .replace(/\{ext_scope\}/g, data.extScope)
      .replace(/\{stack\}/g, stripLeadingHeader(data.stack))
      .replace(/\{conventions\}/g, stripLeadingHeader(data.conventions))
      .replace(/\{rules\}/g, stripLeadingHeader(data.rules))
      .replace(/\{workflow\}/g, stripLeadingHeader(data.workflow))
      .replace(/\{docs\}/g, stripLeadingHeader(data.docs))
      .replace(/\{context\}/g, renderContextSpec(data.spec?.context))
      .replace(/\{guardrails\}/g, renderGuardrailsSpec(data.spec?.guardrails))
      .replace(/\{output_format\}/g, renderOutputFormatSpec(data.spec?.output))
      // CR normalization (defense-in-depth — legacy bodies may embed CR).
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
  );
}

// ── Validation (spec §6.2 + §5 checklist) ─

/**
 * Post-render DLP gate. Scans rendered content for raw secrets and returns
 * formatted blocker errors (critical/high) and warning labels (medium/PII).
 * Never echoes the matched value — only type + hit count.
 * @param {string} content
 * @returns {{ blockers: string[], warnings: string[] }}
 */
export function runDlpGate(content) {
  const finalScan = scanSecrets(content, { mode: 'scan' });
  const blockers = [];
  const warnings = [];
  const hitsByType = (type) => finalScan.findings.filter((f) => f.type === type).length;
  for (const type of [
    ...new Set(finalScan.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').map((f) => f.type)),
  ]) {
    blockers.push(`DLP: raw ${type} found in rendered content — refusing to write (${hitsByType(type)} hit(s))`);
  }
  for (const type of [...new Set(finalScan.findings.filter((f) => f.severity === 'medium').map((f) => f.type))]) {
    warnings.push(type);
  }
  return { blockers, warnings };
}

export function validateConfig(content, which, data = {}) {
  const errors = [];
  if (which === 'config') {
    const required = [
      '## Technology Stack',
      '## Context Spec',
      '## Code Conventions & Standards',
      '## Operational Rules & Constraints',
      '## Guardrails Spec',
      '## Workflow & Process Definition',
      '## Documentation Requirements',
      '## Output Format Spec',
      '## Agent Responsibilities',
    ];
    for (const r of required) if (!content.includes(r)) errors.push(`Missing section: ${r}`);
    if (!/Version\*\*:\s*v?\d+\.\d+/.test(content)) errors.push('Missing version information');
    if (!/Created\*\*:\s*\S+/.test(content)) errors.push('Missing creation timestamp');

    // §5 Structural — no duplicate "## " headers (each must appear once)
    const headers = (content.match(/^##\s+(.+)$/gm) || []).map((h) => h.toLowerCase().trim());
    const uniqueHeaders = new Set(headers);
    if (headers.length !== uniqueHeaders.size) {
      errors.push(`Duplicate "## " headers detected (found ${headers.length}, unique ${uniqueHeaders.size})`);
    }

    // §5 Indent alignment — if Python, indentation must be 4 spaces
    const langs = lowerList(data.stack || '');
    const isPython = langs.some((l) => l.includes('python'));
    if (isPython && !/Indentation\*\*:\s*4 spaces/.test(data.conventions || '')) {
      errors.push('Python detected but indentation is not "4 spaces" (spec §2.1)');
    }

    // §5 Conflict resolution — no competing frameworks in same runtime
    const fwText = ((data.stack || '') + ' ' + (data.conventions || '')).toLowerCase();
    const pyHits = PY_FRAMEWORKS.filter((f) => fwText.includes(f));
    const nodeHits = NODE_FRAMEWORKS.filter((f) => fwText.includes(f));
    if (pyHits.length > 1) errors.push(`Competing Python frameworks unresolved: ${pyHits.join(', ')}`);
    if (nodeHits.length > 1) errors.push(`Competing Node frameworks unresolved: ${nodeHits.join(', ')}`);

    // §5 No placeholders — zero empty "- " or ":" lines
    if (/^\s*[-*]\s*$/m.test(content) || /^\s*:\s*$/m.test(content)) {
      errors.push('Empty bullet/colon placeholder found (spec §2.3)');
    }
  } else {
    if (!/\*\*Extends\*\*:\s*AGENTS\.md \(v/.test(content)) errors.push('Missing reference to base AGENTS.md version');
    if (!/Load Order for Agents/.test(content)) errors.push('Missing load order instructions');
    if (!/Conflict Resolution/.test(content)) errors.push('Missing conflict resolution guidelines');
    // Mandatory precedence clause (spec §5.1)
    if (!content.includes('Conflicts resolve in favor of AGENTS_ANEX.md')) {
      errors.push(
        'Missing precedence clause: "This annex extends AGENTS.md. Conflicts resolve in favor of AGENTS_ANEX.md"',
      );
    }
    const requiredAnex = [
      '## Supplementary Context Spec',
      '## Supplementary Guardrails Spec',
      '## Supplementary Output Format Spec',
    ];
    for (const r of requiredAnex) if (!content.includes(r)) errors.push(`Missing annex section: ${r}`);
  }

  // §6.2 Spec validation — strict types, ranges and enums (Blocks A/B/C).
  // Shared by both scenarios. Guarded with optional chaining so legacy data
  // objects (without data.spec) are skipped.
  const spec = data.spec;
  if (spec) {
    const g = spec.guardrails || {};
    if (!Number.isInteger(g.tokenBudgetPerCall) || g.tokenBudgetPerCall < 1000 || g.tokenBudgetPerCall > 64000) {
      errors.push(`Guardrails: tokenBudgetPerCall must be an integer 1000-64000, got "${g.tokenBudgetPerCall}"`);
    }
    if (
      !Number.isInteger(g.tokenBudgetPerSession) ||
      g.tokenBudgetPerSession < (g.tokenBudgetPerCall || 0) ||
      g.tokenBudgetPerSession > 512000
    ) {
      errors.push(
        `Guardrails: tokenBudgetPerSession must be an integer >= per-call budget (1000-512000), got "${g.tokenBudgetPerSession}"`,
      );
    }
    if (!Number.isInteger(g.maxIterations) || g.maxIterations < 1 || g.maxIterations > 20) {
      errors.push(`Guardrails: maxIterations must be an integer 1-20, got "${g.maxIterations}"`);
    }
    if (!['scan', 'redact'].includes(g.dlpMode))
      errors.push(`Guardrails: dlpMode must be scan|redact, got "${brief(g.dlpMode)}"`);
    if (typeof g.antiInjection !== 'boolean')
      errors.push(`Guardrails: antiInjection must be boolean, got "${g.antiInjection}"`);

    const o = spec.output || {};
    if (!['structured markdown', 'json'].includes(o.outputSchema)) {
      errors.push(`Output Format: outputSchema must be "structured markdown"|"json", got "${brief(o.outputSchema)}"`);
    }
    if (!['minimal', 'standard', 'detailed'].includes(o.verbosity)) {
      errors.push(`Output Format: verbosity must be minimal|standard|detailed, got "${brief(o.verbosity)}"`);
    }
    if (!['allow', 'escape'].includes(o.latexHandling)) {
      errors.push(`Output Format: latexHandling must be allow|escape, got "${brief(o.latexHandling)}"`);
    }

    const c = spec.context || {};
    if (!c.defaultLanguage || typeof c.defaultLanguage !== 'string') {
      errors.push('Context Spec: defaultLanguage must be a non-empty string');
    }

    // §5 Residue — no unsanitized injection/secret markers may reach disk
    if (/\[⚠ INJECTION DETECTED/.test(content)) errors.push('Residue: unsanitized injection marker found in content');
    if (/\[REDACTED:[a-z0-9_-]+\]/.test(content))
      errors.push('Residue: unsanitized [REDACTED:...] marker found in content');
  }
  return errors;
}

// ── Main generator (importable) ──
export async function generateAgentsConfig({ outDir = cwd(), yes = false, rl = null, ask: askFn = null } = {}) {
  bindReadline(rl && askFn ? { rl, ask: askFn } : null);
  const target = resolve(outDir);
  mkdirSync(target, { recursive: true });

  const agentsMd = join(target, 'AGENTS.md');
  const exists = existsSync(agentsMd);

  // §2.1 Scenario A vs B
  const created = nowStamp();
  const data = {
    projectName: 'Project',
    version: 'v1.0',
    created,
    baseVersion: '1.0',
    extScope: 'Project-specific enhancements to base AGENTS.md',
    stack: '',
    conventions: '',
    rules: '',
    workflow: '',
    docs: '',
    spec: {
      context: { ...DEFAULTS.spec.context },
      guardrails: { ...DEFAULTS.spec.guardrails },
      output: { ...DEFAULTS.spec.output },
    },
  };

  // Gather project name once
  if (!yes) {
    console.log('\n=== AGENTS Configuration Framework ===');
    const scenarioLabel = exists ? 'AGENTS_ANEX.md' : 'AGENTS.md';
    console.log(
      exists
        ? 'AGENTS.md found → will generate AGENTS_ANEX.md (Scenario B, spec §2.1).'
        : 'No AGENTS.md → will generate AGENTS.md (Scenario A, spec §2.1).',
    );

    // Allow skipping the entire wizard
    const createAnswer = await ask(`Create ${scenarioLabel}?`, 'Y');
    if (createAnswer.toLowerCase() === 'n' || createAnswer.toLowerCase() === 'no') {
      console.log(`Skipped. You can generate it later via \`node tools/init-agents-config.mjs\`.\n`);
      return null;
    }

    data.projectName = await ask('Project name?', 'Project');
  } else {
    data.projectName = DEFAULTS.projectName;
  }

  // §3 — eight modules (parallel-free; sequential by design in spec)
  data.stack = await moduleStack(yes);
  data.conventions = await moduleConventions(yes);
  data.rules = await moduleRules(yes);
  data.workflow = await moduleWorkflow(yes);
  data.docs = await moduleDocs(yes);

  // ── Spec blocks (A/B/C) — captured before sanitization ──
  data.spec.context = await moduleContext(yes, data.stack);
  data.spec.guardrails = await moduleGuardrails(yes);
  data.spec.output = await moduleOutputFormat(yes);

  const { changes } = sanitize(data);
  if (changes.length) {
    console.log('\n→ Sanitization applied (coherence layer):');
    for (const c of changes) console.log('  • ' + c);
  }

  // ── Project Summary ──
  if (!yes) projectSummary(data);

  let content;
  let outFile;
  let which;

  if (!exists) {
    const tpl = readFileSync(TEMPLATE_CONFIG, 'utf-8');
    content = renderConfig(tpl, data);
    outFile = agentsMd;
    which = 'config';
  } else {
    const tpl = readFileSync(TEMPLATE_ANEX, 'utf-8');
    // Best-effort base version detection
    const base = readFileSync(agentsMd, 'utf-8');
    const m = base.match(/\*\*Version\*\*:\s*v?(\d+\.\d+)/);
    data.baseVersion = m ? m[1] : '1.0';
    content = renderAnex(tpl, data);
    outFile = join(target, 'AGENTS_ANEX.md');
    which = 'anex';

    // Ensure AGENTS.md references AGENTS_ANEX.md (append if missing)
    if (!base.includes('AGENTS_ANEX.md')) {
      const ref = [
        '',
        '---',
        '',
        '## Annex Reference',
        '',
        'This project has an **AGENTS_ANEX.md** annex that extends or overrides parts of this configuration.',
        'Agents **must** load `AGENTS_ANEX.md` after this file and apply its modifications.',
        '',
        '---',
      ].join('\n');
      writeFileSync(agentsMd, base.trimEnd() + ref + '\n', 'utf-8');
      console.log('\n→ Annex reference appended to AGENTS.md');
    }
  }

  // §6.2 validation + §5 checklist
  const errors = validateConfig(content, which, data);

  // Post-render DLP gate: scan the FINAL rendered content for raw secrets
  // (belt-and-suspenders — securityPass + post-syntax re-scan already ran).
  // Abort on critical/high findings (type + count only — never echo the
  // value); medium-severity findings (PII) are warnings since they are
  // expected in legitimate documentation (emails, phones).
  const { blockers, warnings } = runDlpGate(content);
  errors.push(...blockers);
  for (const w of warnings) console.warn(`  ⚠ DLP: ${w} detected in content (medium severity — informational)`);

  if (errors.length) {
    console.error('\n✖ Validation failed:');
    for (const e of errors) console.error('  - ' + e);
    throw new Error('AGENTS config validation failed');
  }

  writeFileSync(outFile, content, 'utf-8');
  // Print a portable path — never leak absolute host paths.
  // Prefer relative-to-CWD; if outside CWD, fall back to the file basename.
  const rel = outFile === CWD ? '.' : relative(CWD, outFile);
  const portable = rel && !rel.startsWith('..') ? rel.replace(/^\//, '') : basename(outFile);
  console.log(`\n✓ ${which === 'config' ? 'AGENTS.md' : 'AGENTS_ANEX.md'} generated at ${portable}`);
  printAudit({ data, which, outFile: portable, changes, errors });
  return outFile;
}

// ── Confirmation & audit (spec §5.4) ──
// Emits a single-line machine-readable summary prefixed with AUDIT_JSON= so
// downstream tooling can extract it. All free-text values are already scrubbed
// by securityPass; secrets never appear (placeholder names only).
export function printAudit({ data, which, outFile, changes = [], errors = [] }) {
  const spec = data.spec || {};
  const audit = {
    scenario: which,
    file: outFile,
    project: data.projectName,
    context: {
      defaultLanguage: spec.context?.defaultLanguage ?? 'English',
      exactTechStack: spec.context?.exactTechStack ?? '-',
    },
    guardrails: spec.guardrails ?? null,
    output: spec.output ?? null,
    sanitization: {
      changes,
      secretPlaceholders: (changes || []).filter((c) => c.includes('→ $')),
    },
    validation: {
      ok: errors.length === 0,
      errors,
    },
  };
  console.log(`AUDIT_JSON=${JSON.stringify(audit)}`);
}

// ── CLI entry ──
async function main() {
  const o = parseArgs();
  // Standalone readline is created inside generateAgentsConfig (line ~1321)
  // when no rl/askFn is injected; no need to bind here.
  try {
    await generateAgentsConfig({ outDir: o.out, yes: o.yes });
    closeReadlineIfOwn();
  } catch (e) {
    closeReadlineIfOwn();
    console.error('\n✖ Generation failed:', e.message);
    exit(1);
  }
}

// Run only when invoked directly
if (env.STAFFFORGE_DIRECT !== 'import' && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
