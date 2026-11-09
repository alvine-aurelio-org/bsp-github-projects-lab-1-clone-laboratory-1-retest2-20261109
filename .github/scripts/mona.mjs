import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from './github-api.mjs';
import { MonaError, requireSafe, runMona, validateWorkshop } from './mona-engine.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function createLessonLoader(root = ROOT) {
  return async (file) => {
    requireSafe(/^lessons\/(?:[a-z\d_-]+\/)*[a-z\d_-]+\.md$/i.test(file ?? ''));
    try {
      const actualRoot = await realpath(root);
      const target = await realpath(resolve(actualRoot, file));
      const inside = relative(actualRoot, target);
      requireSafe(inside && !inside.startsWith('..') && !isAbsolute(inside));
      const info = await stat(target);
      requireSafe(info.isFile() && info.size > 0 && info.size <= 48_000);
      return await readFile(target, 'utf8');
    } catch {
      throw new MonaError('Mona stopped: a required lesson file is missing or unsafe. Restore the packaged guide and rerun.');
    }
  };
}

export async function main(env = process.env) {
  requireSafe(Number(process.versions.node.split('.')[0]) >= 22, 'Mona requires Node.js 22 or newer.');
  const workshop = validateWorkshop(JSON.parse(await readFile(resolve(ROOT, 'workshop.json'), 'utf8')));
  requireSafe(typeof env.GITHUB_EVENT_PATH === 'string' && env.GITHUB_EVENT_PATH.length > 0,
    'Mona needs the built-in workflow event path.');
  const info = await stat(env.GITHUB_EVENT_PATH);
  requireSafe(info.isFile() && info.size <= 4 * 1024 * 1024, 'Mona stopped: invalid workflow event file.');
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const api = createGitHubClient({ token: env.GH_TOKEN, repository: env.GITHUB_REPOSITORY });
  return runMona({
    workshop, api, loadLesson: createLessonLoader(),
    context: { repository: env.GITHUB_REPOSITORY, actor: env.GITHUB_ACTOR, eventName: env.GITHUB_EVENT_NAME, event },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    console.log(`Mona: ${result.status}${result.completed === undefined ? '' : ` (${result.completed}/12 lessons)`}.`);
  } catch (error) {
    console.error(error instanceof MonaError ? error.message : 'Mona stopped safely. Check the packaged configuration/event and retry; no progress was reset.');
    process.exitCode = 1;
  }
}
