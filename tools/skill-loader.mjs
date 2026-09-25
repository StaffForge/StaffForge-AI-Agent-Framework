/**
 * Compatibility entry point for skill discovery.
 * The implementation lives in @staffforge/core so CLI, exporters, and SDK
 * consumers share one scoped discovery and validation path.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillRegistry, discoverSkillRoots } from '@staffforge/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

export { SkillRegistry, discoverSkillRoots };

/**
 * Return a framework-only registry by default, or all applicable scopes when a
 * workspace is provided.
 */
export function getSkillRegistry(options = null) {
  if (!options) return new SkillRegistry([{ dir: join(root, 'skills'), scope: 'framework' }]);

  return new SkillRegistry(
    discoverSkillRoots({
      frameworkDir: options.frameworkDir || root,
      frameworkSkillsDir: options.frameworkSkillsDir,
      workspaceDir: options.workspaceDir,
      homeDir: options.homeDir,
    }),
  );
}

export default getSkillRegistry;
