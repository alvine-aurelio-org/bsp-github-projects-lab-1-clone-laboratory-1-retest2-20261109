import assert from 'node:assert/strict';
import {
  MonaError,
  MODULE_EXERCISE,
  MODULE_MESSAGE,
  decodeModuleState,
  hasModuleState,
  unpackModule,
  runModule,
} from '../../.github/scripts/module-engine.mjs';

// Portable, deliberately embedded fixtures. Lab 1 CI does not check out siblings.
export const MODULE_FIXTURES = {
  2: {
    schemaVersion: 3,
    role: 'standalone',
    lab: 2,
    title: 'Plan and complete sprint work',
    minutes: 45,
    continuationMinutes: 35,
    bootstrapIssueLimit: 1,
    starterRepository: 'alvine-aurelio-org/bsp-github-projects-lab-1',
    sourceRepositories: [
      'alvine-aurelio-org/bsp-github-projects-lab-1',
      'alvine-aurelio-org/bsp-github-projects-lab-2',
      'alvine-aurelio-org/bsp-github-projects-lab-3',
    ],
    defaultBranch: 'main',
    exerciseTitle: "Mona's GitHub Projects Lab 2 — start here",
    publicAssetBase:
      'https://raw.githubusercontent.com/alvine-aurelio-org/bsp-github-projects-lab-2/main/assets/screenshots/',
    workBranch: 'workshop/release-checklist',
    workFile: 'work/release-checklist.md',
    requiredWorkText: '- [x] Publish the service release checklist',
    workItems: [
      {
        key: 'implementation',
        title: '[Workshop] Publish the service release checklist',
      },
      {
        key: 'verification',
        title: '[Workshop] Verify the release checklist in Sprint 2',
      },
    ],
    lessons: [
      {
        id: '2-1',
        step: 1,
        minutes: 18,
        title: 'Set up your sprint workspace',
        mode: 'mixed',
        command: 'YOUR_PROJECT_URL',
        image: 'lab-2-step-1.png',
      },
      {
        id: '2-2',
        step: 2,
        minutes: 7,
        title: 'Show a native dependency',
        mode: 'repository-verified',
        command: '/check 2-2',
        image: 'lab-2-step-2.png',
      },
      {
        id: '2-3',
        step: 3,
        minutes: 12,
        title: 'Create a linked pull request',
        mode: 'repository-verified',
        command: '/check 2-3 #YOUR_PR_NUMBER',
        image: 'lab-2-step-3.png',
      },
      {
        id: '2-4',
        step: 4,
        minutes: 8,
        title: 'Complete and carry over',
        mode: 'mixed',
        command: '/check 2-4 #YOUR_PR_NUMBER',
        image: 'lab-2-step-4.png',
      },
    ],
  },
  3: {
    schemaVersion: 3,
    role: 'standalone',
    lab: 3,
    title: 'Visualize and communicate',
    minutes: 45,
    continuationMinutes: 35,
    bootstrapIssueLimit: 1,
    starterRepository: 'alvine-aurelio-org/bsp-github-projects-lab-1',
    sourceRepositories: [
      'alvine-aurelio-org/bsp-github-projects-lab-1',
      'alvine-aurelio-org/bsp-github-projects-lab-2',
      'alvine-aurelio-org/bsp-github-projects-lab-3',
    ],
    defaultBranch: 'main',
    exerciseTitle: "Mona's GitHub Projects Lab 3 — start here",
    publicAssetBase:
      'https://raw.githubusercontent.com/alvine-aurelio-org/bsp-github-projects-lab-3/main/assets/screenshots/',
    workBranch: 'workshop/release-checklist',
    workFile: 'work/release-checklist.md',
    requiredWorkText: '- [x] Publish the service release checklist',
    workItems: [
      {
        key: 'implementation',
        title: '[Workshop] Publish the service release checklist',
      },
      {
        key: 'verification',
        title: '[Workshop] Verify the release checklist in Sprint 2',
      },
    ],
    lessons: [
      {
        id: '3-1',
        step: 1,
        minutes: 20,
        title: 'Set up your release roadmap',
        mode: 'mixed',
        command: 'YOUR_PROJECT_URL',
        image: 'lab-3-step-1.png',
      },
      {
        id: '3-2',
        step: 2,
        minutes: 8,
        title: 'Inspect workload',
        mode: 'self-confirmed',
        command: '/done 3-2',
        image: 'lab-3-step-2.png',
      },
      {
        id: '3-3',
        step: 3,
        minutes: 7,
        title: 'Read a progress chart',
        mode: 'self-confirmed',
        command: '/done 3-3',
        image: 'lab-3-step-3.png',
      },
      {
        id: '3-4',
        step: 4,
        minutes: 10,
        title: 'Publish a delivery update',
        mode: 'self-confirmed',
        command: '/done 3-4',
        image: 'lab-3-step-4.png',
      },
    ],
  },
};

export const HEAD = 'a'.repeat(40);
export const MERGE = 'b'.repeat(40);
export const BOT = 'github-actions[bot]';
export const moduleUser = (
  login = 'learner',
  id = login === 'learner' ? 77 : 88,
) => ({ login, type: 'User', id });
export const moduleBot = () => ({ login: BOT, type: 'Bot', id: 41898282 });

export function moduleReadme(module) {
  return (
    `# Public lab guide\n\nPreamble must not be posted.\n\n## Welcome\n\nNot a lesson.\n\n` +
    module.lessons
      .map(
        (lesson) =>
          `## Step ${lesson.step} — ${lesson.title}\n\n` +
          (lesson.step === 1
            ? 'Create two native work issues manually in {{REPO}}. Owner: {{OWNER}}; learner: {{LEARNER}}.\n\nReturn to {{EXERCISE_URL}} and paste your Project address-bar URL.\n'
            : 'Use implementation #{{ISSUE_implementation}} and verification #{{ISSUE_verification}} in {{REPO}}.\n\nProject: {{PROJECT_URL}}\n') +
          (module.lab === 2 && lesson.step === 4
            ? '\nMerge PR #{{PR_NUMBER}}.\n'
            : '') +
          `\n![Navigation](assets/screenshots/${lesson.image})\n\n` +
          (lesson.step === 1
            ? 'Paste only the link.\n'
            : `Complete with: ${lesson.command}\n`),
      )
      .join('\n') +
    '\n## Troubleshooting\n\nThis section must not be posted as a lesson.\n'
  );
}

export class ModuleFakeGitHub {
  constructor({
    lab = 2,
    owner = 'learner',
    type = 'User',
    repository = `${owner}/optional-lab`,
  } = {}) {
    this.module = structuredClone(MODULE_FIXTURES[lab]);
    this.repository = {
      id: 100,
      name: repository.split('/')[1],
      full_name: repository,
      owner:
        type === 'User' ? moduleUser(owner) : { login: owner, type, id: 901 },
      private: true,
      visibility: 'private',
      is_template: false,
      default_branch: 'main',
    };
    this.issues = [];
    this.comments = [];
    this.calls = [];
    this.failures = [];
    this.overrides = new Map();
    this.number = 1;
    this.commentId = 1_000;
    this.clock = Date.parse('2026-11-05T10:00:00Z');
    this.dependencies = [];
    this.pr = null;
    this.files = [{ filename: this.module.workFile, status: 'modified' }];
    this.closing = [];
    this.contents = new Map([
      [HEAD, this.module.requiredWorkText],
      [MERGE, this.module.requiredWorkText],
    ]);
    this.permission = { permission: 'admin', user: moduleUser() };
  }

  timestamp() {
    this.clock += 1_000;
    return new Date(this.clock).toISOString();
  }

  perform(method, args, action) {
    this.calls.push({ method, args: structuredClone(args) });
    const index = this.failures.findIndex(
      (failure) =>
        failure.method === method && (!failure.where || failure.where(...args)),
    );
    const failure = index < 0 ? null : this.failures.splice(index, 1)[0];
    if (failure && !failure.after)
      throw new MonaError('Synthetic API unavailable.', 'API_UNAVAILABLE');
    const override = this.overrides.get(method);
    const result = structuredClone(
      override ? override(...args, action) : action(),
    );
    if (failure)
      throw new MonaError(
        'Synthetic response lost after commit.',
        'API_UNAVAILABLE',
      );
    return result;
  }

  fail(method, options = {}) {
    this.failures.push({ method, ...options });
  }
  counts(method) {
    return this.calls.filter((call) => call.method === method).length;
  }
  writes() {
    return this.calls.filter(({ method }) =>
      [
        'createIssue',
        'updateExercise',
        'createComment',
        'updateComment',
        'closeExercise',
      ].includes(method),
    );
  }

  addIssue({
    title = 'Unrelated',
    body = '',
    author = moduleUser(),
    number,
    createdAt,
    ...extra
  } = {}) {
    const n = number ?? this.number++;
    this.number = Math.max(this.number, n + 1);
    const issue = {
      id: 500 + n,
      number: n,
      title,
      body,
      user: author,
      state: 'open',
      state_reason: null,
      created_at: createdAt ?? this.timestamp(),
      repository_url: `https://api.github.com/repos/${this.repository.full_name}`,
      html_url: `https://github.com/${this.repository.full_name}/issues/${n}`,
      ...extra,
    };
    this.issues.push(issue);
    return issue;
  }

  addComment(number, body, author = moduleUser(), extra = {}) {
    const time = this.timestamp();
    const comment = {
      id: this.commentId++,
      body,
      user: author,
      issue_url: `https://api.github.com/repos/${this.repository.full_name}/issues/${number}`,
      created_at: time,
      updated_at: time,
      ...extra,
    };
    this.comments.push(comment);
    return structuredClone(comment);
  }

  getRepository = async () =>
    this.perform('getRepository', [], () => this.repository);
  listIssues = async () => this.perform('listIssues', [], () => this.issues);
  getIssue = async (number) =>
    this.perform('getIssue', [number], () => {
      const issue = this.issues.find((item) => item.number === number);
      if (!issue)
        throw new MonaError('Synthetic issue unavailable.', 'API_UNAVAILABLE');
      return issue;
    });
  createIssue = async (input) =>
    this.perform('createIssue', [input], () =>
      this.addIssue({ ...input, author: moduleBot() }),
    );
  updateExercise = async (number, body) =>
    this.perform('updateExercise', [number, body], () => {
      const issue = this.issues.find((item) => item.number === number);
      issue.body = body;
      return issue;
    });
  closeExercise = async (number) =>
    this.perform('closeExercise', [number], () => {
      const issue = this.issues.find((item) => item.number === number);
      issue.state = 'closed';
      issue.state_reason = 'completed';
      return issue;
    });
  listComments = async (number) =>
    this.perform('listComments', [number], () =>
      this.comments.filter((comment) =>
        comment.issue_url.endsWith(`/issues/${number}`),
      ),
    );
  createComment = async (number, body) =>
    this.perform('createComment', [number, body], () =>
      this.addComment(number, body, moduleBot()),
    );
  updateComment = async (id, body) =>
    this.perform('updateComment', [id, body], () => {
      const comment = this.comments.find((item) => item.id === id);
      comment.body = body;
      comment.updated_at = this.timestamp();
      return comment;
    });
  getCollaboratorPermission = async (actor) =>
    this.perform('getCollaboratorPermission', [actor], () => this.permission);
  listBlockedBy = async (number) =>
    this.perform('listBlockedBy', [number], () => this.dependencies);
  getPullRequest = async (number) =>
    this.perform('getPullRequest', [number], () => this.pr);
  listPullRequestFiles = async (number) =>
    this.perform('listPullRequestFiles', [number], () => this.files);
  getClosingIssues = async (number, sha) =>
    this.perform('getClosingIssues', [number, sha], () => this.closing);
  readRepositoryFile = async (file, ref) =>
    this.perform('readRepositoryFile', [file, ref], () =>
      this.contents.get(ref),
    );

  exercise() {
    return this.issues.find(
      (issue) =>
        issue.user.login === BOT &&
        issue.user.type === 'Bot' &&
        issue.body.split(/\r?\n/).includes(MODULE_EXERCISE),
    );
  }
  stateComment() {
    return this.comments.find(
      (comment) =>
        comment.user.login === BOT &&
        comment.user.type === 'Bot' &&
        hasModuleState(comment.body),
    );
  }
  state() {
    return decodeModuleState(this.stateComment().body);
  }
  messages(key) {
    return this.comments.filter(
      (comment) =>
        comment.user.login === BOT &&
        comment.user.type === 'Bot' &&
        comment.body.startsWith(`<!-- ${MODULE_MESSAGE} `) &&
        unpackModule(MODULE_MESSAGE, comment.body).key === key,
    );
  }
  work(role) {
    return this.issues.find(
      (issue) =>
        issue.title ===
        this.module.workItems.find((item) => item.key === role).title,
    );
  }
  manualWork({
    author = moduleUser(),
    implementation = {},
    verification = {},
  } = {}) {
    return Object.fromEntries(
      this.module.workItems.map(({ key, title }, index) => {
        const number = index === 0 ? 11 : 29;
        const issue = this.addIssue({
          title,
          author,
          number: this.issues.some((item) => item.number === number)
            ? undefined
            : number,
          ...(key === 'implementation' ? implementation : verification),
        });
        return [key, { number: issue.number, id: issue.id }];
      }),
    );
  }
  configurePR() {
    const repo = {
      id: this.repository.id,
      full_name: this.repository.full_name,
    };
    this.pr = {
      id: 900031,
      node_id: 'PR_synthetic_900031',
      number: 31,
      state: 'open',
      merged: false,
      merged_at: null,
      merge_commit_sha: null,
      user: moduleUser(this.state().learner, this.state().learnerId),
      changed_files: 1,
      head: {
        ref: this.module.workBranch,
        sha: HEAD,
        repo: structuredClone(repo),
      },
      base: { ref: 'main', sha: 'c'.repeat(40), repo: structuredClone(repo) },
      body: `Closes #${this.state().samples.implementation.number}`,
    };
    this.closing = [
      {
        number: this.state().samples.implementation.number,
        repository: { nameWithOwner: this.repository.full_name },
      },
    ];
    return this.pr;
  }
  mergePR() {
    this.pr.state = 'closed';
    this.pr.merged = true;
    this.pr.merged_at = this.timestamp();
    this.pr.merge_commit_sha = MERGE;
    this.work('implementation').state = 'closed';
    this.work('implementation').state_reason = 'completed';
  }
}

export function moduleHarness(options = {}) {
  const api = new ModuleFakeGitHub(options);
  const module = api.module;
  const learner =
    options.learner ??
    (api.repository.owner.type === 'User'
      ? api.repository.owner.login
      : 'learner');
  const h = { api, module, readme: moduleReadme(module) };
  h.run = (context = {}) =>
    runModule({
      module,
      readme: h.readme,
      api,
      context: {
        repository: api.repository.full_name,
        actor: learner,
        eventName: 'workflow_dispatch',
        event: {},
        ...context,
      },
    });
  h.eventFor = (comment, issue = api.exercise()) => ({
    eventName: 'issue_comment',
    actor: comment.user.login,
    event: {
      action: 'created',
      repository: structuredClone(api.repository),
      issue: structuredClone(issue),
      comment: structuredClone(comment),
    },
  });
  h.say = (body, author = moduleUser(learner, api.state().learnerId)) => {
    const comment = api.addComment(api.exercise().number, body, author);
    return h.run(h.eventFor(comment));
  };
  h.projectUrl = () =>
    `https://github.com/${api.repository.owner.type === 'User' ? 'users' : 'orgs'}/${api.repository.owner.login}/projects/7`;
  return h;
}

export async function reachModule(h, step) {
  if (!h.api.exercise()) await h.run();
  while (h.api.state().completed.length < step - 1) {
    const next = h.api.state().completed.length + 1;
    if (next === 1) {
      if (!h.api.work('implementation'))
        h.api.manualWork({
          author: moduleUser(h.api.state().learner, h.api.state().learnerId),
        });
      await h.say(h.projectUrl());
    } else if (h.module.lab === 3) await h.say(`/done 3-${next}`);
    else if (next === 2) {
      h.api.dependencies = [structuredClone(h.api.work('implementation'))];
      await h.say('/check 2-2');
    } else if (next === 3) {
      h.api.configurePR();
      await h.say('/check 2-3 #31');
    } else {
      h.api.mergePR();
      await h.say('/check 2-4 #31');
    }
    assert.equal(
      h.api.state().completed.length,
      next,
      'fixture should reach the next actual lesson',
    );
  }
  return h;
}

// Real fixed-host transport adapter, not a network request or credential source.
export function moduleFakeFetch(api, requests = []) {
  return async (url, options) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api.github.com');
    assert.equal(options.redirect, 'error');
    const method = options.method;
    requests.push({ method, path: target.pathname, query: target.search });
    const root = `/repos/${api.repository.full_name}`;
    const path = target.pathname.slice(root.length);
    const body = options.body ? JSON.parse(options.body) : null;
    let data;
    if (target.pathname === '/graphql') {
      const mergeQuery = body.query.includes('query MonaMergeCommit(');
      const refs = mergeQuery
        ? null
        : await api.getClosingIssues(body.variables.number, api.pr.head.sha);
      data = {
        data: {
          repository: {
            nameWithOwner: api.repository.full_name,
            pullRequest: {
              number: api.pr.number,
              headRefOid: api.pr.head.sha,
              ...(mergeQuery
                ? {
                  id: api.pr.node_id,
                    state: api.pr.merged ? 'MERGED' : 'OPEN',
                    merged: api.pr.merged,
                    mergedAt: api.pr.merged_at,
                    headRefName: api.pr.head.ref,
                    baseRefName: api.pr.base.ref,
                    mergeCommit: api.pr.merged
                      ? { oid: api.pr.merge_commit_sha }
                      : null,
                  }
                : {
                    closingIssuesReferences: {
                      totalCount: refs.length,
                      nodes: refs,
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  }),
            },
          },
        },
      };
    } else {
      assert.equal(target.pathname.startsWith(root), true);
      let match;
      if (path === '' && method === 'GET') data = await api.getRepository();
      else if (path === '/issues' && method === 'GET')
        data = await api.listIssues();
      else if (path === '/issues' && method === 'POST')
        data = await api.createIssue(body);
      else if ((match = /^\/issues\/(\d+)\/comments$/.exec(path)))
        data =
          method === 'GET'
            ? await api.listComments(Number(match[1]))
            : await api.createComment(Number(match[1]), body.body);
      else if ((match = /^\/issues\/comments\/(\d+)$/.exec(path)))
        data = await api.updateComment(Number(match[1]), body.body);
      else if (
        (match = /^\/issues\/(\d+)\/dependencies\/blocked_by$/.exec(path))
      )
        data = await api.listBlockedBy(Number(match[1]));
      else if ((match = /^\/issues\/(\d+)$/.exec(path)))
        data =
          method === 'GET'
            ? await api.getIssue(Number(match[1]))
            : body.state === 'closed'
              ? await api.closeExercise(Number(match[1]))
              : await api.updateExercise(Number(match[1]), body.body);
      else if ((match = /^\/pulls\/(\d+)\/files$/.exec(path)))
        data = await api.listPullRequestFiles(Number(match[1]));
      else if ((match = /^\/pulls\/(\d+)$/.exec(path))) {
        data = await api.getPullRequest(Number(match[1]));
        // Match the native 2026-03-10 payload, not the engines' internal alias.
        delete data.merge_commit_sha;
      } else if (path === '/contents/work/release-checklist.md') {
        const workFile = 'work/release-checklist.md';
        const content = await api.readRepositoryFile(
          workFile,
          target.searchParams.get('ref'),
        );
        data = {
          type: 'file',
          path: workFile,
          encoding: 'base64',
          size: Buffer.byteLength(content),
          content: Buffer.from(content).toString('base64'),
        };
      } else if ((match = /^\/collaborators\/([^/]+)\/permission$/.exec(path)))
        data = await api.getCollaboratorPermission(match[1]);
      else assert.fail(`Unexpected fixed API route: ${method} ${path}`);
    }
    return new Response(JSON.stringify(data), {
      status: method === 'POST' && target.pathname !== '/graphql' ? 201 : 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}
