---
name: harness-creator
description: >-
  Build, audit, and improve harnesses that make AI coding agents reliable: AGENTS.md/CLAUDE.md
  instruction files, feature/state tracking, verification gates, scope boundaries, session
  handoff, memory persistence, context budgets, tool-permission safety, and multi-agent
  coordination. Also retrofits an existing/legacy repo into a full harness — generating an
  .ai/ knowledge base (steering, context, ADRs) and tool adapters (.cursor/rules, .claude)
  from the repo's code, docs, and git history. Use this whenever a coding agent is unreliable
  across sessions — forgets context, drifts out of scope, claims "done" before tests pass, or
  starts each session inconsistently — or when creating, retrofitting, or assessing AGENTS.md,
  CLAUDE.md, feature-list.json, init.sh, progress.md, or session-handoff files. Reach for it
  even if the user never says the word "harness."
license: MIT
---

# Harness Creator

Use this skill to make a repository easier for coding agents to start, stay in scope, verify work, and resume across sessions. Keep the harness small enough that agents actually follow it.

Not for model selection, prompt tuning in isolation, chat UI design, or general app architecture.

## Core Model

Every useful coding-agent harness has five subsystems:

| Subsystem | Minimal artifact | Purpose |
|---|---|---|
| Instructions | `AGENTS.md` or `CLAUDE.md` | Startup path, working rules, definition of done |
| State | `.ai/state/feature-list.json`, `.ai/state/progress.md` | Current feature, status, evidence, next step |
| Verification | `init.sh` or documented commands | Tests/checks the agent must run before claiming done |
| Scope | Feature dependencies and done criteria | Prevents overreach and half-finished work |
| Lifecycle | `.ai/state/session-handoff.md`, end-of-session routine | Makes the next session restartable |

## First Move

1. Inspect what already exists: instruction files, feature/state files, verification commands, docs, package manifests.
2. Ask only for missing context that cannot be inferred safely: target agent, desired file name, tolerance for structure, and whether overwriting is allowed.
3. Prefer a minimal harness first. Add memory, tool safety, multi-agent, or benchmark details only when the user's problem calls for them.

## Common Tasks

### Create a harness

Use the bundled script when working on a local repository:

```bash
node skills/harness-creator/scripts/create-harness.mjs --target /path/to/project
```

Options:

- `--agent-file CLAUDE.md` for Claude-oriented projects.
- `--package-manager npm|pnpm|yarn|bun` when detection is wrong.
- `--commands "cmd one,cmd two"` for custom verification.
- `--force` only after confirming overwrites are acceptable.

Then explain what was created and how the user should replace placeholder feature entries.

### Audit an existing harness

Run:

```bash
node skills/harness-creator/scripts/validate-harness.mjs --target /path/to/project
```

Report the five subsystem scores, the lowest-scoring area, and the first 2-3 changes that would improve reliability. Treat the lowest score as a candidate bottleneck; confirm with failures, logs, or task outcomes before claiming causality. State files are read from `.ai/state/` (`feature-list.json`, `progress.md`, `session-handoff.md`).

### Retrofit an existing repository

Use when a repo already has code, docs, and git history but lacks a real harness — a flat `AGENTS.md` (or nothing), no `.ai/` knowledge base, no tool adapters. The goal is a project-specific harness, not generic placeholders. Scripts collect signals and scaffold structure; you (the agent) generate the content.

1. **Analyze** the repository:

```bash
node skills/harness-creator/scripts/retrofit-harness.mjs --target /path/to/repo --analyze-only
```

This prints a JSON report: stack, verification commands, source structure, documentation excerpts, existing harness fragments, CI/CD, and git history (recent commits, hot files, contributors).

2. **Read** the report. Note what already exists (`existingHarness`) so you preserve it, and read the actual source/README/docs the report points to — do not invent project facts.

3. **Generate content** for each target, grounded in the analysis:
   - `AGENTS.md` — fill `templates/retrofit/agents-rich.md`: real Project Map (use `sourceStructure`), Working Rules (real constraints), Change Requirements, verification block.
   - `.ai/steering/architecture.md`, `implementation-notes.md`, optional `deployment.md` — from source structure, complex modules, and CI config.
   - `.ai/context/project-origin.md` — from README and the earliest git commits.
   - Tool adapters — `.cursor/rules/00-harness.mdc` and `.claude/settings.local.json` from the retrofit templates.

4. **Write a scaffold plan** (JSON) and run it. The plan lists directories and files; each file uses an action: `template` (render a retrofit template), `generate` (write your content), or `overwrite`. State files are created under `.ai/state/`. Existing files are preserved unless the plan opts in.

```bash
node skills/harness-creator/scripts/retrofit-harness.mjs --target /path/to/repo --scaffold plan.json
```

Running with no mode flag prints the analysis plus a suggested plan skeleton you can edit.

5. **Fill** any files the scaffold left stubbed, then **validate**:

```bash
node skills/harness-creator/scripts/validate-harness.mjs --target /path/to/repo
```

#### Retrofit principles

- Read before write — analyze existing docs and code before generating content.
- Preserve over replace — incorporate existing harness fragments; re-running only adds missing layers.
- Specific over generic — a Project Map with real paths beats template placeholders.
- Agent-driven content — scripts scaffold structure; you generate meaning from the analysis.

### Produce a report

Use when the user wants a shareable assessment:

```bash
node skills/harness-creator/scripts/render-assessment-html.mjs --target /path/to/project
node skills/harness-creator/scripts/run-benchmark.mjs --target /path/to/project --html /path/to/report.html
```

Be clear that this is a structural benchmark. The benchmark first runs a self-check — it scaffolds a throwaway harness and validates it, proving the bundled scripts work end-to-end — then scores the target and eval coverage. Real effectiveness still needs before/after agent sessions on representative tasks.

## When to Read References

Load only the reference needed for the user's problem:

- Memory across sessions: [Memory Persistence](references/memory-persistence-pattern.md)
- Reusable workflows as skills: [Skill Runtime](references/skill-runtime-pattern.md)
- Permissions, tools, concurrency: [Tool Registry & Safety](references/tool-registry-pattern.md)
- Context budget and progressive disclosure: [Context Engineering](references/context-engineering-pattern.md)
- Delegation and parallel agents: [Multi-Agent Coordination](references/multi-agent-pattern.md)
- Hooks, startup, long-running work: [Lifecycle & Bootstrap](references/lifecycle-bootstrap-pattern.md)
- Non-obvious failure modes: [Gotchas](references/gotchas.md)

## Design Rules

- Keep the root instruction file short: routing and invariants, not a full manual.
- Put project facts in project docs, not in the skill.
- Make verification commands explicit and runnable.
- Require evidence before marking a feature done.
- Use one active feature unless the harness has explicit multi-agent ownership boundaries.
- Prefer append/update state files over relying on chat history.
- Never hide destructive behavior in scripts; overwrites require explicit user approval.

## Deliverable Checklist

For a usable minimal harness, leave the target project with:

- [ ] `AGENTS.md` or `CLAUDE.md`
- [ ] `.ai/state/feature-list.json`
- [ ] `.ai/state/progress.md`
- [ ] `init.sh`
- [ ] Optional `.ai/state/session-handoff.md` for multi-session work
- [ ] Documented verification evidence or next action

If you cannot create files, provide exact file contents and commands instead.
