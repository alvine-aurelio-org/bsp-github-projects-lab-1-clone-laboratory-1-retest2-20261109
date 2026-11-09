import { readFile } from 'node:fs/promises';
import {
  BOT,
  MonaError,
  bot,
  decodeState,
  hasStateMarker,
  markerLine,
  messageMarker,
  runMona,
} from '../../.github/scripts/mona-engine.mjs';

export const WORKSHOP = JSON.parse(
  await readFile(new URL('../../workshop.json', import.meta.url), 'utf8'),
);
export const HEAD = 'a'.repeat(40);
export const MERGE = 'b'.repeat(40);
export const botUser = () => ({ login: BOT, type: 'Bot', id: 41898282 });
export const user = (login = 'learner') => ({
  login,
  type: 'User',
  id: login === 'learner' ? 77 : 88,
});
export const backlogCommand = (samples) =>
  `/backlog ${WORKSHOP.backlogItems.map(({ key }) => `#${samples[key].number}`).join(' ')}`;

export class FakeGitHub {
  constructor({
    owner = 'learner',
    type = 'User',
    repository = `${owner}/my-projects`,
  } = {}) {
    this.repository = {
      id: 100,
      name: repository.split('/')[1],
      full_name: repository,
      owner: { login: owner, type },
      private: true,
      visibility: 'private',
      is_template: false,
      default_branch: 'main',
    };
    this.issues = [];
    this.comments = [];
    this.calls = [];
    this.failures = [];
    this.number = 1;
    this.commentId = 1_000;
    this.clock = Date.parse('2026-11-04T10:00:00Z');
    this.dependencies = [];
    this.pr = null;
    this.files = [{ filename: WORKSHOP.workFile, status: 'modified' }];
    this.closing = [];
    this.contents = new Map([
      [HEAD, WORKSHOP.requiredWorkText],
      [MERGE, WORKSHOP.requiredWorkText],
    ]);
    this.permission = { permission: 'admin', user: user() };
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
      throw new MonaError(
        'Mona could not read complete repository evidence. Retry the workflow.',
        'API_UNAVAILABLE',
      );
    const result = action();
    if (failure)
      throw new MonaError(
        'Mona could not reach the repository API safely. Retry the workflow.',
        'API_UNAVAILABLE',
      );
    return structuredClone(result);
  }

  fail(method, options = {}) {
    this.failures.push({ method, ...options });
  }

  addIssue({
    title = 'Unrelated',
    body = '',
    author = botUser(),
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
    return structuredClone(issue);
  }

  addComment(number, body, author = user(), extra = {}) {
    const timestamp = this.timestamp();
    const comment = {
      id: this.commentId++,
      body,
      user: author,
      issue_url: `https://api.github.com/repos/${this.repository.full_name}/issues/${number}`,
      created_at: timestamp,
      updated_at: timestamp,
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
        throw new MonaError(
          'Mona could not read the repository issue (HTTP 404). Retry the workflow.',
          'API_UNAVAILABLE',
        );
      return issue;
    });
  createIssue = async (input) =>
    this.perform('createIssue', [input], () => this.addIssue(input));
  updateExercise = async (number, body) =>
    this.perform('updateExercise', [number, body], () => {
      const issue = this.issues.find((item) => item.number === number);
      issue.body = body;
      return issue;
    });
  closeRetiredSample = async (number) =>
    this.perform('closeRetiredSample', [number], () => {
      const issue = this.issues.find((item) => item.number === number);
      issue.state = 'closed';
      issue.state_reason = 'not_planned';
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
      this.addComment(number, body, botUser()),
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
        bot(issue.user) && markerLine(issue.body, WORKSHOP.exerciseMarker),
    );
  }
  stateComment() {
    return this.comments.find(
      (comment) => bot(comment.user) && hasStateMarker(WORKSHOP, comment.body),
    );
  }
  state() {
    return decodeState(WORKSHOP, this.stateComment().body);
  }
  messages(key) {
    return this.comments.filter(
      (comment) =>
        bot(comment.user) && comment.body.startsWith(messageMarker(key)),
    );
  }
  counts(method) {
    return this.calls.filter((call) => call.method === method).length;
  }
  writes() {
    return this.calls.filter((call) =>
      [
        'createIssue',
        'createComment',
        'updateComment',
        'closeExercise',
        'updateExercise',
        'closeRetiredSample',
      ].includes(call.method),
    );
  }

  // Test fixture for the learner's MANUAL UI creation at lesson 1-1. This is
  // intentionally not createIssue(), which counts the bot's sole exercise POST.
  addLearnerBacklog(author = user(this.state().learner)) {
    return Object.fromEntries(
      WORKSHOP.backlogItems.map(({ key, title, body }) => {
        const issue = this.addIssue({ title, body, author });
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
      user: user(this.state().learner),
      changed_files: 1,
      head: {
        ref: WORKSHOP.workBranch,
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
    const implementation = this.issues.find(
      (issue) => issue.number === this.state().samples.implementation.number,
    );
    implementation.state = 'closed';
    implementation.state_reason = 'completed';
  }
}

export function harness(options = {}) {
  const api = new FakeGitHub(options);
  const workshop = structuredClone(WORKSHOP);
  const loaded = [];
  const loadLesson = async (file) => {
    loaded.push(file);
    const unbound = workshop.lessons
      .slice(0, 2)
      .some((lesson) => lesson.file === file);
    return (
      '# Try this lesson\n\n{{REPO}} {{OWNER}} {{LEARNER}} {{PROJECT_URL}} {{EXERCISE_URL}}\n' +
      (unbound
        ? '{{PR_NUMBER}}\n'
        : '{{ISSUE_feature}} {{ISSUE_implementation}} {{ISSUE_verification}} {{ISSUE_bug}} {{PR_NUMBER}}\n') +
      '```text\n{{CLONE_COMMAND}}\n```\n![Example](../../assets/screenshots/example.png)'
    );
  };
  const run = (context = {}) =>
    runMona({
      workshop,
      api,
      loadLesson,
      context: {
        repository: api.repository.full_name,
        actor: options.learner ?? 'learner',
        eventName: 'workflow_dispatch',
        event: {},
        ...context,
      },
    });
  const eventFor = (comment, issue = api.exercise()) => ({
    eventName: 'issue_comment',
    actor: comment.user.login,
    event: { action: 'created', repository: api.repository, issue, comment },
  });
  const say = async (body, author = user()) => {
    const comment = api.addComment(api.exercise().number, body, author);
    return run(eventFor(comment));
  };
  return { api, workshop, loaded, loadLesson, run, eventFor, say };
}

export async function reach(h, target) {
  if (!h.api.exercise()) await h.run();
  const commands = {
    '1-0': `/project https://github.com/${h.api.repository.owner.type === 'User' ? 'users' : 'orgs'}/${h.api.repository.owner.login}/projects/7`,
    '1-2': '/done 1-2',
    '1-3': '/done 1-3',
    '2-1': '/done 2-1',
    '2-2': '/check 2-2',
    '2-3': '/check 2-3 #31',
    '2-4': '/check 2-4 #31',
    '3-1': '/done 3-1',
    '3-2': '/done 3-2',
    '3-3': '/done 3-3',
    '3-4': '/done 3-4',
  };
  while (h.workshop.lessons[h.api.state().completed.length]?.id !== target) {
    const id = h.workshop.lessons[h.api.state().completed.length]?.id;
    if (!id) throw new Error('Target lesson was not reached');
    if (id === '1-1') commands[id] = backlogCommand(h.api.addLearnerBacklog());
    if (id === '2-2') {
      const state = h.api.state();
      h.api.dependencies = [
        await h.api.getIssue(state.samples.implementation.number),
      ];
    }
    if (id === '2-3') h.api.configurePR();
    if (id === '2-4') h.api.mergePR();
    await h.say(commands[id]);
  }
}
