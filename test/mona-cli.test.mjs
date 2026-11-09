import test from 'node:test';
import assert from 'node:assert/strict';
import { createLessonLoader, main } from '../.github/scripts/mona.mjs';

test('CLI is import-safe and requires built-in event context before creating an API client', async () => {
  await assert.rejects(main({}), /built-in workflow event path/);
});

test('lesson loader only accepts packaged markdown paths and safely reports missing lessons', async () => {
  const loader = createLessonLoader();
  for (const file of ['../workshop.json', '/etc/passwd', 'lessons/../../workshop.json', 'https://evil.test/a.md', 'lessons/a.md\u0000']) {
    await assert.rejects(loader(file));
  }
  await assert.rejects(loader('lessons/not-packaged.md'), /required lesson file is missing or unsafe/);
});
