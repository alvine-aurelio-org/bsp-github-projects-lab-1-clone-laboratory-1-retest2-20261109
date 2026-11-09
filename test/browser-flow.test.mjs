import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  normalizeProjectUrl,
  renderLesson,
} from '../.github/scripts/mona-core.mjs';
import { harness, WORKSHOP } from './helpers/fake-github.mjs';

test('a learner pastes only the Project address-bar link and Mona advances in the same issue', async () => {
  const h = harness();
  await h.run();
  const exercise = h.api.exercise().number;
  await h.say(
    'https://github.com/users/learner/projects/7/views/2?filterQuery=is%3Aopen#item',
  );
  assert.deepEqual(h.api.state().completed, ['1-0']);
  assert.equal(
    h.api.state().projectUrl,
    'https://github.com/users/learner/projects/7',
  );
  assert.equal(h.api.exercise().number, exercise);
  assert.equal(h.api.counts('createIssue'), 1);
  assert.equal(h.api.messages('lesson:1-1').length, 1);
  assert.equal(h.api.state().samples, null);
});

test('raw Project links keep ownership and host boundaries without fetching Projects', () => {
  for (const suffix of ['', '/', '/views/2', '/views/2?pane=info#item']) {
    assert.equal(
      normalizeProjectUrl(
        `https://github.com/users/learner/projects/7${suffix}`,
        'learner',
        'User',
      ),
      'https://github.com/users/learner/projects/7',
    );
  }
  for (const value of [
    'https://github.com/users/other/projects/7',
    'https://github.com/orgs/learner/projects/7',
    'https://github.com.evil.test/users/learner/projects/7',
    'https://evil@github.com/users/learner/projects/7',
    'https://github.com:443/users/learner/projects/7',
    'https://github.com/users/x/../learner/projects/7',
    'https://github.com/users/%6cearner/projects/7',
    'https://github.com/users/learner/projects/7/views/0',
    'https://github.com/users/learner/projects/7\n',
  ])
    assert.equal(normalizeProjectUrl(value, 'learner', 'User'), null, value);
});

test('the first actual lesson asks for only the link and contains no local-tool or command instructions', () => {
  const source = readFileSync(resolve('lessons/lab-1/00-workspace.md'), 'utf8');
  const state = {
    repository: 'learner/workshop',
    owner: 'learner',
    learner: 'learner',
    projectUrl: null,
    exerciseNumber: 1,
    pullRequest: null,
    samples: null,
  };
  const rendered = renderLesson(WORKSHOP, state, WORKSHOP.lessons[0], source);
  assert.ok(rendered.includes('Paste only that URL'));
  for (const forbidden of [
    '/project',
    'YOUR_PROJECT_URL',
    'YOUR-USERNAME',
    'local clone',
    '```powershell',
    'git remote',
    'VS Code',
    '**Project UI: SELF-CONFIRMED.**',
  ])
    assert.ok(!rendered.includes(forbidden), forbidden);
  const prGuide = readFileSync(
    resolve('lessons/lab-2/03-pull-request.md'),
    'utf8',
  );
  for (const required of [
    'branch menu',
    'Edit this file',
    'Commit changes',
    'Compare & pull request',
  ])
    assert.ok(prGuide.includes(required), required);
  assert.ok(
    !/```powershell|\bgit (?:clone|push|fetch|switch)\b/i.test(prGuide),
  );
  const workflow = readFileSync(resolve('.github/workflows/mona.yml'), 'utf8');
  assert.ok(
    !workflow.includes("startsWith(github.event.comment.body, '/')"),
    'Plain URL comments must reach the workflow',
  );
});

test('actual lesson comments retain the manual-rehearsal controls and stop conditions', async (t) => {
  const cases = {
    'lessons/lab-1/00-workspace.md': [
      "that organization's Projects tab",
      'same owner',
      'separate browser tabs',
    ],
    'lessons/lab-1/02-fields.md': [
      'Add field',
      'Add issue fields \u2192 Create a project field',
      'Create a project field',
      'duplicate fields',
    ],
    'lessons/lab-2/01-sprint.md': [
      'Add issue fields \u2192 Create a project field',
      'Starts on',
      'seven days',
      'displayed start/end dates',
      'multi-select',
      'clear Count',
      'Effort 5',
    ],
    'lessons/lab-2/03-pull-request.md': [
      'Preview changes',
      'one removed line and one added line',
      'second still unchecked',
      "Green quality checks do not replace Mona's Step 2-3 pass",
      'Re-run jobs',
      'run URL and exact error',
      'Keep this PR open',
    ],
    'lessons/lab-2/04-complete.md': [
      'enable it only if it is Off',
      'already shows Merged',
      'preserve that merge',
      'Do not recreate or reopen the PR',
    ],
    'lessons/lab-3/01-roadmap.md': [
      'Add issue fields \u2192 Create a project field',
      'actual Sprint 1 and Sprint 2 start/end dates',
      'clear inherited filters',
      'Dates: Start date and Target date',
      'Date fields',
    ],
    'lessons/lab-3/02-workload.md': [
      'is:open',
      'multi-select',
      'clear Count',
    ],
    'lessons/lab-3/04-update.md': [
      'all five work-issue rows',
      'Count the loaded Backlog rows',
      'Do not expect a numeric row count in the export dialog',
      'select Export in that dialog',
      'completed TSV download',
      'do not submit /done 3-4',
      'do not commit, upload or attach',
    ],
  };
  for (const [file, required] of Object.entries(cases))
    await t.test(file, () => {
      const source = readFileSync(resolve(file), 'utf8').replace(/[*`]/g, '');
      for (const text of required)
        assert.ok(source.includes(text), `Missing manual-run guidance: ${text}`);
      if (file === 'lessons/lab-3/04-update.md') {
        assert.ok(
          source.indexOf('Count the loaded Backlog rows') < source.indexOf('Export view data'),
          'Count loaded rows before opening the export dialog',
        );
        assert.doesNotMatch(source, /check the confirmation dialog's row count/i);
      }
    });
});
