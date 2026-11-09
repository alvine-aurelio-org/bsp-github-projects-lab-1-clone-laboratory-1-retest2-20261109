import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets', 'screenshots');
const sourceCommit = '4a20c763a48bd4f5a34a84c002fd9858e9793f65';
const sourceBase = `https://raw.githubusercontent.com/github/docs/${sourceCommit}/assets/images/help/`;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

// Every panel is a genuine upstream screenshot, never a reconstructed interface.
const panels = {
  template: [
    'repository/use-this-template-button.png',
    'Use this template → create your PRIVATE copy',
  ],
  profile: [
    'profile/profile-button-avatar-menu-global-nav-update.png',
    'Your profile → Projects (create a private Project)',
  ],
  projects: [
    'projects-v2/tab-projects.png',
    'Projects tab → New project (next control is not pictured)',
  ],
  link: [
    'projects-v2/repo-tab.png',
    'Your repository → Projects → Link a project',
  ],
  add: [
    'projects-v2/add-item.png',
    'Project bottom row: Add item → paste YOUR issue URL',
  ],
  convert: [
    'projects-v2/item-context-menu-button-table.png',
    'Open the draft row menu → Convert to issue',
  ],
  field: [
    'projects-v2/new-field-button.png',
    'Rightmost column header + → New field',
  ],
  table: [
    'projects/priority-example.png',
    'A real table: edit fields here; use the exercise values',
  ],
  view: [
    'projects-v2/new-view.png',
    'New view → select the layout; save your changes',
  ],
  board: [
    'projects-v2/example-board.png',
    'Board columns show Status; move YOUR implementation card',
  ],
  iteration: [
    'projects-v2/add-iteration-options.png',
    'Iteration settings; creation and assignment are described in the text',
  ],
  issue: [
    'issues/create-a-branch.png',
    'Real issue sidebar orientation: use YOUR issue, not this example',
  ],
  pr: [
    'pull_requests/pull-request-compare-pull-request.png',
    'After your browser edit: Compare & pull request',
  ],
  edit: [
    'repository/edit-file-edit-button.png',
    'In your work branch: pencil → Edit this file → Commit changes',
  ],
  merge: [
    'pull_requests/merge-pull-request-options.png',
    'Inspect files/checks → Merge pull request → confirm',
  ],
  roadmap: [
    'projects-v2/roadmap-menu-dates.png',
    'Roadmap → Date fields → map Start date and Target date',
  ],
  insights: [
    'projects-v2/insights-button.png',
    'Project top-right graph icon → Insights',
  ],
  details: [
    'projects-v2/insights-button.png',
    'Project details: use the side-panel icon RIGHT of the highlighted graph',
  ],
  chart: [
    'issues/column-chart-example.png',
    'Example OUTPUT only; configure YOUR chart by Status',
  ],
};

const sheets = [
  [
    '1-0',
    'Create your isolated workspace',
    ['template', 'profile', 'projects', 'link'],
  ],
  ['1-1', 'Populate your backlog', ['add', 'convert']],
  ['1-2', 'Add planning information', ['field', 'table']],
  ['1-3', 'Save a delivery board', ['view', 'board']],
  ['2-1', 'Plan your sprint', ['field', 'iteration']],
  ['2-2', 'Show a native dependency', ['issue']],
  ['2-3', 'Create a linked pull request', ['issue', 'edit', 'pr']],
  ['2-4', 'Complete and carry over', ['merge', 'board']],
  ['3-1', 'Create a release roadmap', ['view', 'roadmap']],
  ['3-2', 'Inspect workload', ['view', 'table']],
  ['3-3', 'Read a progress chart', ['insights', 'chart']],
  ['3-4', 'Publish a delivery update', ['details', 'view']],
];

await mkdir(join(out, 'originals'), { recursive: true });
const originals = {};
for (const [key, [path, caption]] of Object.entries(panels)) {
  const filename = path.replaceAll('/', '--');
  const destination = join(out, 'originals', filename);
  let bytes;
  if (existsSync(destination)) bytes = await readFile(destination);
  else {
    const response = await fetch(sourceBase + path, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Screenshot source failed (${response.status}): ${path}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
      throw new Error(`Not a PNG: ${path}`);
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    throw new Error(`Invalid stored PNG: ${path}`);
  originals[key] = {
    path: `originals/${filename}`,
    sourcePath: path,
    sourceUrl: sourceBase + path,
    sha256: hash(bytes),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    caption,
    data: bytes.toString('base64'),
  };
}

const candidates = [
  process.env.SCREENSHOT_BROWSER_PATH,
  process.env['ProgramFiles(x86)'] &&
    join(
      process.env['ProgramFiles(x86)'],
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
  process.env.ProgramFiles &&
    join(
      process.env.ProgramFiles,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
].filter(Boolean);
const executablePath = candidates.find(existsSync);
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const manifest = {
  schemaVersion: 1,
  sourceCommit,
  license: 'CC-BY-4.0',
  originals: {},
  sheets: [],
};
for (const [key, value] of Object.entries(originals)) {
  const { data: _data, ...metadata } = value;
  manifest.originals[key] = metadata;
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  for (const [id, title, keys] of sheets) {
    const filename = `lab-${id[0]}-step-${id[2]}.png`;
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(title)}</title>
      <style>*{box-sizing:border-box}body{margin:0;background:#f6f8fa;color:#1f2328;font:17px/1.5 Arial,sans-serif}
      main{padding:30px;width:1440px}header{border-left:7px solid #0969da;padding:3px 20px;margin-bottom:24px}
      small{font-weight:700;color:#0969da;letter-spacing:1px}h1{font-size:30px;line-height:1.2;margin:6px 0 10px}
      p{margin:6px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}.grid:has(figure:only-child){grid-template-columns:1fr}
      figure{margin:0;background:white;border:1px solid #d0d7de;border-radius:12px;overflow:hidden}
      figcaption{font-size:17px;font-weight:700;background:#ddf4ff;padding:14px;min-height:78px}
      .badge{display:inline-block;background:#0969da;color:white;border-radius:50%;width:28px;line-height:28px;text-align:center;margin-right:8px}
      .picture{padding:16px;min-height:185px;display:flex;align-items:center;justify-content:center}
      img{max-width:100%;height:auto;max-height:410px;object-fit:contain;display:block}
      footer{margin-top:22px;border-top:1px solid #d0d7de;padding:16px 3px 0;font-size:15px;color:#59636e}
      .note{padding:14px 18px;background:#fff8c5;border-radius:8px;margin-top:20px;font-size:16px}</style>
      <main><header><small>GITHUB PROJECTS · LAB ${id[0]} · STEP ${id[2]}</small><h1>${escape(title)}</h1>
      <p>Real GitHub Docs screenshots · numbered navigation overview · work only in your own private copy</p></header>
      <div class="grid">${keys
        .map(
          (
            key,
            index,
          ) => `<figure><figcaption><span class="badge">${index + 1}</span>${escape(originals[key].caption)}</figcaption>
      <div class="picture"><img alt="${escape(originals[key].caption)}" src="data:image/png;base64,${originals[key].data}"></div></figure>`,
        )
        .join('')}</div>
      <p class="note">Follow the lesson text for exact values and expanded menus. An entry-point screenshot is not a picture of every subsequent dialog.</p>
      <footer>Source screenshots © GitHub, Inc. and contributors · GitHub Docs · CC BY 4.0 · resized, composed and captioned for this workshop.<br>
      Source commit ${sourceCommit.slice(0, 12)} · Full source URLs and changes: assets/screenshots/SOURCES.md · No endorsement implied.</footer></main></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    const image = await page
      .locator('main')
      .screenshot({ path: join(out, filename), animations: 'disabled' });
    manifest.sheets.push({
      id,
      path: filename,
      title,
      panels: keys,
      sha256: hash(image),
      width: image.readUInt32BE(16),
      height: image.readUInt32BE(20),
    });
  }
} finally {
  await browser.close();
}
await writeFile(
  join(out, 'screenshots.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

// Generated binary assets and their attribution metadata are packaged into the
// two companions. No source guide or runtime file is edited by this builder.
for (const lab of [2, 3]) {
  const destination = resolve(
    root,
    '..',
    `bsp-github-projects-lab-${lab}`,
    'assets',
    'screenshots',
  );
  await mkdir(join(destination, 'originals'), { recursive: true });
  const selected = manifest.sheets.filter((sheet) =>
    sheet.id.startsWith(`${lab}-`),
  );
  const keys = new Set(selected.flatMap((sheet) => sheet.panels));
  for (const sheet of selected)
    await copyFile(join(out, sheet.path), join(destination, sheet.path));
  for (const key of keys)
    await copyFile(
      join(out, originals[key].path),
      join(destination, originals[key].path),
    );
  await copyFile(join(out, 'SOURCES.md'), join(destination, 'SOURCES.md'));
  await writeFile(
    join(destination, 'screenshots.json'),
    `${JSON.stringify({ ...manifest, originals: Object.fromEntries([...keys].map((key) => [key, manifest.originals[key]])), sheets: selected }, null, 2)}\n`,
  );
  await copyFile(
    join(root, 'THIRD-PARTY-NOTICES.md'),
    resolve(destination, '..', '..', 'THIRD-PARTY-NOTICES.md'),
  );
}
console.log(
  `Built ${manifest.sheets.length} genuine-source navigation sheets; packaged 4 per companion. No authenticated learner UI or Project API was used.`,
);
