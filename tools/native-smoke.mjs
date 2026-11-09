import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGitHubClient } from '../.github/scripts/github-api.mjs';
import {
  bot,
  decodeState,
  hasStateMarker,
  runMona,
} from '../.github/scripts/mona-engine.mjs';
import { createLessonLoader } from '../.github/scripts/mona.mjs';

const repository = process.env.GITHUB_REPOSITORY;
assert.equal(repository, 'alvine-aurelio-org/bsp-github-projects-lab-1');
const api = createGitHubClient({ token: process.env.GH_TOKEN, repository });
const actual = await api.getRepository();
assert.equal(
  actual.private,
  true,
  'Probe is allowed only before public publication.',
);
assert.equal(
  actual.is_template,
  false,
  'Never run an author mutation against the learner template.',
);
const course = JSON.parse(await readFile(resolve('workshop.json'), 'utf8'));
// Test ONLY native repository-token bootstrap. The source exemption is removed
// in this private, author-owned probe; runtime learner code is not altered.
course.sourceRepositories = course.sourceRepositories.filter(
  (name) => name !== repository,
);
course.exerciseTitle =
  '[Author smoke only] Mona native bootstrap — not learner completion';
const before = await api.listIssues();
assert.equal(
  before.length,
  0,
  'This one-time v2 author probe requires an empty private source; never repurpose an active or legacy learner copy.',
);
const context = {
  repository,
  actor: process.env.GITHUB_ACTOR,
  eventName: 'workflow_dispatch',
  event: {},
};
const result = await runMona({
  workshop: course,
  context,
  api,
  loadLesson: createLessonLoader(),
});
assert.equal(result.status, 'ready');
assert.equal(
  result.completed,
  0,
  'No Project UI or participant lesson may be credited by this probe.',
);
const issues = await api.listIssues();
assert.equal(
  issues.length,
  1,
  'V2 bootstrap may create only the single exercise issue.',
);
const exercise = issues.find(
  (issue) =>
    bot(issue.user) &&
    issue.body?.split(/\r?\n/).includes(course.exerciseMarker),
);
assert.ok(exercise);
const comments = await api.listComments(exercise.number);
const saved = comments.find(
  (comment) => bot(comment.user) && hasStateMarker(course, comment.body),
);
assert.ok(saved);
const state = decodeState(course, saved.body);
assert.equal(state.completed.length, 0);
assert.equal(state.projectUrl, null);
assert.equal(
  state.samples,
  null,
  'Work items are learner-created later, never seeded.',
);
assert.ok(
  comments.some(
    (comment) => bot(comment.user) && comment.body.includes('lesson:1-0'),
  ),
);
const rerun = await runMona({
  workshop: course,
  context,
  api,
  loadLesson: createLessonLoader(),
});
assert.equal(rerun.completed, 0);
assert.equal(
  (await api.listIssues()).length,
  1,
  'Rerun must not create another exercise or any work issue.',
);
const found = await api.getIssue(exercise.number);
assert.ok(bot(found.user) && found.title.startsWith('[Author smoke only]'));
assert.equal((await api.closeExercise(exercise.number)).state, 'closed');
console.log(
  JSON.stringify(
    {
      nativeBootstrap: 'passed',
      nativeIdempotentRerun: 'passed',
      bootstrapIssueCount: 1,
      sourceGuardExemption: 'empty private author probe only',
      workIssuesCreated: 0,
      exerciseIssue: exercise.number,
      probeIssuesClosed: 1,
      participantLessonsCompleted: 0,
      projectApiCalls: 0,
      projectUiRehearsed: false,
      note: 'Does not claim a template-copy event, native PR/merge or participant Project UI rehearsal.',
    },
    null,
    2,
  ),
);
