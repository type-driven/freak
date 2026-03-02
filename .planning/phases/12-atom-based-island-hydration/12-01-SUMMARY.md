---
phase: 12-atom-based-island-hydration
plan: 01
subsystem: hydration
tags: [effect, atoms, signals, preact, fresh, hydration, ssr, island]

# Dependency graph
requires:
  - phase: 04-atom-hydration
    provides: setAtom(), initAtomHydration(), __FRSH_ATOM_STATE pipeline — the implementation this decision document describes
  - phase: 12-research
    provides: Source-verified architecture findings, gap analysis, and decision rationale

provides:
  - 12-DECISION.md: Architectural decision document for atom-based island hydration
  - Documentation of dual-channel hydration (Channel 1 signal pipeline, Channel 2 atom pipeline)
  - Gap assessment table with Accept/Defer decisions for all 4 gaps
  - API surface assessment confirming no breaking changes to setAtom/initAtomHydration

affects:
  - future phases involving Partial render atom updates
  - future phases involving multi-app atom isolation (per-app hook wiring)
  - future phases involving hydration.ts deduplication

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dual-channel hydration: Channel 1 (stringify/reviver/signal props) orthogonal to Channel 2 (__FRSH_ATOM_STATE atoms)"
    - "Atom hydration layers on top of signal hydration — parallel channels, not replacement"
    - "setAtomHydrationHook() registers global hook in segments.ts; consumed by FreshRuntimeScript"
    - "Per-app hook (setAtomHydrationHookForApp) is deferred infrastructure — not yet wired to FreshRuntimeScript"

key-files:
  created:
    - .planning/phases/12-atom-based-island-hydration/12-DECISION.md
  modified: []

key-decisions:
  - "Atom-based hydration layers on top of signal hydration — no replacement, no new protocol required"
  - "No breaking changes to setAtom(), initAtomHydration(), setAtomHydrationHook() APIs"
  - "Partials gap deferred — atoms not emitted during Fresh Partial navigation; workaround: use RPC streams"
  - "Dead per-app hook deferred — setAtomHydrationHookForApp exists but FreshRuntimeScript never calls it"
  - "Global hook last-writer-wins accepted and documented — single-app production use is the supported scenario"
  - "hydration.ts duplication deferred — plugin-effect has identical local copy; deduplicate after verifying JSR constraints"

patterns-established:
  - "Decision document format: 7 sections (context, architecture, decision, API assessment, gap table, SC verification, follow-ons)"
  - "Gap table format: Gap ID, Description, Impact, Severity, Decision (Accept/Defer)"

# Metrics
duration: 3min
completed: 2026-02-28
---

# Phase 12 Plan 01: Atom-Based Island Hydration Decision Summary

**Dual-channel hydration architecture decision: atom state (__FRSH_ATOM_STATE)
layers on top of signal props (stringify/reviver), no breaking changes to
setAtom/initAtomHydration API, 4 gaps documented with Accept/Defer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-28T20:54:53Z
- **Completed:** 2026-02-28T20:57:30Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Wrote 12-DECISION.md: full architectural decision for atom-based island
  hydration with all 7 sections
- Documented both hydration channels from source (Channel 1: stringify/reviver
  signal pipeline, Channel 2: __FRSH_ATOM_STATE atom pipeline) with key file
  references
- Assessed full API surface: setAtom(), initAtomHydration(),
  setAtomHydrationHook() — no breaking changes confirmed
- Produced gap table with Accept/Defer decisions for all 4 gaps from
  12-RESEARCH.md
- Verified all 3 roadmap success criteria (SC-1, SC-2, SC-3 all PASS)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write 12-DECISION.md** - `cf33045a` (docs)
2. **Task 2: Verify decision document against success criteria** - verification
   only, no new files (all SC grep checks passed)

**Plan metadata:** see final commit below

## Files Created/Modified

- `.planning/phases/12-atom-based-island-hydration/12-DECISION.md` — Full
  architectural decision document: dual-channel hydration architecture, API
  surface assessment, gap table, SC verification

## Decisions Made

- Atom-based hydration layers on top of signal hydration (not replacement, not
  new protocol) — confirmed from Phase 04 source
- No breaking changes to setAtom()/initAtomHydration()/setAtomHydrationHook()
  API surface; no migration required
- 4 gaps each have explicit Accept/Defer: Partials gap (Defer), dead per-app
  hook (Defer), global last-writer-wins (Accept/document), hydration.ts
  duplication (Defer)
- setAtomHydrationHookForApp() exists in app.ts but is never consumed by
  FreshRuntimeScript — confirmed dead code; deferred to future multi-app
  isolation work

## Deviations from Plan

None — plan executed exactly as written. Task 1 wrote the document; Task 2
verified it. All success criteria passed on first attempt.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 12 is complete: decision document written, all 3 success criteria
  verified
- 4 gaps identified with explicit defer decisions — candidates for future phases
  if concrete use cases emerge:
  - Partials atom delta updates (requires Partial branch extension in
    FreshRuntimeScript)
  - Per-app hook wiring (requires RenderState changes to pass App instance
    through)
  - hydration.ts deduplication (verify JSR dependency constraints first)
- No blockers for other phases

---

_Phase: 12-atom-based-island-hydration_ _Completed: 2026-02-28_
