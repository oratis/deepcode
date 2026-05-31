// Resolve the directory of built-in skills shipped inside @deepcode/core.
// Shared by the REPL, headless mode, and `deepcode skills list`.

export async function resolveBuiltinSkillsDir(): Promise<string | undefined> {
  const { createRequire } = await import('node:module');
  const require_ = createRequire(import.meta.url);
  try {
    // Resolve any file inside the package, then walk up to find skills/.
    const corePkg = require_.resolve('@deepcode/core/package.json');
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const skillsDir = path.join(path.dirname(corePkg), 'skills');
    try {
      await fs.access(skillsDir);
      return skillsDir;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}
