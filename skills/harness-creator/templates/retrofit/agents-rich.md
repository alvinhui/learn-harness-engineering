# {{AGENT_FILE_NAME}}

{{PROJECT_PURPOSE}}

> This file is the routing entrypoint for coding agents. Keep it short: startup
> path, hard rules, and where to find deeper context. Project facts live in
> `.ai/steering/`, not here.

## Startup Workflow

Before writing any code, in order:

1. **Read this file** to confirm working boundaries and verification requirements.
2. **Read steering docs**: `.ai/steering/architecture.md` and `.ai/steering/implementation-notes.md`.
3. **Read state**: `.ai/state/feature-list.json`, `.ai/state/progress.md`, and `.ai/state/session-handoff.md`.
4. **Read relevant ADRs** under `.ai/adr/`.
5. **Skim** `README.md` and relevant pages under `docs/`.
6. **Run** `{{PRIMARY_VERIFICATION_COMMAND}}` to confirm a clean baseline.

## Project Map

{{PROJECT_MAP}}

## Working Rules

- One feature at a time. Pick a single entry from `.ai/state/feature-list.json` and finish it before starting another.
- Stay in scope. Do not refactor, rename, or "clean up" code unrelated to the active feature.
{{WORKING_RULES}}

## Change Requirements

When you change the items below, you MUST keep the listed artifacts in sync:

{{CHANGE_REQUIREMENTS}}

## Verification

```bash
{{VERIFICATION_BLOCK}}
```

Required checks before claiming any work done:

{{VERIFICATION_COMMANDS}}

## Test Expectations

{{TEST_EXPECTATIONS}}

## Definition of Done

A task is done only when ALL of these hold:

1. The change implements exactly the active feature — nothing more.
2. Verification (`{{PRIMARY_VERIFICATION_COMMAND}}`) passes, and the evidence is recorded.
3. `.ai/state/feature-list.json` status is updated.
4. `.ai/state/progress.md` records what changed and the verification result.
5. Public API / documented behavior stays backward compatible unless a version strategy is stated.

## End of Session

Before ending a session:

1. Summarize what was accomplished.
2. Update `.ai/state/progress.md` with high-signal records only.
3. Update `.ai/state/session-handoff.md` so the next agent can resume cleanly.
4. Expose any failures or risks honestly — do not hide them.
5. Only commit when the user explicitly asks.
