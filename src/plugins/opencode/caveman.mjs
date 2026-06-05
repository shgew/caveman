import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CavemanPlugin } from './plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function existingSkillsDir() {
  const candidates = [
    path.resolve(here, '..', '..', '..', 'skills'),
    path.resolve(here, '..', 'skills'),
  ];

  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

export default {
  id: 'caveman',
  server: async (input, options) => {
    const hooks = await CavemanPlugin(input, options);
    const skillsDir = existingSkillsDir();
    if (!skillsDir) return hooks;

    const originalConfig = hooks.config;
    return {
      ...hooks,
      config: async (config) => {
        await originalConfig?.(config);
        config.skills = config.skills || {};
        config.skills.paths = config.skills.paths || [];
        if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);
      },
    };
  },
};

export { CavemanPlugin };
