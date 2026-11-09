import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDING_MARKER,
  bindingFor,
  contractHash,
  decodeBinding,
  decodeState,
  encodeBinding,
  encodeState,
  initialState,
  messageMarker,
  parseCommand,
  planCommand,
  renderLesson,
  sampleMarker,
  validateState,
  validateWorkshop,
} from '../.github/scripts/mona-engine.mjs';
import {
  WORKSHOP,
  backlogCommand,
  botUser,
  harness,
  reach,
  user,
} from './helpers/fake-github.mjs';

const roles = WORKSHOP.backlogItems.map(({ key }) => key);
const packLegacy = (marker, value = { version: 1 }) =>
  `<!-- ${marker} ${Buffer.from(JSON.stringify(value)).toString('base64')} -->`;
const legacyBinding = () => packLegacy('bsp-workshop-binding:v1');
const nativeIssue = (h, samples, key = 'feature') =>
  h.api.issues.find((issue) => issue.number === samples[key].number);

test('v2 migration primitives are exported without enabling legacy startup or a compatibility fallback', async () => {
  const h = harness();
  const binding = bindingFor(WORKSHOP, h.api.repository, 'learner', 'exercise');
  assert.equal(binding.version, 2);
  assert.equal(binding.contract, contractHash(WORKSHOP));
  assert.equal(BINDING_MARKER, 'bsp-workshop-binding:v2');
  assert.deepEqual(decodeBinding(encodeBinding(binding)), binding);
  assert.equal(
    messageMarker('lesson:1-0'),
    '<!-- bsp-workshop-message:v2 lesson:1-0 -->',
  );
  assert.throws(() => decodeBinding(legacyBinding()));
  assert.throws(
    () => validateWorkshop({ ...WORKSHOP, schemaVersion: 1 }),
    /v2 workshop contract/,
  );
  for (const mutation of [
    { bootstrapIssueLimit: 5 },
    { exerciseMarker: '<!-- bsp-workshop-exercise:v1 -->' },
    { stateMarker: 'bsp-workshop-state:v1' },
    { sampleIssues: WORKSHOP.backlogItems },
  ])
    assert.throws(() => validateWorkshop({ ...WORKSHOP, ...mutation }));
  await h.run();
  const initial = initialState(WORKSHOP, binding, h.api.exercise());
  assert.equal(initial.samples, null);
  assert.deepEqual(
    decodeState(WORKSHOP, encodeState(WORKSHOP, initial)),
    initial,
  );
  assert.equal(
    validateState(WORKSHOP, initial, binding, h.api.exercise()),
    initial,
  );
  const changed = structuredClone(WORKSHOP);
  changed.title += ' changed';
  assert.notEqual(contractHash(changed), contractHash(WORKSHOP));
  h.workshop.title = changed.title;
  const writes = h.api.writes().length;
  await assert.rejects(h.run());
  assert.equal(h.api.writes().length, writes);
  assert.equal(h.api.counts('createIssue'), 1);
});

const malformedBacklogs = [
  '/backlog',
  '/backlog #1 #2 #3',
  '/backlog #1 #2 #3 #4 #5',
  '/backlog #1 #2 #3 #3',
  '/backlog #0 #2 #3 #4',
  '/backlog #-1 #2 #3 #4',
  '/backlog #01 #2 #3 #4',
  '/backlog #1 #02 #3 #4',
  '/backlog #1 #2 #03 #4',
  '/backlog #1 #2 #3 #04',
  '/backlog #9007199254740992 #2 #3 #4',
  '/backlog #1.0 #2 #3 #4',
  '/backlog #1e2 #2 #3 #4',
  '/backlog #+1 #2 #3 #4',
  '/backlog 1 #2 #3 #4',
  '/backlog https://github.com/learner/my-projects/issues/1 #2 #3 #4',
  '/backlog #1 #2 #3 #4/',
  '/backlog #1 #2 #3 #4?x=1',
  '/backlog #1 #2 #3 #4;',
  '/backlog #1 #2 #3 #4 trailing',
  '/backlog #1 #2 #3 #4 ',
  ' /backlog #1 #2 #3 #4',
  '/backlogs #1 #2 #3 #4',
  '/BACKLOG #1 #2 #3 #4',
  '/backlog  #1 #2 #3 #4',
  '/backlog #1\t#2 #3 #4',
  '/backlog #1 #2 #3 #4\n',
  '/backlog #1 #2 #3 #4\r',
  '/backlog #1 #2 #3 #4\n/done 1-2',
  '/backlog #1 #2 #3 #4\u0000',
  '/backlog #1 #2 #3 #4\u2028',
  '/backlog #1 #2 #3 #4\u2029',
];

test('backlog parser accepts only four distinct canonical positive safe integers', () => {
  assert.deepEqual(parseCommand('/backlog #11 #23 #47 #68'), {
    verb: 'backlog',
    numbers: [11, 23, 47, 68],
  });
  assert.deepEqual(parseCommand('/backlog #9007199254740991 #2 #3 #4'), {
    verb: 'backlog',
    numbers: [Number.MAX_SAFE_INTEGER, 2, 3, 4],
  });
  for (const body of malformedBacklogs)
    assert.equal(parseCommand(body), null, JSON.stringify(body));
});

test('registration is current-lesson-only; malformed commands and /done cannot bypass or seed', async () => {
  const h = harness();
  await h.run();
  await h.say('/backlog #11 #23 #47 #68');
  assert.equal(h.api.state().samples, null);
  assert.equal(h.api.counts('getIssue'), 0);
  await reach(h, '1-1');
  for (const command of [
    ...malformedBacklogs,
    '/done 1-1',
    '/done1-1',
    '/check 1-1',
    '/done 1-2',
    '/status',
    '/help',
  ]) {
    await h.say(command);
  }
  assert.deepEqual(h.api.state().completed, ['1-0']);
  assert.equal(h.api.state().samples, null);
  assert.equal(h.api.counts('getIssue'), 0);
  assert.equal(h.api.counts('createIssue'), 1);
  assert.equal(h.api.issues.length, 1);
  assert.match(
    h.api.comments.at(-1).body,
    /Create the four work issues manually/,
  );
});

test('four manual learner issues bind actual numbers, IDs and native evidence atomically without issue edits', async () => {
  const h = harness();
  await reach(h, '1-1');
  assert.equal(h.api.state().samples, null);
  assert.equal(h.api.issues.length, 1);
  const numbers = [11, 23, 47, 68];
  const samples = Object.fromEntries(
    WORKSHOP.backlogItems.map(({ key, title, body }, index) => {
      const issue = h.api.addIssue({
        title,
        body,
        number: numbers[index],
        author: user(),
      });
      return [key, { number: issue.number, id: issue.id }];
    }),
  );
  // Equal creation timestamps are explicitly permitted by the >= fence.
  nativeIssue(h, samples).created_at = h.api.exercise().created_at;
  const before = structuredClone(h.api.issues);
  await h.say(backlogCommand(samples));
  const state = h.api.state();
  assert.deepEqual(state.completed, ['1-0', '1-1']);
  assert.deepEqual(state.samples, samples);
  assert.deepEqual(
    h.api.calls
      .filter(({ method }) => method === 'getIssue')
      .map(({ args }) => args[0]),
    numbers,
  );
  assert.deepEqual(h.api.issues, before);
  assert.equal(h.api.counts('createIssue'), 1);
  assert.equal(h.api.counts('updateExercise'), 0);
  assert.equal(h.api.counts('closeRetiredSample'), 0);
  for (const key of roles) {
    const proof = state.evidence['1-1'].issues[key];
    assert.equal(proof.id, samples[key].id);
    assert.equal(proof.number, samples[key].number);
    assert.equal(
      proof.repositoryUrl,
      'https://api.github.com/repos/learner/my-projects',
    );
    assert.deepEqual(proof.author, user());
    assert.equal(proof.state, 'open');
    assert.equal(proof.pullRequest, false);
    assert.equal(proof.workshopMarkers, false);
  }
  assert.match(h.api.messages('feedback:1-1')[0].body, /MIXED EVIDENCE/);
  const binding = bindingFor(WORKSHOP, h.api.repository, 'learner', 'exercise');
  // A replay with today's map would refuse rebinding; validateState must replay
  // 1-1 with the historical null map instead.
  assert.equal(
    planCommand(
      WORKSHOP,
      { ...state, completed: ['1-0'] },
      state.evidence['1-1'].command,
    ).kind,
    'reply',
  );
  assert.equal(
    validateState(WORKSHOP, state, binding, h.api.exercise(), samples),
    state,
  );
  const writes = h.api.writes().length;
  await h.run();
  assert.equal(h.api.writes().length, writes);
});

test('semantic backlog rejection never records completion, changes roles or edits learner issues', async (t) => {
  const cases = {
    swappedRoles: {
      mutate: (_h, samples) => {
        [samples.feature, samples.implementation] = [
          samples.implementation,
          samples.feature,
        ];
      },
      error: /feature.*exact title.*do not swap/,
    },
    wrongTitle: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).title = 'A different task';
      },
      error: /feature.*exact title/,
    },
    closed: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).state = 'closed';
      },
      error: /must be open/,
    },
    otherHuman: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).user = user('intruder');
      },
      error: /bound human learner/,
    },
    bot: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).user = botUser();
      },
      error: /not a bot/,
    },
    forgedBotIdentity: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).user = { ...botUser(), type: 'User' };
      },
      error: /bound human learner/,
    },
    nonHuman: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).user = { ...user(), type: 'Mannequin' };
      },
      error: /bound human learner/,
    },
    pullRequest: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).pull_request = {
          url: 'https://evil.test/do-not-follow',
        };
      },
      error: /not a pull request/,
    },
    exercise: {
      mutate: (h, samples) => {
        samples.feature = {
          number: h.api.exercise().number,
          id: h.api.exercise().id,
        };
      },
      error: /Mona exercise cannot/,
    },
    predatesExercise: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).created_at = new Date(
          Date.parse(h.api.exercise().created_at) - 1,
        ).toISOString();
      },
      error: /at or after this Mona exercise/,
    },
    forgedV1: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).body += `\n${sampleMarker('feature')}`;
      },
      error: /forged workshop markers/,
    },
    forgedV2: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).body += `\n${encodeBinding({ version: 2 })}`;
      },
      error: /forged workshop markers/,
    },
    forgedUnknown: {
      mutate: (h, samples) => {
        nativeIssue(h, samples).body +=
          '\n<!-- BSP-WORKSHOP-STATE:v99 forged -->';
      },
      error: /forged workshop markers/,
    },
  };
  for (const [label, { mutate, error }] of Object.entries(cases))
    await t.test(label, async () => {
      const h = harness();
      await reach(h, '1-1');
      const samples = h.api.addLearnerBacklog();
      mutate(h, samples);
      const before = structuredClone(h.api.issues);
      await h.say(backlogCommand(samples));
      assert.deepEqual(h.api.state().completed, ['1-0']);
      assert.equal(h.api.state().samples, null);
      assert.equal(h.api.state().evidence['1-1'], undefined);
      assert.match(h.api.comments.at(-1).body, error);
      assert.deepEqual(h.api.issues, before);
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('native binding corruption and denied reads do not consume the command; an exact retry can succeed', async (t) => {
  const cases = {
    wrongNumber: (issue) => ({ ...issue, number: issue.number + 100 }),
    wrongId: (issue) => ({ ...issue, id: issue.id + 100 }),
    unsafeId: (issue) => ({ ...issue, id: Number.MAX_SAFE_INTEGER + 1 }),
    noId: (issue) => ({ ...issue, id: null }),
    wrongRepository: (issue) => ({
      ...issue,
      repository_url: 'https://api.github.com/repos/other/repo',
    }),
    untrustedUrl: (issue) => ({
      ...issue,
      repository_url: 'https://evil.test/repos/learner/my-projects',
    }),
    invalidDate: (issue) => ({ ...issue, created_at: 'not-a-date' }),
    normalizedInvalidDate: (issue) => ({
      ...issue,
      created_at: '2026-02-30T10:00:00Z',
    }),
    nonNativeDate: (issue) => ({ ...issue, created_at: '2026' }),
    noTitle: (issue) => ({ ...issue, title: null }),
    missingBody: (issue) => {
      const result = { ...issue };
      delete result.body;
      return result;
    },
    noAuthorId: (issue) => ({
      ...issue,
      user: { login: 'learner', type: 'User' },
    }),
    contradictoryAuthorId: (issue) => ({
      ...issue,
      user: { ...user(), id: 999 },
    }),
    corruptNativeState: (issue) => ({ ...issue, state: 'unknown' }),
    missingResponse: () => undefined,
  };
  for (const [label, corrupt] of Object.entries(cases))
    await t.test(label, async () => {
      const h = harness();
      await reach(h, '1-1');
      const samples = h.api.addLearnerBacklog();
      const getIssue = h.api.getIssue;
      h.api.getIssue = async (number) => {
        const issue = await getIssue(number);
        return number === samples.feature.number ? corrupt(issue) : issue;
      };
      const command = h.api.addComment(
        h.api.exercise().number,
        backlogCommand(samples),
      );
      const before = h.api.stateComment().body;
      const writes = h.api.writes().length;
      await assert.rejects(h.run(h.eventFor(command)), /could not read/);
      assert.equal(h.api.stateComment().body, before);
      assert.equal(h.api.writes().length, writes);
      h.api.getIssue = getIssue;
      await h.run(h.eventFor(command));
      assert.deepEqual(h.api.state().samples, samples);
      assert.equal(h.api.state().lastProcessedHumanCommentId, command.id);
    });
  for (const after of [false, true])
    await t.test(`GET denied/lost response; after=${after}`, async () => {
      const h = harness();
      await reach(h, '1-1');
      const samples = h.api.addLearnerBacklog();
      const command = h.api.addComment(
        h.api.exercise().number,
        backlogCommand(samples),
      );
      h.api.fail('getIssue', {
        after,
        where: (number) => number === samples.verification.number,
      });
      const before = h.api.stateComment().body;
      const writes = h.api.writes().length;
      await assert.rejects(
        h.run(h.eventFor(command)),
        /repository evidence|repository API/,
      );
      assert.equal(h.api.stateComment().body, before);
      assert.equal(h.api.writes().length, writes);
      await h.run(h.eventFor(command));
      assert.deepEqual(h.api.state().samples, samples);
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('only canonical, unedited comments in the bound learner exercise can register a backlog', async () => {
  const h = harness({ owner: 'my-org', type: 'Organization' });
  await reach(h, '1-1');
  const samples = h.api.addLearnerBacklog();
  const command = backlogCommand(samples);
  const intruder = h.api.addComment(
    h.api.exercise().number,
    command,
    user('other-admin'),
  );
  await h.run(h.eventFor(intruder));
  const otherIssue = h.api.addIssue({ author: user() });
  const unrelated = h.api.addComment(otherIssue.number, command);
  await h.run(h.eventFor(unrelated, otherIssue));
  const bot = h.api.addComment(h.api.exercise().number, command, botUser());
  await h.run(h.eventFor(bot));
  const edited = h.api.addComment(h.api.exercise().number, command, user(), {
    updated_at: '2027-01-01T00:00:00Z',
  });
  await h.run(h.eventFor(edited));
  const ordinary = h.api.addComment(h.api.exercise().number, 'not a command');
  const forgedEvent = h.eventFor(ordinary);
  forgedEvent.event.comment.body = command;
  await h.run(forgedEvent);
  assert.equal(h.api.state().samples, null);
  assert.equal(h.api.counts('getIssue'), 0);
  await h.say(command);
  assert.deepEqual(h.api.state().samples, samples);
});

test('registered roles cannot be rebound, even with another valid set of manual issues', async () => {
  const h = harness();
  await reach(h, '1-2');
  const original = h.api.state().samples;
  const proof = h.api.state().evidence['1-1'];
  const another = h.api.addLearnerBacklog();
  const reads = h.api.counts('getIssue');
  for (const command of [
    backlogCommand(another),
    backlogCommand(original),
    '/done 1-1',
  ])
    await h.say(command);
  assert.deepEqual(h.api.state().samples, original);
  assert.deepEqual(h.api.state().evidence['1-1'], proof);
  assert.deepEqual(h.api.state().completed, ['1-0', '1-1']);
  assert.equal(h.api.counts('getIssue'), reads);
  assert.equal(h.api.counts('createIssue'), 1);
});

test('saved binding cardinality and native historical evidence are validated before any writes', async (t) => {
  const mutations = {
    nullMap: (state) => {
      state.samples = null;
    },
    missingRole: (state) => {
      delete state.samples.bug;
    },
    extraRole: (state) => {
      state.samples.other = { number: 90, id: 590 };
    },
    duplicateNumber: (state) => {
      state.samples.bug.number = state.samples.feature.number;
    },
    duplicateId: (state) => {
      state.samples.bug.id = state.samples.feature.id;
    },
    changedId: (state) => {
      state.samples.bug.id += 100;
    },
    missingNativeProof: (state) => {
      delete state.evidence['1-1'].issues;
    },
    changedNativeProof: (state) => {
      state.evidence['1-1'].issues.feature.id += 100;
    },
    wrongNativeAuthor: (state) => {
      state.evidence['1-1'].issues.feature.author = user('intruder');
    },
    oldNativeDate: (state) => {
      state.evidence['1-1'].issues.feature.createdAt = '2025-01-01T00:00:00Z';
    },
    closedNativeProof: (state) => {
      state.evidence['1-1'].issues.feature.state = 'closed';
    },
    forgedMetadataProof: (state) => {
      state.evidence['1-1'].issues.feature.workshopMarkers = true;
    },
    bypassCommand: (state) => {
      state.evidence['1-1'].command = '/done 1-1';
    },
    swappedCommand: (state) => {
      state.evidence['1-1'].command = backlogCommand({
        ...state.samples,
        feature: state.samples.bug,
        bug: state.samples.feature,
      });
    },
  };
  for (const [label, mutate] of Object.entries(mutations))
    await t.test(label, async () => {
      const h = harness();
      await reach(h, '1-2');
      const state = h.api.state();
      mutate(state);
      h.api.stateComment().body = encodeState(WORKSHOP, state);
      const before = h.api.stateComment().body;
      const writes = h.api.writes().length;
      await assert.rejects(h.run());
      assert.equal(h.api.stateComment().body, before);
      assert.equal(h.api.writes().length, writes);
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('missing bound issues are not rediscovered/reseeded and fail without consuming a command when queried', async () => {
  const h = harness();
  await reach(h, '1-2');
  const state = h.api.state();
  h.api.issues = h.api.issues.filter(
    ({ number }) =>
      ![state.samples.feature.number, state.samples.bug.number].includes(
        number,
      ),
  );
  const writes = h.api.writes().length;
  const reads = h.api.counts('getIssue');
  await h.run();
  assert.equal(h.api.writes().length, writes);
  assert.equal(h.api.counts('getIssue'), reads);
  assert.deepEqual(h.api.state().samples, state.samples);
  await reach(h, '2-4');
  h.api.mergePR();
  h.api.issues = h.api.issues.filter(
    ({ number }) => number !== state.samples.implementation.number,
  );
  const command = h.api.addComment(h.api.exercise().number, '/check 2-4 #31');
  const before = h.api.stateComment().body;
  const writesBefore = h.api.writes().length;
  await assert.rejects(h.run(h.eventFor(command)), /HTTP 404/);
  assert.equal(h.api.stateComment().body, before);
  assert.equal(h.api.writes().length, writesBefore);
  assert.equal(h.api.counts('createIssue'), 1);
});

test('a queried bound issue with a contradictory immutable ID is corruption, not a consumed negative check', async () => {
  const h = harness();
  await reach(h, '2-4');
  h.api.mergePR();
  const getIssue = h.api.getIssue;
  h.api.getIssue = async (number) => ({
    ...(await getIssue(number)),
    id: 99_999,
  });
  const command = h.api.addComment(h.api.exercise().number, '/check 2-4 #31');
  const before = h.api.stateComment().body;
  const writes = h.api.writes().length;
  await assert.rejects(h.run(h.eventFor(command)), /immutable ID/);
  assert.equal(h.api.stateComment().body, before);
  assert.equal(h.api.writes().length, writes);
});

test('backlog binding PATCH and publication recovery never duplicates or partially rebinds roles', async (t) => {
  for (const target of ['state', 'feedback', 'lesson'])
    for (const after of [false, true])
      await t.test(`${target}; committed=${after}`, async () => {
        const h = harness();
        await reach(h, '1-1');
        const samples = h.api.addLearnerBacklog();
        const originalIssues = structuredClone(h.api.issues);
        const command = h.api.addComment(
          h.api.exercise().number,
          backlogCommand(samples),
        );
        if (target === 'state') h.api.fail('updateComment', { after });
        else
          h.api.fail('createComment', {
            after,
            where: (_number, body) =>
              body.startsWith(
                messageMarker(
                  target === 'feedback' ? 'feedback:1-1' : 'lesson:1-2',
                ),
              ),
          });
        await assert.rejects(h.run(h.eventFor(command)));
        const committed = target !== 'state' || after;
        assert.deepEqual(h.api.state().samples, committed ? samples : null);
        assert.equal(h.api.state().completed.length, committed ? 2 : 1);
        const reads = h.api.counts('getIssue');
        await h.run(h.eventFor(command));
        assert.equal(h.api.counts('getIssue') - reads, committed ? 0 : 4);
        assert.deepEqual(h.api.state().samples, samples);
        assert.equal(h.api.state().completed.length, 2);
        assert.equal(h.api.state().lastProcessedHumanCommentId, command.id);
        assert.equal(h.api.messages('feedback:1-1').length, 1);
        assert.equal(h.api.messages('lesson:1-2').length, 1);
        assert.deepEqual(h.api.issues, originalIssues);
        assert.equal(h.api.counts('createIssue'), 1);
        const writes = h.api.writes().length;
        await h.run();
        assert.equal(h.api.writes().length, writes);
      });
});

test('legacy artifacts and orphaned/unknown namespaces fail closed before even the first bootstrap write', async (t) => {
  const cases = {
    v1Exercise: (h) =>
      h.api.addIssue({
        body: `<!-- bsp-workshop-exercise:v1 -->\n${legacyBinding()}`,
      }),
    closedV1Exercise: (h) =>
      h.api.addIssue({
        state: 'closed',
        body: `<!-- bsp-workshop-exercise:v1 -->\n${legacyBinding()}`,
      }),
    v1Sample: (h) =>
      h.api.addIssue({
        body: `${sampleMarker('feature')}\n${legacyBinding()}`,
      }),
    retiredWithoutV2Exercise: (h) =>
      h.api.addIssue({
        state: 'closed',
        body: `${sampleMarker('feature')}\n${legacyBinding()}`,
      }),
    orphanedV1State: (h) => {
      const issue = h.api.addIssue();
      h.api.addComment(
        issue.number,
        packLegacy('bsp-workshop-state:v1'),
        botUser(),
      );
    },
    orphanedStateOnHumanIssue: (h) => {
      const issue = h.api.addIssue({ author: user() });
      h.api.addComment(
        issue.number,
        packLegacy('bsp-workshop-state:v1'),
        botUser(),
      );
    },
    orphanedV2State: (h) => {
      const issue = h.api.addIssue();
      h.api.addComment(
        issue.number,
        packLegacy('bsp-workshop-state:v2', { version: 2 }),
        botUser(),
      );
    },
    orphanedV1Message: (h) => {
      const issue = h.api.addIssue();
      h.api.addComment(
        issue.number,
        '<!-- bsp-workshop-message:v1 lesson:1-0 -->',
        botUser(),
      );
    },
    orphanedBinding: (h) =>
      h.api.addIssue({ body: encodeBinding({ version: 2 }) }),
    unknownVersion: (h) =>
      h.api.addIssue({ body: '<!-- bsp-workshop-exercise:v99 -->' }),
    unknownNamespace: (h) =>
      h.api.addIssue({ body: '<!-- bsp-workshop-custom:v2 x -->' }),
    malformedMarker: (h) =>
      h.api.addIssue({ body: '<!--bsp-workshop-exercise:v2-->' }),
    multilineMarker: (h) =>
      h.api.addIssue({ body: '<!--\n bsp-workshop-exercise:v1\n-->' }),
    multilineComment: (h) => {
      const issue = h.api.addIssue();
      h.api.addComment(
        issue.number,
        '<!--\n bsp-workshop-state:v1 e30=\n-->',
        botUser(),
      );
    },
    multipleMarkersOnOneLine: (h) =>
      h.api.addIssue({
        body: `${WORKSHOP.exerciseMarker} <!-- bsp-workshop-exercise:v1 -->`,
      }),
    mixedEnvelope: (h) =>
      h.api.addIssue({
        body: `<!-- bsp-workshop-exercise:v1 -->\n${WORKSHOP.exerciseMarker}\n${encodeBinding(bindingFor(WORKSHOP, h.api.repository, 'learner', 'exercise'))}`,
      }),
    otherBot: (h) =>
      h.api.addIssue({
        author: { login: 'another[bot]', type: 'Bot', id: 1 },
        body: '<!-- bsp-workshop-exercise:v1 -->',
      }),
    botPRArtifact: (h) =>
      h.api.addIssue({
        pull_request: {},
        body: '<!-- bsp-workshop-exercise:v1 -->',
      }),
  };
  for (const [label, setup] of Object.entries(cases))
    await t.test(label, async () => {
      const h = harness();
      setup(h);
      const issues = structuredClone(h.api.issues);
      const comments = structuredClone(h.api.comments);
      await assert.rejects(h.run(), /legacy|unknown|mixed/i);
      assert.equal(h.api.writes().length, 0);
      assert.deepEqual(h.api.issues, issues);
      assert.deepEqual(h.api.comments, comments);
    });
});

test('a current v2 exercise cannot hide mixed versions, a second exercise, or a foreign bot publication', async (t) => {
  const mutations = {
    v1Exercise: (h) =>
      h.api.addIssue({
        state: 'closed',
        body: '<!-- bsp-workshop-exercise:v1 -->',
      }),
    secondV2Exercise: (h) => h.api.addIssue({ body: h.api.exercise().body }),
    openV1Sample: (h) =>
      h.api.addIssue({ body: `${sampleMarker('bug')}\n${legacyBinding()}` }),
    unknownSample: (h) =>
      h.api.addIssue({
        state: 'closed',
        body: '<!-- bsp-workshop-sample:v2 bug -->',
      }),
    mixedRetiredSample: (h) =>
      h.api.addIssue({
        state: 'closed',
        body: `${sampleMarker('bug')}\n${encodeBinding({ version: 2 })}`,
      }),
    extraExerciseMarker: (h) => {
      h.api.issues[0].body += '\n<!-- bsp-workshop-exercise:v1 -->';
    },
    v1State: (h) =>
      h.api.addComment(
        h.api.exercise().number,
        packLegacy('bsp-workshop-state:v1'),
        botUser(),
      ),
    v1Publication: (h) =>
      h.api.addComment(
        h.api.exercise().number,
        '<!-- bsp-workshop-message:v1 lesson:1-1 -->',
        botUser(),
      ),
    unknownPublication: (h) =>
      h.api.addComment(
        h.api.exercise().number,
        '<!-- bsp-workshop-message:v2 lesson:9-9 -->',
        botUser(),
      ),
    mixedPublication: (h) =>
      h.api.addComment(
        h.api.exercise().number,
        `${messageMarker('lesson:1-1')}\n<!-- bsp-workshop-message:v1 lesson:1-1 -->`,
        botUser(),
      ),
    otherBotPublication: (h) =>
      h.api.addComment(h.api.exercise().number, messageMarker('lesson:1-1'), {
        login: 'another[bot]',
        type: 'Bot',
        id: 1,
      }),
    futureReply: (h) =>
      h.api.addComment(
        h.api.exercise().number,
        messageMarker('reply:999999'),
        botUser(),
      ),
  };
  for (const [label, mutate] of Object.entries(mutations))
    await t.test(label, async () => {
      const h = harness();
      await h.run();
      mutate(h);
      const writes = h.api.writes().length;
      const before = h.api.stateComment().body;
      await assert.rejects(h.run(), /Mona stopped/);
      assert.equal(h.api.writes().length, writes);
      assert.equal(h.api.stateComment().body, before);
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('migrated v2 exercises ignore optional closed historical v1 samples without requiring their presence', async () => {
  const h = harness();
  await h.run();
  const retired = roles.map((key) =>
    h.api.addIssue({
      state: 'closed',
      state_reason: 'not_planned',
      createdAt: '2025-01-01T00:00:00Z',
      body: `${sampleMarker(key)}\n${legacyBinding()}\nHistorical bot work; not a v2 backlog role.`,
    }),
  );
  const writes = h.api.writes().length;
  await h.run();
  assert.equal(h.api.state().samples, null);
  assert.equal(h.api.writes().length, writes);
  assert.equal(h.api.counts('getIssue'), 0);
  await reach(h, '1-2');
  const samples = h.api.state().samples;
  assert.ok(
    roles.every(
      (key) => !retired.some(({ number }) => number === samples[key].number),
    ),
  );
  const retiredNumbers = new Set(retired.map(({ number }) => number));
  h.api.issues = h.api.issues.filter(
    ({ number }) => !retiredNumbers.has(number),
  );
  const writesAfter = h.api.writes().length;
  await h.run();
  assert.equal(h.api.writes().length, writesAfter);
  assert.deepEqual(h.api.state().samples, samples);
  assert.equal(h.api.counts('createIssue'), 1);
  assert.equal(h.api.counts('closeRetiredSample'), 0);
  assert.equal(h.api.counts('updateExercise'), 0);
});

test('unbound lessons render without sample dereferences and missing requested numbers fail clearly', async () => {
  const h = harness();
  await h.run();
  const unbound = h.api.state();
  for (const lesson of WORKSHOP.lessons.slice(0, 2)) {
    const rendered = renderLesson(
      WORKSHOP,
      unbound,
      lesson,
      '{{REPO}} {{LEARNER}} {{EXERCISE_URL}}',
    );
    assert.ok(!rendered.includes('undefined'));
    assert.ok(!rendered.includes('{{'));
    for (const key of roles)
      assert.throws(
        () => renderLesson(WORKSHOP, unbound, lesson, `{{ISSUE_${key}}}`),
        /requires the four manually created issues registered with \/backlog/,
      );
  }
  await reach(h, '1-2');
  const bound = h.api.state();
  for (const key of roles) {
    assert.ok(
      renderLesson(
        WORKSHOP,
        bound,
        WORKSHOP.lessons[2],
        `#{{ISSUE_${key}}}`,
      ).includes(`#${bound.samples[key].number}`),
    );
    const missing = structuredClone(bound);
    delete missing.samples[key];
    assert.throws(
      () =>
        renderLesson(
          WORKSHOP,
          missing,
          WORKSHOP.lessons[2],
          `{{ISSUE_${key}}}`,
        ),
      /No issue number was invented/,
    );
  }
});
