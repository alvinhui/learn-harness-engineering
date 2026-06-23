#!/usr/bin/env bash
set -euo pipefail

# Verification entrypoint. Modes:
#   quick  state + typecheck + test   (default)
#   build  quick + build
#   docs   state + docs build
#   full   everything
MODE="${1:-quick}"

echo "=== Harness Initialization (mode: $MODE) ==="

validate_state() {
  local state_file=".ai/state/feature-list.json"
  if [ ! -f "$state_file" ]; then
    echo "WARN: $state_file not found; skipping state validation."
    return 0
  fi
  echo "=== Validating $state_file ==="
  node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(".ai/state/feature-list.json", "utf8"));
    const allowed = new Set(["not-started", "planned", "in-progress", "active", "blocked", "done"]);
    if (!data || !Array.isArray(data.features)) throw new Error("feature-list.json must contain a features array");
    const ids = new Set();
    for (const f of data.features) {
      if (typeof f.id !== "string") throw new Error("each feature needs a string id");
      if (ids.has(f.id)) throw new Error("duplicate feature id: " + f.id);
      ids.add(f.id);
      if (typeof f.name !== "string") throw new Error("feature " + f.id + " needs a name");
      if (!allowed.has(f.status)) throw new Error("feature " + f.id + " has invalid status: " + f.status);
      if (!Array.isArray(f.dependencies)) throw new Error("feature " + f.id + " dependencies must be an array");
    }
    for (const f of data.features) for (const dep of f.dependencies) {
      if (!ids.has(dep)) throw new Error("feature " + f.id + " depends on missing feature: " + dep);
    }
    console.log("feature-list.json OK (" + data.features.length + " features)");
  '
}

run_typecheck() {
  echo "=== Typecheck ==="
{{TYPECHECK_CMD}}
}

run_test() {
  echo "=== Tests ==="
{{TEST_CMD}}
}

run_build() {
  echo "=== Build ==="
{{BUILD_CMD}}
}

run_docs() {
  echo "=== Docs build ==="
{{DOCS_CMD}}
}

case "$MODE" in
  quick)
    validate_state
    run_typecheck
    run_test
    ;;
  build)
    validate_state
    run_typecheck
    run_test
    run_build
    ;;
  docs)
    validate_state
    run_docs
    ;;
  full)
    validate_state
    run_typecheck
    run_test
    run_build
    run_docs
    ;;
  *)
    echo "Unknown mode: $MODE (use quick|build|docs|full)"
    exit 1
    ;;
esac

echo "=== Verification Complete ==="
echo ""
echo "Next steps:"
echo "1. Read .ai/state/feature-list.json for current feature state"
echo "2. Pick ONE unfinished feature"
echo "3. Implement only that feature"
echo "4. Re-run verification before claiming done"
