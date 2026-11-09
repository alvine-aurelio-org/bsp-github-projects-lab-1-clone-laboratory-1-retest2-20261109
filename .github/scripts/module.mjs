import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGitHubClient } from './github-api.mjs';
import {
  MonaError,
  moduleSafe,
  validateModule,
  runModule,
} from './module-engine.mjs';

async function readBounded(path, limit) {
  let handle;
  try {
    handle = await open(path, 'r');
    const info = await handle.stat();
    moduleSafe(info.isFile() && info.size > 0 && info.size <= limit);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    moduleSafe(length > 0 && length <= limit);
    return new TextDecoder('utf-8', { fatal: true }).decode(
      buffer.subarray(0, length),
    );
  } catch {
    throw new MonaError(
      'Mona stopped: required module data or the built-in event file is missing, unsafe or too large.',
    );
  } finally {
    await handle?.close();
  }
}

async function readCallerData(root, name, limit) {
  const expected = resolve(root, name);
  let actual;
  try {
    actual = await realpath(expected);
  } catch {
    throw new MonaError(
      'Mona stopped: the caller checkout must contain its module metadata and README at the root.',
    );
  }
  moduleSafe(
    relative(root, actual) === name,
    'Mona stopped: module data must be regular files directly inside the caller checkout, not linked to another path.',
  );
  return readBounded(actual, limit);
}

export async function main(env = process.env) {
  moduleSafe(
    Number(process.versions.node.split('.')[0]) >= 22,
    'Mona modules require Node.js 22 or newer.',
  );
  const requested = env.MODULE_ROOT ?? process.cwd();
  moduleSafe(
    typeof requested === 'string' && isAbsolute(requested),
    'Mona stopped: MODULE_ROOT must be the absolute caller checkout directory.',
  );
  let root;
  try {
    root = await realpath(requested);
    moduleSafe((await stat(root)).isDirectory());
  } catch {
    throw new MonaError(
      'Mona stopped: the caller checkout directory is unavailable.',
    );
  }
  const metadata = await readCallerData(root, 'workshop.json', 64_000);
  let module;
  try {
    module = JSON.parse(metadata);
  } catch {
    throw new MonaError(
      'Mona stopped: the caller module metadata is not valid JSON.',
    );
  }
  validateModule(module);
  const readme = await readCallerData(root, 'README.md', 512_000);
  moduleSafe(
    typeof env.GITHUB_EVENT_PATH === 'string' &&
      isAbsolute(env.GITHUB_EVENT_PATH),
    'Mona needs the built-in absolute workflow event path.',
  );
  const source = await readBounded(env.GITHUB_EVENT_PATH, 4 * 1024 * 1024);
  let event;
  try {
    event = JSON.parse(source);
  } catch {
    throw new MonaError(
      'Mona stopped: the built-in workflow event is not valid JSON.',
    );
  }
  moduleSafe(
    event && typeof event === 'object' && !Array.isArray(event),
    'Mona stopped: invalid built-in workflow event.',
  );
  const api = createGitHubClient({
    token: env.GH_TOKEN ?? env.GITHUB_TOKEN,
    repository: env.GITHUB_REPOSITORY,
  });
  return runModule({
    module,
    readme,
    api,
    context: {
      repository: env.GITHUB_REPOSITORY,
      actor: env.GITHUB_ACTOR,
      eventName: env.GITHUB_EVENT_NAME,
      event,
    },
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await main();
    console.log(`Mona module: ${result.status} (${result.completed}/4 steps).`);
  } catch (error) {
    console.error(
      error instanceof MonaError
        ? error.message
        : 'Mona module stopped safely. Check the caller configuration and retry; no progress was reset.',
    );
    process.exitCode = 1;
  }
}
