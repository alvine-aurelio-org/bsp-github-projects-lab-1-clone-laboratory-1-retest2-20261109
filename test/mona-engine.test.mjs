import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT,
  LESSON_IDS,
  bindingFor,
  decodeState,
  encodeBinding,
  encodeState,
  initialState,
  messageMarker,
  parseCommand,
  planCommand,
  recordDecision,
  renderLesson,
  runMona,
  sampleMarker,
  validateProjectUrl,
} from '../.github/scripts/mona-engine.mjs';
import {
  HEAD,
  MERGE,
  WORKSHOP,
  backlogCommand,
  botUser,
  harness,
  reach,
  user,
} from './helpers/fake-github.mjs';

test('complete twelve-step synthetic flow records honest evidence and closes only the exercise', async () => {
  const h = harness();
  assert.deepEqual(
    await h.run({ eventName: 'push', event: { ref: 'refs/heads/main' } }),
    { status: 'ready', completed: 0 },
  );
  assert.equal(h.api.issues.length, 1);
  assert.equal(h.api.state().samples, null);
  assert.equal(h.api.counts('getIssue'), 0);
  assert.equal(h.api.exercise().user.login, BOT);
  assert.equal(h.api.stateComment().user.login, BOT);
  assert.deepEqual(h.loaded, [WORKSHOP.lessons[0].file]);
  const first = h.api.messages('lesson:1-0')[0].body;
  assert.match(
    first,
    /https:\/\/raw\.githubusercontent\.com\/.*\/example\.png/,
  );
  assert.match(
    first,
    /git clone https:\/\/github\.com\/learner\/my-projects\.git/,
  );
  assert.ok(first.includes('https://octodex.github.com/images/original.png'));
  assert.ok(!first.includes('{{'));
  const initialWrites = h.api.writes().length;
  await h.run();
  assert.equal(h.api.writes().length, initialWrites);
  await reach(h, '3-4');
  assert.equal(h.api.issues.length, 5);
  assert.deepEqual(
    h.api.issues.slice(1).map((issue) => issue.title),
    WORKSHOP.backlogItems.map((issue) => issue.title),
  );
  assert.ok(
    h.api.issues
      .slice(1)
      .every(
        (issue) => issue.user.type === 'User' && issue.user.login === 'learner',
      ),
  );
  assert.deepEqual(await h.say('/done 3-4'), {
    status: 'complete',
    completed: 12,
  });
  const state = h.api.state();
  assert.deepEqual(state.completed, LESSON_IDS);
  assert.equal(Object.keys(state.evidence).length, 12);
  assert.equal(state.projectUrl, 'https://github.com/users/learner/projects/7');
  assert.deepEqual(state.pullRequest, { number: 31, headSha: HEAD });
  assert.equal(state.evidence['1-1'].mode, 'mixed');
  assert.equal(state.evidence['1-1'].native, 'issues.get');
  assert.deepEqual(state.evidence['1-1'].samples, state.samples);
  assert.equal(state.evidence['2-2'].native, 'blocked_by');
  assert.equal(state.evidence['2-3'].headSha, HEAD);
  assert.equal(state.evidence['2-4'].mergeSha, MERGE);
  assert.equal(state.evidence['2-4'].projectUi, 'SELF-CONFIRMED');
  for (const lesson of WORKSHOP.lessons) {
    assert.equal(h.api.messages(`lesson:${lesson.id}`).length, 1);
    assert.equal(h.api.messages(`feedback:${lesson.id}`).length, 1);
    assert.ok(
      !h.api
        .messages(`lesson:${lesson.id}`)[0]
        .body.includes(
          '**Project UI: SELF-CONFIRMED.** Mona never calls the Projects API.',
        ),
    );
    assert.ok(state.evidence[lesson.id].feedback.length > 10);
  }
  assert.match(h.api.messages('feedback:1-3')[0].body, /Lab 1 complete/);
  assert.match(h.api.messages('feedback:2-4')[0].body, /Lab 2 complete/);
  assert.match(h.api.messages('complete')[0].body, /REPOSITORY-VERIFIED/);
  assert.match(h.api.messages('complete')[0].body, /SELF-CONFIRMED/);
  assert.match(h.api.messages('complete')[0].body, /never API-verified/);
  assert.equal(h.api.exercise().state, 'closed');
  assert.equal(
    h.api.issues.find(
      (issue) => issue.number === state.samples.verification.number,
    ).state,
    'open',
  );
  assert.deepEqual(
    h.api.calls
      .filter((call) => call.method === 'closeExercise')
      .map((call) => call.args[0]),
    [h.api.exercise().number],
  );
  assert.ok(
    h.api.calls.some(
      (call) => call.method === 'readRepositoryFile' && call.args[1] === MERGE,
    ),
  );
  const writes = h.api.writes().length;
  await h.run();
  assert.equal(h.api.writes().length, writes);
  assert.equal(h.api.counts('createIssue'), 1);
});

test('source repositories and companion roles do not even read the API', async (t) => {
  for (const repository of WORKSHOP.sourceRepositories)
    await t.test(repository, async () => {
      const h = harness({ repository, owner: repository.split('/')[0] });
      assert.equal((await h.run()).reason, 'source-repository');
      assert.equal(h.api.calls.length, 0);
    });
  for (const role of ['companion', 'lab-2', 'lab-3'])
    await t.test(role, async () => {
      const h = harness();
      h.workshop.role = role;
      assert.equal((await h.run()).reason, 'companion-role');
      assert.equal(h.api.calls.length, 0);
    });
});

test('template/private/default-branch and owner guards also prevent existing progress', async (t) => {
  for (const [field, value] of [
    ['is_template', true],
    ['is_template', undefined],
    ['private', false],
    ['visibility', 'public'],
    ['default_branch', 'dev'],
  ]) {
    await t.test(`${field}=${value}`, async () => {
      const h = harness();
      await h.run();
      const saved = h.api.stateComment().body;
      h.api.repository[field] = value;
      const writes = h.api.writes().length;
      await h.say('/project https://github.com/users/learner/projects/1');
      assert.equal(h.api.stateComment().body, saved);
      assert.equal(h.api.writes().length, writes);
    });
  }
  const h = harness();
  assert.equal(
    (await h.run({ actor: 'intruder' })).reason,
    'not-repository-owner',
  );
  assert.equal(h.api.issues.length, 0);
  assert.equal(
    (await h.run({ eventName: 'push', event: { ref: 'refs/heads/feature' } }))
      .reason,
    'not-default-branch',
  );
});

test('organization copies require actor-specific repository admin and bind that one learner', async () => {
  const h = harness({ owner: 'my-org', type: 'Organization' });
  h.api.permission = { permission: 'write', user: user() };
  assert.equal((await h.run()).reason, 'not-repository-owner-admin');
  assert.equal(h.api.issues.length, 0);
  h.api.permission = { permission: 'admin', user: user('somebody') };
  assert.equal((await h.run()).reason, 'not-repository-owner-admin');
  h.api.permission = { permission: 'admin', user: user() };
  await h.run();
  assert.equal(h.api.state().learner, 'learner');
  await h.say('/project https://github.com/users/my-org/projects/8');
  assert.equal(h.api.state().completed.length, 0);
  await h.say('/project https://github.com/orgs/my-org/projects/8');
  assert.equal(h.api.state().completed.length, 1);
  const writes = h.api.writes().length;
  await h.say('/done 1-1', user('other-admin'));
  assert.equal(h.api.writes().length, writes);
});

test('strict project URL validation rejects normalization and ownership tricks without network', () => {
  const invalid = [
    'http://github.com/users/learner/projects/1',
    'https://github.com.evil/users/learner/projects/1',
    'https://github.com@evil.test/users/learner/projects/1',
    'https://x@github.com/users/learner/projects/1',
    'https://github.com:443/users/learner/projects/1',
    'https://GITHUB.COM/users/learner/projects/1',
    'https://github.com/users/other/projects/1',
    'https://github.com/orgs/learner/projects/1',
    'https://github.com/users/%6cearner/projects/1',
    'https://github.com/users/learner/projects/%31',
    'https://github.com/users/learner/projects/01',
    'https://github.com/users/learner/projects/0',
    'https://github.com/users/learner/projects/-1',
    'https://github.com/users/learner/projects/1/',
    'https://github.com/users/learner/projects/1?x=y',
    'https://github.com/users/learner/projects/1#',
    'https://github.com/users/learner/projects/9007199254740992',
    'https://github.com/users/x/../learner/projects/1',
    'https://github.com/users/learner/projects/1\n',
    'https://github.com/users/learner/projects/1%2f',
    'https://github.com\\users\\learner\\projects\\1',
  ];
  for (const url of invalid)
    assert.equal(validateProjectUrl(url, 'learner', 'User'), null, url);
  assert.equal(
    validateProjectUrl(
      'https://github.com/users/LEARNER/projects/12',
      'learner',
      'User',
    ),
    'https://github.com/users/learner/projects/12',
  );
  assert.equal(
    validateProjectUrl(
      'https://github.com/orgs/my-org/projects/1',
      'my-org',
      'Organization',
    ),
    'https://github.com/orgs/my-org/projects/1',
  );
});

test('commands are exact data, never execution; no skip, reset or done bypass', async () => {
  const h = harness();
  await h.run();
  await h.say('/done 1-0');
  assert.equal(h.api.state().completed.length, 0);
  await reach(h, '2-2');
  const before = h.api.state().completed;
  const hostile = [
    '/done 2-2',
    '/done 2-3',
    '/done 2-4',
    '/done 3-4',
    '/check 2-3 #31',
    '/skip',
    '/reset',
    '/check 2-2; whoami',
    '/check 2-2\n/done 3-4',
    '/CHECK 2-2',
    ' /check 2-2',
    '/check 2-2 ',
    '/check 2-2\u0000',
    '/project $(touch owned)',
    '/project `whoami`',
    '/check 2-3 #01',
    '/check 2-3 #9007199254740992',
    '/done 2-1',
  ];
  for (const command of hostile) await h.say(command);
  assert.deepEqual(h.api.state().completed, before);
  assert.equal(h.api.counts('getPullRequest'), 0);
  assert.equal(h.api.counts('listBlockedBy'), 0);
  assert.equal(h.api.counts('closeExercise'), 0);
  for (const command of [
    '/reset',
    '/skip',
    '/check 2-2\n',
    '/done 1-1 ',
    '/help\n',
  ])
    assert.equal(parseCommand(command), null);
  await h.say('/help');
  await h.say('/status');
  assert.deepEqual(h.api.state().completed, before);
  assert.match(h.api.comments.at(-1).body, /SELF-CONFIRMED/);
});

test('other actors, unrelated issues, PR comments and pre-creation events cannot progress or seed', async () => {
  const h = harness();
  const unrelated = h.api.addIssue({ author: user() });
  const early = h.api.addComment(unrelated.number, '/done 1-1');
  await h.run(h.eventFor(early, unrelated));
  assert.equal(h.api.counts('createIssue'), 0);
  await h.run();
  const saved = h.api.stateComment().body;
  await h.say(
    '/project https://github.com/users/learner/projects/7',
    user('intruder'),
  );
  const other = h.api.addComment(
    unrelated.number,
    '/project https://github.com/users/learner/projects/7',
  );
  await h.run(h.eventFor(other, unrelated));
  const onPR = h.api.addComment(
    h.api.exercise().number,
    '/project https://github.com/users/learner/projects/7',
  );
  await h.run(h.eventFor(onPR, { ...h.api.exercise(), pull_request: {} }));
  // The fake has no PR endpoint; remove its artificial same-issue comment before
  // testing a real canonical issue list (GitHub cannot turn an issue into a PR).
  h.api.comments = h.api.comments.filter((comment) => comment.id !== onPR.id);
  assert.equal(h.api.stateComment().body, saved);
  assert.equal(h.api.state().completed.length, 0);
  const botCommand = h.api.addComment(
    h.api.exercise().number,
    '/project https://github.com/users/learner/projects/7',
    botUser(),
  );
  await h.run(h.eventFor(botCommand));
  assert.equal(h.api.state().completed.length, 0);
});

test('coalesced/reordered/stale events drain canonical created comments once and ignore edits', async () => {
  const h = harness();
  await h.run();
  const number = h.api.exercise().number;
  const early = h.api.addComment(
    number,
    '/project https://github.com/users/learner/projects/7',
    user(),
    {
      id: 999,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
  );
  const first = h.api.addComment(
    number,
    '/project https://github.com/users/learner/projects/7',
  );
  const command = backlogCommand(h.api.addLearnerBacklog());
  const second = h.api.addComment(number, command);
  const duplicate = h.api.addComment(number, command);
  const edited = h.api.addComment(number, '/done 1-2', user(), {
    updated_at: '2027-01-01T00:00:00Z',
  });
  const third = h.api.addComment(number, '/done 1-2');
  h.api.comments.reverse();
  await h.run({
    ...h.eventFor(third),
    event: {
      ...h.eventFor(third).event,
      comment: { ...third, body: '/done 3-4' },
    },
  });
  assert.deepEqual(h.api.state().completed, ['1-0', '1-1', '1-2']);
  assert.equal(h.api.state().lastProcessedHumanCommentId, third.id);
  assert.ok(
    !Object.values(h.api.state().evidence).some((item) =>
      [early.id, duplicate.id, edited.id].includes(item.commentId),
    ),
  );
  const writes = h.api.writes().length;
  for (const comment of [first, second, third])
    await h.run(h.eventFor(comment));
  assert.equal(h.api.writes().length, writes);
});

test('forged human issues/comments are never trusted, nor do forged publication markers suppress a lesson', async () => {
  const h = harness();
  const fakeBinding = bindingFor(
    h.workshop,
    h.api.repository,
    'learner',
    'exercise',
  );
  h.api.addIssue({
    author: user(),
    body: `${WORKSHOP.exerciseMarker}\n${encodeBinding(fakeBinding)}`,
  });
  h.api.addIssue({ author: user(), body: sampleMarker('feature') });
  await h.run();
  assert.equal(h.api.counts('createIssue'), 1);
  assert.equal(h.api.state().samples, null);
  const forged = { ...h.api.state(), completed: [...LESSON_IDS] };
  h.api.addComment(
    h.api.exercise().number,
    encodeState(WORKSHOP, forged),
    user(),
  );
  h.api.addComment(
    h.api.exercise().number,
    `${messageMarker('lesson:1-1')}\nforged`,
    user(),
  );
  await h.say('/project https://github.com/users/learner/projects/7');
  assert.deepEqual(h.api.state().completed, ['1-0']);
  assert.equal(h.api.messages('lesson:1-1').length, 1);
});

test('corrupt/misbound/missing/ambiguous bot state fails closed without resetting', async (t) => {
  const mutations = {
    base64: (h) => {
      h.api.stateComment().body = `<!-- ${WORKSHOP.stateMarker} not-base64! -->`;
    },
    wrongRepo: (h) => {
      const s = h.api.state();
      s.repository = 'other/repo';
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
    wrongOwner: (h) => {
      const s = h.api.state();
      s.owner = 'other';
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
    wrongLearner: (h) => {
      const s = h.api.state();
      s.learner = 'other';
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
    wrongFence: (h) => {
      const s = h.api.state();
      s.readyAfterCommentId += 1;
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
    outOfOrder: (h) => {
      const s = h.api.state();
      s.completed = ['1-1'];
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
    missing: (h) => {
      h.api.comments = h.api.comments.filter(
        (comment) => comment.id !== h.api.stateComment().id,
      );
    },
    duplicate: (h) => {
      h.api.addComment(
        h.api.exercise().number,
        h.api.stateComment().body,
        botUser(),
      );
    },
    binding: (h) => {
      h.api.exercise();
      const ex = h.api.issues.find(
        (issue) => issue.number === h.api.exercise().number,
      );
      ex.body = `${WORKSHOP.exerciseMarker}\n${encodeBinding({ ...decodeState(WORKSHOP, h.api.stateComment().body), learner: 'other' })}`;
    },
    prematureMap: (h) => {
      const s = h.api.state();
      s.samples = {};
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
    absentMap: (h) => {
      const s = h.api.state();
      delete s.samples;
      h.api.stateComment().body = encodeState(WORKSHOP, s);
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const h = harness();
      await h.run();
      mutate(h);
      const before = structuredClone(h.api.comments);
      const writes = h.api.writes().length;
      await assert.rejects(h.run());
      assert.deepEqual(h.api.comments, before);
      assert.equal(h.api.writes().length, writes);
    });
});

test('a syntactically valid old state cannot roll back already published progress', async () => {
  const h = harness();
  await h.run();
  const original = h.api.stateComment().body;
  await h.say('/project https://github.com/users/learner/projects/7');
  h.api.stateComment().body = original;
  const writes = h.api.writes().length;
  await assert.rejects(h.run(), /saved progress conflicts/);
  assert.equal(h.api.stateComment().body, original);
  assert.equal(h.api.writes().length, writes);
});

test('dependency requires actual same-repository native blocked_by and never passes API denial', async () => {
  const h = harness();
  await reach(h, '2-2');
  await h.say('/check 2-2');
  assert.equal(h.api.state().completed.length, 5);
  const implementation = await h.api.getIssue(
    h.api.state().samples.implementation.number,
  );
  h.api.dependencies = [
    {
      ...implementation,
      repository_url: 'https://api.github.com/repos/other/repo',
    },
  ];
  await h.say('/check 2-2');
  assert.equal(h.api.state().completed.length, 5);
  h.api.dependencies = [implementation];
  const command = h.api.addComment(h.api.exercise().number, '/check 2-2');
  const before = h.api.stateComment().body;
  h.api.fail('listBlockedBy');
  await assert.rejects(
    h.run(h.eventFor(command)),
    /complete repository evidence/,
  );
  assert.equal(h.api.stateComment().body, before);
  await h.run(h.eventFor(command));
  assert.equal(h.api.state().completed.length, 6);
});

test('open PR repository checks reject wrong scope, file, native link, branch, author or state', async (t) => {
  const mutations = {
    headRepo: (h) => {
      h.api.pr.head.repo.full_name = 'other/repo';
    },
    baseRepo: (h) => {
      h.api.pr.base.repo.id = 999;
    },
    number: (h) => {
      h.api.pr.number = 32;
    },
    branch: (h) => {
      h.api.pr.head.ref = 'workshop/wrong';
    },
    base: (h) => {
      h.api.pr.base.ref = 'dev';
    },
    author: (h) => {
      h.api.pr.user = user('intruder');
    },
    botAuthor: (h) => {
      h.api.pr.user = botUser();
    },
    file: (h) => {
      h.api.files[0].filename = 'other.md';
    },
    added: (h) => {
      h.api.files[0].status = 'added';
    },
    renamed: (h) => {
      h.api.files[0].status = 'renamed';
    },
    files: (h) => {
      h.api.files.push({ filename: 'extra.md', status: 'modified' });
    },
    totalCount: (h) => {
      h.api.pr.changed_files = 2;
    },
    noNativeLink: (h) => {
      h.api.closing = [];
    },
    foreignLink: (h) => {
      h.api.closing[0].repository.nameWithOwner = 'other/repo';
    },
    wrongIssue: (h) => {
      h.api.closing[0].number += 1;
    },
    requiredLine: (h) => {
      h.api.contents.set(HEAD, `prefix ${WORKSHOP.requiredWorkText}`);
    },
    closed: (h) => {
      h.api.pr.state = 'closed';
    },
    alreadyMerged: (h) => {
      h.api.mergePR();
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const h = harness();
      await reach(h, '2-3');
      h.api.configurePR();
      mutate(h);
      await h.say('/check 2-3 #31');
      assert.equal(h.api.state().completed.length, 6);
      assert.equal(h.api.state().pullRequest, null);
      assert.match(h.api.comments.at(-1).body, /no progress changed/);
    });
});

test('merge gate requires same checked PR/head, actual merge, completed issue, open verification and merged content', async (t) => {
  const mutations = {
    notMerged: (h) => {
      h.api.pr.merged = false;
    },
    open: (h) => {
      h.api.pr.state = 'open';
    },
    noMergedAt: (h) => {
      h.api.pr.merged_at = null;
    },
    changedHead: (h) => {
      h.api.pr.head.sha = 'd'.repeat(40);
    },
    changedBase: (h) => {
      h.api.pr.base.ref = 'dev';
    },
    noNativeLink: (h) => {
      h.api.closing = [];
    },
    issueOpen: (h) => {
      h.api.issues.find(
        (issue) => issue.number === h.api.state().samples.implementation.number,
      ).state = 'open';
    },
    notPlanned: (h) => {
      h.api.issues.find(
        (issue) => issue.number === h.api.state().samples.implementation.number,
      ).state_reason = 'not_planned';
    },
    verificationClosed: (h) => {
      h.api.issues.find(
        (issue) => issue.number === h.api.state().samples.verification.number,
      ).state = 'closed';
    },
    mergedFileMissing: (h) => {
      h.api.contents.set(MERGE, '- [ ] Publish the service release checklist');
    },
  };
  for (const [name, mutate] of Object.entries(mutations))
    await t.test(name, async () => {
      const h = harness();
      await reach(h, '2-4');
      h.api.mergePR();
      mutate(h);
      await h.say('/check 2-4 #31');
      assert.equal(h.api.state().completed.length, 7);
    });
  const h = harness();
  await reach(h, '2-4');
  h.api.mergePR();
  const checks = h.api.counts('getPullRequest');
  await h.say('/check 2-4 #32');
  await h.say('/done 2-4');
  assert.equal(h.api.counts('getPullRequest'), checks);
  assert.equal(h.api.state().completed.length, 7);
});

test('PR changing while checks run fails rather than committing a torn evidence snapshot', async () => {
  const h = harness();
  await reach(h, '2-3');
  h.api.configurePR();
  const original = h.api.getPullRequest;
  let reads = 0;
  h.api.getPullRequest = async (number) => {
    reads += 1;
    const pr = await original(number);
    return reads === 2
      ? { ...pr, head: { ...pr.head, sha: 'd'.repeat(40) } }
      : pr;
  };
  await h.say('/check 2-3 #31');
  assert.equal(h.api.state().completed.length, 6);
  assert.match(h.api.comments.at(-1).body, /changed during verification/);
});

test('one-issue bootstrap recovers before/after ambiguous API failures without duplicating exercise or state', async (t) => {
  for (const target of ['exercise', 'state'])
    for (const after of [false, true])
      await t.test(`${target}; committed=${after}`, async () => {
        const h = harness();
        if (target === 'state')
          h.api.fail('createComment', {
            after,
            where: (_number, body) => body.includes(WORKSHOP.stateMarker),
          });
        else
          h.api.fail('createIssue', {
            after,
            where: ({ body }) => body.includes(WORKSHOP.exerciseMarker),
          });
        await assert.rejects(h.run());
        await h.run();
        assert.equal(h.api.issues.length, 1);
        assert.equal(
          h.api.comments.filter((comment) =>
            comment.body.includes(WORKSHOP.stateMarker),
          ).length,
          1,
        );
        assert.equal(h.api.messages('lesson:1-0').length, 1);
        assert.equal(h.api.state().completed.length, 0);
        assert.equal(h.api.state().samples, null);
        assert.equal(h.api.counts('getIssue'), 0);
      });
});

test('persist completion before posting; retry PATCH/feedback/next-lesson failures without double advancement', async (t) => {
  for (const target of ['state', 'feedback', 'lesson'])
    for (const after of [false, true])
      await t.test(`${target}; committed=${after}`, async () => {
        const h = harness();
        await h.run();
        const command = h.api.addComment(
          h.api.exercise().number,
          '/project https://github.com/users/learner/projects/7',
        );
        if (target === 'state') h.api.fail('updateComment', { after });
        else
          h.api.fail('createComment', {
            after,
            where: (_number, body) =>
              body.startsWith(
                messageMarker(`${target}:1-${target === 'lesson' ? '1' : '0'}`),
              ),
          });
        await assert.rejects(h.run(h.eventFor(command)));
        assert.equal(
          h.api.state().completed.length,
          target === 'state' && !after ? 0 : 1,
        );
        await h.run(h.eventFor(command));
        assert.deepEqual(h.api.state().completed, ['1-0']);
        assert.equal(h.api.state().lastProcessedHumanCommentId, command.id);
        assert.equal(h.api.messages('feedback:1-0').length, 1);
        assert.equal(h.api.messages('lesson:1-1').length, 1);
        const writes = h.api.writes().length;
        await h.run(h.eventFor(command));
        assert.equal(h.api.writes().length, writes);
      });
});

test('first lesson publication / ready fence and final recap / issue close recover partial failures', async (t) => {
  for (const after of [false, true])
    await t.test(`first publication committed=${after}`, async () => {
      const h = harness();
      h.api.fail('createComment', {
        after,
        where: (_number, body) => body.startsWith(messageMarker('lesson:1-0')),
      });
      await assert.rejects(h.run());
      if (!after)
        h.api.addComment(
          h.api.exercise().number,
          '/project https://github.com/users/learner/projects/7',
        );
      await h.run();
      assert.equal(h.api.state().completed.length, 0);
      assert.equal(h.api.messages('lesson:1-0').length, 1);
      assert.equal(
        h.api.state().readyAfterCommentId,
        h.api.messages('lesson:1-0')[0].id,
      );
    });
  for (const target of ['complete', 'close'])
    for (const after of [false, true])
      await t.test(`${target} committed=${after}`, async () => {
        const h = harness();
        await reach(h, '3-4');
        if (target === 'close') h.api.fail('closeExercise', { after });
        else
          h.api.fail('createComment', {
            after,
            where: (_number, body) =>
              body.startsWith(messageMarker('complete')),
          });
        await assert.rejects(h.say('/done 3-4'));
        assert.equal(h.api.state().completed.length, 12);
        await h.run();
        assert.equal(h.api.messages('complete').length, 1);
        assert.equal(h.api.messages('feedback:3-4').length, 1);
        assert.equal(h.api.exercise().state, 'closed');
        assert.equal(h.api.state().completed.length, 12);
      });
});

test('creation-fence PATCH and unavailable next lesson are recoverable without losing evidence', async (t) => {
  for (const after of [false, true])
    await t.test(`fence committed=${after}`, async () => {
      const h = harness();
      h.api.fail('updateComment', { after });
      await assert.rejects(h.run());
      assert.equal(h.api.messages('lesson:1-0').length, 1);
      await h.run();
      assert.equal(h.api.messages('lesson:1-0').length, 1);
      assert.equal(
        h.api.state().readyAfterCommentId,
        h.api.messages('lesson:1-0')[0].id,
      );
    });
  const h = harness();
  await h.run();
  const comment = h.api.addComment(
    h.api.exercise().number,
    '/project https://github.com/users/learner/projects/7',
  );
  await assert.rejects(
    runMona({
      workshop: WORKSHOP,
      api: h.api,
      context: {
        repository: h.api.repository.full_name,
        ...h.eventFor(comment),
      },
      loadLesson: async () => {
        throw new Error('temporarily unavailable lesson');
      },
    }),
    /temporarily unavailable lesson/,
  );
  assert.equal(h.api.state().completed.length, 1);
  assert.equal(h.api.messages('feedback:1-0').length, 1);
  assert.equal(h.api.messages('lesson:1-1').length, 0);
  await h.run();
  assert.equal(h.api.state().completed.length, 1);
  assert.equal(h.api.messages('lesson:1-1').length, 1);
});

test('pure reducer does not mutate input and rendering substitutes safely using public images', async () => {
  const h = harness();
  await h.run();
  const state = h.api.state();
  const snapshot = structuredClone(state);
  const comment = {
    id: state.readyAfterCommentId + 100,
    body: '/project https://github.com/users/learner/projects/6',
  };
  const plan = planCommand(WORKSHOP, state, comment.body);
  const next = recordDecision(WORKSHOP, state, comment, plan);
  assert.deepEqual(state, snapshot);
  assert.equal(next.completed.length, 1);
  const source =
    '![inline](../../assets/screenshots/a.png)\n![ref][shot]\n[shot]: ../b.png "caption"\n<img src="../../c.png">\n{{CLONE_COMMAND}}';
  const rendered = renderLesson(WORKSHOP, next, WORKSHOP.lessons[0], source);
  for (const image of ['a.png', 'b.png', 'c.png'])
    assert.ok(rendered.includes(`${WORKSHOP.publicAssetBase}${image}`));
  assert.throws(() =>
    renderLesson(WORKSHOP, next, WORKSHOP.lessons[0], '{{UNKNOWN}}'),
  );
  assert.throws(() =>
    renderLesson(WORKSHOP, next, WORKSHOP.lessons[0], '![x](javascript:alert)'),
  );
  assert.throws(() =>
    renderLesson(
      WORKSHOP,
      next,
      WORKSHOP.lessons[0],
      '![x](//evil.test/x.png)',
    ),
  );
  const binding = bindingFor(WORKSHOP, h.api.repository, 'learner', 'exercise');
  assert.equal(
    initialState(WORKSHOP, binding, h.api.exercise()).completed.length,
    0,
  );
  assert.equal(initialState(WORKSHOP, binding, h.api.exercise()).samples, null);
});

test('missing lesson loader fails safely before initialization writes', async () => {
  const h = harness();
  await assert.rejects(
    runMona({
      workshop: WORKSHOP,
      api: h.api,
      context: {
        repository: h.api.repository.full_name,
        actor: 'learner',
        eventName: 'workflow_dispatch',
        event: {},
      },
      loadLesson: async () => {
        throw new Error('missing fixture');
      },
    }),
    /missing fixture/,
  );
  assert.equal(h.api.writes().length, 0);
});
