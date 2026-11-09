import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MonaError,
  MODULE_EXERCISE,
  MODULE_STATE,
  MODULE_MESSAGE,
  FIRST_LINK_HELP,
  MODULE_SOURCES,
  validateModule,
  validateModuleReadme,
  extractModuleLesson,
  renderModuleLesson,
  moduleContractHash,
  decodeModuleBinding,
  encodeModuleBinding,
  encodeModuleState,
  decodeModuleState,
  packModule,
  moduleMessageMarker,
  moduleBinding,
  moduleExerciseBody,
  runModule,
} from '../.github/scripts/module-engine.mjs';
import { createGitHubClient } from '../.github/scripts/github-api.mjs';
import { main } from '../.github/scripts/module.mjs';
import {
  MODULE_FIXTURES,
  HEAD,
  MERGE,
  BOT,
  moduleUser,
  moduleBot,
  moduleReadme,
  ModuleFakeGitHub,
  moduleHarness,
  reachModule,
  moduleFakeFetch,
} from './helpers/module-fake-github.mjs';

const rejectedWithoutWrites = async (h, work = () => h.run()) => {
  const writes = h.api.writes().length;
  await assert.rejects(work, MonaError);
  assert.equal(h.api.writes().length, writes);
};
const modifyState = (h, change) => {
  const state = h.api.state();
  change(state);
  h.api.stateComment().body = encodeModuleState(state);
};
const firstCompletedState = (body) => {
  try {
    return decodeModuleState(body).completed.length === 1;
  } catch {
    return false;
  }
};

test('portable schema-v3 fixtures describe exactly two independent four-step alternatives', () => {
  for (const lab of [2, 3]) {
    const module = structuredClone(MODULE_FIXTURES[lab]);
    assert.equal(validateModule(module), module);
    assert.equal(
      validateModuleReadme(module, moduleReadme(module)).length > 100,
      true,
    );
    assert.equal(
      module.lessons.reduce((sum, lesson) => sum + lesson.minutes, 0),
      45,
    );
    assert.match(moduleContractHash(module), /^[a-f\d]{64}$/);
    assert.equal(
      moduleContractHash(Object.fromEntries(Object.entries(module).reverse())),
      moduleContractHash(module),
    );
  }
});

test('metadata cannot inject commands, files, source repositories, assets, timing or extra lessons', async (t) => {
  const cases = {
    legacy: (m) => {
      m.schemaVersion = 2;
    },
    starterRole: (m) => {
      m.role = 'starter';
    },
    wrongLab: (m) => {
      m.lab = 1;
    },
    duration: (m) => {
      m.minutes = 35;
    },
    continuation: (m) => {
      m.continuationMinutes = 45;
    },
    automaticIssues: (m) => {
      m.bootstrapIssueLimit = 3;
    },
    branch: (m) => {
      m.defaultBranch = 'dev';
    },
    starter: (m) => {
      m.starterRepository = 'evil/template';
    },
    source: (m) => {
      m.sourceRepositories[1] = 'evil/source';
    },
    sourceSubset: (m) => {
      m.sourceRepositories.pop();
    },
    assetsHost: (m) => {
      m.publicAssetBase = 'https://evil.invalid/assets/';
    },
    assetsWrongLab: (m) => {
      m.publicAssetBase = MODULE_FIXTURES[3].publicAssetBase;
    },
    assetsQuery: (m) => {
      m.publicAssetBase += '?x=y';
    },
    workBranch: (m) => {
      m.workBranch = 'arbitrary';
    },
    workFile: (m) => {
      m.workFile = '.github/workflows/run.yml';
    },
    requiredText: (m) => {
      m.requiredWorkText = 'anything';
    },
    roleTitle: (m) => {
      m.workItems[0].title += ' ';
    },
    roleOrder: (m) => {
      m.workItems.reverse();
    },
    roleMetadata: (m) => {
      m.workItems[0].body = 'execute this';
    },
    firstCommand: (m) => {
      m.lessons[0].command = '/project YOUR_PROJECT_URL';
    },
    firstMode: (m) => {
      m.lessons[0].mode = 'self-confirmed';
    },
    checkCommand: (m) => {
      m.lessons[1].command = '/done 2-2';
    },
    stepTime: (m) => {
      m.lessons[0].minutes = 8;
    },
    image: (m) => {
      m.lessons[0].image = '../remote.png';
    },
    titleMarkup: (m) => {
      m.lessons[0].title = '<script>bad</script>';
    },
    extraStep: (m) => {
      m.lessons.push(m.lessons[3]);
    },
    flexiblePath: (m) => {
      m.lessons[0].file = 'other.md';
    },
    unknownConfig: (m) => {
      m.command = 'run a script';
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      change(h.module);
      await rejectedWithoutWrites(h);
      assert.equal(h.api.calls.length, 0);
    });
});

test('README extraction includes exactly the requested em-dash section, not fenced headings or surrounding guides', () => {
  const readme =
    '# Guide\n\n## Welcome\nnot posted\n\n## Step 1 — Setup\nfirst\n```text\n## Step 2 — fake\n## Other\n```\nlast\n\n## Step 2 — Actual\nsecond\n\n## Troubleshooting\nnot posted\n';
  assert.equal(
    extractModuleLesson(readme, 1),
    '## Step 1 — Setup\nfirst\n```text\n## Step 2 — fake\n## Other\n```\nlast',
  );
  assert.equal(
    extractModuleLesson(readme.replaceAll('\n', '\r\n'), 2),
    '## Step 2 — Actual\nsecond',
  );
  for (const source of [
    readme + '\n## Step 1 — Duplicate\n',
    readme.replace('Step 1 —', 'Step 1 -'),
    readme.replace('## Step 1', '### Step 1'),
    '## Step 2 — Only\n',
    'x'.repeat(512_001),
  ])
    assert.throws(() => extractModuleLesson(source, 1), MonaError);
  for (const step of [0, 5, '1', null])
    assert.throws(() => extractModuleLesson(readme, step), MonaError);
});

test('first lesson has null samples, only its own README section, public images and no confusing footer placeholders', async () => {
  const h = moduleHarness();
  await h.run();
  const state = h.api.state();
  assert.equal(state.samples, null);
  assert.equal(state.projectUrl, null);
  const body = h.api.messages('lesson:2-1')[0].body;
  assert.ok(body.includes('## Step 1 —'));
  assert.ok(body.includes(`${h.module.publicAssetBase}lab-2-step-1.png`));
  assert.ok(body.endsWith(FIRST_LINK_HELP));
  for (const absent of [
    'Preamble',
    '## Step 2',
    '## Troubleshooting',
    '{{',
    'YOUR_PROJECT_URL',
    '/project',
    'PAT',
    'SELF-CONFIRMED',
  ])
    assert.ok(!body.includes(absent), absent);
  assert.throws(
    () => renderModuleLesson(h.module, state, h.module.lessons[1], h.readme),
    /unbound/,
  );
  assert.equal(h.api.counts('createIssue'), 1);
  assert.equal(h.api.issues.length, 1);
  assert.equal(h.api.counts('getIssue'), 0);
  const writes = h.api.writes().length;
  await h.run();
  assert.equal(h.api.writes().length, writes);
});

test('unknown, unbound, malformed or reserved README placeholders fail before bootstrap', async (t) => {
  for (const token of [
    '{{ISSUE_implementation}}',
    '{{ISSUE_verification}}',
    '{{PR_NUMBER}}',
    '{{PROJECT_URL}}',
    '{{UNKNOWN}}',
    '{{BROKEN',
    '<!-- bsp-module-state:v1 nope -->',
  ])
    await t.test(token, async () => {
      const h = moduleHarness();
      h.readme = h.readme.replace(
        'Create two native',
        `${token} Create two native`,
      );
      await rejectedWithoutWrites(h);
      assert.equal(h.api.calls.length, 0);
    });
});

test('README images resolve inline/reference/HTML public assets and reject injected hosts or paths before bootstrap', async (t) => {
  const h = moduleHarness();
  h.readme = h.readme.replace(
    '![Navigation](assets/screenshots/lab-2-step-1.png)',
    '![Navigation][first]\n\n[first]: assets/screenshots/lab-2-step-1.png\n\n<img src="./assets/screenshots/lab-2-step-1.png" alt="Navigation">',
  );
  await h.run();
  const body = h.api.messages('lesson:2-1')[0].body;
  assert.equal((body.match(/raw\.githubusercontent\.com/g) ?? []).length, 2);
  for (const target of [
    'https://evil.invalid/image.png',
    'assets/screenshots/lab-3-step-1.png',
    '../assets/screenshots/lab-2-step-1.png',
    'javascript:alert',
    '//evil.invalid/p.png',
  ])
    await t.test(target, async () => {
      const bad = moduleHarness();
      bad.readme = bad.readme.replace(
        'assets/screenshots/lab-2-step-1.png',
        target,
      );
      await rejectedWithoutWrites(bad);
      assert.equal(bad.api.calls.length, 0);
    });
});

for (const lab of [2, 3])
  test(`Lab ${lab}: complete four-step flow, one exercise, manual role IDs, idempotent reruns and exercise-only closure`, async () => {
    const h = moduleHarness({ lab });
    assert.deepEqual(
      await h.run({ eventName: 'push', event: { ref: 'refs/heads/main' } }),
      { status: 'ready', completed: 0 },
    );
    await reachModule(h, 5);
    const state = h.api.state();
    assert.deepEqual(
      state.completed,
      h.module.lessons.map(({ id }) => id),
    );
    assert.deepEqual(state.samples, {
      implementation: { number: 11, id: 511 },
      verification: { number: 29, id: 529 },
    });
    assert.equal(state.projectUrl, h.projectUrl());
    assert.equal(state.learnerId, 77);
    assert.equal(state.exerciseId, h.api.exercise().id);
    assert.equal(state.evidence[`${lab}-1`].native, 'issues.get');
    assert.equal(
      state.evidence[`${lab}-1`].issues.implementation.author.id,
      77,
    );
    assert.deepEqual(state.evidence[`${lab}-1`].samples, state.samples);
    assert.equal(h.api.counts('createIssue'), 1);
    assert.equal(h.api.issues.length, 3);
    assert.equal(
      h.api.issues.filter((issue) => issue.user.type === 'Bot').length,
      1,
    );
    assert.equal(h.api.exercise().state, 'closed');
    assert.equal(h.api.exercise().state_reason, 'completed');
    assert.equal(h.api.work('verification').state, 'open');
    assert.deepEqual(
      h.api.calls
        .filter(({ method }) => method === 'closeExercise')
        .map(({ args }) => args[0]),
      [h.api.exercise().number],
    );
    for (const lesson of h.module.lessons) {
      assert.equal(h.api.messages(`lesson:${lesson.id}`).length, 1);
      assert.equal(h.api.messages(`feedback:${lesson.id}`).length, 1);
      const lessonMessage = h.api.messages(`lesson:${lesson.id}`)[0];
      if (lesson.step > 1)
        assert.ok(lessonMessage.body.includes('#11 and verification #29'));
      assert.equal((lessonMessage.body.match(/^## Step /gm) ?? []).length, 1);
    }
    assert.equal(h.api.messages('complete').length, 1);
    assert.match(h.api.messages('complete')[0].body, /SELF-CONFIRMED/);
    assert.match(
      h.api.messages('complete')[0].body,
      /never calls a Projects API/,
    );
    assert.match(
      h.api.messages('complete')[0].body,
      /other standalone lab is optional/,
    );
    if (lab === 2) {
      assert.equal(state.evidence['2-2'].native, 'blocked_by');
      assert.deepEqual(state.pullRequest, {
        number: 31,
        id: 900031,
        headSha: HEAD,
      });
      assert.equal(state.evidence['2-4'].mergeSha, MERGE);
      assert.ok(
        h.api.calls.some(
          ({ method, args }) =>
            method === 'readRepositoryFile' && args[1] === MERGE,
        ),
      );
    } else {
      assert.equal(state.pullRequest, null);
      assert.equal(h.api.counts('getPullRequest'), 0);
      assert.equal(h.api.counts('listBlockedBy'), 0);
    }
    const writes = h.api.writes().length;
    assert.deepEqual(await h.run(), { status: 'complete', completed: 4 });
    assert.equal(h.api.writes().length, writes);
  });

test('first input accepts raw root/view address-bar links and saves only the immutable canonical root', async (t) => {
  for (const suffix of [
    '',
    '/',
    '/views/3',
    '/views/3/?pane=info&filterQuery=is%3Aopen#item',
  ])
    await t.test(suffix || 'root', async () => {
      const h = moduleHarness();
      await h.run();
      h.api.manualWork();
      const raw = h.projectUrl() + suffix;
      await h.say(raw);
      const state = h.api.state();
      assert.equal(state.completed.length, 1);
      assert.equal(state.projectUrl, h.projectUrl());
      assert.equal(state.evidence['2-1'].command, raw);
      const samples = structuredClone(state.samples);
      await h.say('https://github.com/users/learner/projects/999/views/8');
      assert.equal(h.api.state().projectUrl, h.projectUrl());
      assert.deepEqual(h.api.state().samples, samples);
      assert.equal(h.api.state().completed.length, 1);
    });
});

test('first input is only a raw same-owner Project URL; invalid commands get the friendly first error', async () => {
  const h = moduleHarness();
  await h.run();
  h.api.manualWork();
  const invalid = [
    '/project ' + h.projectUrl(),
    '/start',
    '/done 2-1',
    '/check 2-2',
    '/reset',
    'YOUR_PROJECT_URL',
    'https://github.com/users/other/projects/7',
    'https://github.com/orgs/learner/projects/7',
    'https://github.com.evil.invalid/users/learner/projects/7',
    'https://a@github.com/users/learner/projects/7',
    'http://github.com/users/learner/projects/7',
    h.projectUrl() + '/views/0',
    h.projectUrl() + '\n',
    ` ${h.projectUrl()}`,
    h.projectUrl().replace('/7', '/01'),
    '$(whoami)',
    `<!-- bsp-module-message:v1 e30= -->\n${h.projectUrl()}`,
  ];
  for (const body of invalid) {
    await h.say(body);
    assert.equal(h.api.state().completed.length, 0);
    assert.ok(h.api.comments.at(-1).body.endsWith(FIRST_LINK_HELP));
  }
  assert.equal(h.api.counts('getIssue'), 0);
  assert.equal(h.api.counts('createIssue'), 1);
});

test('missing or duplicate exact work titles never create work issues and invite creating them first', async (t) => {
  for (const kind of [
    'missing-both',
    'missing-one',
    'different-case',
    'trailing-space',
    'duplicate',
    'duplicate-PR',
  ])
    await t.test(kind, async () => {
      const h = moduleHarness();
      await h.run();
      if (kind !== 'missing-both') h.api.manualWork();
      if (kind === 'missing-one')
        h.api.issues = h.api.issues.filter(
          (item) => item !== h.api.work('verification'),
        );
      if (kind === 'different-case')
        h.api.work('implementation').title =
          h.module.workItems[0].title.toLowerCase();
      if (kind === 'trailing-space') h.api.work('implementation').title += ' ';
      if (kind.startsWith('duplicate'))
        h.api.addIssue({
          title: h.module.workItems[0].title,
          ...(kind === 'duplicate-PR' ? { pull_request: {} } : {}),
        });
      await h.say(h.projectUrl());
      assert.equal(h.api.state().completed.length, 0);
      assert.equal(h.api.state().samples, null);
      assert.equal(h.api.state().projectUrl, null);
      assert.equal(h.api.counts('getIssue'), 0);
      assert.equal(h.api.counts('createIssue'), 1);
      assert.match(
        h.api.comments.at(-1).body,
        /Create the two work issues first/,
      );
    });
});

test('manual registration verifies native identity, raw human author ID, date, exact title, non-PR and clean metadata', async (t) => {
  const cases = {
    bot: (h) => {
      h.api.work('implementation').user = moduleBot();
    },
    otherHuman: (h) => {
      h.api.work('implementation').user = moduleUser('someone');
    },
    sameLoginDifferentId: (h) => {
      h.api.work('implementation').user.id = 123;
    },
    pullRequest: (h) => {
      h.api.work('implementation').pull_request = {};
    },
    oldIssue: (h) => {
      h.api.work('implementation').created_at = '2025-01-01T00:00:00Z';
    },
    closedImplementation: (h) => {
      h.api.work('implementation').state = 'closed';
      h.api.work('implementation').state_reason = 'completed';
    },
    closedVerification: (h) => {
      h.api.work('verification').state = 'closed';
    },
    moduleMetadata: (h) => {
      h.api.work('implementation').body = '<!-- bsp-module-state:v1 forged -->';
    },
    legacyMetadata: (h) => {
      h.api.work('verification').body = 'bsp-workshop-binding:v2 forged';
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await h.run();
      h.api.manualWork();
      change(h);
      await h.say(h.projectUrl());
      assert.equal(h.api.state().completed.length, 0);
      assert.equal(h.api.state().samples, null);
      assert.equal(h.api.counts('createIssue'), 1);
      assert.equal(h.api.messages('lesson:2-2').length, 0);
    });
});

test('incomplete/contradictory native issue GETs and inventories do not consume the comment cursor', async (t) => {
  const cases = {
    inventoryBadId: (h) => {
      h.api.work('implementation').id = 0;
    },
    inventoryDuplicateId: (h) => {
      h.api.work('verification').id = h.api.work('implementation').id;
    },
    inventoryDuplicateNumber: (h) => {
      h.api.work('verification').number = h.api.work('implementation').number;
    },
    inventoryWrongRepo: (h) => {
      h.api.work('implementation').repository_url =
        'https://api.github.com/repos/other/repo';
    },
    inventoryMissingTitle: (h) => {
      delete h.api.work('implementation').title;
    },
    inventoryMissingBody: (h) => {
      delete h.api.work('implementation').body;
    },
    noNativeAuthorId: (h) => {
      delete h.api.work('implementation').user.id;
    },
    nonPositiveNativeAuthor: (h) => {
      h.api.work('implementation').user.id = 0;
    },
    getBadId: (h) =>
      h.api.overrides.set('getIssue', (n, original) => ({
        ...original(),
        id: 9999,
      })),
    getWrongNumber: (h) =>
      h.api.overrides.set('getIssue', (n, original) => ({
        ...original(),
        number: 0,
      })),
    getWrongRepo: (h) =>
      h.api.overrides.set('getIssue', (n, original) => ({
        ...original(),
        repository_url: 'https://api.github.com/repos/other/repo',
      })),
    getInvalidDate: (h) =>
      h.api.overrides.set('getIssue', (n, original) => ({
        ...original(),
        created_at: 'yesterday',
      })),
    getUnavailable: (h) => h.api.fail('getIssue'),
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await h.run();
      h.api.manualWork();
      const saved = h.api.stateComment().body;
      change(h);
      await rejectedWithoutWrites(h, () => h.say(h.projectUrl()));
      assert.equal(h.api.stateComment().body, saved);
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('Lab 3 accepts open or completed implementation, but never cancelled implementation or closed verification', async (t) => {
  for (const [state, reason, expected] of [
    ['open', null, 1],
    ['closed', 'completed', 1],
    ['closed', 'not_planned', 0],
    ['closed', null, 0],
  ])
    await t.test(`${state}/${reason}`, async () => {
      const h = moduleHarness({ lab: 3 });
      await h.run();
      h.api.manualWork({ implementation: { state, state_reason: reason } });
      await h.say(h.projectUrl());
      assert.equal(h.api.state().completed.length, expected);
    });
  const h = moduleHarness({ lab: 3 });
  await h.run();
  h.api.manualWork({
    verification: { state: 'closed', state_reason: 'completed' },
  });
  await h.say(h.projectUrl());
  assert.equal(h.api.state().completed.length, 0);
});

test('work issues created at exactly the exercise timestamp are allowed; native GET title changes are not', async () => {
  const h = moduleHarness();
  await h.run();
  h.api.manualWork({
    implementation: { createdAt: h.api.exercise().created_at },
  });
  h.api.overrides.set('getIssue', (n, original) => ({
    ...original(),
    title: 'Changed since inventory',
  }));
  await h.say(h.projectUrl());
  assert.equal(h.api.state().completed.length, 0);
  h.api.overrides.clear();
  await h.say(h.projectUrl());
  assert.equal(h.api.state().completed.length, 1);
});

test('source repositories are guarded without API reads; public/template/default-branch and personal-owner copies cannot write', async (t) => {
  for (const repository of MODULE_SOURCES)
    await t.test(repository, async () => {
      const h = moduleHarness({ repository, owner: repository.split('/')[0] });
      assert.equal((await h.run()).reason, 'source-repository');
      assert.equal(h.api.calls.length, 0);
    });
  for (const [field, value] of [
    ['private', false],
    ['visibility', 'public'],
    ['is_template', true],
    ['is_template', undefined],
    ['default_branch', 'dev'],
  ])
    await t.test(`${field}/${value}`, async () => {
      const h = moduleHarness();
      h.api.repository[field] = value;
      assert.equal((await h.run()).status, 'skipped');
      assert.equal(h.api.writes().length, 0);
      assert.equal(h.api.counts('listIssues'), 0);
    });
  const h = moduleHarness();
  assert.equal(
    (await h.run({ actor: 'intruder' })).reason,
    'not-repository-owner',
  );
  assert.equal(h.api.writes().length, 0);
});

test('organization initialization checks actual actor admin permission and immutable human learner ID, not token permissions', async () => {
  const h = moduleHarness({ owner: 'my-org', type: 'Organization' });
  for (const permission of [
    { permission: 'write', user: moduleUser() },
    { permission: 'admin', user: moduleUser('other-admin') },
    { permission: 'admin', user: { login: 'learner', type: 'Bot', id: 77 } },
    { permission: 'admin', user: { login: 'learner', type: 'User' } },
  ]) {
    h.api.permission = permission;
    assert.equal((await h.run()).reason, 'not-repository-owner-admin');
    assert.equal(h.api.writes().length, 0);
  }
  h.api.permission = { permission: 'admin', user: moduleUser() };
  await h.run();
  h.api.manualWork();
  await h.say(h.projectUrl() + '/views/2?pane=info');
  assert.equal(h.api.state().ownerType, 'Organization');
  assert.equal(h.api.state().learnerId, 77);
  assert.equal(
    h.api.state().projectUrl,
    'https://github.com/orgs/my-org/projects/7',
  );
  const writes = h.api.writes().length;
  await h.run({ actor: 'other-admin' });
  await h.say('/check 2-2', moduleUser('learner', 123));
  assert.equal(h.api.writes().length, writes);
  assert.ok(
    h.api.calls
      .filter(({ method }) => method === 'getCollaboratorPermission')
      .every(({ args }) => args[0] === 'learner'),
  );
});

test('legacy/unknown/mixed/malformed bot namespaces on issues fail closed before creating anything', async (t) => {
  const artifacts = [
    '<!-- bsp-workshop-exercise:v1 -->',
    '<!-- bsp-workshop-exercise:v2 -->',
    '<!-- bsp-module-exercise:v2 -->',
    '<!-- bsp-module-unknown:v1 -->',
    '<!-- bsp-module:v1 -->',
    '<!-- BSP-MODULE-exercise:v1 -->',
    '<!--\n bsp-module-state:v1 e30= -->',
    `${MODULE_EXERCISE}\n<!-- bsp-workshop-state:v2 e30= -->`,
    '<!-- bsp-module-state:v1 e30= -->',
  ];
  for (const artifact of artifacts)
    await t.test(artifact, async () => {
      const h = moduleHarness();
      h.api.addIssue({ body: artifact, author: moduleBot() });
      await rejectedWithoutWrites(h);
      assert.equal(h.api.counts('createIssue'), 0);
    });
  const h = moduleHarness();
  h.api.addIssue({
    author: { login: 'another[bot]', type: 'Bot', id: 9 },
    body: MODULE_EXERCISE,
  });
  await rejectedWithoutWrites(h);
});

test('orphaned markers on unrelated issue/PR conversations are scanned before bootstrap or outbox repair', async (t) => {
  for (const onPR of [false, true])
    for (const artifact of [
      '<!-- bsp-workshop-state:v2 e30= -->',
      '<!-- bsp-module-state:v1 e30= -->',
      '<!-- bsp-module-message:v9 e30= -->',
    ])
      await t.test(`${onPR}/${artifact}`, async () => {
        const h = moduleHarness();
        const issue = h.api.addIssue({ ...(onPR ? { pull_request: {} } : {}) });
        h.api.addComment(issue.number, artifact, moduleBot());
        await rejectedWithoutWrites(h);
        assert.equal(h.api.counts('createIssue'), 0);
      });
  const h = moduleHarness();
  await h.run();
  const other = h.api.addIssue();
  h.api.addComment(other.number, '<!-- bsp-module-unknown:v1 -->', moduleBot());
  await rejectedWithoutWrites(h);
});

test('human-forged issue, state and message markers are ignored and cannot suppress real publication or bind work', async () => {
  const h = moduleHarness({ lab: 3 });
  h.api.addIssue({ author: moduleUser(), body: MODULE_EXERCISE });
  await h.run();
  const exercise = h.api.exercise();
  const binding = moduleBinding(
    h.module,
    h.readme,
    h.api.repository,
    moduleUser(),
    exercise,
  );
  const forged = { ...h.api.state(), completed: ['3-1', '3-2', '3-3', '3-4'] };
  h.api.addComment(exercise.number, encodeModuleState(forged), moduleUser());
  h.api.addComment(
    exercise.number,
    `${moduleMessageMarker(binding, 'lesson:3-2')}\nforged`,
    moduleUser(),
  );
  h.api.manualWork();
  await h.say(h.projectUrl());
  assert.deepEqual(h.api.state().completed, ['3-1']);
  assert.equal(h.api.messages('lesson:3-2').length, 1);
  assert.equal(h.api.counts('createIssue'), 1);
});

test('corrupt or forged saved state and exercise bindings fail closed without reset', async (t) => {
  const cases = {
    base64: (h) => {
      h.api.stateComment().body = `<!-- ${MODULE_STATE} nope! -->`;
    },
    wrongVersion: (h) =>
      modifyState(h, (s) => {
        s.version = 2;
      }),
    repository: (h) =>
      modifyState(h, (s) => {
        s.repository = 'other/repo';
      }),
    repositoryId: (h) =>
      modifyState(h, (s) => {
        s.repositoryId += 1;
      }),
    owner: (h) =>
      modifyState(h, (s) => {
        s.owner = 'other';
      }),
    ownerId: (h) =>
      modifyState(h, (s) => {
        s.ownerId += 1;
      }),
    learner: (h) =>
      modifyState(h, (s) => {
        s.learner = 'other';
      }),
    learnerId: (h) =>
      modifyState(h, (s) => {
        s.learnerId += 1;
      }),
    exerciseId: (h) =>
      modifyState(h, (s) => {
        s.exerciseId += 1;
      }),
    exerciseNumber: (h) =>
      modifyState(h, (s) => {
        s.exerciseNumber += 1;
      }),
    createdAt: (h) =>
      modifyState(h, (s) => {
        s.createdAt = '2026-01-01T00:00:00Z';
      }),
    contract: (h) =>
      modifyState(h, (s) => {
        s.contract = '0'.repeat(64);
      }),
    guideHash: (h) =>
      modifyState(h, (s) => {
        s.guideHash = '0'.repeat(64);
      }),
    skip: (h) =>
      modifyState(h, (s) => {
        s.completed = ['2-2'];
      }),
    earlyMap: (h) =>
      modifyState(h, (s) => {
        s.samples = {
          implementation: { number: 11, id: 511 },
          verification: { number: 29, id: 529 },
        };
      }),
    earlyProject: (h) =>
      modifyState(h, (s) => {
        s.projectUrl = h.projectUrl();
      }),
    earlyPR: (h) =>
      modifyState(h, (s) => {
        s.pullRequest = { number: 31, id: 42, headSha: HEAD };
      }),
    fence: (h) =>
      modifyState(h, (s) => {
        s.readyAfterCommentId += 1;
      }),
    cursor: (h) =>
      modifyState(h, (s) => {
        s.lastProcessedHumanCommentId += 999;
      }),
    outboxHash: (h) =>
      modifyState(h, (s) => {
        s.outbox[0].digest = '0'.repeat(64);
      }),
    outboxKey: (h) =>
      modifyState(h, (s) => {
        s.outbox[0].key = 'lesson:2-4';
      }),
    unknownStateKey: (h) =>
      modifyState(h, (s) => {
        s.reset = true;
      }),
    missing: (h) => {
      h.api.comments = h.api.comments.filter(
        (item) => item !== h.api.stateComment(),
      );
    },
    duplicate: (h) => {
      h.api.addComment(
        h.api.exercise().number,
        h.api.stateComment().body,
        moduleBot(),
      );
    },
    immutableBinding: (h) => {
      const envelope = decodeModuleBinding(h.api.exercise().body);
      envelope.exerciseId += 1;
      h.api.exercise().body = h.api
        .exercise()
        .body.replace(
          /<!-- bsp-module-binding:v1 .* -->/,
          encodeModuleBinding(envelope),
        );
    },
    exerciseNativeId: (h) => {
      h.api.exercise().id += 1;
    },
    ownerNativeId: (h) => {
      h.api.repository.owner.id += 1;
    },
    exerciseTitle: (h) => {
      h.api.exercise().title = 'Not the configured exercise';
    },
    readmeChanged: (h) => {
      h.readme += '\nchanged\n';
    },
    metadataChanged: (h) => {
      h.module.title += ' changed';
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await h.run();
      change(h);
      await rejectedWithoutWrites(h);
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('historical evidence, canonical input and publication integrity are validated before any recovery writes', async (t) => {
  const cases = {
    rebindRoleNumber: (h) =>
      modifyState(h, (s) => {
        s.samples.implementation.number += 10;
      }),
    rebindRoleId: (h) =>
      modifyState(h, (s) => {
        s.samples.verification.id += 10;
      }),
    nonCanonicalProject: (h) =>
      modifyState(h, (s) => {
        s.projectUrl += '/views/2';
      }),
    swappedTitles: (h) =>
      modifyState(h, (s) => {
        s.evidence['2-1'].issues.implementation.title =
          h.module.workItems[1].title;
      }),
    nativeAuthorId: (h) =>
      modifyState(h, (s) => {
        s.evidence['2-1'].issues.implementation.author.id += 1;
      }),
    unknownEvidenceKey: (h) =>
      modifyState(h, (s) => {
        s.evidence['2-1'].override = true;
      }),
    missingNative: (h) =>
      modifyState(h, (s) => {
        delete s.evidence['2-1'].native;
      }),
    commandForgery: (h) =>
      modifyState(h, (s) => {
        s.evidence['2-1'].command =
          'https://github.com/users/learner/projects/8';
      }),
    editedCompletion: (h) => {
      const c = h.api.comments.find(
        (item) => item.id === h.api.state().evidence['2-1'].commentId,
      );
      c.updated_at = h.api.timestamp();
    },
    deletedCompletion: (h) => {
      const id = h.api.state().evidence['2-1'].commentId;
      h.api.comments = h.api.comments.filter((item) => item.id !== id);
    },
    changedPublishedText: (h) => {
      h.api.messages('lesson:2-1')[0].body += '\nchanged';
    },
    missingHistoricalLesson: (h) => {
      const id = h.api.messages('lesson:2-1')[0].id;
      h.api.comments = h.api.comments.filter((item) => item.id !== id);
    },
    duplicateMessage: (h) => {
      h.api.addComment(
        h.api.exercise().number,
        h.api.messages('lesson:2-2')[0].body,
        moduleBot(),
      );
    },
    futureMessage: (h) => {
      const binding = moduleBinding(
        h.module,
        h.readme,
        h.api.repository,
        moduleUser(),
        h.api.exercise(),
      );
      h.api.addComment(
        h.api.exercise().number,
        `${moduleMessageMarker(binding, 'lesson:2-4')}\nforged`,
        moduleBot(),
      );
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await reachModule(h, 2);
      change(h);
      await rejectedWithoutWrites(h);
    });
});

test('events for edits, bots, other authors, unrelated issues, PRs and non-main pushes cannot initialize or progress', async () => {
  const h = moduleHarness();
  assert.equal(
    (await h.run({ eventName: 'pull_request' })).reason,
    'unsupported-event',
  );
  assert.equal(
    (await h.run({ eventName: 'push', event: { ref: 'refs/heads/feature' } }))
      .reason,
    'not-default-branch',
  );
  const other = h.api.addIssue();
  const early = h.api.addComment(other.number, h.projectUrl());
  assert.equal(
    (await h.run(h.eventFor(early, other))).reason,
    'exercise-not-created',
  );
  assert.equal(h.api.counts('createIssue'), 0);
  await h.run();
  const before = h.api.stateComment().body;
  const writes = h.api.writes().length;
  const unrelated = h.api.addComment(other.number, h.projectUrl());
  await h.run(h.eventFor(unrelated, other));
  const own = h.api.addComment(h.api.exercise().number, h.projectUrl());
  const event = h.eventFor(own);
  await h.run({ ...event, event: { ...event.event, action: 'edited' } });
  await h.run({
    ...event,
    event: {
      ...event.event,
      issue: { ...event.event.issue, pull_request: {} },
    },
  });
  // This artificial PR-event comment is not a real canonical issue event.
  h.api.comments = h.api.comments.filter((item) => item.id !== own.id);
  await h.say(h.projectUrl(), moduleUser('intruder'));
  await h.say(h.projectUrl(), moduleUser('learner', 123));
  await h.say(h.projectUrl(), moduleBot());
  assert.equal(h.api.stateComment().body, before);
  assert.equal(h.api.writes().length, writes);
});

test('raw event body forgery cannot complete a step; canonical comment ID, human ID and unedited body are authoritative', async () => {
  const h = moduleHarness();
  await h.run();
  h.api.manualWork();
  const comment = h.api.addComment(
    h.api.exercise().number,
    'not a Project URL',
  );
  const event = h.eventFor(comment);
  event.event.comment.body = h.projectUrl();
  await h.run(event);
  assert.equal(h.api.state().completed.length, 0);
  const edited = h.api.addComment(
    h.api.exercise().number,
    h.projectUrl(),
    moduleUser(),
    { updated_at: '2027-01-01T00:00:00Z' },
  );
  await h.run(h.eventFor(edited));
  assert.equal(h.api.state().completed.length, 0);
  const absent = { ...edited, id: 999999 };
  await rejectedWithoutWrites(h, () => h.run(h.eventFor(absent)));
  await h.say(h.projectUrl());
  assert.equal(h.api.state().completed.length, 1);
});

test('chronological canonical queue handles coalesced/reordered/stale events, duplicates and edited comments', async () => {
  const h = moduleHarness({ lab: 3 });
  await h.run();
  h.api.manualWork();
  const n = h.api.exercise().number;
  const old = h.api.addComment(n, h.projectUrl(), moduleUser(), {
    id: 999,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  });
  const first = h.api.addComment(n, h.projectUrl());
  const duplicate = h.api.addComment(n, h.projectUrl());
  const edited = h.api.addComment(n, '/done 3-2', moduleUser(), {
    updated_at: '2027-01-01T00:00:00Z',
  });
  const second = h.api.addComment(n, '/done 3-2');
  const third = h.api.addComment(n, '/done 3-3');
  const fourth = h.api.addComment(n, '/done 3-4');
  h.api.comments.reverse();
  const event = h.eventFor(fourth);
  event.event.comment.body = '/reset';
  assert.deepEqual(await h.run(event), { status: 'complete', completed: 4 });
  const evidenceIds = Object.values(h.api.state().evidence).map(
    ({ commentId }) => commentId,
  );
  assert.deepEqual(evidenceIds, [first.id, second.id, third.id, fourth.id]);
  for (const item of [old, duplicate, edited])
    assert.ok(!evidenceIds.includes(item.id));
  const writes = h.api.writes().length;
  for (const item of [first, second, third, fourth])
    await h.run(h.eventFor(item));
  assert.equal(h.api.writes().length, writes);
});

test('invalid/out-of-order/duplicate commands cannot skip, rebind or reset; status/help do not award evidence', async () => {
  const h = moduleHarness();
  await reachModule(h, 2);
  const initial = h.api.state();
  for (const body of [
    '/done 2-2',
    '/done 3-4',
    '/check 2-3 #31',
    '/check 2-4 #31',
    '/reset',
    '/skip',
    '/check 2-2; whoami',
    '/check 2-2\n/done 3-4',
    '/CHECK 2-2',
    ' /check 2-2',
    '/check 2-2 ',
    '/check 2-2\u0000',
    '/project ' + h.projectUrl(),
    h.projectUrl(),
    '/help',
    '/status',
  ]) {
    await h.say(body);
    const state = h.api.state();
    assert.deepEqual(state.completed, initial.completed);
    assert.deepEqual(state.samples, initial.samples);
    assert.equal(state.projectUrl, initial.projectUrl);
  }
  assert.equal(h.api.counts('getPullRequest'), 0);
  assert.equal(h.api.counts('listBlockedBy'), 0);
  assert.equal(h.api.counts('closeExercise'), 0);
  assert.ok(
    h.api.comments.some(({ body }) =>
      body.includes('never read through a Projects API'),
    ),
  );
  h.api.dependencies = [h.api.work('implementation')];
  await h.say('/check 2-2');
  await h.say('/check 2-2');
  assert.equal(h.api.state().completed.length, 2);
  assert.equal(h.api.counts('listBlockedBy'), 1);
});

test('native blocked_by direction, repository and immutable issue ID are required, not links or Project fields', async (t) => {
  const cases = {
    empty: () => [],
    reversed: (h) => [h.api.work('verification')],
    wrongId: (h) => [{ ...h.api.work('implementation'), id: 1234 }],
    wrongNumber: (h) => [{ ...h.api.work('implementation'), number: 12 }],
    wrongRepo: (h) => [
      {
        ...h.api.work('implementation'),
        repository_url: 'https://api.github.com/repos/other/repo',
      },
    ],
    PR: (h) => [{ ...h.api.work('implementation'), pull_request: {} }],
    bodyLink: (h) => {
      h.api.work('verification').body =
        `Blocked by #${h.api.work('implementation').number}`;
      return [];
    },
  };
  for (const [name, entries] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await reachModule(h, 2);
      h.api.dependencies = entries(h);
      await h.say('/check 2-2');
      assert.equal(h.api.state().completed.length, 1);
      assert.equal(h.api.messages('lesson:2-3').length, 0);
      assert.equal(
        h.api.calls.findLast(({ method }) => method === 'listBlockedBy')
          .args[0],
        29,
      );
    });
});

test('PR verification rejects wrong scope/author/branch/file/native link/content and changed snapshots', async (t) => {
  const cases = {
    wrongNumber: (h) => {
      h.api.pr.number = 32;
    },
    wrongAuthor: (h) => {
      h.api.pr.user = moduleUser('other');
    },
    wrongHumanId: (h) => {
      h.api.pr.user.id = 123;
    },
    botAuthor: (h) => {
      h.api.pr.user = moduleBot();
    },
    forkHead: (h) => {
      h.api.pr.head.repo.full_name = 'other/repo';
    },
    forkBase: (h) => {
      h.api.pr.base.repo.full_name = 'other/repo';
    },
    differentRepositoryId: (h) => {
      h.api.pr.head.repo.id = 101;
    },
    wrongBranch: (h) => {
      h.api.pr.head.ref = 'workshop/other';
    },
    wrongBase: (h) => {
      h.api.pr.base.ref = 'dev';
    },
    extraFile: (h) => {
      h.api.files.push({ filename: 'extra.md', status: 'modified' });
    },
    extraCount: (h) => {
      h.api.pr.changed_files = 2;
    },
    wrongFile: (h) => {
      h.api.files[0].filename = 'README.md';
    },
    renamedFile: (h) => {
      h.api.files[0].status = 'renamed';
    },
    previousName: (h) => {
      h.api.files[0].previous_filename = 'other.md';
    },
    bodyOnlyClosing: (h) => {
      h.api.closing = [];
    },
    wrongClosingScope: (h) => {
      h.api.closing[0].repository.nameWithOwner = 'other/repo';
    },
    wrongClosingIssue: (h) => {
      h.api.closing[0].number = 29;
    },
    missingLine: (h) => {
      h.api.contents.set(HEAD, '- [ ] Publish the service release checklist');
    },
    substringOnly: (h) => {
      h.api.contents.set(HEAD, h.module.requiredWorkText + ' extra');
    },
    alreadyMerged: (h) => {
      h.api.mergePR();
    },
    closedUnmerged: (h) => {
      h.api.pr.state = 'closed';
    },
    changingHead: (h) =>
      h.api.overrides.set('getPullRequest', (n, original) => {
        const result = structuredClone(original());
        if (h.api.counts('getPullRequest') % 2 === 0)
          result.head.sha = 'd'.repeat(40);
        return result;
      }),
    changingAuthorId: (h) =>
      h.api.overrides.set('getPullRequest', (n, original) => {
        const result = structuredClone(original());
        if (h.api.counts('getPullRequest') % 2 === 0) result.user.id = 123;
        return result;
      }),
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await reachModule(h, 3);
      h.api.configurePR();
      change(h);
      await h.say('/check 2-3 #31');
      assert.equal(h.api.state().completed.length, 2);
      assert.equal(h.api.state().pullRequest, null);
      assert.equal(h.api.messages('lesson:2-4').length, 0);
      assert.equal(h.api.counts('closeExercise'), 0);
    });
});

test('merge verification requires same checked PR/head, real main merge, completed implementation, open verification and merge-ref checklist', async (t) => {
  const cases = {
    wrongPR: (h) => {
      h.api.pr.number = 32;
    },
    wrongImmutablePR: (h) => {
      h.api.pr.id += 1;
    },
    changedHead: (h) => {
      h.api.pr.head.sha = 'd'.repeat(40);
      h.api.contents.set('d'.repeat(40), h.module.requiredWorkText);
    },
    unmerged: (h) => {
      h.api.pr.merged = false;
    },
    stillOpen: (h) => {
      h.api.pr.state = 'open';
    },
    noMergeDate: (h) => {
      h.api.pr.merged_at = null;
    },
    noMergeSha: (h) => {
      h.api.pr.merge_commit_sha = null;
    },
    wrongTarget: (h) => {
      h.api.pr.base.ref = 'dev';
    },
    noMergedLine: (h) => {
      h.api.contents.set(MERGE, '- [ ] Publish the service release checklist');
    },
    implementationOpen: (h) => {
      h.api.work('implementation').state = 'open';
    },
    implementationCancelled: (h) => {
      h.api.work('implementation').state_reason = 'not_planned';
    },
    verificationClosed: (h) => {
      h.api.work('verification').state = 'closed';
    },
    closingReferenceRemoved: (h) => {
      h.api.closing = [];
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const h = moduleHarness();
      await reachModule(h, 4);
      h.api.mergePR();
      change(h);
      await h.say('/check 2-4 #31');
      assert.equal(h.api.state().completed.length, 3);
      assert.equal(h.api.counts('closeExercise'), 0);
      assert.equal(h.api.messages('complete').length, 0);
    });
  const h = moduleHarness();
  await reachModule(h, 4);
  h.api.mergePR();
  const calls = h.api.counts('getPullRequest');
  await h.say('/check 2-4 #32');
  assert.equal(h.api.counts('getPullRequest'), calls);
  assert.equal(h.api.state().completed.length, 3);
});

test('partial GETs and API failures preserve the failing cursor and all committed evidence', async (t) => {
  for (const method of ['listIssues', 'listComments', 'listBlockedBy'])
    await t.test(method, async () => {
      const h = moduleHarness();
      await reachModule(h, 2);
      h.api.dependencies = [h.api.work('implementation')];
      const saved = h.api.stateComment().body;
      h.api.fail(method);
      await rejectedWithoutWrites(h, () => h.say('/check 2-2'));
      assert.equal(h.api.stateComment().body, saved);
      await h.run();
      assert.equal(h.api.state().completed.length, 2);
    });
  for (const method of [
    'getPullRequest',
    'listPullRequestFiles',
    'getClosingIssues',
    'readRepositoryFile',
  ])
    await t.test(method, async () => {
      const h = moduleHarness();
      await reachModule(h, 3);
      h.api.configurePR();
      const saved = h.api.stateComment().body;
      h.api.fail(method);
      await rejectedWithoutWrites(h, () => h.say('/check 2-3 #31'));
      assert.equal(h.api.stateComment().body, saved);
      await h.run();
      assert.equal(h.api.state().completed.length, 3);
    });
  for (const method of [
    'listBlockedBy',
    'listPullRequestFiles',
    'getClosingIssues',
    'readRepositoryFile',
  ])
    await t.test(`partial-${method}`, async () => {
      const h = moduleHarness();
      await reachModule(h, method === 'listBlockedBy' ? 2 : 3);
      if (method !== 'listBlockedBy') h.api.configurePR();
      const saved = h.api.stateComment().body;
      h.api.overrides.set(method, () => null);
      await rejectedWithoutWrites(h, () =>
        h.say(method === 'listBlockedBy' ? '/check 2-2' : '/check 2-3 #31'),
      );
      assert.equal(h.api.stateComment().body, saved);
    });
  const partials = {
    missingPR: (h) => h.api.overrides.set('getPullRequest', () => ({})),
    missingPRId: (h) => {
      delete h.api.pr.id;
    },
    nonPositivePRId: (h) => {
      h.api.pr.id = 0;
    },
    missingAuthor: (h) => {
      delete h.api.pr.user;
    },
    missingHead: (h) => {
      delete h.api.pr.head;
    },
    missingHeadRepo: (h) => {
      delete h.api.pr.head.repo;
    },
    badNativeSha: (h) => {
      h.api.pr.head.sha = '../main';
    },
    missingMergedFlag: (h) => {
      delete h.api.pr.merged;
    },
    invalidNativeDate: (h) => {
      h.api.pr.merged_at = 'yesterday';
    },
    partialFiles: (h) => {
      h.api.files = [{ filename: h.module.workFile }];
    },
    partialClosing: (h) => {
      h.api.closing = [{}];
    },
    partialAfter: (h) =>
      h.api.overrides.set('getPullRequest', (n, original) =>
        h.api.counts('getPullRequest') % 2 === 0 ? {} : original(),
      ),
  };
  for (const [name, change] of Object.entries(partials))
    await t.test(name, async () => {
      const h = moduleHarness();
      await reachModule(h, 3);
      h.api.configurePR();
      const saved = h.api.stateComment().body;
      change(h);
      await rejectedWithoutWrites(h, () => h.say('/check 2-3 #31'));
      assert.equal(h.api.stateComment().body, saved);
    });
  const h = moduleHarness();
  await reachModule(h, 2);
  h.api.dependencies = [{}];
  const saved = h.api.stateComment().body;
  await rejectedWithoutWrites(h, () => h.say('/check 2-2'));
  assert.equal(h.api.stateComment().body, saved);
});

test('interrupted bootstrap POST/PATCH/state/first-lesson operations reconcile without duplicate artifacts', async (t) => {
  const operations = [
    ['createIssue', undefined],
    [
      'updateExercise',
      (n, body) => decodeModuleBinding(body).kind === 'initializing',
    ],
    ['createComment', (n, body) => body.startsWith(`<!-- ${MODULE_STATE} `)],
    [
      'updateExercise',
      (n, body) => decodeModuleBinding(body).kind === 'exercise',
    ],
    ['createComment', (n, body) => body.startsWith(`<!-- ${MODULE_MESSAGE} `)],
    [
      'updateComment',
      (id, body) => decodeModuleState(body).readyAfterCommentId !== null,
    ],
  ];
  for (const [method, where] of operations)
    for (const after of [false, true])
      await t.test(
        `${method}/${operations.findIndex((item) => item[1] === where)}/${after}`,
        async () => {
          const h = moduleHarness();
          h.api.fail(method, { where, after });
          await assert.rejects(() => h.run(), MonaError);
          assert.deepEqual(await h.run(), { status: 'ready', completed: 0 });
          assert.equal(h.api.issues.length, 1);
          assert.equal(
            h.api.comments.filter(
              (item) =>
                item.user.type === 'Bot' &&
                item.body.startsWith(`<!-- ${MODULE_STATE} `),
            ).length,
            1,
          );
          assert.equal(h.api.messages('lesson:2-1').length, 1);
          assert.equal(
            decodeModuleBinding(h.api.exercise().body).kind,
            'exercise',
          );
          const writes = h.api.writes().length;
          await h.run();
          assert.equal(h.api.writes().length, writes);
          if (method === 'createIssue' && after)
            assert.equal(h.api.counts('createIssue'), 1);
        },
      );
});

test('first completion persists URL, native role evidence, completion and cursor in one PATCH before publishing', async () => {
  const h = moduleHarness();
  await h.run();
  h.api.manualWork();
  h.api.fail('createComment', {
    where: (n, body) => body.includes('Project link saved.'),
  });
  const comment = h.api.addComment(
    h.api.exercise().number,
    h.projectUrl() + '/views/2?pane=info',
  );
  await assert.rejects(() => h.run(h.eventFor(comment)), MonaError);
  const state = h.api.state();
  assert.equal(state.completed.length, 1);
  assert.equal(state.lastProcessedHumanCommentId, comment.id);
  assert.equal(state.projectUrl, h.projectUrl());
  assert.equal(state.samples.implementation.id, 511);
  assert.equal(state.evidence['2-1'].issues.implementation.author.id, 77);
  assert.equal(h.api.messages('feedback:2-1').length, 0);
  assert.equal(h.api.messages('lesson:2-2').length, 0);
  const bindingGets = h.api.counts('getIssue');
  await h.run();
  assert.equal(h.api.counts('getIssue'), bindingGets);
  assert.equal(h.api.messages('feedback:2-1').length, 1);
  assert.equal(h.api.messages('lesson:2-2').length, 1);
});

test('interrupted first-completion state and publication responses recover exactly once, including reply outbox', async (t) => {
  const operations = [
    ['updateComment', (id, body) => firstCompletedState(body)],
    ['createComment', (n, body) => body.includes('Project link saved.')],
    ['createComment', (n, body) => body.includes('## Step 2 —')],
    [
      'updateComment',
      (id, body) => {
        const s = decodeModuleState(body);
        return s.completed.length === 1 && s.outbox.at(-1).commentId !== null;
      },
    ],
  ];
  for (const [index, [method, where]] of operations.entries())
    for (const after of [false, true])
      await t.test(`${index}/${after}`, async () => {
        const h = moduleHarness();
        await h.run();
        h.api.manualWork();
        h.api.fail(method, { where, after });
        const comment = h.api.addComment(
          h.api.exercise().number,
          h.projectUrl(),
        );
        await assert.rejects(() => h.run(h.eventFor(comment)), MonaError);
        await h.run();
        assert.deepEqual(h.api.state().completed, ['2-1']);
        assert.equal(h.api.state().evidence['2-1'].commentId, comment.id);
        assert.equal(h.api.messages('feedback:2-1').length, 1);
        assert.equal(h.api.messages('lesson:2-2').length, 1);
        assert.equal(h.api.counts('createIssue'), 1);
      });
  const h = moduleHarness();
  await h.run();
  const comment = h.api.addComment(h.api.exercise().number, '/help');
  h.api.fail('createComment', {
    after: true,
    where: (n, body) => body.includes('never read through a Projects API'),
  });
  await assert.rejects(() => h.run(h.eventFor(comment)), MonaError);
  await h.run();
  assert.equal(h.api.messages(`reply:${comment.id}`).length, 1);
  assert.equal(h.api.state().completed.length, 0);
});

test('completion and close response losses do not repeat lessons or touch work issues', async (t) => {
  for (const method of ['createComment', 'closeExercise'])
    for (const after of [false, true])
      await t.test(`${method}/${after}`, async () => {
        const h = moduleHarness({ lab: 3 });
        await reachModule(h, 4);
        h.api.fail(method, {
          after,
          where:
            method === 'createComment'
              ? (n, body) => body.includes('### Lab 3 complete')
              : undefined,
        });
        const comment = h.api.addComment(h.api.exercise().number, '/done 3-4');
        await assert.rejects(() => h.run(h.eventFor(comment)), MonaError);
        assert.equal(h.api.state().completed.length, 4);
        assert.deepEqual(await h.run(), { status: 'complete', completed: 4 });
        assert.equal(h.api.messages('complete').length, 1);
        assert.equal(h.api.messages('feedback:3-4').length, 1);
        assert.equal(h.api.work('implementation').state, 'open');
        assert.equal(h.api.work('verification').state, 'open');
        assert.ok(
          h.api.calls
            .filter(({ method: name }) => name === 'closeExercise')
            .every(({ args }) => args[0] === h.api.exercise().number),
        );
      });
});

test('a manually closed incomplete exercise pauses without reinitializing or reopening it', async () => {
  const h = moduleHarness();
  await reachModule(h, 2);
  h.api.exercise().state = 'closed';
  h.api.exercise().state_reason = 'not_planned';
  const saved = h.api.stateComment().body;
  const writes = h.api.writes().length;
  assert.deepEqual(await h.run(), {
    status: 'paused',
    reason: 'exercise-closed',
    completed: 1,
  });
  assert.equal(h.api.stateComment().body, saved);
  assert.equal(h.api.writes().length, writes);
});

test('fixed API transport completes a Lab 2 flow with no Project, foreign-host or caller-selected API route', async () => {
  const h = moduleHarness();
  const requests = [];
  const transport = createGitHubClient({
    token: 'unit-test-not-issued',
    repository: h.api.repository.full_name,
    fetchImpl: moduleFakeFetch(h.api, requests),
  });
  const run = () =>
    runModule({
      module: h.module,
      readme: h.readme,
      api: transport,
      context: {
        repository: h.api.repository.full_name,
        actor: 'learner',
        eventName: 'workflow_dispatch',
        event: {},
      },
    });
  await run();
  h.api.manualWork();
  h.api.addComment(
    h.api.exercise().number,
    h.projectUrl() + '/views/4?pane=info',
  );
  await run();
  h.api.dependencies = [h.api.work('implementation')];
  h.api.addComment(h.api.exercise().number, '/check 2-2');
  await run();
  h.api.configurePR();
  h.api.addComment(h.api.exercise().number, '/check 2-3 #31');
  await run();
  h.api.mergePR();
  h.api.addComment(h.api.exercise().number, '/check 2-4 #31');
  assert.deepEqual(await run(), { status: 'complete', completed: 4 });
  assert.ok(
    requests.every(
      ({ path }) =>
        path === '/graphql' ||
        path.startsWith(`/repos/${h.api.repository.full_name}`),
    ),
  );
  assert.ok(
    requests.every(({ path }) => !/projects|actions|git\/refs/.test(path)),
  );
  assert.equal(h.api.counts('createIssue'), 1);
});

test('incomplete transport pagination fails closed before bootstrap, even if a partial page contains a plausible match', async () => {
  const api = new ModuleFakeGitHub();
  const original = moduleFakeFetch(api);
  const transport = createGitHubClient({
    token: 'unit-test-not-issued',
    repository: api.repository.full_name,
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      if (target.pathname.endsWith('/issues'))
        return new Response('[]', {
          status: 200,
          headers: {
            link: `<https://evil.invalid/repos/${api.repository.full_name}/issues?per_page=100&page=2>; rel="next"`,
          },
        });
      return original(url, options);
    },
  });
  await assert.rejects(
    () =>
      runModule({
        module: api.module,
        readme: moduleReadme(api.module),
        api: transport,
        context: {
          repository: api.repository.full_name,
          actor: 'learner',
          eventName: 'workflow_dispatch',
          event: {},
        },
      }),
    MonaError,
  );
  assert.equal(api.writes().length, 0);
});

async function callerFixture(t, lab = 2) {
  const root = await mkdtemp(join(tmpdir(), 'bsp-module-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(
    join(root, 'workshop.json'),
    JSON.stringify(MODULE_FIXTURES[lab]),
  );
  await writeFile(join(root, 'README.md'), moduleReadme(MODULE_FIXTURES[lab]));
  const eventPath = join(root, 'event.json');
  await writeFile(eventPath, '{}');
  return {
    root,
    eventPath,
    env: {
      MODULE_ROOT: root,
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_REPOSITORY: 'learner/optional-lab',
      GITHUB_ACTOR: 'learner',
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GH_TOKEN: 'unit-test-not-issued',
    },
  };
}

test('CLI reads only root metadata/README as data, works without caller module scripts, and returns safe counts', async (t) => {
  const { root, env } = await callerFixture(t, 3);
  const api = new ModuleFakeGitHub({ lab: 3 });
  const original = globalThis.fetch;
  globalThis.fetch = moduleFakeFetch(api);
  t.after(() => {
    globalThis.fetch = original;
  });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { postinstall: 'MUST NEVER EXECUTE' } }),
  );
  await mkdir(join(root, '.github', 'scripts'), { recursive: true });
  await writeFile(
    join(root, '.github', 'scripts', 'module.mjs'),
    'throw new Error("caller code executed");',
  );
  assert.deepEqual(await main(env), { status: 'ready', completed: 0 });
  const writes = api.writes().length;
  const standardToken = { ...env, GITHUB_TOKEN: env.GH_TOKEN };
  delete standardToken.GH_TOKEN;
  assert.deepEqual(await main(standardToken), {
    status: 'ready',
    completed: 0,
  });
  assert.equal(api.writes().length, writes);
  const cwd = process.cwd();
  try {
    process.chdir(root);
    const fallback = { ...env };
    delete fallback.MODULE_ROOT;
    assert.deepEqual(await main(fallback), { status: 'ready', completed: 0 });
  } finally {
    process.chdir(cwd);
  }
});

test('CLI refuses flexible/relative roots, missing root data, unsafe event files and oversized payloads without network', async (t) => {
  const cases = {
    relativeRoot: async (f) => {
      f.env.MODULE_ROOT = '.';
    },
    missingRoot: async (f) => {
      f.env.MODULE_ROOT = join(f.root, 'absent');
    },
    directoryRootFile: async (f) => {
      f.env.MODULE_ROOT = f.eventPath;
    },
    missingRootMetadata: async (f) => {
      await mkdir(join(f.root, 'nested'));
      await writeFile(
        join(f.root, 'nested', 'workshop.json'),
        JSON.stringify(MODULE_FIXTURES[2]),
      );
      await rm(join(f.root, 'workshop.json'));
    },
    missingReadme: async (f) => {
      await rm(join(f.root, 'README.md'));
    },
    malformedMetadata: async (f) => {
      await writeFile(join(f.root, 'workshop.json'), '{');
    },
    oversizedMetadata: async (f) => {
      await writeFile(join(f.root, 'workshop.json'), ' '.repeat(64_001));
    },
    oversizedReadme: async (f) => {
      await writeFile(join(f.root, 'README.md'), 'x'.repeat(512_001));
    },
    missingEvent: async (f) => {
      delete f.env.GITHUB_EVENT_PATH;
    },
    relativeEvent: async (f) => {
      f.env.GITHUB_EVENT_PATH = 'event.json';
    },
    eventDirectory: async (f) => {
      f.env.GITHUB_EVENT_PATH = f.root;
    },
    malformedEvent: async (f) => {
      await writeFile(f.eventPath, '{');
    },
    arrayEvent: async (f) => {
      await writeFile(f.eventPath, '[]');
    },
    oversizedEvent: async (f) => {
      await writeFile(f.eventPath, 'x'.repeat(4 * 1024 * 1024 + 1));
    },
    invalidUtf8: async (f) => {
      await writeFile(f.eventPath, Buffer.from([0xff]));
    },
  };
  const original = globalThis.fetch;
  globalThis.fetch = () =>
    assert.fail('CLI preflight must not use a network or credential');
  t.after(() => {
    globalThis.fetch = original;
  });
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async (subtest) => {
      const f = await callerFixture(subtest);
      await change(f);
      await assert.rejects(() => main(f.env), MonaError);
    });
});
