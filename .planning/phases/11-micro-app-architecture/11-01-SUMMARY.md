---
phase: 11-micro-app-architecture
plan: 01
subsystem: architecture
tags: [fresh, micro-app, plugin-pattern, mountApp, composition, module-federation]

# Dependency graph
requires:
  - phase: 11-micro-app-architecture
    provides: "11-RESEARCH.md — root cause analysis of mountApp failures and options comparison"
provides:
  - "11-DECISION.md — durable architectural decision for micro-app composition in Freak"
  - "Documented 5 root causes of mountApp failures with code locations and trigger conditions"
  - "Evaluation of 3 options: fix mountApp, plugin pattern, Module Federation"
  - "Decision accepted: programmatic plugin pattern is the supported composition model"
  - "mountApp scope clarification (not deprecated, limited valid use cases)"
  - "Reference implementations: workflowPlugin + authPlugin + platform/control-panel"
  - "Future work enumerated for follow-on phases"
affects:
  - "Any future phase adding Plugin<Config> type to @fresh/core"
  - "Any future phase enabling islands in plugins (BuildCache aggregation)"
  - "Any future phase adding ctx.state namespacing"
  - "Plugin authoring documentation / scaffolding phases"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Programmatic Plugin Pattern: pluginName(config)(app) — curried factory registering routes directly on host app"
    - "layoutWrapper callback: plugin renders body HTML; host provides shell-wrapping function"

key-files:
  created:
    - ".planning/phases/11-micro-app-architecture/11-DECISION.md"
  modified: []

key-decisions:
  - "Adopt the Programmatic Plugin Pattern as the supported composition model for Freak sub-apps"
  - "mountApp is not deprecated but is limited to static prefix, no islands, no appWrapper, no fsRoutes"
  - "Module Federation is not applicable (server-side problem vs. browser-side solution; requires Vite)"
  - "Fix mountApp deferred indefinitely — high effort, wrong layer for current real-world use case"

patterns-established:
  - "Plugin calling convention: pluginName(config)(app) — curried, config first, app second"
  - "layoutWrapper interface: (bodyHtml, { title, req }) => string | Response — content/presentation separation"

# Metrics
duration: 2min
completed: 2026-02-27
---

# Phase 11 Plan 01: Micro-App Architecture Decision Summary

**Architectural decision recorded: adopt programmatic plugin pattern (already in production as workflowPlugin + authPlugin) as Freak's supported sub-app composition model, with 5 mountApp root causes documented and Module Federation ruled inapplicable**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-02-27T15:56:56Z
- **Completed:** 2026-02-27T15:59:09Z
- **Tasks:** 1
- **Files modified:** 1 (created)

## Accomplishments

- Created `11-DECISION.md` with all 8 required sections covering root causes, options, decision, scope clarification, reference implementations, and future work
- Documented 5 specific root causes of `mountApp` failures with code locations (`app.ts`, `commands.ts`, `segments.ts`, `preact_hooks.ts`) and trigger conditions
- Evaluated 3 options with evidence-based rationale: Fix mountApp (HIGH complexity, wrong layer), Plugin Pattern (LOW, production-validated), Module Federation (PROHIBITIVE, wrong problem layer)
- Recorded accepted decision: formalize the programmatic plugin pattern already used by `workflowPlugin` and `authPlugin` in the platform project
- Clarified `mountApp` valid scope: static prefix, no islands, no `appWrapper`, no `fsRoutes` — not deprecated but explicitly limited

## Task Commits

1. **Task 1: Write 11-DECISION.md** - `5cc73977` (docs)

## Files Created/Modified

- `.planning/phases/11-micro-app-architecture/11-DECISION.md` — Architectural decision document synthesizing research into durable internal notes

## Decisions Made

- Programmatic plugin pattern (curried factory `pluginName(config)(app)`) is the accepted composition model — production-validated, low effort to formalize, covers dynamic mount paths that mountApp cannot support
- `mountApp` remains available for simple static-prefix composition without islands/appWrapper/fsRoutes; its failure modes are documented as known limitations, not fixed in this phase
- Module Federation ruled inapplicable: it is a browser-side mechanism; Freak's problem is server-side route registration and BuildCache aggregation; MF would require switching from esbuild to Vite with separate deployments per sub-app

## Deviations from Plan

None — plan executed exactly as written. The document was created in a single pass following the 8-section structure specified in the task. No code was modified.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Phase 11 is complete. The architectural decision is recorded and accepted.

**What's ready:**
- The programmatic plugin pattern is formalized in `11-DECISION.md` with reference implementations and calling conventions
- Future phases can reference this decision when adding `Plugin<Config>` type, islands support, or ctx.state namespacing
- The decision document serves as the authoritative source for plugin authors

**Blockers:** None.

---
*Phase: 11-micro-app-architecture*
*Completed: 2026-02-27*
