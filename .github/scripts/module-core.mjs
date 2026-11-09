import { createHash } from 'node:crypto';
import {
  MonaError,
  CheckFailed,
  human,
  positive,
  same,
  repositoryParts,
  timestamp,
  validateProjectUrl,
  normalizeProjectUrl,
} from './mona-core.mjs';

export { MonaError, CheckFailed };

// Standalone modules deliberately share neither the Lab 1 state nor its markers.
export const MODULE_EXERCISE = '<!-- bsp-module-exercise:v1 -->';
export const MODULE_BINDING = 'bsp-module-binding:v1';
export const MODULE_STATE = 'bsp-module-state:v1';
export const MODULE_MESSAGE = 'bsp-module-message:v1';
export const FIRST_LINK_HELP =
  'Open your Project, copy its address-bar URL, and paste only that link here.';
export const MODULE_SOURCES = Object.freeze(
  [1, 2, 3].map((lab) => `alvine-aurelio-org/bsp-github-projects-lab-${lab}`),
);
export const ROLE_KEYS = Object.freeze(['implementation', 'verification']);
const TITLES = Object.freeze([
  '[Workshop] Publish the service release checklist',
  '[Workshop] Verify the release checklist in Sprint 2',
]);
const SHA = /^[a-f\d]{40}$/i;
const DIGEST = /^[a-f\d]{64}$/;
const own = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = (value, limit = 200) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= limit &&
  !/[\u0000-\u001f\u007f<>{}]/.test(value);

export function moduleSafe(
  condition,
  message = 'Mona stopped: standalone module data is missing, corrupt or ambiguous. Nothing was reset.',
) {
  if (!condition) throw new MonaError(message);
}

export function exactKeys(value, keys) {
  return (
    own(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!own(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

export const moduleDigest = (text) =>
  createHash('sha256').update(text).digest('hex');
export const moduleContractHash = (module) =>
  moduleDigest(JSON.stringify(canonical(module)));
export const moduleGuideHash = (readme) =>
  moduleDigest(readme.replace(/\r\n/g, '\n'));

export function validateModule(module) {
  moduleSafe(
    exactKeys(module, [
      'schemaVersion',
      'role',
      'lab',
      'title',
      'minutes',
      'continuationMinutes',
      'bootstrapIssueLimit',
      'starterRepository',
      'sourceRepositories',
      'defaultBranch',
      'exerciseTitle',
      'publicAssetBase',
      'workBranch',
      'workFile',
      'requiredWorkText',
      'workItems',
      'lessons',
    ]),
    'Mona stopped: this entry point requires the standalone schema-v3 module contract.',
  );
  moduleSafe(
    module.schemaVersion === 3 &&
      module.role === 'standalone' &&
      [2, 3].includes(module.lab),
  );
  moduleSafe(
    module.minutes === 45 &&
      module.continuationMinutes === 35 &&
      module.bootstrapIssueLimit === 1 &&
      module.defaultBranch === 'main',
  );
  moduleSafe(
    module.starterRepository === MODULE_SOURCES[0] &&
      Array.isArray(module.sourceRepositories) &&
      JSON.stringify(module.sourceRepositories) ===
        JSON.stringify(MODULE_SOURCES),
  );
  module.sourceRepositories.forEach(repositoryParts);
  moduleSafe(
    plain(module.title) &&
      plain(module.exerciseTitle) &&
      module.exerciseTitle ===
        `Mona's GitHub Projects Lab ${module.lab} — start here`,
  );
  moduleSafe(
    module.publicAssetBase ===
      `https://raw.githubusercontent.com/${MODULE_SOURCES[module.lab - 1]}/main/assets/screenshots/`,
    'Mona stopped: module assets must use the canonical public lab source.',
  );
  moduleSafe(
    module.workBranch === 'workshop/release-checklist' &&
      module.workFile === 'work/release-checklist.md' &&
      module.requiredWorkText === '- [x] Publish the service release checklist',
  );
  moduleSafe(Array.isArray(module.workItems) && module.workItems.length === 2);
  module.workItems.forEach((item, index) =>
    moduleSafe(
      exactKeys(item, ['key', 'title']) &&
        item.key === ROLE_KEYS[index] &&
        item.title === TITLES[index],
    ),
  );
  moduleSafe(Array.isArray(module.lessons) && module.lessons.length === 4);
  const times = module.lab === 2 ? [18, 7, 12, 8] : [20, 8, 7, 10];
  module.lessons.forEach((lesson, index) => {
    const step = index + 1;
    const id = `${module.lab}-${step}`;
    const mode =
      index === 0 || (module.lab === 2 && step === 4)
        ? 'mixed'
        : module.lab === 3
          ? 'self-confirmed'
          : 'repository-verified';
    const command =
      index === 0
        ? 'YOUR_PROJECT_URL'
        : module.lab === 3
          ? `/done ${id}`
          : step === 2
            ? '/check 2-2'
            : `/check ${id} #YOUR_PR_NUMBER`;
    moduleSafe(
      exactKeys(lesson, [
        'id',
        'step',
        'minutes',
        'title',
        'mode',
        'command',
        'image',
      ]) &&
        lesson.id === id &&
        lesson.step === step &&
        lesson.minutes === times[index] &&
        plain(lesson.title) &&
        lesson.mode === mode &&
        lesson.command === command &&
        lesson.image === `lab-${module.lab}-step-${step}.png`,
    );
  });
  return module;
}

// Only real, top-level Markdown headings delimit a step. Examples in fences do not.
export function extractModuleLesson(readme, step) {
  moduleSafe(
    typeof readme === 'string' &&
      readme.length > 0 &&
      readme.length <= 512_000 &&
      Number.isInteger(step) &&
      step >= 1 &&
      step <= 4,
    'Mona stopped: the module README or step is invalid.',
  );
  const lines = readme.replace(/\r\n/g, '\n').split('\n');
  const headings = [];
  let fence = null;
  for (const [index, line] of lines.entries()) {
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        match &&
        match[1][0] === fence.character &&
        match[1].length >= fence.length &&
        /^\s*$/.test(match[2])
      )
        fence = null;
      continue;
    }
    if (match) {
      fence = { character: match[1][0], length: match[1].length };
      continue;
    }
    if (/^##(?:[ \t]+|$)/.test(line)) headings.push({ index, line });
  }
  const matches = headings.filter(({ line }) =>
    new RegExp(`^## Step ${step} — [^\\n]+$`).test(line),
  );
  moduleSafe(
    matches.length === 1,
    `Mona stopped: README must contain exactly one "## Step ${step} — ..." section.`,
  );
  const start = matches[0].index;
  const end =
    headings.find(({ index }) => index > start)?.index ?? lines.length;
  const source = lines.slice(start, end).join('\n').trimEnd();
  moduleSafe(
    source.length <= 48_000 && !/bsp-(?:workshop|module)\b/i.test(source),
    'Mona stopped: a README step is too large or contains reserved bot metadata.',
  );
  return source;
}

const TOKENS = new Set([
  'REPO',
  'OWNER',
  'LEARNER',
  'PROJECT_URL',
  'ISSUE_implementation',
  'ISSUE_verification',
  'PR_NUMBER',
  'EXERCISE_URL',
]);

function resolveModuleImages(module, source) {
  const image = (target) => {
    const match =
      /^(?:\.\/)?assets\/screenshots\/(lab-[23]-step-[1-4]\.png)$/.exec(target);
    if (match) {
      moduleSafe(match[1].startsWith(`lab-${module.lab}-`));
      return `${module.publicAssetBase}${match[1]}`;
    }
    moduleSafe(
      module.lessons.some(
        ({ image: name }) => target === `${module.publicAssetBase}${name}`,
      ),
      "Mona stopped: a README image does not use this module's canonical public assets.",
    );
    return target;
  };
  let text = source.replace(
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
  return text.replace(
    /(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,
    (_, prefix, target, suffix) => `${prefix}${image(target)}${suffix}`,
  );
}

export function validateModuleReadme(module, readme) {
  for (const lesson of module.lessons) {
    const source = extractModuleLesson(readme, lesson.step);
    const rest = source.replace(/\{\{([A-Za-z_]+)\}\}/g, (_, key) => {
      moduleSafe(
        TOKENS.has(key),
        'Mona stopped: unknown README lesson placeholder.',
      );
      moduleSafe(
        lesson.step !== 1 ||
          ![
            'PROJECT_URL',
            'PR_NUMBER',
            ...ROLE_KEYS.map((role) => `ISSUE_${role}`),
          ].includes(key),
        'Mona stopped: the first README step cannot reference an unbound Project, issue or PR.',
      );
      moduleSafe(
        key !== 'PR_NUMBER' || (module.lab === 2 && lesson.step === 4),
        'Mona stopped: that README step requires a pull request not yet registered.',
      );
      return '';
    });
    moduleSafe(
      !rest.includes('{{') && !rest.includes('}}'),
      'Mona stopped: malformed README lesson placeholder.',
    );
    resolveModuleImages(module, source);
  }
  return readme;
}

export function moduleBinding(
  module,
  readme,
  repository,
  learner,
  exercise = null,
) {
  moduleSafe(human(learner) && positive(learner.id));
  return {
    version: 1,
    contract: moduleContractHash(module),
    guideHash: moduleGuideHash(readme),
    lab: module.lab,
    repository: repository.full_name,
    repositoryId: repository.id,
    owner: repository.owner.login,
    ownerType: repository.owner.type,
    ownerId: repository.owner.id,
    learner: learner.login,
    learnerId: learner.id,
    exerciseNumber: exercise?.number ?? null,
    exerciseId: exercise?.id ?? null,
    createdAt: exercise?.created_at ?? null,
  };
}

export function sameEnvelope(value, expected) {
  return (
    exactKeys(value, Object.keys(expected)) &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

export function packModule(marker, value) {
  return `<!-- ${marker} ${Buffer.from(JSON.stringify(value)).toString('base64')} -->`;
}

export function unpackModule(marker, body) {
  moduleSafe(typeof body === 'string' && body.length <= 60_000);
  const prefix = `<!-- ${marker} `;
  const lines = body.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  moduleSafe(lines.length === 1 && lines[0].endsWith(' -->'));
  const encoded = lines[0].slice(prefix.length, -4);
  moduleSafe(
    /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(
      encoded,
    ),
  );
  const bytes = Buffer.from(encoded, 'base64');
  moduleSafe(bytes.toString('base64') === encoded);
  try {
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    moduleSafe(own(value));
    return value;
  } catch {
    throw new MonaError(
      'Mona stopped: saved module metadata is corrupt. It was not reset.',
    );
  }
}

export const encodeModuleBinding = (binding) =>
  packModule(MODULE_BINDING, binding);
export const decodeModuleBinding = (body) => unpackModule(MODULE_BINDING, body);
export const encodeModuleState = (state) =>
  `${packModule(MODULE_STATE, state)}\nMona's saved module progress; do not edit or delete.`;
export const decodeModuleState = (body) => unpackModule(MODULE_STATE, body);
export const moduleMessageMarker = (binding, key) =>
  packModule(MODULE_MESSAGE, { ...binding, kind: 'message', key });
export const hasModuleState = (body) =>
  typeof body === 'string' && body.includes(`<!-- ${MODULE_STATE}`);

// Detect unknown versions and malformed/multiline/case-varied namespace artifacts.
export function moduleMarkers(body) {
  if (typeof body !== 'string') return [];
  return [...body.matchAll(/<!--\s*bsp-(?:module|workshop)\b/gi)].map(
    ({ index }) => {
      const end = body.indexOf('\n', index);
      return body
        .slice(body.lastIndexOf('\n', index) + 1, end < 0 ? body.length : end)
        .replace(/\r$/, '');
    },
  );
}

export function moduleExerciseBody(
  binding,
  phase = 'exercise',
  stateCommentId = null,
  title,
) {
  const envelope = {
    ...binding,
    kind: phase,
    ...(phase === 'exercise' ? { stateCommentId } : {}),
  };
  return (
    `${MODULE_EXERCISE}\n${encodeModuleBinding(envelope)}\n### ${title}\n\n` +
    `Learner: @${binding.learner}. Follow the four lesson comments in this private repository. ` +
    'Create the two work issues yourself as described in Step 1; Mona creates only this exercise. ' +
    'Use a new comment for each answer. No other repository or Project is created automatically.'
  );
}

function commandText(lesson, state) {
  return lesson.command.replace(
    'YOUR_PR_NUMBER',
    String(state.pullRequest?.number ?? 'YOUR_PR_NUMBER'),
  );
}

export function renderModuleLesson(module, state, lesson, readme) {
  const source = extractModuleLesson(readme, lesson.step);
  const values = {
    REPO: state.repository,
    OWNER: state.owner,
    LEARNER: state.learner,
    PROJECT_URL: state.projectUrl,
    PR_NUMBER: state.pullRequest?.number,
    EXERCISE_URL: positive(state.exerciseNumber)
      ? `https://github.com/${state.repository}/issues/${state.exerciseNumber}`
      : null,
    ...Object.fromEntries(
      ROLE_KEYS.map((role) => [`ISSUE_${role}`, state.samples?.[role]?.number]),
    ),
  };
  let text = source.replace(/\{\{([A-Za-z_]+)\}\}/g, (_, key) => {
    moduleSafe(
      TOKENS.has(key) &&
        values[key] !== null &&
        values[key] !== undefined &&
        (!key.startsWith('ISSUE_') ||
          (positive(values[key]) &&
            positive(state.samples?.[key.slice(6)]?.id))),
      `Mona stopped: README placeholder ${key} is unbound. No issue or PR number was invented.`,
    );
    return String(values[key]);
  });
  moduleSafe(!text.includes('{{') && !text.includes('}}'));
  text = resolveModuleImages(module, text);
  return `${text}\n\n${
    lesson.step === 1
      ? FIRST_LINK_HELP
      : `When ready, post \`${commandText(lesson, state)}\` as a new comment.`
  }`;
}

export function moduleStatus(module, state) {
  const lesson = module.lessons[state.completed.length];
  return (
    `${state.completed.length}/4 steps recorded. ` +
    (lesson
      ? `Current step: ${lesson.id} — ${lesson.title}. ` +
        (lesson.step === 1
          ? FIRST_LINK_HELP
          : `Use \`${commandText(lesson, state)}\`.`)
      : 'This module is complete.')
  );
}

export function moduleHelp(module, state) {
  return (
    `${moduleStatus(module, state)}\n\n` +
    'Create the two native work issues manually with the exact Step 1 titles, then paste only your Project address-bar link. ' +
    'Only the current step and the learner who started this exercise are accepted. Use one new, unedited comment per answer. ' +
    'The saved Project and issue roles cannot be changed; there is no reset or skip. `/status` and `/help` are safe. ' +
    (module.lab === 2
      ? 'Later commands are `/check 2-2`, `/check 2-3 #NUMBER`, and `/check 2-4 #NUMBER` for the same checked PR. '
      : 'Later commands are `/done 3-2`, `/done 3-3`, and `/done 3-4`. ') +
    'Project existence, access, settings, views, fields, charts and updates are SELF-CONFIRMED, never read through a Projects API. ' +
    'Native issue identity is checked in Step 1; Lab 2 also checks native dependencies and PR/merge evidence. ' +
    'Only the built-in repository workflow token is used; no instructor, PAT or App is needed.'
  );
}

export function planModuleCommand(module, state, body) {
  const reply = (text) => ({ kind: 'reply', text });
  if (body === '/status') return reply(moduleStatus(module, state));
  if (body === '/help') return reply(moduleHelp(module, state));
  const lesson = module.lessons[state.completed.length];
  if (!lesson)
    return reply('This module is already complete. No step was repeated.');
  if (lesson.step === 1) {
    const projectUrl = normalizeProjectUrl(body, state.owner, state.ownerType);
    return projectUrl
      ? { kind: 'bind', lessonId: lesson.id, projectUrl }
      : reply(FIRST_LINK_HELP);
  }
  if (
    typeof body !== 'string' ||
    body.length > 512 ||
    /[\u0000-\u001f\u007f\u2028\u2029]/.test(body)
  )
    return reply(
      `No progress changed. ${moduleStatus(module, state)} Use a single new comment.`,
    );
  if (module.lab === 3 && body === lesson.command)
    return { kind: 'self', lessonId: lesson.id };
  if (module.lab === 2 && lesson.step === 2 && body === '/check 2-2')
    return { kind: 'check', lessonId: lesson.id };
  const match = /^\/check (2-[34]) #([1-9]\d*)$/.exec(body);
  if (
    module.lab === 2 &&
    match &&
    match[1] === lesson.id &&
    positive(Number(match[2])) &&
    (lesson.step !== 4 || Number(match[2]) === state.pullRequest?.number)
  )
    return { kind: 'check', lessonId: lesson.id, prNumber: Number(match[2]) };
  return reply(
    `No progress changed. ${moduleStatus(module, state)} The Project and issue roles stay fixed; no reset or skip is available.`,
  );
}

function check(condition, message) {
  if (!condition) throw new CheckFailed(message);
}

export function validateModuleSamples(samples, exercise) {
  moduleSafe(exactKeys(samples, ROLE_KEYS));
  const numbers = new Set();
  const ids = new Set();
  for (const role of ROLE_KEYS) {
    const item = samples[role];
    moduleSafe(
      exactKeys(item, ['number', 'id']) &&
        positive(item.number) &&
        positive(item.id) &&
        item.number !== exercise.number &&
        item.id !== exercise.id &&
        !numbers.has(item.number) &&
        !ids.has(item.id),
      'Mona stopped: saved issue roles have invalid numbers or immutable IDs. They were not rebound.',
    );
    numbers.add(item.number);
    ids.add(item.id);
  }
}

export function verifyModuleWorkItems(
  module,
  state,
  exercise,
  inventory,
  issues,
  learner,
) {
  moduleSafe(
    state.samples === null &&
      Array.isArray(inventory) &&
      Array.isArray(issues) &&
      issues.length === 2,
  );
  moduleSafe(
    human(learner) &&
      positive(learner.id) &&
      learner.id === state.learnerId &&
      same(learner.login, state.learner),
    "Mona could not read the bound human learner's native author ID. Retry without changing authentication.",
  );
  const samples = {};
  const evidence = {};
  for (const [index, role] of ROLE_KEYS.entries()) {
    const issue = issues[index];
    const title = module.workItems[index].title;
    const listed = inventory.filter((item) => item.title === title);
    check(
      listed.length === 1,
      'Create the two work issues first, using the exact Step 1 titles once each, then paste your Project URL again. Mona will not create them for you.',
    );
    moduleSafe(
      issue?.number === listed[0].number &&
        positive(issue.id) &&
        issue.id === listed[0].id &&
        same(
          issue.repository_url,
          `https://api.github.com/repos/${state.repository}`,
        ) &&
        timestamp(issue.created_at) &&
        typeof issue.title === 'string' &&
        ['open', 'closed'].includes(issue.state) &&
        (issue.body === null || typeof issue.body === 'string') &&
        issue.user &&
        positive(issue.user.id) &&
        typeof issue.user.login === 'string' &&
        ['User', 'Bot', 'Mannequin'].includes(issue.user.type),
      'Mona could not read complete native work-issue identity and dates. Retry the workflow; no progress changed.',
    );
    check(
      issue.title === title &&
        issue.number !== exercise.number &&
        issue.id !== exercise.id &&
        !issue.pull_request,
      `The ${role} item must be a separate native issue with the exact Step 1 title, not a pull request.`,
    );
    check(
      human(issue.user) &&
        positive(issue.user.id) &&
        issue.user.id === learner.id &&
        same(issue.user.login, state.learner),
      `Create the ${role} issue yourself with the learner account that started this exercise.`,
    );
    check(
      Date.parse(issue.created_at) >= Date.parse(exercise.created_at),
      `Create the ${role} issue after this exercise was opened; an older issue cannot be registered.`,
    );
    check(
      !/bsp-(?:workshop|module)\b/i.test(issue.body ?? ''),
      `Remove reserved bot metadata from the ${role} work issue; use a clean, manually created issue.`,
    );
    check(
      issue.state === 'open' ||
        (module.lab === 3 &&
          role === 'implementation' &&
          issue.state === 'closed' &&
          issue.state_reason === 'completed'),
      module.lab === 2
        ? 'Both work issues must be open before you paste the Project URL.'
        : 'Verification must be open; implementation may be open or closed as completed.',
    );
    samples[role] = { number: issue.number, id: issue.id };
    evidence[role] = {
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
      state: issue.state,
      stateReason: issue.state_reason ?? null,
      pullRequest: false,
      reservedMetadata: false,
    };
  }
  validateModuleSamples(samples, exercise);
  return {
    native: 'issues.get',
    learnerId: learner.id,
    samples,
    issues: evidence,
  };
}

function feedbackFor(module, evidence) {
  const step = Number(evidence.lessonId.at(-1));
  if (step === 1)
    return `Project link saved. Implementation #${evidence.samples.implementation.number} and verification #${evidence.samples.verification.number} are registered. Continue with Step 2.`;
  if (module.lab === 3)
    return `Step ${step} recorded.${step < 4 ? ` Continue with Step ${step + 1}.` : ''}`;
  if (step === 2)
    return `Native dependency checked: #${evidence.verification} is blocked by #${evidence.implementation}.`;
  if (step === 3)
    return `PR #${evidence.prNumber} checked at head ${evidence.headSha}. Keep that head unchanged, then follow Step 4.`;
  return `PR #${evidence.prNumber} merged into main at ${evidence.mergeSha}. Implementation is completed; verification remains open.`;
}

export function moduleCompletion(module, state) {
  return (
    `### Lab ${module.lab} complete\n\nAll four steps are recorded.\n\n` +
    '**REPOSITORY-VERIFIED:** the two manually created issues, immutable IDs, titles, learner author and creation dates. ' +
    (module.lab === 2
      ? "Also checked: the native blocked_by relationship; the learner's same-repository, one-file PR and native closing reference; the same checked head merged into main, required merged checklist line, completed implementation and open verification.\n\n"
      : '\n\n') +
    '**SELF-CONFIRMED:** all Project work, including existence, access, fields, membership, views, charts, updates and exports. ' +
    'Mona never calls a Projects API or grades screenshots. No PAT, App or instructor account was used.\n\n' +
    `Bound Project: ${state.projectUrl}\n\nOnly this exercise is closed. Work issues are not created or edited by Mona. ` +
    'Keep unfinished verification open. The other standalone lab is optional; no additional repository or Project is created.'
  );
}

export function initialModuleState(binding) {
  return {
    ...binding,
    kind: 'state',
    samples: null,
    projectUrl: null,
    pullRequest: null,
    completed: [],
    evidence: {},
    lastProcessedHumanCommentId: 0,
    readyAfterCommentId: null,
    replies: [],
    outbox: [],
  };
}

function historicalState(state, count) {
  return {
    ...state,
    completed: state.completed.slice(0, count),
    samples: count === 0 ? null : state.samples,
    projectUrl: count === 0 ? null : state.projectUrl,
    pullRequest: count < 3 ? null : state.pullRequest,
  };
}

export function moduleMessageBody(module, binding, state, key, readme) {
  let text;
  if (key.startsWith('lesson:')) {
    const index = module.lessons.findIndex(({ id }) => key === `lesson:${id}`);
    moduleSafe(index >= 0 && index <= state.completed.length);
    text = renderModuleLesson(
      module,
      historicalState(state, index),
      module.lessons[index],
      readme,
    );
  } else if (key.startsWith('feedback:')) {
    const evidence = state.evidence[key.slice(9)];
    moduleSafe(evidence);
    text = feedbackFor(module, evidence);
  } else if (key === 'complete') {
    moduleSafe(state.completed.length === 4);
    text = moduleCompletion(module, state);
  } else {
    const reply = state.replies.find(
      (item) => key === `reply:${item.commentId}`,
    );
    moduleSafe(reply);
    text = reply.text;
  }
  const body = `${moduleMessageMarker(binding, key)}\n${text}`;
  moduleSafe(
    body.length <= 60_000,
    'Mona stopped: the rendered module message is too large.',
  );
  return body;
}

export function appendModuleOutbox(module, binding, state, key, readme) {
  moduleSafe(!state.outbox.some((entry) => entry.key === key));
  state.outbox.push({
    key,
    digest: moduleDigest(
      moduleMessageBody(module, binding, state, key, readme),
    ),
    commentId: null,
  });
}

export function recordModuleDecision(
  module,
  binding,
  state,
  comment,
  plan,
  details,
  readme,
) {
  moduleSafe(
    positive(comment.id) &&
      comment.id > state.lastProcessedHumanCommentId &&
      positive(state.readyAfterCommentId) &&
      comment.id > state.readyAfterCommentId,
  );
  const next = structuredClone(state);
  next.lastProcessedHumanCommentId = comment.id;
  if (plan.kind === 'reply') {
    next.replies.push({
      commentId: comment.id,
      command: comment.body,
      createdAt: comment.created_at,
      text: plan.text,
    });
    appendModuleOutbox(module, binding, next, `reply:${comment.id}`, readme);
    return next;
  }
  const lesson = module.lessons[state.completed.length];
  moduleSafe(
    lesson?.id === plan.lessonId &&
      ['bind', 'self', 'check'].includes(plan.kind),
  );
  const evidence = {
    ...structuredClone(details ?? {}),
    lessonId: lesson.id,
    mode: lesson.mode,
    command: comment.body,
    commentId: comment.id,
    authorId: comment.user.id,
    createdAt: comment.created_at,
  };
  if (plan.kind === 'bind') {
    moduleSafe(
      state.samples === null &&
        state.projectUrl === null &&
        details?.native === 'issues.get',
    );
    next.samples = structuredClone(details.samples);
    next.projectUrl = plan.projectUrl;
    evidence.projectUrl = plan.projectUrl;
    evidence.projectUi = 'SELF-CONFIRMED';
  }
  if (plan.kind === 'self') evidence.projectUi = 'SELF-CONFIRMED';
  if (lesson.id === '2-3')
    next.pullRequest = {
      number: details.prNumber,
      id: details.prId,
      headSha: details.headSha,
    };
  next.evidence[lesson.id] = evidence;
  next.completed.push(lesson.id);
  appendModuleOutbox(module, binding, next, `feedback:${lesson.id}`, readme);
  appendModuleOutbox(
    module,
    binding,
    next,
    next.completed.length === 4
      ? 'complete'
      : `lesson:${module.lessons[next.completed.length].id}`,
    readme,
  );
  return next;
}

function validateNativeBinding(module, state, evidence, exercise) {
  moduleSafe(
    evidence.native === 'issues.get' &&
      evidence.learnerId === state.learnerId &&
      exactKeys(evidence.issues, ROLE_KEYS),
  );
  validateModuleSamples(evidence.samples, exercise);
  moduleSafe(
    JSON.stringify(evidence.samples) === JSON.stringify(state.samples),
  );
  for (const [index, role] of ROLE_KEYS.entries()) {
    const item = evidence.issues[role];
    moduleSafe(
      exactKeys(item, [
        'number',
        'id',
        'title',
        'repositoryUrl',
        'author',
        'createdAt',
        'state',
        'stateReason',
        'pullRequest',
        'reservedMetadata',
      ]) &&
        item.number === state.samples[role].number &&
        item.id === state.samples[role].id &&
        item.title === module.workItems[index].title &&
        same(
          item.repositoryUrl,
          `https://api.github.com/repos/${state.repository}`,
        ) &&
        exactKeys(item.author, ['login', 'type', 'id']) &&
        human(item.author) &&
        same(item.author.login, state.learner) &&
        item.author.id === state.learnerId &&
        timestamp(item.createdAt) &&
        Date.parse(item.createdAt) >= Date.parse(state.createdAt) &&
        (item.state === 'open' ||
          (module.lab === 3 &&
            role === 'implementation' &&
            item.state === 'closed' &&
            item.stateReason === 'completed')) &&
        [null, 'completed', 'not_planned', 'reopened'].includes(
          item.stateReason,
        ) &&
        item.pullRequest === false &&
        item.reservedMetadata === false,
      'Mona stopped: saved native work-issue evidence conflicts with its bound role.',
    );
  }
}

export function validateModuleState(
  module,
  binding,
  state,
  exercise,
  readme,
  comments,
) {
  const fields = [
    'kind',
    'samples',
    'projectUrl',
    'pullRequest',
    'completed',
    'evidence',
    'lastProcessedHumanCommentId',
    'readyAfterCommentId',
    'replies',
    'outbox',
  ];
  moduleSafe(
    exactKeys(state, [...Object.keys(binding), ...fields]) &&
      state.kind === 'state' &&
      Object.entries(binding).every(([key, value]) => state[key] === value),
  );
  moduleSafe(
    Array.isArray(state.completed) &&
      state.completed.length <= 4 &&
      state.completed.every((id, index) => id === module.lessons[index].id) &&
      own(state.evidence) &&
      Object.keys(state.evidence).length === state.completed.length &&
      state.completed.every((id) => Object.hasOwn(state.evidence, id)),
  );
  moduleSafe(
    Number.isSafeInteger(state.lastProcessedHumanCommentId) &&
      state.lastProcessedHumanCommentId >= 0 &&
      (state.readyAfterCommentId === null ||
        positive(state.readyAfterCommentId)) &&
      (state.lastProcessedHumanCommentId === 0 ||
        state.lastProcessedHumanCommentId > state.readyAfterCommentId),
  );
  if (state.completed.length === 0)
    moduleSafe(
      state.samples === null &&
        state.projectUrl === null &&
        state.pullRequest === null,
    );
  else {
    validateModuleSamples(state.samples, exercise);
    moduleSafe(
      positive(state.readyAfterCommentId) &&
        validateProjectUrl(state.projectUrl, state.owner, state.ownerType) ===
          state.projectUrl,
    );
  }
  moduleSafe(
    state.completed.includes('2-3')
      ? exactKeys(state.pullRequest, ['number', 'id', 'headSha']) &&
          positive(state.pullRequest.number) &&
          positive(state.pullRequest.id) &&
          SHA.test(state.pullRequest.headSha)
      : state.pullRequest === null,
  );
  const canonicalComment = (id, command, createdAt) => {
    const comment = comments?.find((item) => item.id === id);
    moduleSafe(
      comment &&
        human(comment.user) &&
        comment.user.id === binding.learnerId &&
        same(comment.user.login, binding.learner) &&
        comment.body === command &&
        comment.created_at === createdAt &&
        comment.updated_at === comment.created_at,
      'Mona stopped: saved progress has no matching new, unedited comment from the bound human learner.',
    );
  };
  let previous = state.readyAfterCommentId ?? 0;
  const actions = [];
  for (const [index, id] of state.completed.entries()) {
    const evidence = state.evidence[id];
    const details =
      index === 0
        ? [
            'native',
            'learnerId',
            'samples',
            'issues',
            'projectUrl',
            'projectUi',
          ]
        : module.lab === 3
          ? ['projectUi']
          : id === '2-2'
            ? ['native', 'implementation', 'verification']
            : [
                'prNumber',
                'headSha',
                'native',
                'prId',
                ...(id === '2-4' ? ['mergeSha', 'projectUi'] : []),
              ];
    moduleSafe(
      exactKeys(evidence, [
        'lessonId',
        'mode',
        'command',
        'commentId',
        'authorId',
        'createdAt',
        ...details,
      ]) &&
        evidence.lessonId === id &&
        evidence.mode === module.lessons[index].mode &&
        positive(evidence.commentId) &&
        evidence.commentId > previous &&
        evidence.commentId <= state.lastProcessedHumanCommentId &&
        evidence.authorId === binding.learnerId &&
        timestamp(evidence.createdAt) &&
        Date.parse(evidence.createdAt) >= Date.parse(binding.createdAt),
    );
    canonicalComment(evidence.commentId, evidence.command, evidence.createdAt);
    const plan = planModuleCommand(
      module,
      historicalState(state, index),
      evidence.command,
    );
    moduleSafe(
      ['bind', 'self', 'check'].includes(plan.kind) && plan.lessonId === id,
    );
    if (index === 0) {
      moduleSafe(
        evidence.projectUrl === state.projectUrl &&
          plan.projectUrl === state.projectUrl &&
          evidence.projectUi === 'SELF-CONFIRMED',
      );
      validateNativeBinding(module, state, evidence, exercise);
    } else if (module.lab === 3)
      moduleSafe(evidence.projectUi === 'SELF-CONFIRMED');
    else if (id === '2-2')
      moduleSafe(
        evidence.native === 'blocked_by' &&
          evidence.implementation === state.samples.implementation.number &&
          evidence.verification === state.samples.verification.number,
      );
    else {
      moduleSafe(
        evidence.prNumber === state.pullRequest.number &&
          evidence.prId === state.pullRequest.id &&
          plan.prNumber === state.pullRequest.number &&
          evidence.headSha === state.pullRequest.headSha,
      );
      moduleSafe(
        id === '2-3'
          ? evidence.native === 'closingIssuesReferences'
          : evidence.native === 'merged-and-closingIssuesReferences' &&
              SHA.test(evidence.mergeSha) &&
              evidence.projectUi === 'SELF-CONFIRMED',
      );
    }
    previous = evidence.commentId;
    actions.push({ commentId: evidence.commentId, lessonId: id });
  }
  moduleSafe(Array.isArray(state.replies));
  for (const reply of state.replies) {
    moduleSafe(
      exactKeys(reply, ['commentId', 'command', 'createdAt', 'text']) &&
        positive(reply.commentId) &&
        reply.commentId > state.readyAfterCommentId &&
        reply.commentId <= state.lastProcessedHumanCommentId &&
        timestamp(reply.createdAt) &&
        typeof reply.command === 'string' &&
        typeof reply.text === 'string' &&
        reply.text.length > 0 &&
        reply.text.length <= 4_000,
    );
    canonicalComment(reply.commentId, reply.command, reply.createdAt);
    actions.push({ commentId: reply.commentId });
  }
  moduleSafe(
    new Set(actions.map(({ commentId }) => commentId)).size ===
      actions.length &&
      (actions.length === 0
        ? state.lastProcessedHumanCommentId === 0
        : Math.max(...actions.map(({ commentId }) => commentId)) ===
          state.lastProcessedHumanCommentId),
  );
  actions.sort((a, b) => a.commentId - b.commentId);
  const keys = [`lesson:${module.lessons[0].id}`];
  for (const action of actions) {
    if (!action.lessonId) keys.push(`reply:${action.commentId}`);
    else {
      const index = module.lessons.findIndex(
        ({ id }) => id === action.lessonId,
      );
      keys.push(
        `feedback:${action.lessonId}`,
        index === 3 ? 'complete' : `lesson:${module.lessons[index + 1].id}`,
      );
    }
  }
  moduleSafe(
    Array.isArray(state.outbox) && state.outbox.length === keys.length,
  );
  let pending = false;
  let lastPublication = 0;
  for (const [index, entry] of state.outbox.entries()) {
    moduleSafe(
      exactKeys(entry, ['key', 'digest', 'commentId']) &&
        entry.key === keys[index] &&
        DIGEST.test(entry.digest) &&
        entry.digest ===
          moduleDigest(
            moduleMessageBody(module, binding, state, entry.key, readme),
          ) &&
        (entry.commentId === null || positive(entry.commentId)),
    );
    if (entry.commentId === null) pending = true;
    else {
      moduleSafe(!pending && entry.commentId > lastPublication);
      lastPublication = entry.commentId;
    }
  }
  moduleSafe(state.outbox[0].commentId === state.readyAfterCommentId);
  for (const id of state.completed)
    moduleSafe(
      positive(
        state.outbox.find((entry) => entry.key === `lesson:${id}`)?.commentId,
      ),
    );
  return state;
}
