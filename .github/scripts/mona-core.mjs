import { createHash } from 'node:crypto';

// Pure policy, state transitions and rendering. No network, filesystem or clock.
export const BOT = 'github-actions[bot]';
export const OCTOCAT = 'https://octodex.github.com/images/original.png';
export const LESSON_IDS = Object.freeze([
  '1-0',
  '1-1',
  '1-2',
  '1-3',
  '2-1',
  '2-2',
  '2-3',
  '2-4',
  '3-1',
  '3-2',
  '3-3',
  '3-4',
]);
const SELF_IDS = new Set(
  LESSON_IDS.filter((id) => !['1-1', '2-2', '2-3', '2-4'].includes(id)),
);
const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPOSITORY = /^([a-z\d][a-z\d-]{0,38})\/([a-z\d_.-]{1,100})$/i;
const SHA = /^[a-f\d]{40}$/i;
const SAMPLE_KEYS = Object.freeze([
  'feature',
  'implementation',
  'verification',
  'bug',
]);
export const BINDING_MARKER = 'bsp-workshop-binding:v2';

export class MonaError extends Error {
  constructor(message, code = 'UNSAFE_STATE') {
    super(message);
    this.name = 'MonaError';
    this.code = code;
  }
}

export class CheckFailed extends MonaError {
  constructor(message) {
    super(message, 'CHECK_FAILED');
  }
}

export function requireSafe(
  condition,
  message = 'Mona stopped: invalid or ambiguous workshop data. Progress was not reset.',
) {
  if (!condition) throw new MonaError(message);
}

export const same = (left, right) =>
  typeof left === 'string' &&
  typeof right === 'string' &&
  left.toLowerCase() === right.toLowerCase();
export const positive = (value) => Number.isSafeInteger(value) && value > 0;
export const human = (user) =>
  user?.type === 'User' && LOGIN.test(user.login ?? '');
export const bot = (user) => user?.type === 'Bot' && user.login === BOT;
export const issueUrl = (repository, number) =>
  `https://github.com/${repository}/issues/${number}`;
// Legacy identification only. V2 never creates or binds bot sample issues.
export const sampleMarker = (key) => `<!-- bsp-workshop-sample:v1 ${key} -->`;
export const messageMarker = (key) => `<!-- bsp-workshop-message:v2 ${key} -->`;
export const markerLine = (body, marker) =>
  typeof body === 'string' && body.split(/\r?\n/).includes(marker);
export function workshopMarkers(body) {
  if (typeof body !== 'string') return [];
  // Match across line breaks too: a malformed multiline marker must fail
  // namespace validation, not disappear from the pre-bootstrap inventory.
  return [...body.matchAll(/<!--\s*bsp-workshop-/gi)].map(({ index }) => {
    const end = body.indexOf('\n', index);
    return body
      .slice(body.lastIndexOf('\n', index) + 1, end < 0 ? body.length : end)
      .replace(/\r$/, '');
  });
}
export const timestamp = (value) =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString() ===
    value.replace(
      /(?:\.(\d{1,3}))?Z$/,
      (_, fraction = '') => `.${fraction.padEnd(3, '0')}Z`,
    );

export function repositoryParts(repository) {
  const match = REPOSITORY.exec(repository ?? '');
  requireSafe(
    match && !['.', '..'].includes(match[2]),
    'Mona stopped: invalid repository context.',
  );
  return { owner: match[1], name: match[2] };
}

export function validateWorkshop(workshop) {
  requireSafe(
    workshop?.schemaVersion === 2 && Array.isArray(workshop.sourceRepositories),
    'Mona stopped: this runtime requires the v2 workshop contract. Legacy workshops must be migrated explicitly; nothing was reset.',
  );
  workshop.sourceRepositories.forEach(repositoryParts);
  requireSafe(typeof workshop.role === 'string');
  // Companion repositories never initialize or process lessons.
  if (workshop.role !== 'starter') return workshop;
  requireSafe(
    workshop.defaultBranch === 'main' && workshop.bootstrapIssueLimit === 1,
  );
  requireSafe(
    typeof workshop.exerciseTitle === 'string' &&
      workshop.exerciseTitle.length < 200,
  );
  requireSafe(
    workshop.exerciseMarker === '<!-- bsp-workshop-exercise:v2 -->' &&
      workshop.stateMarker === 'bsp-workshop-state:v2',
  );
  requireSafe(
    workshop.workBranch === 'workshop/release-checklist' &&
      workshop.workFile === 'work/release-checklist.md' &&
      typeof workshop.requiredWorkText === 'string' &&
      workshop.requiredWorkText.length > 0,
  );
  requireSafe(
    !Object.hasOwn(workshop, 'sampleIssues') &&
      Array.isArray(workshop.backlogItems) &&
      workshop.backlogItems.length === SAMPLE_KEYS.length,
  );
  requireSafe(
    SAMPLE_KEYS.every(
      (key, index) =>
        workshop.backlogItems[index]?.key === key &&
        typeof workshop.backlogItems[index].title === 'string' &&
        workshop.backlogItems[index].title.length > 0 &&
        workshop.backlogItems[index].title.length < 200 &&
        typeof workshop.backlogItems[index].body === 'string',
    ),
  );
  requireSafe(
    new Set(workshop.backlogItems.map(({ title }) => title)).size ===
      SAMPLE_KEYS.length,
  );
  requireSafe(
    Array.isArray(workshop.lessons) &&
      workshop.lessons.length === LESSON_IDS.length,
  );
  workshop.lessons.forEach((lesson, index) => {
    requireSafe(
      lesson.id === LESSON_IDS[index] && lesson.lab === Number(lesson.id[0]),
    );
    requireSafe(
      /^lessons\/(?:[a-z\d_-]+\/)*[a-z\d_-]+\.md$/i.test(lesson.file ?? ''),
    );
    requireSafe(/^[a-z\d_-]+\.png$/i.test(lesson.image ?? ''));
    requireSafe(
      typeof lesson.title === 'string' && typeof lesson.command === 'string',
    );
    const mode = SELF_IDS.has(lesson.id)
      ? 'self-confirmed'
      : ['1-1', '2-4'].includes(lesson.id)
        ? 'mixed'
        : 'repository-verified';
    requireSafe(lesson.mode === mode);
    const command =
      lesson.id === '1-0'
        ? '/project YOUR_PROJECT_URL'
        : lesson.id === '1-1'
          ? '/backlog #FEATURE #IMPLEMENTATION #VERIFICATION #BUG'
          : SELF_IDS.has(lesson.id)
            ? `/done ${lesson.id}`
            : lesson.id === '2-2'
              ? '/check 2-2'
              : `/check ${lesson.id} #YOUR_PR_NUMBER`;
    requireSafe(lesson.command === command);
  });
  const assets = new URL(workshop.publicAssetBase);
  requireSafe(
    assets.protocol === 'https:' &&
      assets.hostname === 'raw.githubusercontent.com' &&
      !assets.username &&
      !assets.password &&
      !assets.search &&
      !assets.hash &&
      assets.pathname.endsWith('/'),
    'Mona stopped: invalid public asset base.',
  );
  return workshop;
}

export function contractHash(workshop) {
  return createHash('sha256').update(JSON.stringify(workshop)).digest('hex');
}

export function bindingFor(workshop, repository, learner, kind) {
  return {
    version: 2,
    contract: contractHash(workshop),
    kind,
    repository: repository.full_name,
    repositoryId: repository.id,
    owner: repository.owner.login,
    ownerType: repository.owner.type,
    learner,
  };
}

function pack(marker, value) {
  return `<!-- ${marker} ${Buffer.from(JSON.stringify(value)).toString('base64')} -->`;
}

function unpack(marker, body) {
  requireSafe(typeof body === 'string' && body.length <= 60_000);
  const prefix = `<!-- ${marker} `;
  const lines = body.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  requireSafe(lines.length === 1 && lines[0].endsWith(' -->'));
  const encoded = lines[0].slice(prefix.length, -4);
  requireSafe(
    /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(
      encoded,
    ),
  );
  const bytes = Buffer.from(encoded, 'base64');
  requireSafe(bytes.toString('base64') === encoded);
  try {
    const result = JSON.parse(bytes.toString('utf8'));
    requireSafe(result && typeof result === 'object' && !Array.isArray(result));
    return result;
  } catch {
    throw new MonaError(
      'Mona stopped: the saved bot state or binding is corrupt. It was not reset.',
    );
  }
}

export const encodeBinding = (binding) => pack(BINDING_MARKER, binding);
export const decodeBinding = (body) => unpack(BINDING_MARKER, body);
export const encodeState = (workshop, state) =>
  `${pack(workshop.stateMarker, state)}\nMona's durable progress; do not edit or delete this bot comment.`;
export const decodeState = (workshop, body) =>
  unpack(workshop.stateMarker, body);
export const hasStateMarker = (workshop, body) =>
  typeof body === 'string' && body.includes(`<!-- ${workshop.stateMarker}`);

export function validateBinding(binding, expected) {
  requireSafe(Object.keys(binding).length === Object.keys(expected).length);
  for (const [key, value] of Object.entries(expected))
    requireSafe(binding[key] === value);
  requireSafe(LOGIN.test(binding.learner ?? ''));
  return binding;
}

// Deliberately not URL-normalized: reject credentials, escapes, ports, suffixes,
// query strings, fragments, whitespace and path/host normalization tricks.
export function validateProjectUrl(value, owner, ownerType) {
  if (typeof value !== 'string' || value.length > 200) return null;
  const match =
    /^https:\/\/github\.com\/(users|orgs)\/([A-Za-z\d][A-Za-z\d-]{0,38})\/projects\/([1-9]\d*)$/.exec(
      value,
    );
  const type =
    ownerType === 'User'
      ? 'users'
      : ownerType === 'Organization'
        ? 'orgs'
        : null;
  if (
    !match ||
    match[1] !== type ||
    !same(match[2], owner) ||
    !positive(Number(match[3]))
  )
    return null;
  return `https://github.com/${type}/${owner}/projects/${match[3]}`;
}

// Accept an address-bar Project link without asking learners to edit it.
// This only normalizes syntax; it never fetches a Project or verifies access.
export function normalizeProjectUrl(value, owner, ownerType) {
  if (
    typeof value !== 'string' ||
    value.length > 512 ||
    /[\s\\\u0000-\u001f]/.test(value)
  )
    return null;
  const address = value.split(/[?#]/)[0];
  if (
    !/^https:\/\/github\.com\/(?:users|orgs)\//.test(address) ||
    /%|\/(?:\.|\.\.)(?:\/|$)/.test(address)
  )
    return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.username ||
    url.password ||
    url.port ||
    /%|\.{2}/.test(url.pathname)
  )
    return null;
  const match =
    /^\/(users|orgs)\/([A-Za-z\d][A-Za-z\d-]{0,38})\/projects\/([1-9]\d*)(?:\/views\/([1-9]\d*))?\/?$/.exec(
      url.pathname,
    );
  if (!match || (match[4] && !positive(Number(match[4])))) return null;
  return validateProjectUrl(
    `https://github.com/${match[1]}/${match[2]}/projects/${match[3]}`,
    owner,
    ownerType,
  );
}

export function initialState(workshop, binding, exercise) {
  return {
    ...binding,
    kind: 'state',
    exerciseNumber: exercise.number,
    createdAt: exercise.created_at,
    samples: null,
    projectUrl: null,
    pullRequest: null,
    completed: [],
    evidence: {},
    lastProcessedHumanCommentId: 0,
    readyAfterCommentId: null,
    lastReply: null,
  };
}

function roleMap(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === SAMPLE_KEYS.length &&
    SAMPLE_KEYS.every((key) => Object.hasOwn(value, key))
  );
}

function validateSamples(samples, exercise) {
  requireSafe(
    roleMap(samples),
    'Mona stopped: all four registered backlog roles are required; the saved map was not reset.',
  );
  const numbers = new Set();
  const ids = new Set();
  for (const key of SAMPLE_KEYS) {
    const item = samples[key];
    requireSafe(
      item &&
        Object.keys(item).length === 2 &&
        positive(item.number) &&
        positive(item.id) &&
        item.number !== exercise.number &&
        item.id !== exercise.id &&
        !numbers.has(item.number) &&
        !ids.has(item.id),
      'Mona stopped: the saved backlog numbers or immutable issue IDs are invalid. They were not rebound.',
    );
    numbers.add(item.number);
    ids.add(item.id);
  }
}

function sameSamples(left, right) {
  return left === null || right === null
    ? left === right
    : roleMap(left) &&
        roleMap(right) &&
        SAMPLE_KEYS.every(
          (key) =>
            left[key]?.number === right[key]?.number &&
            left[key]?.id === right[key]?.id,
        );
}

export function validateState(
  workshop,
  state,
  binding,
  exercise,
  samples = state?.samples,
) {
  requireSafe(state && typeof state === 'object' && !Array.isArray(state));
  const expected = { ...binding, kind: 'state' };
  for (const [key, value] of Object.entries(expected))
    requireSafe(state[key] === value);
  requireSafe(
    state.exerciseNumber === exercise.number &&
      state.createdAt === exercise.created_at &&
      timestamp(state.createdAt),
  );
  requireSafe(
    Array.isArray(state.completed) &&
      state.completed.length <= LESSON_IDS.length &&
      state.completed.every((id, index) => id === LESSON_IDS[index]),
  );
  if (state.completed.includes('1-1')) validateSamples(state.samples, exercise);
  else
    requireSafe(
      state.samples === null,
      'Mona stopped: backlog roles cannot be registered before lesson 1-1.',
    );
  requireSafe(
    sameSamples(state.samples, samples),
    'Mona stopped: the registered backlog map is immutable. No issues were rebound.',
  );
  requireSafe(
    state.evidence &&
      typeof state.evidence === 'object' &&
      !Array.isArray(state.evidence) &&
      Object.keys(state.evidence).length === state.completed.length,
  );
  requireSafe(
    Number.isSafeInteger(state.lastProcessedHumanCommentId) &&
      state.lastProcessedHumanCommentId >= 0,
  );
  requireSafe(
    state.readyAfterCommentId === null || positive(state.readyAfterCommentId),
  );
  requireSafe(
    state.completed.length === 0 || positive(state.readyAfterCommentId),
  );
  let previousId = state.readyAfterCommentId ?? 0;
  for (const id of state.completed) {
    const evidence = state.evidence[id];
    const mode = workshop.lessons.find((lesson) => lesson.id === id).mode;
    requireSafe(
      evidence?.lessonId === id &&
        evidence.mode === mode &&
        positive(evidence.commentId) &&
        evidence.commentId > previousId &&
        evidence.commentId <= state.lastProcessedHumanCommentId &&
        typeof evidence.feedback === 'string' &&
        evidence.feedback.length <= 4_000 &&
        typeof evidence.command === 'string',
    );
    const index = LESSON_IDS.indexOf(id);
    // Replay the pre-registration state, not today's immutable, bound map.
    const historical = {
      ...state,
      completed: state.completed.slice(0, index),
      samples: index <= 1 ? null : state.samples,
    };
    const plan = planCommand(workshop, historical, evidence.command);
    requireSafe(
      ['self', 'backlog', 'check'].includes(plan.kind) && plan.lessonId === id,
    );
    if (id === '1-0')
      requireSafe(
        evidence.projectUrl === state.projectUrl &&
          plan.projectUrl === state.projectUrl,
      );
    if (id === '1-1') {
      validateSamples(evidence.samples, exercise);
      requireSafe(
        evidence.native === 'issues.get' &&
          sameSamples(evidence.samples, state.samples) &&
          positive(evidence.learnerId) &&
          roleMap(evidence.issues),
        'Mona stopped: native backlog binding evidence is missing or corrupt.',
      );
      for (const [roleIndex, key] of SAMPLE_KEYS.entries()) {
        const item = evidence.issues[key];
        requireSafe(
          item?.number === state.samples[key].number &&
            item.id === state.samples[key].id &&
            plan.numbers[roleIndex] === item.number &&
            item.title === workshop.backlogItems[roleIndex].title &&
            same(
              item.repositoryUrl,
              `https://api.github.com/repos/${state.repository}`,
            ) &&
            human(item.author) &&
            item.author.id === evidence.learnerId &&
            same(item.author.login, state.learner) &&
            timestamp(item.createdAt) &&
            Date.parse(item.createdAt) >= Date.parse(state.createdAt) &&
            item.state === 'open' &&
            item.pullRequest === false &&
            item.workshopMarkers === false,
          'Mona stopped: native backlog binding evidence conflicts with its registered role.',
        );
      }
    }
    if (id === '2-2')
      requireSafe(
        evidence.implementation === state.samples.implementation.number &&
          evidence.verification === state.samples.verification.number &&
          evidence.native === 'blocked_by',
      );
    if (id === '2-3')
      requireSafe(
        evidence.prNumber === state.pullRequest?.number &&
          evidence.headSha === state.pullRequest?.headSha &&
          SHA.test(evidence.headSha) &&
          plan.prNumber === evidence.prNumber,
      );
    if (id === '2-4')
      requireSafe(
        evidence.prNumber === state.pullRequest?.number &&
          evidence.headSha === state.pullRequest?.headSha &&
          SHA.test(evidence.mergeSha) &&
          evidence.projectUi === 'SELF-CONFIRMED' &&
          plan.prNumber === evidence.prNumber,
      );
    previousId = evidence.commentId;
  }
  requireSafe(
    state.completed.length === 0
      ? state.projectUrl === null
      : validateProjectUrl(state.projectUrl, state.owner, state.ownerType) ===
          state.projectUrl,
  );
  requireSafe(
    state.completed.includes('2-3')
      ? positive(state.pullRequest?.number) &&
          SHA.test(state.pullRequest.headSha)
      : state.pullRequest === null,
  );
  if (state.lastReply !== null)
    requireSafe(
      positive(state.lastReply?.commentId) &&
        state.lastReply.commentId <= state.lastProcessedHumanCommentId &&
        typeof state.lastReply.text === 'string' &&
        state.lastReply.text.length <= 4_000,
    );
  return state;
}

export function parseCommand(body) {
  if (
    typeof body !== 'string' ||
    body.length > 512 ||
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(body)
  )
    return null;
  if (body === '/status' || body === '/help') return { verb: body.slice(1) };
  if (/^https:\/\/github\.com\//.test(body))
    return { verb: 'project', url: body, direct: true };
  let match = /^\/project (\S+)$/.exec(body);
  if (match) return { verb: 'project', url: match[1] };
  match = /^\/backlog #([1-9]\d*) #([1-9]\d*) #([1-9]\d*) #([1-9]\d*)$/.exec(
    body,
  );
  if (match) {
    const numbers = match.slice(1).map(Number);
    return numbers.every(positive) &&
      new Set(numbers).size === SAMPLE_KEYS.length
      ? { verb: 'backlog', numbers }
      : null;
  }
  match = /^\/done ([1-3]-[0-4])$/.exec(body);
  if (match) return { verb: 'done', lessonId: match[1] };
  if (body === '/check 2-2') return { verb: 'check', lessonId: '2-2' };
  match = /^\/check (2-[34]) #([1-9]\d*)$/.exec(body);
  if (match && positive(Number(match[2])))
    return { verb: 'check', lessonId: match[1], prNumber: Number(match[2]) };
  return null;
}

export function statusText(workshop, state) {
  const lesson = workshop.lessons[state.completed.length];
  return (
    `Mona: ${state.completed.length}/${workshop.lessons.length} lessons recorded. ` +
    (lesson
      ? lesson.id === '1-0'
        ? `Current lesson: **${lesson.id} — ${lesson.title}**. Paste your Project URL as a new comment.`
        : `Current lesson: **${lesson.id} — ${lesson.title}**. Submit \`${commandText(lesson, state)}\`.`
      : '**Workshop complete.**') +
    '\n\nProject UI work is **SELF-CONFIRMED**, never API-verified.'
  );
}

export function helpText(workshop, state) {
  return (
    `${statusText(workshop, state)}\n\nUse one exact command per new, unedited comment. ` +
    'For the first step, paste only your Project URL. Later steps use `/backlog #FEATURE #IMPLEMENTATION #VERIFICATION #BUG`, `/done LESSON_ID`, `/check 2-2`, `/check 2-3 #NUMBER`, `/check 2-4 #NUMBER`, `/status`, `/help`. ' +
    'Create the four work issues manually at lesson 1-1. Only the current lesson and the bound learner are accepted. ' +
    '`/done` cannot bypass backlog registration or repository checks. Registered roles cannot be rebound. There is no reset or skip.'
  );
}

export function planCommand(workshop, state, body) {
  const command = parseCommand(body);
  const reply = (text) => ({ kind: 'reply', text });
  if (!command)
    return typeof body === 'string' && body.startsWith('/')
      ? reply(
          'Mona: command not recognized. Use `/help`; commands must be exact and on one line.',
        )
      : { kind: 'ignore' };
  if (command.verb === 'status') return reply(statusText(workshop, state));
  if (command.verb === 'help') return reply(helpText(workshop, state));
  const lesson = workshop.lessons[state.completed.length];
  if (!lesson)
    return reply(
      'Mona: the workshop is already complete. No lesson was repeated.',
    );
  const wrong = () =>
    reply(
      lesson.id === '1-0'
        ? 'Mona: open your Project, copy its address-bar URL, and paste only that link here.'
        : `Mona: no progress changed. Current lesson is **${lesson.id}**; use \`${commandText(lesson, state)}\`. No reset or skip is available.`,
    );
  if (lesson.id === '1-0' && command.verb === 'project') {
    const projectUrl = (
      command.direct ? normalizeProjectUrl : validateProjectUrl
    )(command.url, state.owner, state.ownerType);
    return projectUrl
      ? { kind: 'self', lessonId: lesson.id, projectUrl }
      : reply(
          'Mona: open the Project owned by the same account as this repository. Copy its address-bar URL and paste only that link in a new comment.',
        );
  }
  if (lesson.id === '1-0') return wrong();
  if (lesson.id === '1-1')
    return command.verb === 'backlog' && state.samples === null
      ? { kind: 'backlog', lessonId: '1-1', numbers: command.numbers }
      : wrong();
  if (command.lessonId !== lesson.id) return wrong();
  if (SELF_IDS.has(lesson.id) && command.verb === 'done')
    return { kind: 'self', lessonId: lesson.id };
  if (!SELF_IDS.has(lesson.id) && command.verb === 'check') {
    if (lesson.id === '2-4' && command.prNumber !== state.pullRequest?.number)
      return wrong();
    return { kind: 'check', lessonId: lesson.id, prNumber: command.prNumber };
  }
  return wrong();
}

function check(condition, message) {
  if (!condition)
    throw new CheckFailed(`Mona: no progress changed. ${message}`);
}

export function verifyBacklog(
  workshop,
  state,
  exercise,
  plan,
  issues,
  inventory = [],
  learner,
) {
  requireSafe(
    state.samples === null &&
      plan.kind === 'backlog' &&
      plan.lessonId === '1-1' &&
      Array.isArray(plan.numbers) &&
      plan.numbers.length === SAMPLE_KEYS.length &&
      plan.numbers.every(positive) &&
      new Set(plan.numbers).size === SAMPLE_KEYS.length &&
      Array.isArray(issues) &&
      issues.length === SAMPLE_KEYS.length &&
      Array.isArray(inventory),
  );
  requireSafe(
    human(learner) &&
      same(learner.login, state.learner) &&
      positive(learner.id),
    'Mona could not read the canonical learner author ID. Retry the workflow; no progress changed.',
  );
  const samples = {};
  const evidence = {};
  const ids = new Set();
  for (const [index, key] of SAMPLE_KEYS.entries()) {
    const issue = issues[index];
    const listed = inventory.find(
      (item) => item.number === plan.numbers[index],
    );
    requireSafe(
      issue?.number === plan.numbers[index] &&
        positive(issue.id) &&
        !ids.has(issue.id) &&
        (!listed || listed.id === issue.id) &&
        same(
          issue.repository_url,
          `https://api.github.com/repos/${state.repository}`,
        ) &&
        timestamp(issue.created_at) &&
        typeof issue.title === 'string' &&
        ['open', 'closed'].includes(issue.state) &&
        (issue.body === null || typeof issue.body === 'string'),
      'Mona could not read authentic backlog issue numbers, immutable IDs, repository or creation dates. Retry the workflow; no progress changed.',
    );
    ids.add(issue.id);
    check(
      issue.number !== exercise.number && issue.id !== exercise.id,
      'The Mona exercise cannot be a backlog item. Create four separate work issues manually.',
    );
    check(
      !issue.pull_request,
      `The ${key} role must be an issue, not a pull request.`,
    );
    check(
      issue.state === 'open',
      `The ${key} issue must be open when you register the backlog.`,
    );
    check(
      human(issue.user) && same(issue.user.login, state.learner),
      `The ${key} issue must be created manually by the bound human learner @${state.learner}, not a bot or another author.`,
    );
    requireSafe(
      positive(issue.user.id) && issue.user.id === learner.id,
      'Mona could not read a matching immutable native backlog author ID. Retry the workflow; no progress changed.',
    );
    check(
      Date.parse(issue.created_at) >= Date.parse(exercise.created_at),
      `The ${key} issue must be created at or after this Mona exercise; older issues cannot be registered.`,
    );
    check(
      !/bsp-workshop-/i.test(issue.body ?? ''),
      `The ${key} issue contains reserved or forged workshop markers. Use a clean, manually created work issue without bot metadata.`,
    );
    check(
      issue.title === workshop.backlogItems[index].title,
      `The ${key} issue must have the exact title "${workshop.backlogItems[index].title}". Submit roles in feature, implementation, verification, bug order; do not swap them.`,
    );
    samples[key] = { number: issue.number, id: issue.id };
    evidence[key] = {
      number: issue.number,
      id: issue.id,
      title: issue.title,
      repositoryUrl: issue.repository_url,
      author: {
        login: issue.user.login,
        type: issue.user.type,
        id: issue.user.id,
      },
      createdAt: issue.created_at,
      state: 'open',
      pullRequest: false,
      workshopMarkers: false,
    };
  }
  validateSamples(samples, exercise);
  return {
    native: 'issues.get',
    learnerId: learner.id,
    samples,
    issues: evidence,
  };
}

export function verifyDependency(state, dependencies) {
  requireSafe(
    Array.isArray(dependencies),
    'Mona could not read complete repository evidence. Retry the workflow; no progress changed.',
  );
  const implementation = state.samples.implementation;
  check(
    dependencies.some(
      (item) =>
        item?.number === implementation.number &&
        item.id === implementation.id &&
        !item.pull_request &&
        same(
          item.repository_url,
          `https://api.github.com/repos/${state.repository}`,
        ),
    ),
    'Use the native issue relationship: the verification issue must be blocked by the implementation issue, then submit `/check 2-2` again. A body link or Project field is not a dependency.',
  );
  return {
    native: 'blocked_by',
    implementation: implementation.number,
    verification: state.samples.verification.number,
  };
}

export function verifyPullRequest(workshop, state, plan, snapshot) {
  const { pr, after, files, closingIssues, content } = snapshot;
  requireSafe(
    pr &&
      after &&
      Array.isArray(files) &&
      Array.isArray(closingIssues) &&
      typeof content === 'string',
    'Mona could not read complete repository evidence. Retry the workflow; no progress changed.',
  );
  const inRepo = (repo) =>
    repo?.id === state.repositoryId && same(repo.full_name, state.repository);
  const merged = plan.lessonId === '2-4';
  check(
    pr.number === plan.prNumber &&
      after.number === pr.number &&
      inRepo(pr.base?.repo) &&
      inRepo(pr.head?.repo) &&
      inRepo(after.base?.repo) &&
      inRepo(after.head?.repo),
    'Use a pull request whose head and base both belong to this repository.',
  );
  check(
    human(pr.user) &&
      same(pr.user.login, state.learner) &&
      same(after.user?.login, state.learner),
    'The pull request must be authored by the bound learner.',
  );
  check(
    pr.head.ref === workshop.workBranch &&
      pr.base.ref === workshop.defaultBranch &&
      after.head.ref === pr.head.ref &&
      after.base.ref === pr.base.ref,
    'Use the workshop/release-checklist branch targeting main.',
  );
  check(
    SHA.test(pr.head.sha) &&
      pr.head.sha === after.head.sha &&
      pr.state === after.state &&
      pr.merged === after.merged &&
      pr.merge_commit_sha === after.merge_commit_sha,
    'The pull request changed during verification. Submit the check again.',
  );
  check(
    files.length === 1 &&
      pr.changed_files === 1 &&
      after.changed_files === 1 &&
      files[0]?.filename === workshop.workFile &&
      files[0].status === 'modified' &&
      (!files[0].previous_filename ||
        files[0].previous_filename === workshop.workFile),
    'The pull request must modify only work/release-checklist.md; no renames or other changed files.',
  );
  check(
    closingIssues.some(
      (item) =>
        item?.number === state.samples.implementation.number &&
        same(item.repository?.nameWithOwner, state.repository),
    ),
    'Add an actual native closing reference to the implementation issue. Mentioning its number alone is not enough.',
  );
  check(
    content.split(/\r?\n/).includes(workshop.requiredWorkText),
    'The required completed checklist line must be present in the checked repository file.',
  );
  if (!merged) {
    check(
      pr.state === 'open' &&
        pr.merged === false &&
        !pr.merged_at &&
        after.merged_at === pr.merged_at,
      'Keep the linked pull request open for lesson 2-3.',
    );
    return {
      prNumber: pr.number,
      headSha: pr.head.sha,
      native: 'closingIssuesReferences',
    };
  }
  check(
    pr.number === state.pullRequest.number &&
      pr.head.sha === state.pullRequest.headSha,
    'Use the same pull request and checked head recorded in lesson 2-3.',
  );
  check(
    pr.state === 'closed' &&
      pr.merged === true &&
      Number.isFinite(Date.parse(pr.merged_at)) &&
      SHA.test(pr.merge_commit_sha) &&
      after.merged_at === pr.merged_at,
    'Merge that pull request into main first; a closed, unmerged pull request does not pass.',
  );
  const { implementation, verification } = snapshot;
  const boundIssue = (issue, key) =>
    requireSafe(
      issue?.number === state.samples[key].number &&
        issue.id === state.samples[key].id &&
        !issue.pull_request &&
        same(
          issue.repository_url,
          `https://api.github.com/repos/${state.repository}`,
        ),
      'Mona could not read the registered issue number, immutable ID and repository. Retry the workflow; no progress changed.',
    );
  boundIssue(implementation, 'implementation');
  boundIssue(verification, 'verification');
  check(
    implementation.state === 'closed' &&
      implementation.state_reason === 'completed',
    'The implementation issue must be closed as completed.',
  );
  check(
    verification.state === 'open',
    'Leave the verification issue open for Sprint 2.',
  );
  return {
    prNumber: pr.number,
    headSha: pr.head.sha,
    mergeSha: pr.merge_commit_sha,
    native: 'merged-and-closingIssuesReferences',
    projectUi: 'SELF-CONFIRMED',
  };
}

function feedbackFor(id, details) {
  if (id === '1-0')
    return 'Mona: Project link saved. Next, create your backlog. (Project settings are self-confirmed.)';
  if (id === '1-1')
    return (
      'Mona: **1-1 — MIXED EVIDENCE**. Four native issue GETs verified distinct numbers and immutable IDs, this repository, open non-PR work issues, the bound human author, creation dates, clean metadata and exact role titles. ' +
      'The feature, implementation, verification and bug map is now immutable. Project backlog and Project UI work are **SELF-CONFIRMED by your command**. No work issue was created or edited by Mona.'
    );
  if (id === '2-2')
    return `Mona: **2-2 — REPOSITORY-VERIFIED**. Native Issues REST blocked_by: #${details.verification} is blocked by #${details.implementation}. Project UI remains SELF-CONFIRMED.`;
  if (id === '2-3')
    return `Mona: **2-3 — REPOSITORY-VERIFIED**. PR #${details.prNumber}, head ${details.headSha}: learner, repository, branch, native closing link, single checklist file and required line checked.`;
  if (id === '2-4')
    return `Mona: **2-4 — MIXED EVIDENCE**. PR #${details.prNumber} merged into main at ${details.mergeSha}; native closing link, implementation completed, verification open and merged checklist verified. Project Done and Sprint 2 carry-over are **SELF-CONFIRMED by your command**.\n\n**Lab 2 complete. Next: Lab 3 — roadmap and communicate.**`;
  return (
    `Mona: **${id} — SELF-CONFIRMED**. Your Project UI work is recorded, not API-verified.` +
    (id === '1-3'
      ? '\n\n**Lab 1 complete. Next: Lab 2 — plan and deliver.**'
      : '')
  );
}

// The reducer returns a NEW state. A caller must persist it before publishing
// feedback/next lesson. Negative checks never create a completion record.
export function recordDecision(workshop, state, comment, plan, details = {}) {
  requireSafe(
    positive(comment.id) &&
      comment.id > state.lastProcessedHumanCommentId &&
      positive(state.readyAfterCommentId) &&
      comment.id > state.readyAfterCommentId,
  );
  const next = structuredClone(state);
  next.lastProcessedHumanCommentId = comment.id;
  if (plan.kind === 'reply')
    next.lastReply = { commentId: comment.id, text: plan.text };
  if (['self', 'backlog', 'check'].includes(plan.kind)) {
    requireSafe(workshop.lessons[state.completed.length]?.id === plan.lessonId);
    const lesson = workshop.lessons[state.completed.length];
    if (plan.kind === 'self')
      details = plan.projectUrl ? { projectUrl: plan.projectUrl } : {};
    if (plan.kind === 'backlog') {
      requireSafe(
        lesson.id === '1-1' &&
          state.samples === null &&
          details.native === 'issues.get',
      );
      validateSamples(details.samples, { number: state.exerciseNumber });
      next.samples = structuredClone(details.samples);
    }
    next.evidence[lesson.id] = {
      ...structuredClone(details),
      lessonId: lesson.id,
      mode: lesson.mode,
      commentId: comment.id,
      command: comment.body,
      feedback: feedbackFor(lesson.id, details),
    };
    if (plan.projectUrl) next.projectUrl = plan.projectUrl;
    if (lesson.id === '2-3')
      next.pullRequest = { number: details.prNumber, headSha: details.headSha };
    next.completed.push(lesson.id);
  }
  return next;
}

function commandText(lesson, state) {
  return lesson.command.replace(
    'YOUR_PR_NUMBER',
    String(state.pullRequest?.number ?? 'YOUR_PR_NUMBER'),
  );
}

export function renderLesson(workshop, state, lesson, source) {
  requireSafe(
    typeof source === 'string' && source.length > 0 && source.length <= 48_000,
    'Mona stopped: a lesson file is missing, empty or too large. Restore the course file and rerun.',
  );
  const values = {
    REPO: state.repository,
    OWNER: state.owner,
    LEARNER: state.learner,
    PROJECT_URL: state.projectUrl ?? 'YOUR_PROJECT_URL',
    EXERCISE_URL: issueUrl(state.repository, state.exerciseNumber),
    PR_NUMBER: String(state.pullRequest?.number ?? 'YOUR_PR_NUMBER'),
    CLONE_COMMAND: `git clone https://github.com/${state.repository}.git`,
  };
  let text = source.replace(/\{\{([A-Za-z_]+)\}\}/g, (_, key) => {
    if (key.startsWith('ISSUE_') && SAMPLE_KEYS.includes(key.slice(6))) {
      const sample = state.samples?.[key.slice(6)];
      requireSafe(
        positive(sample?.number) && positive(sample.id),
        `Mona stopped: lesson placeholder ${key} requires the four manually created issues registered with /backlog at lesson 1-1. No issue number was invented.`,
      );
      return String(sample.number);
    }
    requireSafe(
      Object.hasOwn(values, key),
      'Mona stopped: unknown lesson placeholder.',
    );
    return values[key];
  });
  const image = (target) => {
    if (/^https:\/\//.test(target)) return target;
    requireSafe(
      !/^[a-z]+:|^\/\/|[?#%\\]/i.test(target),
      'Mona stopped: invalid lesson image.',
    );
    const name = target.split('/').at(-1);
    requireSafe(
      /^[a-z\d_.-]+\.(?:png|jpe?g|gif|webp|svg)$/i.test(name),
      'Mona stopped: invalid lesson image.',
    );
    return new URL(name, workshop.publicAssetBase).href;
  };
  text = text.replace(
    /(!\[[^\]\n]*\]\()<?([^\s)>]+)>?([^\n)]*\))/g,
    (_, prefix, target, suffix) => `${prefix}${image(target)}${suffix}`,
  );
  const references = new Set(
    [...text.matchAll(/!\[([^\]\n]*)\]\[([^\]\n]*)\]/g)].map((match) =>
      (match[2] || match[1]).toLowerCase(),
    ),
  );
  text = text.replace(
    /^(\s*\[([^\]\n]+)\]:\s*)<?([^\s>]+)>?(.*)$/gm,
    (whole, prefix, key, target, suffix) =>
      references.has(key.toLowerCase())
        ? `${prefix}${image(target)}${suffix}`
        : whole,
  );
  text = text.replace(
    /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,
    (_, prefix, target, suffix) => `${prefix}${image(target)}${suffix}`,
  );
  const screenshot = new URL(lesson.image, workshop.publicAssetBase).href;
  const result =
    `${messageMarker(`lesson:${lesson.id}`)}\n### Mona — ${lesson.id}: ${lesson.title}\n\n` +
    `<img src="${OCTOCAT}" width="64" alt="Mona the Octocat">\n\n${text}\n\n` +
    (text.includes(screenshot)
      ? ''
      : `![Lesson ${lesson.id} illustration](${screenshot})\n\n`) +
    (lesson.id === '1-0'
      ? 'Paste only your Project URL as a new comment below.\n\n'
      : `When ready, submit \`${commandText(lesson, state)}\` in a new comment.\n\n`) +
    'Octocat artwork: [GitHub Octodex](https://octodex.github.com/).';
  requireSafe(
    result.length <= 60_000,
    'Mona stopped: rendered lesson is too large.',
  );
  return result;
}

export function completionText(state) {
  return (
    '### Mona — workshop complete\n\nAll 12 lessons have recorded evidence.\n\n' +
    '**REPOSITORY-VERIFIED:** the native issue identity/author/date/role checks in mixed lesson 1-1; 2-2 native blocked_by dependency; 2-3 learner PR, exact branch/file/required line and native closing link; ' +
    `2-4 the same PR #${state.pullRequest.number}, merge into main, completed implementation, open verification and required checklist in the merged ref.\n\n` +
    '**SELF-CONFIRMED:** 1-0, 1-2, 1-3, 2-1, 3-1, 3-2, 3-3, 3-4, plus the Project backlog in mixed lesson 1-1 and Project Done and Sprint 2 carry-over in mixed lesson 2-4. ' +
    'Project existence/access, fields, views, roadmap, workload, charts and updates were never API-verified.\n\n' +
    `Bound Project: ${state.projectUrl}\n\nOnly this exercise issue will be closed. Keep verification work open for Sprint 2.`
  );
}
