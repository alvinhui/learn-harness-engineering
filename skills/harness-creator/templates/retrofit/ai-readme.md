# .ai — Agent Knowledge Base

Long-term context for coding agents. Separate from engineering output (src,
docs, tests). Structure:

| Path | Purpose |
|------|---------|
| `steering/` | Long-term architectural constraints (architecture, implementation notes, deployment) |
| `context/` | Project origin and the priority hierarchy for resolving conflicts |
| `adr/` | Architecture Decision Records — why key choices were made |
| `state/` | Cross-session agent state (feature list, progress log, session handoff) |
| `history/` | Preserved raw sessions/transcripts — historical evidence only, NOT authoritative |

## Priority Hierarchy

When sources conflict, trust them in this order (highest first):

1. Current source code
2. Reviewed specs (`specs/`)
3. Reviewed ADRs (`.ai/adr/`)
4. Steering docs (`.ai/steering/`)
5. Extracted summaries (`.ai/context/`)
6. Raw history (`.ai/history/`)
