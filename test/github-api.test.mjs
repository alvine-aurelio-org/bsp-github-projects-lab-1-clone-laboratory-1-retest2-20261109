import test from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubClient } from '../.github/scripts/github-api.mjs';
import { runMona } from '../.github/scripts/mona-engine.mjs';
import { runModule } from '../.github/scripts/module-engine.mjs';
import { HEAD, MERGE, WORKSHOP, harness, reach } from './helpers/fake-github.mjs';
import {
  moduleFakeFetch,
  moduleHarness,
  reachModule,
} from './helpers/module-fake-github.mjs';

const ROOT = 'https://api.github.com/repos/learner/my-projects';
const response = (data, options = {}) =>
  new Response(JSON.stringify(data), {
    status: options.status ?? 200,
    headers: { 'content-type': 'application/json', ...options.headers },
  });

function client(handler, options = {}) {
  const calls = [];
  const api = createGitHubClient({
    token: 'synthetic-not-a-credential',
    repository: 'learner/my-projects',
    ...options,
    fetchImpl: async (target, init) => {
      const url = new URL(target);
      calls.push({ url, init });
      assert.equal(url.origin, 'https://api.github.com');
      assert.ok(
        url.pathname.startsWith('/repos/learner/my-projects') ||
          url.pathname === '/graphql',
      );
      assert.ok(!url.pathname.includes('/projects'));
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      return handler(url, init, calls.length);
    },
  });
  return { api, calls };
}

const rows = (start, count = 100) =>
  Array.from({ length: count }, (_, index) => ({ id: start + index }));
const refsResponse = ({
  nodes = [],
  total = nodes.length,
  next = false,
  cursor = null,
  repo = 'learner/my-projects',
  head = HEAD,
  ...extra
} = {}) => ({
  data: {
    repository: {
      nameWithOwner: repo,
      pullRequest: {
        number: 31,
        headRefOid: head,
        closingIssuesReferences: {
          nodes,
          totalCount: total,
          pageInfo: { hasNextPage: next, endCursor: cursor },
        },
      },
    },
  },
  ...extra,
});
const nativeNode = (number = 2, repo = 'learner/my-projects') => ({
  number,
  repository: { nameWithOwner: repo },
});

// API 2026-03-10 omits merge_commit_sha, even for an already-merged PR.
const restPR = (merged = false) => ({
  id: 5_000_000_031,
  node_id: 'PR_synthetic_large_id_31',
  number: 31,
  state: merged ? 'closed' : 'open',
  merged,
  merged_at: merged ? '2026-11-09T10:00:00Z' : null,
  user: { id: 77, login: 'learner', type: 'User' },
  changed_files: 1,
  head: {
    ref: WORKSHOP.workBranch,
    sha: HEAD,
    repo: { id: 100, full_name: 'learner/my-projects' },
  },
  base: {
    ref: 'main',
    sha: 'c'.repeat(40),
    repo: { id: 100, full_name: 'learner/my-projects' },
  },
});
const mergeResponse = () => ({
  data: {
    repository: {
      nameWithOwner: 'learner/my-projects',
      pullRequest: {
        number: 31,
        id: 'PR_synthetic_large_id_31',
        state: 'MERGED',
        merged: true,
        mergedAt: '2026-11-09T10:00:00Z',
        headRefName: WORKSHOP.workBranch,
        headRefOid: HEAD,
        baseRefName: 'main',
        mergeCommit: { oid: MERGE },
      },
    },
  },
});

test('current REST PRs without merge_commit_sha and with large IDs are normalized; only merged PRs read native GraphQL merge evidence', async (t) => {
  for (const merged of [false, true])
    await t.test(`merged=${merged}`, async () => {
      const { api, calls } = client((url, init) => {
        if (url.pathname !== '/graphql') {
          assert.equal(url.pathname, '/repos/learner/my-projects/pulls/31');
          assert.equal(init.method, 'GET');
          return response(restPR(merged));
        }
        const body = JSON.parse(init.body);
        assert.match(body.query, /mergeCommit\s*\{\s*oid\s*\}/);
        assert.ok(!body.query.includes('databaseId'));
        assert.ok(!/mutation|project|search\s*\(/i.test(body.query));
        assert.deepEqual(body.variables, {
          owner: 'learner',
          name: 'my-projects',
          number: 31,
        });
        return response(mergeResponse());
      });
      assert.equal(Object.hasOwn(restPR(merged), 'merge_commit_sha'), false);
      const pr = await api.getPullRequest(31);
      assert.deepEqual(pr, {
        ...restPR(merged),
        merge_commit_sha: merged ? MERGE : null,
      });
      assert.equal(calls.length, merged ? 2 : 1);
    });
});

test('native GraphQL merge evidence must match the REST repository, PR ID, head, branch, state and timestamp', async (t) => {
  const cases = {
    wrongNumber: (pr) => { pr.number = 32; },
    wrongId: (pr) => { pr.id = 'PR_different'; },
    wrongHead: (pr) => { pr.headRefOid = 'd'.repeat(40); },
    wrongHeadBranch: (pr) => { pr.headRefName = 'other-branch'; },
    wrongBaseBranch: (pr) => { pr.baseRefName = 'other-base'; },
    wrongState: (pr) => { pr.state = 'CLOSED'; },
    notMerged: (pr) => { pr.merged = false; },
    wrongTime: (pr) => { pr.mergedAt = '2026-11-09T11:00:00Z'; },
    missingCommit: (pr) => { pr.mergeCommit = null; },
    malformedCommit: (pr) => { pr.mergeCommit.oid = 'main'; },
  };
  for (const [label, change] of Object.entries(cases))
    await t.test(label, async () => {
      const data = mergeResponse();
      change(data.data.repository.pullRequest);
      const { api, calls } = client((url) =>
        response(url.pathname === '/graphql' ? data : restPR(true)),
      );
      await assert.rejects(api.getPullRequest(31), /complete repository evidence/);
      assert.equal(calls.length, 2);
    });
  for (const label of ['wrongRepository', 'errors', 'partial', 'denied'])
    await t.test(label, async () => {
      const data = mergeResponse();
      if (label === 'wrongRepository') data.data.repository.nameWithOwner = 'other/repo';
      if (label === 'errors') data.errors = [{ message: 'MUST_NOT_LEAK' }];
      if (label === 'partial') data.data.repository.pullRequest = null;
      const { api, calls } = client((url) =>
        url.pathname === '/graphql'
          ? response(data, label === 'denied' ? { status: 403 } : {})
          : response(restPR(true)),
      );
      await assert.rejects(api.getPullRequest(31), (error) => {
        assert.equal(error.code, label === 'denied' ? 'API_UNAVAILABLE' : 'API_INCOMPLETE');
        assert.ok(!error.message.includes('MUST_NOT_LEAK'));
        return true;
      });
      assert.equal(calls.length, 2);
    });
});

test('both engines accept current PR responses and preserve the failed merge-read command for a safe retry', async (t) => {
  for (const standalone of [false, true])
    await t.test(standalone ? 'standalone Lab 2' : 'full-workshop Lab 1', async () => {
      const h = standalone ? moduleHarness() : harness();
      if (standalone) await reachModule(h, 3);
      else await reach(h, '2-3');
      h.api.configurePR();
      const requests = [];
      const fetchImpl = moduleFakeFetch(h.api, requests);
      let denyMerge = true;
      const api = createGitHubClient({
        token: 'synthetic-not-a-credential',
        repository: h.api.repository.full_name,
        fetchImpl: (url, init) =>
          denyMerge && init.body?.includes('query MonaMergeCommit(')
            ? response({ message: 'MUST_NOT_LEAK' }, { status: 403 })
            : fetchImpl(url, init),
      });
      const context = {
        repository: h.api.repository.full_name,
        actor: 'learner',
        eventName: 'workflow_dispatch',
        event: {},
      };
      const run = () =>
        standalone
          ? runModule({ module: h.module, readme: h.readme, api, context })
          : runMona({ workshop: h.workshop, loadLesson: h.loadLesson, api, context });
      const initial = h.api.state().completed.length;
      h.api.addComment(h.api.exercise().number, '/check 2-3 #31');
      await run();
      assert.equal(h.api.state().completed.length, initial + 1);
      assert.equal(h.api.messages('lesson:2-4').length, 1);
      h.api.mergePR();
      h.api.addComment(h.api.exercise().number, '/check 2-4 #31');
      const saved = h.api.stateComment().body;
      const writes = h.api.writes().length;
      await assert.rejects(run(), (error) => {
        assert.equal(error.code, 'API_UNAVAILABLE');
        assert.match(error.message, /HTTP 403/);
        assert.ok(!error.message.includes('MUST_NOT_LEAK'));
        return true;
      });
      assert.equal(h.api.stateComment().body, saved);
      assert.equal(h.api.writes().length, writes);
      denyMerge = false;
      await run();
      assert.equal(h.api.state().completed.length, initial + 2);
      assert.equal(h.api.messages('feedback:2-4').length, 1);
      assert.ok(h.api.messages('feedback:2-4')[0].body.includes(MERGE));
      assert.ok(requests.some(({ query }) => query.includes(`ref=${MERGE}`)));
      assert.ok(requests.every(({ path }) => !path.includes('/projects')));
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('all REST list endpoints paginate, including full pages without Link', async (t) => {
  const cases = [
    ['issues', (api) => api.listIssues(), '/issues'],
    ['comments', (api) => api.listComments(5), '/issues/5/comments'],
    [
      'native dependency',
      (api) => api.listBlockedBy(3),
      '/issues/3/dependencies/blocked_by',
    ],
    ['PR files', (api) => api.listPullRequestFiles(31), '/pulls/31/files'],
  ];
  for (const [label, invoke, suffix] of cases)
    await t.test(label, async () => {
      const { api, calls } = client((url) => {
        assert.equal(url.pathname, `/repos/learner/my-projects${suffix}`);
        assert.equal(url.searchParams.get('per_page'), '100');
        const page = Number(url.searchParams.get('page'));
        const data = page === 1 ? rows(1) : rows(101, 2);
        return response(
          label === 'PR files'
            ? data.map(({ id }) => ({ filename: `file-${id}.md` }))
            : data,
        );
      });
      assert.equal((await invoke(api)).length, 102);
      assert.equal(calls.length, 2);
      if (label === 'issues')
        assert.equal(calls[0].url.searchParams.get('state'), 'all');
    });
});

test('validated REST Link pages are followed even for a short page; foreign/cyclic/truncated pages fail', async (t) => {
  const valid = client((url) => {
    const page = Number(url.searchParams.get('page'));
    const next = new URL(url);
    next.searchParams.set('page', '2');
    return response(
      rows(page, 1),
      page === 1 ? { headers: { link: `<${next.href}>; rel="next"` } } : {},
    );
  });
  assert.equal((await valid.api.listBlockedBy(3)).length, 2);
  const links = [
    '<https://evil.test/repo?page=2>; rel="next"',
    `<${ROOT}/issues/999/comments?per_page=100&page=2>; rel="next"`,
    `<${ROOT}/issues/3/dependencies/blocked_by?per_page=100&page=1>; rel="next"`,
    `<${ROOT}/issues/3/dependencies/blocked_by?per_page=100&page=2&extra=1>; rel="next"`,
    `<https://x@api.github.com/repos/learner/my-projects/issues/3/dependencies/blocked_by?per_page=100&page=2>; rel="next"`,
    'malformed-link',
  ];
  for (const link of links)
    await t.test(link, async () => {
      const { api, calls } = client(() =>
        response(rows(1, 1), { headers: { link } }),
      );
      await assert.rejects(
        api.listBlockedBy(3),
        /complete repository evidence/,
      );
      assert.equal(calls.length, 1);
    });
  const capped = client(
    (url) => response(rows(Number(url.searchParams.get('page')) * 100)),
    { maxPages: 2 },
  );
  await assert.rejects(capped.api.listIssues(), /complete repository evidence/);
  assert.equal(capped.calls.length, 2);
  const duplicates = client(() => response(rows(1)), { maxPages: 2 });
  await assert.rejects(
    duplicates.api.listComments(5),
    /complete repository evidence/,
  );
  const invalidShape = client(() => response({ items: [] }));
  await assert.rejects(
    invalidShape.api.listPullRequestFiles(31),
    /complete repository evidence/,
  );
});

test('GraphQL reads only current-repository native closingIssuesReferences and fully paginates', async () => {
  const { api, calls } = client((url, init, count) => {
    assert.equal(url.pathname, '/graphql');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.match(
      body.query,
      /closingIssuesReferences\(first: 100, after: \$after\)/,
    );
    assert.ok(!/project|mutation|search\s*\(/i.test(body.query));
    assert.deepEqual(body.variables, {
      owner: 'learner',
      name: 'my-projects',
      number: 31,
      after: count === 1 ? null : 'cursor-one',
    });
    return response(
      refsResponse(
        count === 1
          ? {
              nodes: [nativeNode(99, 'other/repo')],
              total: 2,
              next: true,
              cursor: 'cursor-one',
            }
          : { nodes: [nativeNode(2)], total: 2 },
      ),
    );
  });
  assert.deepEqual(await api.getClosingIssues(31, HEAD), [
    nativeNode(99, 'other/repo'),
    nativeNode(2),
  ]);
  assert.equal(calls.length, 2);
});

test('GraphQL partial errors, missing fields, wrong binding/head, bad cursors and caps never mean empty success', async (t) => {
  const missingCount = refsResponse();
  delete missingCount.data.repository.pullRequest.closingIssuesReferences
    .totalCount;
  const cases = {
    errors: refsResponse({
      errors: [{ message: 'synthetic secret MUST_NOT_LEAK' }],
    }),
    errorsShape: refsResponse({ errors: {} }),
    nullData: { data: { repository: null } },
    nullNodes: refsResponse({ nodes: [null] }),
    wrongRepo: refsResponse({ repo: 'other/repo' }),
    wrongHead: refsResponse({ head: 'f'.repeat(40) }),
    missingCount,
    countMismatch: refsResponse({ nodes: [], total: 1 }),
    emptyNext: refsResponse({ nodes: [], total: 1, next: true, cursor: 'a' }),
    missingCursor: refsResponse({
      nodes: [nativeNode(2)],
      total: 2,
      next: true,
    }),
  };
  for (const [label, data] of Object.entries(cases))
    await t.test(label, async () => {
      const { api } = client(() => response(data));
      await assert.rejects(api.getClosingIssues(31, HEAD), (error) => {
        assert.match(error.message, /complete repository evidence/);
        assert.ok(!error.message.includes('MUST_NOT_LEAK'));
        return true;
      });
    });
  const duplicate = client(() =>
    response(
      refsResponse({
        nodes: [nativeNode(2)],
        total: 3,
        next: true,
        cursor: 'same',
      }),
    ),
  );
  await assert.rejects(
    duplicate.api.getClosingIssues(31, HEAD),
    /complete repository evidence/,
  );
  const cap = client(
    (_url, _init, count) =>
      response(
        refsResponse({
          nodes: [nativeNode(count)],
          total: 3,
          next: true,
          cursor: `c-${count}`,
        }),
      ),
    { maxPages: 2 },
  );
  await assert.rejects(
    cap.api.getClosingIssues(31, HEAD),
    /complete repository evidence/,
  );
  const changing = client((_url, _init, count) =>
    response(
      refsResponse({
        nodes: [nativeNode(count)],
        total: count === 1 ? 2 : 3,
        next: true,
        cursor: `c-${count}`,
      }),
    ),
  );
  await assert.rejects(
    changing.api.getClosingIssues(31, HEAD),
    /complete repository evidence/,
  );
});

test('current-repository content is read by immutable SHA, never via download_url, and validated for truncation', async (t) => {
  const content = `${WORKSHOP.requiredWorkText}\r\n`;
  const good = {
    type: 'file',
    path: WORKSHOP.workFile,
    encoding: 'base64',
    size: Buffer.byteLength(content),
    content: Buffer.from(content).toString('base64'),
    download_url: 'https://evil.test/ignore-me',
  };
  const { api, calls } = client((url) => {
    assert.equal(url.searchParams.get('ref'), HEAD);
    return response(good);
  });
  assert.equal(await api.readRepositoryFile(WORKSHOP.workFile, HEAD), content);
  assert.equal(calls.length, 1);
  await assert.rejects(api.readRepositoryFile('../bad.md', HEAD));
  await assert.rejects(
    api.readRepositoryFile(WORKSHOP.workFile, 'main;whoami'),
  );
  assert.equal(calls.length, 1);
  for (const changed of [
    { type: 'symlink' },
    { path: 'other.md' },
    { size: good.size + 1 },
    { encoding: 'none' },
    { content: 'invalid!' },
    { size: 2 * 1024 * 1024 },
  ])
    await t.test(JSON.stringify(changed), async () => {
      const h = client(() => response({ ...good, ...changed }));
      await assert.rejects(
        h.api.readRepositoryFile(WORKSHOP.workFile, HEAD),
        /complete repository evidence/,
      );
    });
});

test('HTTP denial, redirect, non-JSON, transport errors and oversized responses fail safely with no secret logs or mutation retry', async (t) => {
  for (const status of [301, 302, 401, 403, 404, 410, 429, 500])
    await t.test(`HTTP ${status}`, async () => {
      const { api, calls } = client(() =>
        response({ message: 'MUST_NOT_LEAK' }, { status }),
      );
      await assert.rejects(
        api.createIssue({ title: 'Synthetic', body: 'data' }),
        (error) => {
          assert.match(error.message, new RegExp(`HTTP ${status}`));
          assert.ok(!error.message.includes('MUST_NOT_LEAK'));
          assert.ok(!error.message.includes('synthetic-not-a-credential'));
          return true;
        },
      );
      assert.equal(calls.length, 1);
    });
  for (const reply of [
    () => new Response('<html>MUST_NOT_LEAK</html>'),
    () =>
      response([], { headers: { 'content-length': String(9 * 1024 * 1024) } }),
    () => {
      throw new Error('fetch failed MUST_NOT_LEAK');
    },
  ]) {
    const { api } = client(reply);
    await assert.rejects(
      api.listIssues(),
      (error) => !error.message.includes('MUST_NOT_LEAK'),
    );
  }
  assert.throws(() =>
    createGitHubClient({ token: 'x', repository: '../other/repo' }),
  );
  const h = client(() => response({}));
  assert.throws(() => h.api.getIssue('1/../../other'));
  assert.equal(h.calls.length, 0);
});

test('bound writes use only issues permissions; pull requests and contents are read-only', async () => {
  const { api, calls } = client((url, init) => {
    if (init.method === 'POST' && url.pathname !== '/graphql')
      return response({ id: 1 }, { status: 201 });
    return response({ id: 1 });
  });
  await api.getRepository();
  await api.createIssue({ title: 'Lesson', body: 'literal $(whoami)' });
  await api.createComment(5, 'literal `whoami`');
  await api.updateComment(1000, 'state');
  await api.closeExercise(5);
  await api.updateExercise(5, 'literal v2 exercise body');
  await api.closeRetiredSample(2);
  await api.getCollaboratorPermission('learner');
  for (const { url, init } of calls) {
    assert.equal(
      init.headers.Authorization,
      'Bearer synthetic-not-a-credential',
    );
    assert.equal(init.headers['X-GitHub-Api-Version'], '2026-03-10');
    if (init.method !== 'GET') assert.match(url.pathname, /\/issues(?:\/|$)/);
  }
  assert.deepEqual(
    JSON.parse(
      calls.find(
        ({ init }) =>
          init.method === 'PATCH' && init.body.includes('state_reason'),
      ).init.body,
    ),
    { state: 'closed', state_reason: 'completed' },
  );
  const migration = calls
    .filter(
      ({ url, init }) =>
        init.method === 'PATCH' &&
        url.pathname !== '/repos/learner/my-projects/issues/comments/1000',
    )
    .slice(1);
  assert.deepEqual(
    migration.map(({ url, init }) => ({
      path: url.pathname,
      body: JSON.parse(init.body),
    })),
    [
      {
        path: '/repos/learner/my-projects/issues/5',
        body: { body: 'literal v2 exercise body' },
      },
      {
        path: '/repos/learner/my-projects/issues/2',
        body: { state: 'closed', state_reason: 'not_planned' },
      },
    ],
  );
  assert.equal(api.request, undefined);
  assert.equal(api.getUrl, undefined);
  assert.ok(Object.isFrozen(api));
});

test('migration PATCH primitives reject unsafe arguments locally and never retry a denied mutation', async (t) => {
  const { api, calls } = client(() => response({ id: 1 }));
  for (const number of [
    0,
    -1,
    1.1,
    Number.MAX_SAFE_INTEGER + 1,
    '5',
    'https://evil.test/issues/5',
    '5/../../other',
  ]) {
    assert.throws(() => api.getIssue(number));
    assert.throws(() => api.updateExercise(number, 'body'));
    assert.throws(() => api.closeRetiredSample(number));
    assert.throws(() => api.closeExercise(number));
  }
  for (const body of [null, undefined, '', 1, 'x'.repeat(60_001)])
    assert.throws(() => api.updateExercise(5, body));
  assert.equal(calls.length, 0);
  for (const method of ['updateExercise', 'closeRetiredSample'])
    await t.test(method, async () => {
      const denied = client(() =>
        response({ message: 'MUST_NOT_LEAK' }, { status: 403 }),
      );
      await assert.rejects(denied.api[method](5, 'literal body'), (error) => {
        assert.match(error.message, /HTTP 403/);
        assert.ok(!error.message.includes('MUST_NOT_LEAK'));
        return true;
      });
      assert.equal(denied.calls.length, 1);
      assert.equal(denied.calls[0].init.method, 'PATCH');
    });
});

test('backlog registration uses four fixed-repository native GETs; actual HTTP denial preserves the command cursor', async (t) => {
  for (const denied of [false, true])
    await t.test(`denied=${denied}`, async () => {
      const h = harness();
      await reach(h, '1-1');
      const samples = h.api.addLearnerBacklog();
      const numbers = WORKSHOP.backlogItems.map(
        ({ key }) => samples[key].number,
      );
      const adapter = client((url, init) => {
        assert.equal(init.method, 'GET');
        const number = Number(url.pathname.split('/').at(-1));
        assert.ok(numbers.includes(number));
        assert.equal(
          url.pathname,
          `/repos/learner/my-projects/issues/${number}`,
        );
        assert.equal(url.search, '');
        if (denied && number === samples.verification.number)
          return response({ message: 'MUST_NOT_LEAK' }, { status: 403 });
        return response(h.api.issues.find((issue) => issue.number === number));
      });
      h.api.getIssue = adapter.api.getIssue;
      const command = h.api.addComment(
        h.api.exercise().number,
        `/backlog ${numbers.map((number) => `#${number}`).join(' ')}`,
      );
      const before = h.api.stateComment().body;
      const writes = h.api.writes().length;
      if (denied) {
        await assert.rejects(h.run(h.eventFor(command)), /HTTP 403/);
        assert.equal(h.api.stateComment().body, before);
        assert.equal(h.api.writes().length, writes);
        assert.equal(adapter.calls.length, 3);
      } else {
        await h.run(h.eventFor(command));
        assert.deepEqual(h.api.state().samples, samples);
        assert.equal(adapter.calls.length, 4);
      }
      assert.equal(h.api.counts('createIssue'), 1);
    });
});

test('real adapter truncation/GraphQL denial cannot advance injected engine or consume failed command', async (t) => {
  for (const gate of ['dependency-cap', 'graphql-errors', 'files-cap'])
    await t.test(gate, async () => {
      const h = harness();
      await reach(h, gate === 'dependency-cap' ? '2-2' : '2-3');
      if (gate !== 'dependency-cap') h.api.configurePR();
      const adapter = client(
        (url) => {
          if (gate === 'graphql-errors')
            return response(
              refsResponse({ errors: [{ message: 'permission denied' }] }),
            );
          const page = Number(url.searchParams.get('page'));
          if (gate === 'files-cap')
            return response(
              rows(page * 100).map(({ id }) => ({ filename: `file-${id}.md` })),
            );
          return response(
            rows(page * 100).map((item) => ({ ...item, number: item.id })),
          );
        },
        { maxPages: 1 },
      ).api;
      if (gate === 'dependency-cap')
        h.api.listBlockedBy = adapter.listBlockedBy;
      if (gate === 'graphql-errors')
        h.api.getClosingIssues = adapter.getClosingIssues;
      if (gate === 'files-cap')
        h.api.listPullRequestFiles = adapter.listPullRequestFiles;
      const command = h.api.addComment(
        h.api.exercise().number,
        gate === 'dependency-cap' ? '/check 2-2' : '/check 2-3 #31',
      );
      const before = h.api.stateComment().body;
      await assert.rejects(
        h.run(h.eventFor(command)),
        /complete repository evidence/,
      );
      assert.equal(h.api.stateComment().body, before);
    });
});

test('initial issue/comment pagination failure cannot seed, reset or advance', async () => {
  const h = harness();
  const adapter = client(() => response(rows(1)), { maxPages: 1 }).api;
  h.api.listIssues = adapter.listIssues;
  await assert.rejects(h.run(), /complete repository evidence/);
  assert.equal(h.api.writes().length, 0);
  const existing = harness();
  await existing.run();
  const saved = existing.api.stateComment().body;
  existing.api.listComments = adapter.listComments;
  await assert.rejects(existing.run(), /complete repository evidence/);
  assert.equal(existing.api.stateComment().body, saved);
});
