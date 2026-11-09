import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderLesson,
  validateWorkshop,
} from '../.github/scripts/mona-core.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const ignored = new Set(['.git', 'node_modules', '.artifacts']);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function sourceFiles(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() && !ignored.has(entry.name)
      ? sourceFiles(path)
      : entry.isFile()
        ? [path]
        : [];
  });
}

export function validateLinks(markdown, filename, base = root) {
  const errors = [];
  for (const match of markdown.matchAll(
    /!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
  )) {
    const target = match[1];
    if (/^(?:https?:|mailto:|#|\{\{)/.test(target)) continue;
    let path;
    try {
      path = decodeURIComponent(target.split(/[?#]/)[0]);
    } catch {
      errors.push(`Bad encoded link: ${target}`);
      continue;
    }
    const destination = resolve(dirname(filename), path);
    const rel = relative(base, destination);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`))
      errors.push(`Link escapes repository: ${target}`);
    else if (!existsSync(destination) || !statSync(destination).isFile())
      errors.push(`Missing local link: ${target}`);
  }
  return errors;
}

export function verifyContent() {
  const errors = [];
  const check = (label, action) => {
    try {
      action();
    } catch (error) {
      errors.push(`${label}: ${error.message}`);
    }
  };
  let workshop;
  check('workshop contract', () => {
    workshop = JSON.parse(readFileSync(resolve(root, 'workshop.json'), 'utf8'));
    validateWorkshop(workshop);
  });
  if (!workshop) return errors;
  check('single-issue bootstrap contract', () => {
    assert.equal(workshop.schemaVersion, 2);
    assert.equal(workshop.bootstrapIssueLimit, 1);
    assert.ok(!Object.hasOwn(workshop, 'sampleIssues'));
    assert.equal(workshop.backlogItems.length, 4);
    assert.equal(
      workshop.lessons[1].command,
      '/backlog #FEATURE #IMPLEMENTATION #VERIFICATION #BUG',
    );
    assert.equal(workshop.lessons[1].mode, 'mixed');
    const engine = readFileSync(
      resolve(root, '.github/scripts/mona-engine.mjs'),
      'utf8',
    );
    assert.equal(
      (engine.match(/await api\.createIssue\(/g) ?? []).length,
      1,
      'Only the exercise creation site is allowed',
    );
    assert.ok(
      !engine.includes('sample.title') && !engine.includes('sampleBinding'),
      'No sample seed loop may return',
    );
  });
  check('lab durations and counts', () => {
    for (const [lab, minutes] of [
      [1, 40],
      [2, 35],
      [3, 35],
    ]) {
      const lessons = workshop.lessons.filter((lesson) => lesson.lab === lab);
      assert.equal(lessons.length, 4);
      assert.equal(
        lessons.reduce((sum, lesson) => sum + lesson.minutes, 0),
        minutes,
      );
    }
  });
  const fixture = {
    repository: 'sample-learner/my-projects-workshop',
    owner: 'sample-learner',
    learner: 'sample-learner',
    projectUrl: 'https://github.com/users/sample-learner/projects/1',
    exerciseNumber: 5,
    pullRequest: { number: 7 },
    samples: {
      feature: { number: 1, id: 101 },
      implementation: { number: 2, id: 102 },
      verification: { number: 3, id: 103 },
      bug: { number: 4, id: 104 },
    },
  };
  for (const lesson of workshop.lessons)
    check(`lesson ${lesson.id}`, () => {
      const filename = resolve(root, lesson.file);
      const markdown = readFileSync(filename, 'utf8').replaceAll('\r\n', '\n');
      for (const heading of ['## What and why', '## Do', '## '])
        assert.ok(
          markdown.includes(heading),
          `Missing guided-learning section ${heading}`,
        );
      assert.ok(markdown.includes(`**Time: ${lesson.minutes} minutes`));
      assert.ok(markdown.includes(lesson.image), 'Missing per-step screenshot');
      assert.ok(
        lesson.id === '1-0' ||
          markdown.includes('CONFIRMED') ||
          markdown.includes('VERIFIED') ||
          markdown.includes('MIXED EVIDENCE'),
      );
      const rendered = renderLesson(workshop, fixture, lesson, markdown);
      assert.ok(!rendered.includes('{{'), 'Unexpanded runtime placeholder');
      assert.ok(
        rendered.includes(`${workshop.publicAssetBase}${lesson.image}`),
        'Private-copy images need absolute public source URLs',
      );
      assert.ok(rendered.length < 60_000);
      assert.ok(
        !/```(?:powershell|bash|sh)\b|\bgit (?:clone|fetch|switch|add|commit|push|remote)\b|\blocal clone\b|\bVS Code\b/i.test(
          markdown,
        ),
        'Participant lessons must be browser-only',
      );
      assert.deepEqual(validateLinks(markdown, filename), []);
      if (lesson.id === '1-0' || lesson.id === '1-1') {
        assert.ok(
          !markdown.includes('{{ISSUE_'),
          'Bootstrap and backlog instructions must render before roles are bound',
        );
        const unbound = renderLesson(
          workshop,
          { ...fixture, samples: null },
          lesson,
          markdown,
        );
        assert.ok(!unbound.includes('{{'));
      }
    });
  check('screenshot provenance', () => {
    const imageRoot = resolve(root, 'assets/screenshots');
    const manifest = JSON.parse(
      readFileSync(resolve(imageRoot, 'screenshots.json'), 'utf8'),
    );
    assert.equal(manifest.license, 'CC-BY-4.0');
    assert.match(manifest.sourceCommit, /^[a-f\d]{40}$/);
    assert.equal(manifest.sheets.length, 12);
    for (const image of [
      ...Object.values(manifest.originals),
      ...manifest.sheets,
    ]) {
      const bytes = readFileSync(resolve(imageRoot, image.path));
      assert.ok(
        bytes.subarray(0, 8).equals(pngSignature),
        `Not an actual PNG: ${image.path}`,
      );
      assert.equal(
        sha(bytes),
        image.sha256,
        `Screenshot digest mismatch: ${image.path}`,
      );
      assert.equal(bytes.readUInt32BE(16), image.width);
      assert.equal(bytes.readUInt32BE(20), image.height);
      assert.ok(image.width > 0 && image.height > 0);
    }
    for (const sheet of manifest.sheets)
      assert.ok(sheet.panels.every((key) => manifest.originals[key]));
  });
  for (const file of sourceFiles()) {
    if (!/\.(?:md|mjs|json|ya?ml)$/.test(file)) continue;
    const label = relative(root, file);
    check(label, () => {
      const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
      assert.ok(
        !/\b(?:gh[pousr]_[A-Za-z\d]{25,}|github_pat_[A-Za-z\d_]{25,})\b/.test(
          text,
        ),
        'Credential-shaped value',
      );
      assert.ok(
        !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text),
        'Private key',
      );
      if (file.endsWith('.md')) assert.deepEqual(validateLinks(text, file), []);
      assert.ok(!/[ \t]+$/m.test(text), 'Trailing whitespace');
      assert.ok(text.endsWith('\n'), 'Missing final newline');
    });
  }
  check('Mona workflow permissions', () => {
    const workflow = readFileSync(
      resolve(root, '.github/workflows/mona.yml'),
      'utf8',
    );
    assert.ok(
      workflow.includes('contents: read') &&
        workflow.includes('issues: write') &&
        workflow.includes('pull-requests: read'),
    );
    assert.ok(
      !workflow.includes('contents: write') &&
        !workflow.includes('pull_request_target') &&
        !workflow.includes('secrets.'),
    );
    assert.ok(
      workflow.includes('ref: main') &&
        workflow.includes('persist-credentials: false') &&
        workflow.includes('cancel-in-progress: false'),
    );
  });
  check('CI is unprivileged and pinned', () => {
    for (const file of ['mona.yml', 'verify.yml']) {
      const workflow = readFileSync(
        resolve(root, '.github/workflows', file),
        'utf8',
      );
      const uses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map(
        (match) => match[1],
      );
      assert.equal(uses.length, 2);
      uses.forEach((value) =>
        assert.match(value, /^actions\/(?:checkout|setup-node)@[a-f\d]{40}$/),
      );
    }
    const workflow = readFileSync(
      resolve(root, '.github/workflows/verify.yml'),
      'utf8',
    );
    assert.ok(
      !/issues:\s*write|pull-requests:\s*write|secrets\./.test(workflow),
    );
  });
  check('work file remains a portable exercise', () => {
    const text = readFileSync(resolve(root, workshop.workFile), 'utf8');
    assert.match(text, /^- \[[ x]\] Publish the service release checklist$/m);
    assert.match(text, /^- \[ \] Confirm verification work for Sprint 2$/m);
  });
  return errors;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = verifyContent();
  if (errors.length) {
    console.error(
      `Course verification failed:\n${errors.map((error) => `- ${error}`).join('\n')}`,
    );
    process.exitCode = 1;
  } else
    console.log(
      'Course verification passed: 12 lessons, 4 steps per lab, 40/35/35 minutes, real attributed PNGs, safe workflows and resolved local links.',
    );
}
