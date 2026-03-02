---
phase: 06-fresh-core-plumbing
verified: 2026-02-25T18:26:36Z
status: passed
score: 4/4 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "All existing plugin-effect integration tests pass after the refactor — define_types_test.ts updated to createEffectDefine(app, { layer }) signature; all 8 tests now pass"
  gaps_remaining: []
  regressions: []
---

# Phase 6: Fresh Core Plumbing Verification Report

**Phase Goal:** Multiple `App` instances in the same process each own their
Effect runner — the global `_effectResolver` singleton is replaced with a
per-app hook, and Effect handlers work via `app.get()` / `app.post()` /
`app.use()` with no observable behavior change for existing code.

**Verified:** 2026-02-25T18:26:36Z **Status:** passed **Re-verification:** Yes —
after gap closure (define_types_test.ts updated to app-first createEffectDefine
signature)

## Goal Achievement

### Observable Truths

| # | Truth                                                                                      | Status   | Evidence                                                                                                         |
| - | ------------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| 1 | Two App instances each run Effect handlers through their own runner without interfering    | VERIFIED | per_app_test.ts: 6/6 tests pass including interleaved concurrent requests (SC-1, 2 tests)                        |
| 2 | An Effect handler registered via app.get() or app.post() returns the correct HTTP response | VERIFIED | per_app_test.ts SC-2 tests pass; runMiddlewares() calls isEffectLike() and dispatches through effectRunner       |
| 3 | An Effect-returning middleware registered via app.use() runs and its Effect is resolved    | VERIFIED | per_app_test.ts SC-3 tests pass including state injection and short-circuit paths                                |
| 4 | All existing plugin-effect integration tests pass after the refactor                       | VERIFIED | define_types_test.ts: 8/8 pass (was 4/8); integration_test.ts: 7/7 pass; per_app_test.ts: 6/6 pass — 21/21 total |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact                                            | Expected                                                                                                    | Status   | Details                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/fresh/src/handlers.ts`                    | isEffectLike() function + EffectRunner type                                                                 | VERIFIED | isEffectLike() at line 247; EffectRunner type at line 237; both exported                                                                                                                         |
| `packages/fresh/src/app.ts`                         | #effectRunner field, setEffectRunner/getEffectRunner                                                        | VERIFIED | #effectRunner at line 176; static block wires setEffectRunner/getEffectRunner at lines 188-191; setEffectRunner/getEffectRunner declared at lines 163-164                                        |
| `packages/fresh/src/segments.ts`                    | renderRoute with effectRunner parameter, no _effectResolver global                                          | VERIFIED | _effectResolver global fully absent (grep confirms zero occurrences); renderRoute accepts effectRunner at line 179; effectRunner used at line 217                                                |
| `packages/fresh/src/middlewares/mod.ts`             | runMiddlewares with effectRunner parameter, isEffectLike resolution                                         | VERIFIED | effectRunner parameter at line 96; isEffectLike check + dispatch at lines 121-126                                                                                                                |
| `packages/fresh/src/commands.ts`                    | applyCommands/applyCommandsInner thread effectRunner through all renderRoute and segmentToMiddlewares calls | VERIFIED | applyCommands at line 204; applyCommandsInner at line 217; effectRunner passed to renderRoute at lines 292, 310; passed to segmentToMiddlewares at lines 273, 341; FsRoute recursion at line 363 |
| `packages/fresh/src/internals.ts`                   | setEffectRunner, getEffectRunner, isEffectLike, EffectRunner re-exported                                    | VERIFIED | Line 3: setEffectRunner, getEffectRunner from app.ts; Line 4: EffectRunner type, isEffectLike from handlers.ts                                                                                   |
| `packages/plugin-effect/src/mod.ts`                 | effectPlugin(app, opts) calls setEffectRunner(app, runner)                                                  | VERIFIED | setEffectRunner(app, runner) at line 105; app-first signature at line 83                                                                                                                         |
| `packages/plugin-effect/tests/per_app_test.ts`      | Per-app isolation, app.get() dispatch, app.use() middleware tests                                           | VERIFIED | 237 lines; 6 tests covering SC-1 (2 tests), SC-2 (2 tests), SC-3 (2 tests); all pass                                                                                                             |
| `packages/plugin-effect/tests/integration_test.ts`  | Existing integration tests pass with updated call signatures                                                | VERIFIED | All 7 tests pass; effectPlugin(app) call signature updated throughout                                                                                                                            |
| `packages/plugin-effect/tests/define_types_test.ts` | Type-level createEffectDefine tests pass with app-first signature                                           | VERIFIED | 128 lines; 8/8 tests pass; App imported at line 22; createEffectDefine(app, { layer: DbLayer }) at lines 44, 72, 85, 120                                                                         |

### Key Link Verification

| From                   | To                   | Via                                                            | Status | Details                                                                                                                             |
| ---------------------- | -------------------- | -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app.ts`               | `middlewares/mod.ts` | `app.handler()` passes effectRunner to runMiddlewares()        | WIRED  | Line 457: `runMiddlewares(handlers, ctx, this.#onError, effectRunner)`                                                              |
| `app.ts`               | `commands.ts`        | `app.handler()` passes effectRunner to applyCommands()         | WIRED  | Lines 399-406: `const effectRunner = this.#effectRunner; applyCommands(router, this.#commands, this.config.basePath, effectRunner)` |
| `commands.ts`          | `segments.ts`        | applyCommandsInner passes effectRunner to renderRoute closures | WIRED  | Lines 292, 310: `renderRoute(ctx, def, 200, effectRunner)` and `renderRoute(ctx, route, 200, effectRunner)`                         |
| `commands.ts`          | `segments.ts`        | applyCommandsInner passes effectRunner to segmentToMiddlewares | WIRED  | Lines 273, 341: `segmentToMiddlewares(segment, effectRunner)`                                                                       |
| `commands.ts`          | `segments.ts`        | FsRoute recursion threads effectRunner                         | WIRED  | Line 363: `applyCommandsInner(root, router, items, base, effectRunner)`                                                             |
| `plugin-effect/mod.ts` | `app.ts`             | setEffectRunner(app, runner) registers per-app runner          | WIRED  | Line 105: `setEffectRunner(app, runner)`                                                                                            |
| `handlers.ts`          | `middlewares/mod.ts` | isEffectLike imported and called on middleware results         | WIRED  | Line 5 import; lines 121-126 check and dispatch                                                                                     |

### Requirements Coverage

| Requirement                                       | Status    | Blocking Issue                                                       |
| ------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| CORE-01: Per-app Effect runner                    | SATISFIED | All SC-1 tests pass; no global state remains; _effectResolver absent |
| CORE-02: Effect handlers via app.get()/app.post() | SATISFIED | SC-2 tests pass; runMiddlewares dispatches via isEffectLike          |
| CORE-03: Effect middleware via app.use()          | SATISFIED | SC-3 tests pass                                                      |

### Anti-Patterns Found

| File                                               | Line  | Pattern                                                                                                     | Severity | Impact                                                                          |
| -------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| `packages/plugin-effect/tests/integration_test.ts` | 13-14 | Comment "Effect handlers must be registered via app.route() (not app.get())" is stale — app.get() now works | Warning  | Misleading comment left from pre-phase-6 state; not a blocker                   |
| `packages/plugin-effect/tests/define_test.ts`      | 8-10  | Same stale comment about app.get() bypassing renderRoute                                                    | Warning  | Misleading (app.get() now dispatches Effects via runMiddlewares); not a blocker |

### Human Verification Required

None. All success criteria are verifiable via automated tests.

### Re-verification Summary

**Gap closed:** The one failing truth from initial verification is now resolved.

`define_types_test.ts` was updated to use the
`createEffectDefine(app, { layer })` signature introduced in phase 6-02. The
file now:

- Imports `App` from `@fresh/core` (line 22)
- Creates `const app = new App()` inside each test that needs a layer (lines 43,
  71, 84, 119)
- Passes `app` as the first argument to `createEffectDefine` at all 4 call sites
  (lines 44, 72, 85, 120)

All 8 tests now pass. Combined with the 7 `integration_test.ts` tests and 6
`per_app_test.ts` tests, the full suite is 21/21 passing.

**No regressions detected:** `_effectResolver` global remains absent from
`segments.ts` and `internals.ts`; `App#effectRunner` private field and
`setEffectRunner`/`getEffectRunner` accessors remain intact in `app.ts`.

---

_Verified: 2026-02-25T18:26:36Z_ _Verifier: Claude (gsd-verifier)_
