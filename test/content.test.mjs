import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { renderLesson } from '../.github/scripts/mona-core.mjs';
import {
  root,
  validateLinks,
  verifyContent,
} from '../tools/verify-content.mjs';

const workshop = JSON.parse(
  readFileSync(resolve(root, 'workshop.json'), 'utf8'),
);

test('all packaged lessons, screenshots, links and security contracts verify offline', () => {
  assert.deepEqual(verifyContent(), []);
});

test('exactly four steps per laboratory including Step 0, with 30–45 minute totals', () => {
  for (const lab of [1, 2, 3]) {
    const lessons = workshop.lessons.filter((lesson) => lesson.lab === lab);
    assert.equal(lessons.length, 4);
    const minutes = lessons.reduce((sum, lesson) => sum + lesson.minutes, 0);
    assert.ok(minutes >= 30 && minutes <= 45);
  }
  assert.equal(workshop.lessons[0].step, 0);
});

test('Project UI work cannot be advertised as repository verification', () => {
  const self = workshop.lessons.filter(
    (lesson) => lesson.mode === 'self-confirmed',
  );
  assert.equal(self.length, 8);
  for (const lesson of self) {
    const markdown = readFileSync(resolve(root, lesson.file), 'utf8');
    if (lesson.id !== '1-0') assert.ok(markdown.includes('SELF-CONFIRMED'));
    assert.ok(!markdown.includes('**REPOSITORY-VERIFIED:**'));
  }
});

test('local link verifier rejects missing files, bad encodings and repository escape', () => {
  const filename = resolve(root, 'README.md');
  for (const text of [
    '[missing](never-exists.md)',
    '[escape](../outside.md)',
    '[bad](%zz.md)',
  ]) {
    assert.equal(validateLinks(text, filename).length, 1);
  }
  assert.deepEqual(
    validateLinks('[web](https://github.com/)[local](LICENSE)', filename),
    [],
  );
});

test('the actual twelve lessons render with public images and learner-specific numbers', () => {
  const state = {
    repository: 'learner/my-projects-workshop',
    owner: 'learner',
    learner: 'learner',
    projectUrl: 'https://github.com/users/learner/projects/3',
    exerciseNumber: 5,
    pullRequest: { number: 7 },
    samples: {
      feature: { number: 1, id: 101 },
      implementation: { number: 2, id: 102 },
      verification: { number: 3, id: 103 },
      bug: { number: 4, id: 104 },
    },
  };
  for (const lesson of workshop.lessons) {
    const text = renderLesson(
      workshop,
      state,
      lesson,
      readFileSync(resolve(root, lesson.file), 'utf8'),
    );
    assert.ok(!text.includes('{{'));
    assert.ok(text.includes(workshop.publicAssetBase + lesson.image));
    if (lesson.id === '1-0')
      assert.ok(text.includes('Paste only your Project URL'));
    else {
      const evidence = {
        'self-confirmed': 'SELF-CONFIRMED',
        'repository-verified': 'REPOSITORY-VERIFIED',
        mixed: 'MIXED EVIDENCE',
      }[lesson.mode];
      assert.ok(
        text.includes(evidence),
        `Missing honest evidence class for ${lesson.id}`,
      );
    }
  }
});

test('one instruction thread is explicit in the actual bootstrap and unbound backlog lessons', () => {
  const state = {
    repository: 'learner/my-projects-workshop',
    owner: 'learner',
    learner: 'learner',
    projectUrl: 'https://github.com/users/learner/projects/3',
    exerciseNumber: 1,
    pullRequest: null,
    samples: null,
  };
  assert.equal(workshop.bootstrapIssueLimit, 1);
  const authorProbe = readFileSync(
    resolve(root, 'tools/native-smoke.mjs'),
    'utf8',
  );
  assert.ok(!authorProbe.includes('course.exerciseMarker ='));
  assert.ok(!authorProbe.includes('course.stateMarker ='));
  for (const lesson of workshop.lessons.slice(0, 2)) {
    const source = readFileSync(resolve(root, lesson.file), 'utf8');
    const rendered = renderLesson(workshop, state, lesson, source);
    assert.ok(!rendered.includes('{{'));
    assert.ok(
      rendered.includes('same thread') || rendered.includes('same Mona thread'),
    );
  }
  const backlog = readFileSync(resolve(root, workshop.lessons[1].file), 'utf8');
  assert.ok(
    backlog.includes('/backlog #FEATURE #IMPLEMENTATION #VERIFICATION #BUG'),
  );
  assert.ok(backlog.includes('MIXED EVIDENCE'));
  for (const item of workshop.backlogItems)
    assert.ok(backlog.includes(item.title));
});
