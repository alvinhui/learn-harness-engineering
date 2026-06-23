#!/usr/bin/env node
import path from 'node:path';
import {
  analyzeRepo,
  executeScaffoldPlan,
  parseArgs,
  readJson
} from './lib/harness-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/retrofit-harness.mjs --target DIR [--analyze-only] [--scaffold plan.json] [--force]

Retrofits an existing repository with a full .ai/ knowledge base and tool adapters.

Modes:
  --analyze-only      Print the structured analysis report and exit. The agent
                      reads it, then generates project-specific content.
  --scaffold FILE     Execute a scaffold plan (JSON the agent wrote): create
                      directories, migrate flat state files, and write files.
                      Existing files are preserved unless the plan opts in.

Without a mode flag, prints the analysis report AND the default scaffold plan
the agent should fill in. --force allows overwriting existing files.`);
  process.exit(0);
}

const target = path.resolve(args.target || args._[0] || process.cwd());
const force = Boolean(args.force);

if (args.scaffold) {
  const planPath = path.resolve(args.scaffold);
  const plan = await readJson(planPath);
  const results = await executeScaffoldPlan(target, plan, { force });
  console.log(`Scaffolded harness for ${target} (plan: ${planPath})`);
  for (const result of results) {
    const detail = result.reason ? ` (${result.reason})`
      : result.from ? ` (from ${result.from})`
      : result.source ? ` (${result.source})`
      : '';
    console.log(`${result.status.toUpperCase()} ${result.path}${detail}`);
  }
  const stubbed = results.filter((result) => result.status === 'stubbed').map((result) => result.path);
  if (stubbed.length) {
    console.log('');
    console.log('Agent: fill these stubbed files with project-specific content:');
    for (const file of stubbed) console.log(`  - ${file}`);
  }
  process.exit(0);
}

const report = await analyzeRepo(target, { packageManager: args.packageManager });

if (args.analyzeOnly) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

// Default: emit the analysis plus a suggested scaffold plan skeleton. The agent
// edits this plan (filling content / choosing adapters) before running --scaffold.
const existing = report.existingHarness;
const agentFile = existing.agentsFile || 'AGENTS.md';
const suggestedPlan = {
  directories: ['.ai', '.ai/steering', '.ai/context', '.ai/adr', '.ai/history', '.ai/state'],
  files: [
    { target: '.ai/README.md', action: 'template', template: 'ai-readme.md' },
    { target: agentFile, action: existing.agentsFile ? 'skip-or-overwrite' : 'generate', note: 'agent generates from analysis' },
    { target: '.ai/steering/architecture.md', action: 'generate', note: 'agent generates from sourceStructure + docs' },
    { target: '.ai/steering/implementation-notes.md', action: 'generate', note: 'agent generates from complex modules' },
    { target: '.ai/context/project-origin.md', action: 'generate', note: 'agent generates from README + git history' },
    { target: '.ai/state/feature-list.json', action: 'template', template: 'feature-list-real.json', note: 'seed feature tracker; replace placeholder features' },
    { target: '.ai/state/progress.md', action: 'generate', note: 'seed from current state' },
    { target: '.ai/state/session-handoff.md', action: 'generate', note: 'seed handoff template' }
  ],
  toolAdapters: ['cursor', 'claude']
};

console.log(JSON.stringify({ analysis: report, suggestedPlan }, null, 2));
