/**
 * Platform compatibility filtering for canonical agents and skills.
 * Empty or missing compatible_platforms means all supported platforms.
 */

const PLATFORMS = new Set(['opencode', 'claude-code', 'cursor', 'copilot', 'aider', 'gemini-cli']);

function compatible(resource, platform) {
  const values = resource?.frontmatter?.compatible_platforms;
  if (values === undefined || (Array.isArray(values) && values.length === 0)) {
    return true;
  }
  if (!Array.isArray(values) || values.some((value) => !PLATFORMS.has(value))) {
    throw new Error(`${resource?.name || 'resource'} has invalid compatible_platforms`);
  }
  return values.includes(platform);
}

/**
 * Filter resources without mutating the caller's arrays or objects.
 * @param {{agents?: object[], skills?: object[]}} resources
 * @param {string} platform
 */
export function filterResourcesForPlatform({ agents = [], skills = [] }, platform) {
  if (!PLATFORMS.has(platform)) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return {
    agents: agents.filter((resource) => compatible(resource, platform)),
    skills: skills.filter((resource) => compatible(resource, platform)),
  };
}

export function supportsPlatform(resource, platform) {
  if (!PLATFORMS.has(platform)) {
    throw new Error(`Unknown platform: ${platform}`);
  }
  return compatible(resource, platform);
}

export function listSupportedPlatforms() {
  return [...PLATFORMS];
}
