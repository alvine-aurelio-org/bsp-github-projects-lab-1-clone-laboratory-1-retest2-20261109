import {
  CheckFailed,
  MonaError,
  bot,
  human,
  positive,
  same,
  repositoryParts,
  timestamp,
  verifyDependency,
  verifyPullRequest,
} from './mona-core.mjs';
import {
  MODULE_EXERCISE,
  MODULE_BINDING,
  MODULE_STATE,
  MODULE_MESSAGE,
  ROLE_KEYS,
  validateModule,
  validateModuleReadme,
  moduleSafe,
  moduleBinding,
  sameEnvelope,
  decodeModuleBinding,
  encodeModuleState,
  decodeModuleState,
  unpackModule,
  moduleMarkers,
  moduleExerciseBody,
  initialModuleState,
  hasModuleState,
  appendModuleOutbox,
  moduleMessageBody,
  moduleDigest,
  validateModuleState,
  planModuleCommand,
  recordModuleDecision,
  verifyModuleWorkItems,
} from './module-core.mjs';

export * from './module-core.mjs';

const NAMESPACE_ERROR =
  'Mona stopped: legacy, unknown, mixed or orphaned bot module/workshop markers were found. No bootstrap or progress writes were made; nothing was reset.';
const SHA = /^[a-f\d]{40}$/i;
const markerLine = (body, marker) =>
  typeof body === 'string' && body.split(/\r?\n/).includes(marker);
const namespaceSafe = (condition) => moduleSafe(condition, NAMESPACE_ERROR);

function validateRepository(repository, context, module) {
  const { owner, name } = repositoryParts(context.repository);
  moduleSafe(
    positive(repository?.id) &&
      same(repository.full_name, context.repository) &&
      same(repository.name, name) &&
      same(repository.owner?.login, owner) &&
      positive(repository.owner.id) &&
      ['User', 'Organization'].includes(repository.owner.type),
    'Mona stopped: native repository or owner identity does not match the workflow.',
  );
  if (
    repository.private !== true ||
    (repository.visibility && repository.visibility !== 'private')
  )
    return 'private-copy-required';
  if (repository.is_template !== false)
    return 'template-or-unknown-template-status';
  if (repository.default_branch !== module.defaultBranch)
    return 'default-branch-must-be-main';
  return null;
}

function validateInventory(issues, repository) {
  moduleSafe(
    Array.isArray(issues),
    'Mona could not read a complete native issue inventory. Retry the workflow.',
  );
  const ids = new Set();
  const numbers = new Set();
  for (const issue of issues) {
    moduleSafe(
      positive(issue?.number) &&
        positive(issue.id) &&
        !ids.has(issue.id) &&
        !numbers.has(issue.number) &&
        same(
          issue.repository_url,
          `https://api.github.com/repos/${repository.full_name}`,
        ) &&
        typeof issue.title === 'string' &&
        (issue.body === null || typeof issue.body === 'string') &&
        timestamp(issue.created_at) &&
        ['open', 'closed'].includes(issue.state),
      'Mona could not read a complete, unambiguous native issue inventory. Retry the workflow.',
    );
    ids.add(issue.id);
    numbers.add(issue.number);
  }
}

function authenticExercise(exercise, repository, module) {
  moduleSafe(
    positive(exercise?.number) &&
      positive(exercise.id) &&
      bot(exercise.user) &&
      positive(exercise.user.id) &&
      !exercise.pull_request &&
      exercise.title === module.exerciseTitle &&
      typeof exercise.body === 'string' &&
      timestamp(exercise.created_at) &&
      ['open', 'closed'].includes(exercise.state) &&
      same(
        exercise.repository_url,
        `https://api.github.com/repos/${repository.full_name}`,
      ),
    'Mona stopped: the native exercise identity is invalid. It was not recreated.',
  );
}

function validateComments(comments, repository, number) {
  moduleSafe(
    Array.isArray(comments),
    'Mona could not read complete repository comments. Retry the workflow.',
  );
  const ids = new Set();
  for (const comment of comments) {
    moduleSafe(
      positive(comment?.id) &&
        !ids.has(comment.id) &&
        typeof comment.body === 'string' &&
        comment.body.length <= 60_000 &&
        timestamp(comment.created_at) &&
        timestamp(comment.updated_at) &&
        Date.parse(comment.updated_at) >= Date.parse(comment.created_at) &&
        same(
          comment.issue_url,
          `https://api.github.com/repos/${repository}/issues/${number}`,
        ),
      'Mona could not read complete, authentic repository comments. Retry the workflow.',
    );
    ids.add(comment.id);
  }
}

async function inspectNamespace(api, issues, exercise, repository) {
  for (const issue of issues) {
    if (issue.user?.type !== 'Bot') continue;
    const markers = moduleMarkers(issue.body);
    if (!markers.length) continue;
    namespaceSafe(
      bot(issue.user) &&
        issue.number === exercise?.number &&
        !issue.pull_request &&
        markers.length === 2 &&
        markers.includes(MODULE_EXERCISE) &&
        markers.some((line) =>
          /^<!-- bsp-module-binding:v1 [A-Za-z\d+/]+={0,2} -->$/.test(line),
        ),
    );
  }
  let exerciseComments = [];
  const ids = new Set();
  // Inspect *every* issue/PR conversation before creating or repairing anything.
  // A state stranded on an unmarked issue must not bootstrap a second exercise.
  for (const issue of issues) {
    const comments = await api.listComments(issue.number);
    validateComments(comments, repository.full_name, issue.number);
    for (const comment of comments) {
      moduleSafe(
        !ids.has(comment.id),
        'Mona stopped: duplicate native repository comment IDs.',
      );
      ids.add(comment.id);
      if (comment.user?.type !== 'Bot') continue;
      const markers = moduleMarkers(comment.body);
      if (!markers.length) continue;
      namespaceSafe(
        bot(comment.user) &&
          issue.number === exercise?.number &&
          markers.length === 1 &&
          new RegExp(
            `^<!-- (?:${MODULE_STATE}|${MODULE_MESSAGE}) [A-Za-z\\d+/]+={0,2} -->$`,
          ).test(markers[0]) &&
          comment.body.split(/\r?\n/)[0] === markers[0],
      );
    }
    if (issue.number === exercise?.number) exerciseComments = comments;
  }
  return exerciseComments;
}

function validatePublicationLedger(
  module,
  binding,
  state,
  comments,
  readme,
  stateComment,
) {
  const messages = new Map();
  for (const comment of comments) {
    if (
      !bot(comment.user) ||
      !moduleMarkers(comment.body).length ||
      hasModuleState(comment.body)
    )
      continue;
    const envelope = unpackModule(MODULE_MESSAGE, comment.body);
    moduleSafe(
      typeof envelope.key === 'string' &&
        sameEnvelope(envelope, {
          ...binding,
          kind: 'message',
          key: envelope.key,
        }),
      NAMESPACE_ERROR,
    );
    const entry = state.outbox.find((item) => item.key === envelope.key);
    moduleSafe(
      entry &&
        !messages.has(entry.key) &&
        comment.id > stateComment.id &&
        comment.body ===
          moduleMessageBody(module, binding, state, entry.key, readme) &&
        moduleDigest(comment.body) === entry.digest,
      'Mona stopped: a bot publication conflicts with the durable module outbox. Nothing was reset.',
    );
    messages.set(entry.key, comment);
  }
  let gap = false;
  let previous = stateComment.id;
  for (const entry of state.outbox) {
    const message = messages.get(entry.key);
    if (entry.commentId !== null)
      moduleSafe(
        message?.id === entry.commentId,
        'Mona stopped: a saved bot publication is missing or has changed identity. It was not reposted.',
      );
    if (!message) gap = true;
    else {
      moduleSafe(
        !gap && message.id > previous,
        'Mona stopped: bot publications are out of order. Nothing was reset.',
      );
      previous = message.id;
    }
  }
  return messages;
}

function incompleteSnapshot(condition) {
  if (!condition)
    throw new MonaError(
      'Mona could not read complete native repository evidence. Retry the workflow; the comment cursor was not advanced.',
      'API_INCOMPLETE',
    );
}

function validateNativePR(pr) {
  const repository = (value) =>
    value === null ||
    (positive(value?.id) &&
      typeof value.full_name === 'string' &&
      Boolean(repositoryParts(value.full_name)));
  incompleteSnapshot(
    positive(pr?.id) &&
      positive(pr.number) &&
      ['open', 'closed'].includes(pr.state) &&
      typeof pr.merged === 'boolean' &&
      (pr.merged_at === null || timestamp(pr.merged_at)) &&
      (pr.merge_commit_sha === null || SHA.test(pr.merge_commit_sha ?? '')) &&
      positive(pr.user?.id) &&
      typeof pr.user.login === 'string' &&
      ['User', 'Bot', 'Mannequin'].includes(pr.user.type) &&
      Number.isSafeInteger(pr.changed_files) &&
      pr.changed_files >= 0 &&
      typeof pr.head?.ref === 'string' &&
      SHA.test(pr.head.sha ?? '') &&
      repository(pr.head.repo) &&
      typeof pr.base?.ref === 'string' &&
      SHA.test(pr.base.sha ?? '') &&
      repository(pr.base.repo),
  );
}

async function snapshotFor(
  api,
  module,
  state,
  plan,
  exercise,
  inventory,
  comment,
) {
  if (plan.kind === 'bind') {
    const matches = module.workItems.map(({ title }) =>
      inventory.filter((item) => item.title === title),
    );
    if (matches.some((items) => items.length !== 1))
      throw new CheckFailed(
        'Create the two work issues first, using the exact Step 1 titles once each, then paste your Project URL again. Mona will not create them for you.',
      );
    const issues = [];
    for (const [issue] of matches)
      issues.push(await api.getIssue(issue.number));
    return verifyModuleWorkItems(
      module,
      state,
      exercise,
      inventory,
      issues,
      comment.user,
    );
  }
  if (plan.lessonId === '2-2') {
    const dependencies = await api.listBlockedBy(
      state.samples.verification.number,
    );
    incompleteSnapshot(
      Array.isArray(dependencies) &&
        dependencies.every(
          (issue) =>
            positive(issue?.id) &&
            positive(issue.number) &&
            typeof issue.repository_url === 'string',
        ),
    );
    return verifyDependency(state, dependencies);
  }
  const pr = await api.getPullRequest(plan.prNumber);
  validateNativePR(pr);
  const ref = plan.lessonId === '2-4' ? pr?.merge_commit_sha : pr?.head?.sha;
  if (!SHA.test(ref ?? '') || !SHA.test(pr?.head?.sha ?? ''))
    throw new CheckFailed(
      'The pull request needs the required head or merge commit before this check can pass.',
    );
  const files = await api.listPullRequestFiles(plan.prNumber);
  const closingIssues = await api.getClosingIssues(plan.prNumber, pr.head.sha);
  const content = await api.readRepositoryFile(module.workFile, ref);
  incompleteSnapshot(
    Array.isArray(files) &&
      files.every(
        (file) =>
          typeof file?.filename === 'string' && typeof file.status === 'string',
      ) &&
      Array.isArray(closingIssues) &&
      closingIssues.every(
        (issue) =>
          positive(issue?.number) &&
          typeof issue.repository?.nameWithOwner === 'string',
      ) &&
      typeof content === 'string',
  );
  const snapshot = { pr, files, closingIssues, content };
  if (plan.lessonId === '2-4') {
    snapshot.implementation = await api.getIssue(
      state.samples.implementation.number,
    );
    snapshot.verification = await api.getIssue(
      state.samples.verification.number,
    );
  }
  snapshot.after = await api.getPullRequest(plan.prNumber);
  validateNativePR(snapshot.after);
  if (
    !positive(pr.id) ||
    pr.id !== snapshot.after?.id ||
    !human(pr.user) ||
    !human(snapshot.after.user) ||
    pr.user.id !== state.learnerId ||
    snapshot.after.user.id !== state.learnerId
  )
    throw new CheckFailed(
      'Use a native pull request authored by the same human learner who started this exercise.',
    );
  if (plan.lessonId === '2-4' && pr.id !== state.pullRequest.id)
    throw new CheckFailed(
      'Use the same native pull request checked in Step 3.',
    );
  return { ...verifyPullRequest(module, state, plan, snapshot), prId: pr.id };
}

/** Fixed-repository I/O only. The caller must serialize runs with a repository
 * concurrency group and cancel-in-progress:false. Never retry a mutation here:
 * a lost POST/PATCH response is reconciled from native markers on the next run.
 * Caller README/JSON are data; no caller script, URL, shell or eval is executed. */
export async function runModule({ module, readme, context, api }) {
  validateModule(module);
  repositoryParts(context.repository);
  const skip = (reason) => ({ status: 'skipped', reason, completed: 0 });
  if (
    module.sourceRepositories.some((source) => same(source, context.repository))
  )
    return skip('source-repository');
  if (
    !['push', 'workflow_dispatch', 'issue_comment'].includes(context.eventName)
  )
    return skip('unsupported-event');
  if (!human({ login: context.actor, type: 'User' }))
    return skip('non-human-actor');
  const event = context.event ?? {};
  if (
    event.repository?.full_name &&
    !same(event.repository.full_name, context.repository)
  )
    return skip('event-repository-mismatch');
  if (context.eventName === 'push' && event.ref !== 'refs/heads/main')
    return skip('not-default-branch');
  if (
    context.eventName === 'issue_comment' &&
    (event.action !== 'created' ||
      event.issue?.pull_request ||
      !positive(event.issue?.number) ||
      !positive(event.issue?.id) ||
      !positive(event.comment?.id) ||
      !human(event.comment?.user) ||
      !positive(event.comment.user.id) ||
      !same(event.comment.user.login, context.actor))
  )
    return skip('not-human-issue-comment');
  validateModuleReadme(module, readme);
  const repository = await api.getRepository();
  const guard = validateRepository(repository, context, module);
  if (guard) return skip(guard);
  if (
    repository.owner.type === 'User' &&
    !same(context.actor, repository.owner.login)
  )
    return skip('not-repository-owner');
  const issues = await api.listIssues();
  validateInventory(issues, repository);
  const matches = issues.filter(
    (issue) => bot(issue.user) && markerLine(issue.body, MODULE_EXERCISE),
  );
  moduleSafe(
    matches.length <= 1,
    'Mona stopped: duplicate module exercise issues. Nothing was recreated.',
  );
  let exercise = matches[0];
  let learner;
  let binding;
  let phase;
  let envelope;
  if (exercise) {
    authenticExercise(exercise, repository, module);
    envelope = decodeModuleBinding(exercise.body);
    learner = { login: envelope.learner, id: envelope.learnerId, type: 'User' };
    moduleSafe(human(learner) && positive(learner.id));
    phase = envelope.kind;
    moduleSafe(['reservation', 'initializing', 'exercise'].includes(phase));
    binding = moduleBinding(
      module,
      readme,
      repository,
      learner,
      phase === 'reservation' ? null : exercise,
    );
    const expected = {
      ...binding,
      kind: phase,
      ...(phase === 'exercise'
        ? { stateCommentId: envelope.stateCommentId }
        : {}),
    };
    moduleSafe(
      sameEnvelope(envelope, expected) &&
        (phase !== 'exercise' || positive(envelope.stateCommentId)),
      'Mona stopped: the exercise contract, repository, owner, learner or immutable IDs changed. Nothing was reset.',
    );
    moduleSafe(
      exercise.body ===
        moduleExerciseBody(
          binding,
          phase,
          envelope.stateCommentId,
          module.exerciseTitle,
        ),
    );
    if (repository.owner.type === 'User')
      moduleSafe(
        learner.id === repository.owner.id &&
          same(learner.login, repository.owner.login),
      );
    if (!same(context.actor, learner.login)) return skip('not-bound-learner');
    if (
      context.eventName === 'issue_comment' &&
      (event.issue.number !== exercise.number || event.issue.id !== exercise.id)
    )
      return skip('unrelated-issue');
    if (
      context.eventName === 'issue_comment' &&
      event.comment.user.id !== learner.id
    )
      return skip('not-bound-learner');
  } else {
    if (repository.owner.type === 'Organization') {
      const permission = await api.getCollaboratorPermission(context.actor);
      if (
        permission?.permission !== 'admin' ||
        !human(permission.user) ||
        !positive(permission.user.id) ||
        !same(permission.user.login, context.actor)
      )
        return skip('not-repository-owner-admin');
      learner = permission.user;
    } else learner = repository.owner;
    binding = moduleBinding(module, readme, repository, learner);
    phase = 'reservation';
  }
  let comments = await inspectNamespace(api, issues, exercise, repository);
  if (!exercise && context.eventName === 'issue_comment')
    return skip('exercise-not-created');
  const states = comments.filter(
    (comment) => bot(comment.user) && hasModuleState(comment.body),
  );
  moduleSafe(
    states.length <= 1,
    'Mona stopped: duplicate saved module state. Nothing was reset.',
  );
  let stateComment = states[0];
  const publications = comments.filter(
    (comment) =>
      bot(comment.user) && comment.body.startsWith(`<!-- ${MODULE_MESSAGE} `),
  );
  if (phase === 'reservation')
    moduleSafe(!stateComment && publications.length === 0);
  if (phase === 'exercise')
    moduleSafe(
      stateComment?.id === envelope.stateCommentId,
      'Mona stopped: the bound saved state is missing or changed identity. Progress was not reset.',
    );
  moduleSafe(
    stateComment || publications.length === 0,
    'Mona stopped: bot publications exist without saved state. Progress was not reset.',
  );
  let state;
  if (stateComment) {
    state = decodeModuleState(stateComment.body);
    validateModuleState(module, binding, state, exercise, readme, comments);
    validatePublicationLedger(
      module,
      binding,
      state,
      comments,
      readme,
      stateComment,
    );
    if (phase !== 'exercise')
      moduleSafe(
        state.completed.length === 0 &&
          state.lastProcessedHumanCommentId === 0 &&
          state.readyAfterCommentId === null &&
          publications.length === 0,
      );
  }
  if (context.eventName === 'issue_comment') {
    const canonical = comments.find(
      (comment) => comment.id === event.comment.id,
    );
    if (!canonical)
      throw new MonaError(
        'Mona could not read the canonical event comment. Retry the workflow; no progress changed.',
        'API_INCOMPLETE',
      );
    if (
      !human(canonical.user) ||
      canonical.user.id !== learner.id ||
      !same(canonical.user.login, learner.login)
    )
      return skip('not-bound-learner');
  }
  const validateSavedIssue = (saved, body) => {
    authenticExercise(saved, repository, module);
    moduleSafe(
      saved.number === exercise.number &&
        saved.id === exercise.id &&
        saved.created_at === exercise.created_at &&
        saved.body === body,
    );
    return saved;
  };
  if (!exercise) {
    const body = moduleExerciseBody(
      binding,
      'reservation',
      null,
      module.exerciseTitle,
    );
    exercise = await api.createIssue({ title: module.exerciseTitle, body });
    authenticExercise(exercise, repository, module);
    moduleSafe(exercise.body === body && exercise.state === 'open');
    // A native creation response provides the IDs that cannot exist in a POST body.
    comments = await api.listComments(exercise.number);
    validateComments(comments, repository.full_name, exercise.number);
    moduleSafe(
      !comments.some(
        (comment) => bot(comment.user) && moduleMarkers(comment.body).length,
      ),
    );
  }
  if (phase === 'reservation') {
    moduleSafe(exercise.state === 'open');
    binding = moduleBinding(module, readme, repository, learner, exercise);
    const body = moduleExerciseBody(
      binding,
      'initializing',
      null,
      module.exerciseTitle,
    );
    exercise = validateSavedIssue(
      await api.updateExercise(exercise.number, body),
      body,
    );
    phase = 'initializing';
  }
  const validateSavedComment = (saved, body) => {
    moduleSafe(
      bot(saved?.user) &&
        positive(saved.user.id) &&
        positive(saved.id) &&
        saved.body === body &&
        same(
          saved.issue_url,
          `https://api.github.com/repos/${repository.full_name}/issues/${exercise.number}`,
        ),
    );
    validateComments([saved], repository.full_name, exercise.number);
  };
  const save = async (next) => {
    validateModuleState(module, binding, next, exercise, readme, comments);
    if (state?.samples !== null && state?.samples !== undefined)
      moduleSafe(
        JSON.stringify(next.samples) === JSON.stringify(state.samples) &&
          next.projectUrl === state.projectUrl,
        'Mona stopped: the bound Project and issue map are immutable.',
      );
    const body = encodeModuleState(next);
    moduleSafe(
      body.length <= 60_000,
      'Mona stopped: saved module progress is too large. Nothing was reset.',
    );
    const saved = stateComment
      ? await api.updateComment(stateComment.id, body)
      : await api.createComment(exercise.number, body);
    validateSavedComment(saved, body);
    if (stateComment) moduleSafe(saved.id === stateComment.id);
    comments = comments.filter((comment) => comment.id !== saved.id);
    comments.push(saved);
    stateComment = saved;
    state = next;
  };
  if (!stateComment) {
    moduleSafe(exercise.state === 'open');
    state = initialModuleState(binding);
    appendModuleOutbox(
      module,
      binding,
      state,
      `lesson:${module.lessons[0].id}`,
      readme,
    );
    await save(state);
  }
  if (phase === 'initializing') {
    const body = moduleExerciseBody(
      binding,
      'exercise',
      stateComment.id,
      module.exerciseTitle,
    );
    exercise = validateSavedIssue(
      await api.updateExercise(exercise.number, body),
      body,
    );
  }
  let messages = validatePublicationLedger(
    module,
    binding,
    state,
    comments,
    readme,
    stateComment,
  );
  if (exercise.state === 'closed' && state.completed.length < 4)
    return {
      status: 'paused',
      reason: 'exercise-closed',
      completed: state.completed.length,
    };

  const reconcile = async () => {
    for (let index = 0; index < state.outbox.length; index += 1) {
      const entry = state.outbox[index];
      let published = messages.get(entry.key);
      if (!published) {
        const body = moduleMessageBody(
          module,
          binding,
          state,
          entry.key,
          readme,
        );
        published = await api.createComment(exercise.number, body);
        validateSavedComment(published, body);
        comments.push(published);
        messages.set(entry.key, published);
      }
      if (entry.commentId === null) {
        const next = structuredClone(state);
        next.outbox[index].commentId = published.id;
        if (index === 0) next.readyAfterCommentId = published.id;
        await save(next);
      }
    }
    if (
      state.completed.length === 4 &&
      (exercise.state !== 'closed' || exercise.state_reason !== 'completed')
    ) {
      const closed = await api.closeExercise(exercise.number);
      authenticExercise(closed, repository, module);
      moduleSafe(
        closed.number === exercise.number &&
          closed.id === exercise.id &&
          closed.state === 'closed' &&
          closed.state_reason === 'completed' &&
          closed.body === exercise.body,
      );
      exercise = closed;
    }
  };
  await reconcile();
  const queue = comments
    .filter(
      (comment) =>
        human(comment.user) &&
        comment.user.id === binding.learnerId &&
        same(comment.user.login, binding.learner) &&
        comment.id > state.lastProcessedHumanCommentId &&
        comment.id > state.readyAfterCommentId &&
        Date.parse(comment.created_at) >= Date.parse(binding.createdAt) &&
        comment.updated_at === comment.created_at,
    )
    .sort((a, b) => a.id - b.id);
  for (const comment of queue) {
    let plan = planModuleCommand(module, state, comment.body);
    let details;
    if (['bind', 'check'].includes(plan.kind)) {
      try {
        details = await snapshotFor(
          api,
          module,
          state,
          plan,
          exercise,
          issues,
          comment,
        );
      } catch (error) {
        if (!(error instanceof CheckFailed)) throw error;
        plan = { kind: 'reply', text: error.message };
      }
    }
    // Cursor, immutable registration, native evidence and outbox share ONE PATCH.
    await save(
      recordModuleDecision(
        module,
        binding,
        state,
        comment,
        plan,
        details,
        readme,
      ),
    );
    messages = validatePublicationLedger(
      module,
      binding,
      state,
      comments,
      readme,
      stateComment,
    );
    await reconcile();
  }
  return {
    status: state.completed.length === 4 ? 'complete' : 'ready',
    completed: state.completed.length,
  };
}
