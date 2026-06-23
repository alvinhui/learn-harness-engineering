#!/usr/bin/env node
import path from 'node:path';
import { analyzeRepo, parseArgs, writeText } from './lib/harness-utils.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node scripts/analyze-repo.mjs [--target DIR] [--out FILE] [--package-manager npm|pnpm|yarn|bun]

Scans an existing repository and prints a structured JSON analysis report:
  stack, package manager, verification commands, source structure,
  documentation excerpts, existing harness fragments, CI/CD, git history.

The report is the input the agent reads to generate project-specific harness
content. Pass --out to also write it to a file.`);
  process.exit(0);
}

const target = path.resolve(args.target || args._[0] || process.cwd());
const report = await analyzeRepo(target, { packageManager: args.packageManager });

const json = JSON.stringify(report, null, 2);
if (args.out) {
  const outPath = path.resolve(args.out);
  await writeText(outPath, json);
  console.error(`Analysis written to ${outPath}`);
}
console.log(json);
