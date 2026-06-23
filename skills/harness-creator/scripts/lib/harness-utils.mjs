import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TEMPLATE_DIR = path.join(SKILL_ROOT, 'templates');
export const RETROFIT_TEMPLATE_DIR = path.join(TEMPLATE_DIR, 'retrofit');
export const SUBSYSTEMS = ['instructions', 'state', 'verification', 'scope', 'lifecycle'];

export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
      args[key] = argv[i + 1];
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readText(filePath) {
  return readFile(filePath, 'utf8');
}

export async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

export async function writeText(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

export async function copyTemplate(templateName, targetPath, replacements = {}, { force = false } = {}) {
  if (!force && await exists(targetPath)) {
    return { path: targetPath, status: 'skipped', reason: 'exists' };
  }

  let contents = await readText(path.join(TEMPLATE_DIR, templateName));
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.split(`{{${key}}}`).join(value);
  }
  await writeText(targetPath, contents);
  if (templateName.endsWith('.sh')) {
    await chmod(targetPath, 0o755);
  }
  return { path: targetPath, status: 'written' };
}

export function detectPackageManager(root, explicit) {
  if (explicit) return explicit;
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return 'bun';
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export async function detectProject(root) {
  const files = await listFiles(root, { maxFiles: 800 });
  const has = (name) => files.some((file) => file === name || file.endsWith(`/${name}`));
  const hasPrefix = (prefix) => files.some((file) => file.startsWith(prefix));
  const packageJsonPath = path.join(root, 'package.json');
  const packageJson = await exists(packageJsonPath).then((ok) => ok ? readJson(packageJsonPath) : null);

  let stack = 'generic';
  if (packageJson) {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    if (deps.react || hasPrefix('src/renderer')) stack = 'typescript-react';
    else if (deps.typescript || has('tsconfig.json')) stack = 'typescript';
    else stack = 'node';
  } else if (has('pyproject.toml') || has('requirements.txt')) {
    stack = 'python';
  } else if (has('go.mod')) {
    stack = 'go';
  } else if (has('Cargo.toml')) {
    stack = 'rust';
  } else if (has('pom.xml')) {
    stack = 'java-maven';
  } else if (has('build.gradle') || has('build.gradle.kts')) {
    stack = 'java-gradle';
  } else if (files.some((file) => file.endsWith('.csproj') || file.endsWith('.sln'))) {
    stack = 'dotnet';
  }

  return {
    root,
    stack,
    packageJson,
    files,
    packageManager: detectPackageManager(root)
  };
}

export async function listFiles(root, { maxFiles = 1000 } = {}) {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);
  const results = [];

  async function walk(current, relative) {
    if (results.length >= maxFiles) return;
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) return;
      if (ignored.has(entry.name)) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  }

  await walk(root, '');
  return results.sort();
}

// --- Retrofit analysis -----------------------------------------------------
// These helpers only COLLECT signals. The agent running the skill turns them
// into project-specific harness content; scripts never call an LLM.

async function git(root, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function analyzeGitHistory(root, { recentCount = 30, hotCount = 15 } = {}) {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inside !== 'true') {
    return { available: false };
  }

  const firstCommit = await git(root, ['log', '--reverse', '--format=%ad', '--date=short', '-1']);
  const totalCommits = await git(root, ['rev-list', '--count', 'HEAD']);
  const recentRaw = await git(root, ['log', `-${recentCount}`, '--format=%ad | %s', '--date=short']);
  const contributorsRaw = await git(root, ['shortlog', '-sn', '--all', 'HEAD']);
  // File churn: count how often each path appears across recent history.
  const churnRaw = await git(root, ['log', '--name-only', '--format=', '-200']);

  const recentCommits = recentRaw ? recentRaw.split('\n').filter(Boolean) : [];
  const contributors = contributorsRaw
    ? contributorsRaw.split('\n').map((line) => line.trim().replace(/^\d+\s+/, '')).filter(Boolean).slice(0, 10)
    : [];

  let hotFiles = [];
  if (churnRaw) {
    const counts = new Map();
    for (const file of churnRaw.split('\n').map((line) => line.trim()).filter(Boolean)) {
      counts.set(file, (counts.get(file) || 0) + 1);
    }
    hotFiles = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, hotCount)
      .map(([file, changes]) => ({ file, changes }));
  }

  return {
    available: true,
    firstCommit: firstCommit || null,
    totalCommits: totalCommits ? Number(totalCommits) : null,
    recentCommits,
    contributors,
    hotFiles
  };
}

export async function findExistingHarness(root) {
  const aiDir = path.join(root, '.ai');
  const ai = await exists(aiDir)
    ? {
        steering: await listDirNames(path.join(aiDir, 'steering')),
        context: await listDirNames(path.join(aiDir, 'context')),
        adr: await listDirNames(path.join(aiDir, 'adr')),
        state: await listDirNames(path.join(aiDir, 'state')),
        history: await exists(path.join(aiDir, 'history'))
      }
    : null;

  return {
    agentsFile: await firstExisting(root, ['AGENTS.md', 'CLAUDE.md']),
    aiDir: ai,
    cursorRules: await exists(path.join(root, '.cursor', 'rules')) ? '.cursor/rules' : null,
    claudeSettings: await firstExisting(root, ['.claude/settings.json', '.claude/settings.local.json']),
    initScript: await exists(path.join(root, 'init.sh')) ? 'init.sh' : null,
    featureList: await firstExisting(root, ['.ai/state/feature-list.json']),
    progress: await firstExisting(root, ['.ai/state/progress.md']),
    specsDir: await exists(path.join(root, 'specs')) ? 'specs' : null
  };
}

async function listDirNames(dir) {
  if (!await exists(dir)) return null;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.map((entry) => entry.name).sort();
  } catch {
    return null;
  }
}

async function firstExisting(root, candidates) {
  for (const candidate of candidates) {
    if (await exists(path.join(root, candidate))) return candidate;
  }
  return null;
}

export async function extractDocumentation(root, files, { maxBytes = 16000 } = {}) {
  const docs = { readme: null, docFiles: [] };
  const readmePath = files.find((file) => /^readme(\.md|\.markdown)?$/i.test(file));
  if (readmePath) {
    docs.readme = { path: readmePath, content: await readClamped(path.join(root, readmePath), maxBytes) };
  }
  const docCandidates = files.filter((file) =>
    /^(docs?|documentation)\//i.test(file) && /\.(md|markdown|mdx)$/i.test(file)
    || /^(architecture|contributing|design)\b.*\.(md|markdown)$/i.test(file)
  ).slice(0, 12);
  for (const file of docCandidates) {
    docs.docFiles.push({ path: file, content: await readClamped(path.join(root, file), maxBytes) });
  }
  return docs;
}

async function readClamped(filePath, maxBytes) {
  try {
    const content = await readText(filePath);
    return content.length > maxBytes ? `${content.slice(0, maxBytes)}\n…[truncated]` : content;
  } catch {
    return null;
  }
}

export function analyzeSourceStructure(files, packageJson) {
  const codeExt = /\.([cm]?[jt]sx?|py|go|rs|java|cs)$/i;
  const isTest = (file) =>
    (/(^|\/)(__tests__|tests?|spec|e2e)\//i.test(file) && codeExt.test(file))
    || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file)
    || /_test\.(py|go)$/i.test(file);
  const isSource = (file) => /^(src|lib|app|packages|internal|pkg|cmd)\//i.test(file) && codeExt.test(file);
  const isConfig = (file) => /\.(json|ya?ml|toml|config\.[cm]?[jt]s)$/i.test(file) || /^(tsconfig|vite|vitest|rollup|rslib|rspress|webpack|babel|jest|playwright)\b/i.test(file);

  const tests = files.filter(isTest);
  const source = files.filter((file) => isSource(file) && !isTest(file));
  const config = files.filter((file) => isConfig(file) && !isTest(file));

  const entryPoints = [];
  for (const key of ['main', 'module', 'types']) {
    const value = packageJson?.[key];
    if (typeof value === 'string') entryPoints.push(value.replace(/^\.\//, ''));
  }
  if (packageJson?.exports) entryPoints.push('package.json#exports');
  for (const guess of ['src/index.ts', 'src/index.js', 'src/main.ts', 'index.ts', 'main.go', 'src/main.py']) {
    if (files.includes(guess)) entryPoints.push(guess);
  }

  return {
    entryPoints: dedupe(entryPoints),
    source: source.slice(0, 60),
    tests: tests.slice(0, 40),
    config: config.slice(0, 30),
    scripts: packageJson?.scripts ?? {}
  };
}

export function detectCICD(files) {
  if (files.some((file) => file.startsWith('.github/workflows/'))) {
    return { detected: 'github-actions', configPaths: files.filter((file) => file.startsWith('.github/workflows/')).slice(0, 5) };
  }
  if (files.includes('.gitlab-ci.yml')) {
    return { detected: 'gitlab-ci', configPaths: ['.gitlab-ci.yml'] };
  }
  if (files.includes('Jenkinsfile')) {
    return { detected: 'jenkins', configPaths: ['Jenkinsfile'] };
  }
  if (files.some((file) => file.startsWith('.circleci/'))) {
    return { detected: 'circleci', configPaths: ['.circleci/config.yml'] };
  }
  return { detected: 'none', configPaths: [] };
}

export async function analyzeRepo(root, options = {}) {
  const project = await detectProject(root);
  project.packageManager = detectPackageManager(root, options.packageManager);
  const [gitSummary, existingHarness, documentation] = await Promise.all([
    analyzeGitHistory(root),
    findExistingHarness(root),
    extractDocumentation(root, project.files)
  ]);

  return {
    root,
    stack: project.stack,
    packageManager: project.packageManager,
    packageJson: project.packageJson
      ? { name: project.packageJson.name, version: project.packageJson.version, scripts: project.packageJson.scripts ?? {} }
      : null,
    verificationCommands: verificationCommands(project, options.packageManager),
    sourceStructure: analyzeSourceStructure(project.files, project.packageJson),
    documentation,
    existingHarness,
    cicd: detectCICD(project.files),
    gitSummary,
    fileCount: project.files.length
  };
}

export function verificationCommands(project, explicitPackageManager) {
  const pm = explicitPackageManager || project.packageManager || 'npm';
  const scripts = project.packageJson?.scripts ?? {};
  const run = (script) => {
    if (pm === 'npm') return `npm run ${script}`;
    if (pm === 'yarn') return `yarn ${script}`;
    return `${pm} run ${script}`;
  };

  if (project.stack === 'python') {
    // python3 is the portable name (many systems no longer ship a bare `python`).
    // pytest exits 5 when it collects zero tests — harmless here, so don't let `set -e`
    // treat "no tests yet" as a failure. compileall's -x skips virtualenvs and build
    // artifacts so a syntax check doesn't choke on dependencies it shouldn't compile.
    const py = 'python3';
    return [
      `${py} -m pytest || [ $? -eq 5 ]`,
      `${py} -m compileall -q -x '(^|/)(\\.?venv|env|node_modules|build|dist|__pycache__)(/|$)' .`
    ];
  }

  if (project.stack === 'go') return ['go test ./...'];
  if (project.stack === 'rust') return ['cargo test'];
  if (project.stack === 'java-maven') return ['mvn test'];
  if (project.stack === 'java-gradle') return ['./gradlew test'];
  if (project.stack === 'dotnet') return ['dotnet test'];

  if (!project.packageJson) {
    return [
      'echo "No package manifest detected; replace this line with your project verification command."'
    ];
  }

  const install = pm === 'npm'
    ? 'npm install'
    : pm === 'yarn'
      ? 'yarn install'
      : `${pm} install`;
  const candidates = [
    scripts.check ? run('check') : null,
    scripts.typecheck ? run('typecheck') : null,
    scripts['type-check'] ? run('type-check') : null,
    scripts.lint ? run('lint') : null,
    scripts.test ? (pm === 'npm' ? 'npm test' : `${pm} test`) : null,
    scripts.build ? run('build') : null
  ].filter(Boolean);

  return [install, ...dedupe(candidates)];
}

export function initScriptFromCommands(commands) {
  const body = commands.map((command) => `echo "=== ${escapeForEcho(command)} ==="\n${command}`).join('\n\n');
  return `#!/bin/bash
set -e

echo "=== Harness Initialization ==="

${body}

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read .ai/state/feature-list.json to see current feature state"
echo "2. Pick ONE unfinished feature to work on"
echo "3. Implement only that feature"
echo "4. Re-run verification before claiming done"
`;
}

function escapeForEcho(value) {
  return value.replaceAll('"', '\\"');
}

export function dedupe(values) {
  return [...new Set(values)];
}

export function scoreHarness(files) {
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const allText = files.map((file) => `${file.path}\n${file.content}`).join('\n\n');
  const agents = byPath.get('AGENTS.md') || byPath.get('CLAUDE.md') || '';
  const featureList = byPath.get('.ai/state/feature-list.json') || '';
  const progress = byPath.get('.ai/state/progress.md') || '';
  const init = byPath.get('init.sh') || '';
  const handoff = byPath.get('.ai/state/session-handoff.md') || '';

  const checks = {
    instructions: [
      hasFile(byPath, ['AGENTS.md', 'CLAUDE.md'], 'Agent instruction file exists'),
      structuredHas(agents, ['Startup Workflow', 'Before writing code'], 'Startup workflow documented'),
      structuredHas(agents, ['Definition of Done', 'done only when'], 'Definition of done documented'),
      structuredHas(agents, ['Verification Commands', './init.sh', 'test', 'verify'], 'Verification commands discoverable'),
      structuredHas(agents, ['.ai/state', 'feature-list.json'], 'State artifacts routed from instructions')
    ],
    state: [
      hasFile(byPath, ['.ai/state/feature-list.json'], 'Feature tracker exists'),
      jsonFeatureList(featureList, 'Feature tracker is valid and has feature fields'),
      hasAnyText(progress, 'Progress log exists'),
      structuredHas(progress, ['Current State', 'What', 'Next'], 'Progress log supports restart'),
      structuredHas(handoff || progress, ['Blockers', 'Files', 'Next Session', '风险', '下一步', '交接'], 'Handoff captures blockers/files/next step')
    ],
    verification: [
      hasFile(byPath, ['init.sh'], 'Verification entrypoint exists'),
      textHas(init, ['set -e'], 'Verification fails fast'),
      textHas(init + agents, ['test', 'pytest', 'vitest', 'cargo test', 'go test', 'dotnet test'], 'Test command documented'),
      textHas(init + agents, ['build', 'type', 'lint', 'compile'], 'Static/build check documented'),
      textHas(allText, ['Evidence', 'Verification Evidence', 'command and output', '验证结果'], 'Verification evidence is recorded')
    ],
    scope: [
      structuredHas(agents, ['One feature at a time', 'one-feature-at-a-time', '一个明确任务', '只处理一个'], 'One-feature-at-a-time rule exists'),
      textHas(featureList, ['dependencies'], 'Feature dependencies are tracked'),
      textHas(agents + featureList, ['status'], 'Feature status is explicit'),
      structuredHas(agents, ['Stay in scope', 'scope', 'Working Rules', '边界', '工作边界'], 'Scope boundary documented'),
      structuredHas(agents, ['Definition of Done'], 'Completion gate limits scope closure')
    ],
    lifecycle: [
      hasFile(byPath, ['init.sh'], 'Startup script exists'),
      structuredHas(agents, ['End of Session', 'Before ending', '收尾', '结束前'], 'End-of-session procedure exists'),
      hasFile(byPath, ['.ai/state/session-handoff.md'], 'Session handoff template exists'),
      structuredHas(progress + '\n' + handoff, ['Last Updated', 'Current Objective', 'Recommended Next Step', '下一步'], 'Session restart markers exist'),
      textHas(agents + init, ['restartable', 'clean', 'Next steps', '接手'], 'Clean restart path documented')
    ]
  };

  const subsystems = Object.fromEntries(Object.entries(checks).map(([name, subsystemChecks]) => {
    const passed = subsystemChecks.filter((check) => check.pass).length;
    const score = Math.max(1, Math.round((passed / subsystemChecks.length) * 5));
    return [name, {
      score,
      passed,
      total: subsystemChecks.length,
      checks: subsystemChecks
    }];
  }));

  const total = Object.values(subsystems).reduce((sum, item) => sum + item.score, 0);
  const overall = Math.round((total / (SUBSYSTEMS.length * 5)) * 100);
  const ranked = Object.entries(subsystems).sort((a, b) => a[1].score - b[1].score);
  // A bottleneck only means something when a subsystem is weaker than the rest.
  // When every subsystem already maxes out, reporting one is misleading.
  const bottleneck = ranked[0][1].score === 5 ? null : ranked[0][0];
  return { overall, bottleneck, subsystems };
}

function hasFile(byPath, names, message) {
  return { pass: names.some((name) => byPath.has(name)), message };
}

function hasAnyText(text, message) {
  return { pass: Boolean(text && text.trim()), message };
}

function textHas(text, needles, message) {
  const lower = text.toLowerCase();
  return { pass: needles.some((needle) => lower.includes(needle.toLowerCase())), message };
}

// A real instruction doc carries its load-bearing phrases in structure — headings,
// list items, tables, fenced code, or bold lead-ins — not in free prose. Scoring only
// the structured lines means a genuine harness still passes, while a file that just
// sprinkles the right keywords across a paragraph to game the score does not.
function structuredText(markdown) {
  const kept = [];
  let inFence = false;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) { kept.push(line); continue; }
    if (!line) continue;
    const isHeading = /^#{1,6}\s/.test(line);
    const isList = /^([-*+]|\d+\.)\s/.test(line);
    const isTable = line.startsWith('|');
    const isBoldLead = /^\*\*[^*]+\*\*/.test(line);
    if (isHeading || isList || isTable || isBoldLead) kept.push(line);
  }
  return kept.join('\n');
}

function structuredHas(markdown, needles, message) {
  return textHas(structuredText(markdown), needles, message);
}

function jsonFeatureList(text, message) {
  try {
    const parsed = JSON.parse(text);
    const valid = Array.isArray(parsed.features) && parsed.features.every((feature) =>
      typeof feature.id === 'string'
      && typeof feature.name === 'string'
      && typeof feature.description === 'string'
      && typeof feature.status === 'string'
    );
    return { pass: valid, message };
  } catch {
    return { pass: false, message };
  }
}

export async function loadHarnessFiles(root) {
  const candidates = [
    'AGENTS.md',
    'CLAUDE.md',
    'init.sh',
    '.ai/state/feature-list.json',
    '.ai/state/progress.md',
    '.ai/state/session-handoff.md'
  ];
  const files = [];
  for (const candidate of candidates) {
    const fullPath = path.join(root, candidate);
    if (await exists(fullPath)) {
      files.push({ path: candidate, content: await readText(fullPath) });
    }
  }
  return files;
}

export function formatScoreReport(result, root = '.') {
  const lines = [
    `Harness validation for ${root}`,
    `Overall: ${result.overall}/100`,
    `Bottleneck: ${result.bottleneck ?? 'none — all subsystems at full score'}`,
    ''
  ];

  for (const [name, subsystem] of Object.entries(result.subsystems)) {
    lines.push(`${name}: ${subsystem.score}/5 (${subsystem.passed}/${subsystem.total})`);
    for (const check of subsystem.checks) {
      lines.push(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.message}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function htmlReport(result, title = 'Harness Assessment') {
  const rows = Object.entries(result.subsystems).map(([name, subsystem]) => {
    const checks = subsystem.checks.map((check) =>
      `<li class="${check.pass ? 'pass' : 'fail'}">${check.pass ? 'PASS' : 'FAIL'} ${escapeHtml(check.message)}</li>`
    ).join('');
    return `<section>
      <h2>${escapeHtml(name)} <span>${subsystem.score}/5</span></h2>
      <ul>${checks}</ul>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #172026; background: #f7f8fa; }
    main { max-width: 960px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 8px; font-size: 32px; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 20px 0; }
    .metric { background: white; border: 1px solid #d9dee5; border-radius: 8px; padding: 16px 18px; min-width: 180px; }
    .metric strong { display: block; font-size: 28px; margin-top: 4px; }
    section { background: white; border: 1px solid #d9dee5; border-radius: 8px; margin: 14px 0; padding: 16px 18px; }
    h2 { margin: 0 0 10px; font-size: 20px; display: flex; justify-content: space-between; }
    ul { margin: 0; padding-left: 20px; }
    li { margin: 6px 0; }
    .pass { color: #126c43; }
    .fail { color: #a23020; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p>Five-subsystem harness validation report.</p>
      <div class="summary">
        <div class="metric">Overall<strong>${result.overall}/100</strong></div>
        <div class="metric">Bottleneck<strong>${escapeHtml(result.bottleneck ?? 'none')}</strong></div>
      </div>
    </header>
    ${rows}
  </main>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function copyFileSafe(source, target, { force = false } = {}) {
  if (!force && await exists(target)) {
    return { path: target, status: 'skipped', reason: 'exists' };
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  return { path: target, status: 'written' };
}

// --- Retrofit scaffolding --------------------------------------------------
// The agent writes a scaffold plan (JSON); this executes it deterministically.
// It NEVER overwrites a file unless the plan explicitly opts in, so re-running
// retrofit only fills missing layers.

export const RETROFIT_DIRECTORIES = [
  '.ai',
  '.ai/steering',
  '.ai/context',
  '.ai/adr',
  '.ai/history',
  '.ai/state'
];

export async function renderRetrofitTemplate(templateName, replacements = {}) {
  let contents = await readText(path.join(RETROFIT_TEMPLATE_DIR, templateName));
  for (const [key, value] of Object.entries(replacements)) {
    contents = contents.split(`{{${key}}}`).join(value ?? '');
  }
  return contents;
}

function normalizePlan(plan) {
  const directories = Array.isArray(plan.directories) && plan.directories.length
    ? plan.directories
    : RETROFIT_DIRECTORIES;
  const files = [];
  if (Array.isArray(plan.files)) {
    files.push(...plan.files);
  } else if (plan.files && typeof plan.files === 'object') {
    for (const [target, spec] of Object.entries(plan.files)) {
      files.push({ target, ...(typeof spec === 'object' ? spec : { action: spec }) });
    }
  }
  return { directories, files };
}

export async function executeScaffoldPlan(root, plan, { force = false } = {}) {
  const { directories, files } = normalizePlan(plan);
  const results = [];

  for (const dir of directories) {
    const full = path.join(root, dir);
    if (await exists(full)) {
      results.push({ path: dir, status: 'skipped', reason: 'exists', kind: 'dir' });
    } else {
      await mkdir(full, { recursive: true });
      results.push({ path: dir, status: 'created', kind: 'dir' });
    }
  }

  for (const file of files) {
    const target = file.target || file.path;
    if (!target) {
      results.push({ path: '(missing target)', status: 'error', reason: 'no target field' });
      continue;
    }
    const action = file.action || 'generate';
    const fullTarget = path.join(root, target);
    const overwrite = force || file.overwrite === true || action === 'overwrite';

    if (!overwrite && await exists(fullTarget)) {
      results.push({ path: target, status: 'skipped', reason: 'exists' });
      continue;
    }

    if (action === 'migrate') {
      const from = file.from && path.join(root, file.from);
      if (!from || !await exists(from)) {
        results.push({ path: target, status: 'skipped', reason: `migrate source missing: ${file.from}` });
        continue;
      }
      await writeText(fullTarget, await readText(from));
      results.push({ path: target, status: 'migrated', from: file.from });
      continue;
    }

    if (action === 'template') {
      const content = await renderRetrofitTemplate(file.template, file.replacements || {});
      await writeText(fullTarget, content);
      if (target.endsWith('.sh')) await chmod(fullTarget, 0o755);
      results.push({ path: target, status: 'written', source: `template:${file.template}` });
      continue;
    }

    // action 'generate' or 'overwrite': write provided content, or a stub the
    // agent is expected to fill in next.
    const content = typeof file.content === 'string'
      ? file.content
      : `<!-- TODO(agent): generate project-specific content for ${target} -->\n`;
    await writeText(fullTarget, content);
    if (target.endsWith('.sh')) await chmod(fullTarget, 0o755);
    results.push({ path: target, status: file.content ? 'written' : 'stubbed' });
  }

  return results;
}
