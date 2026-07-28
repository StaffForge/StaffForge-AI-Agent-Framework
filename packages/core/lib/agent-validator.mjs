// packages/core/lib/agent-validator.mjs

import { readFile } from 'fs/promises';
import { join } from 'path';

const AGENT_SCHEMA = {
  required: ['id', 'name', 'mode', 'category', 'description', 'tools', 'capabilities', 'keywords'],
  properties: {
    id: { type: 'string', pattern: '^[a-z0-9-]+$' },
    name: { type: 'string' },
    mode: { type: 'string', enum: ['primary', 'secondary', 'utility'] },
    category: { type: 'string' },
    description: { type: 'string' },
    tools: { type: 'object' },
    capabilities: { type: 'array' },
    keywords: { type: 'array', items: { type: 'string' } }
  }
};

export class AgentValidationError extends Error {
  constructor(agentName, message, missing = []) {
    super(`Agent validation failed for "${agentName}": ${message}`);
    this.name = 'AgentValidationError';
    this.agentName = agentName;
    this.missing = missing;
  }
}

export async function validateAgent(agentName, agentPath) {
  try {
    // 1. Does the file exist?
    const content = await readFile(agentPath, 'utf-8');

    // 2. Parse YAML frontmatter
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) {
      throw new AgentValidationError(
        agentName,
        'Missing YAML frontmatter',
        ['---...---']
      );
    }

    const agentSpec = parseYAML(yamlMatch[1]);

    // 3. Validate required fields
    const missing = AGENT_SCHEMA.required.filter(field => !agentSpec[field]);
    if (missing.length > 0) {
      throw new AgentValidationError(
        agentName,
        `Missing required fields: ${missing.join(', ')}`,
        missing
      );
    }

    // 4. Validate types
    for (const [field, fieldSchema] of Object.entries(AGENT_SCHEMA.properties)) {
      if (field in agentSpec) {
        if (fieldSchema.enum && !fieldSchema.enum.includes(agentSpec[field])) {
          throw new AgentValidationError(
            agentName,
            `Invalid value for "${field}": must be one of ${fieldSchema.enum.join(', ')}`
          );
        }
      }
    }

    return { valid: true, spec: agentSpec };
  } catch (error) {
    if (error instanceof AgentValidationError) {
      throw error;
    }
    throw new AgentValidationError(agentName, error.message);
  }
}

function parseYAML(content) {
  // Simplified YAML parser for frontmatter
  const lines = content.split('\n');
  const result = {};

  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      // Parse arrays: tools: {write: true, bash: true}
      if (value.startsWith('{')) {
        result[key] = {};
        // Basic object parsing
        const objMatch = value.match(/\{([^}]+)\}/);
        if (objMatch) {
          const pairs = objMatch[1].split(',').map(p => p.trim()).filter(Boolean);
          for (const pair of pairs) {
            const [k, v] = pair.split(':').map(s => s.trim());
            result[key][k] = v === 'true' ? true : v === 'false' ? false : v;
          }
        }
      } else if (value.startsWith('[')) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value.replace(/[\[\]'"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
        }
      } else if (value === 'true' || value === 'false') {
        result[key] = value === 'true';
      } else {
        result[key] = value.replace(/['"]/g, '');
      }
    }
  }

  return result;
}

export async function validateAgentRegistry(agentsPath) {
  const agents = await loadAgentsFromPath(agentsPath);
  const results = {
    valid: [],
    invalid: [],
    errors: []
  };

  for (const [name, path] of agents) {
    try {
      const validation = await validateAgent(name, path);
      results.valid.push({ name, spec: validation.spec });
    } catch (error) {
      results.invalid.push({ name, error: error.message });
      results.errors.push(error);
    }
  }

  return results;
}

async function loadAgentsFromPath(path) {
  const { readdir } = await import('fs/promises');
  const entries = [];
  try {
    const files = await readdir(path);
    for (const file of files) {
      if (file.endsWith('.md')) {
        entries.push([file.replace(/\.md$/, ''), join(path, file)]);
      }
    }
  } catch {
    // path doesn't exist
  }
  return entries;
}

export default {
  AgentValidationError,
  validateAgent,
  validateAgentRegistry,
  AGENT_SCHEMA,
  parseYAML
};
