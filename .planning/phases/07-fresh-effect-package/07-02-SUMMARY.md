---
phase: 07-fresh-effect-package
plan: 02
subsystem: testing
tags: [
  effect,
  effect-ts,
  managed-runtime,
  fresh,
  deno,
  signal-handling,
  type-safety,
]

# Dependency graph
requires:
  - phase: 07-01
    provides: "createEffectApp, EffectApp class, createEffectDefine, registerSignalDisposal"
provides:
  - "SC-1 tests: EffectApp.get/post/use with Effect handlers verified"
  - "SC-2 tests: TypeScript type rejection of handlers with undeclared services"
  - "SC-3 tests: SIGTERM subprocess test verifying clean exit code 0"
  - "SC-4 tests: Independent runtime isolation between two EffectApp instances"
  - "Example app converted from effectPlugin to createEffectApp"
affects: [
  "08-httpapi-integration",
  "09-rpc-integration",
  "10-migration-example",
]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SC-N test naming: tests named SC-N: <criterion description> for traceability"
    - "@ts-expect-error placement: must be on line immediately before the error expression, not before containing call"
    - "ChildProcess stream cleanup: await cp.stdout.cancel() + cp.stderr.cancel() after cp.status"

key-files:
  created:
    - "packages/effect/tests/app_test.ts"
    - "packages/effect/tests/types_test.ts"
    - "packages/effect/tests/signal_test.ts"
    - "packages/effect/tests/signal_server.ts"
  modified:
    - "packages/examples/effect-integration/main.ts"
    - "packages/examples/effect-integration/deno.json"

key-decisions:
  - "@ts-expect-error for app.get() rejection placed via typed variable pattern: const badHandler: Parameters<typeof app.get>[1] = () => Effect.gen..."
  - "signal_server.ts uses port: 0 and onListen callback to print READY:<port>"
  - "Deno ChildProcess streams must be cancelled after cp.status to avoid resource leak errors"
  - "app.dispose() called in each test to remove SIGTERM/SIGINT signal listeners"

patterns-established:
  - "Signal test pattern: spawn subprocess, read stdout until READY, send SIGTERM, assert exit code 0, cancel streams"
  - "Type rejection test pattern: assign to typed variable with @ts-expect-error on the line before the error expression"

# Metrics
duration: 4min
completed: 2026-02-25
---

# Phase 7 Plan 2: @fresh/effect Tests Summary

**All 4 Phase 7 success criteria verified: SC-1/SC-4 runtime tests, SC-2
TypeScript rejection tests, SC-3 SIGTERM clean-shutdown subprocess test, example
app converted from effectPlugin to createEffectApp**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-25T21:54:56Z
- **Completed:** 2026-02-25T21:59:32Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- SC-1: `EffectApp.get()`, `.post()`, `.use()` all dispatch Effect handlers
  correctly — 3 tests pass
- SC-2: TypeScript rejects handlers requiring services not in `AppR` — 2
  `@ts-expect-error` tests verified by `deno check`
- SC-3: SIGTERM subprocess test verifies `runtime.dispose()` + `Deno.exit(0)` —
  passes in ~100ms
- SC-4: Two independent `EffectApp` instances serve from distinct Layers;
  disposing one leaves the other functional — 2 tests pass
- Example app converted from `effectPlugin(app, { layer, mapError })` to
  `createEffectApp({ layer, mapError })` — type-checks cleanly

## Task Commits

1. **Task 1: SC-1/SC-4 runtime tests + SC-2 type tests** - `f1a37293` (test)
2. **Task 2: SC-3 signal test + example app conversion** - `ed3dfd9c` (test)

## Files Created/Modified

- `packages/effect/tests/app_test.ts` — SC-1 (get/post/use with Effect handlers)
  and SC-4 (independent runtimes) tests
- `packages/effect/tests/types_test.ts` — SC-2 type rejection tests using
  `@ts-expect-error` and `expectTypeOf`
- `packages/effect/tests/signal_test.ts` — SC-3 SIGTERM subprocess test
- `packages/effect/tests/signal_server.ts` — Minimal EffectApp fixture: prints
  READY:<port>, awaits SIGTERM to exit
- `packages/examples/effect-integration/main.ts` — Converted from `effectPlugin`
  to `createEffectApp`
- `packages/examples/effect-integration/deno.json` — Added `@fresh/effect`
  import alias

## Decisions Made

- **@ts-expect-error placement for app.get() rejection:** TypeScript's error
  attribution on `Effect.gen(function*...)` expressions doesn't align with
  `@ts-expect-error` placed before the containing call. Solution: assign to a
  typed variable (`const badHandler: Parameters<typeof app.get>[1] = ...`) so
  the `@ts-expect-error` is on the line directly before the assignment
  expression that triggers the error.

- **Deno ChildProcess stream cleanup:** After `await cp.status`, must call
  `await cp.stdout.cancel()` and `await cp.stderr.cancel()` to avoid Deno's
  resource leak detection in tests. The streams remain open until explicitly
  cancelled.

- **signal_server.ts port:0 pattern:** Using `port: 0` lets the OS pick a free
  port. The `onListen` callback fires synchronously with the bound address, so
  `console.log("READY:<port>")` is the canonical handshake for subprocess
  readiness.

- **app.dispose() in each test:** Each `EffectApp` registers SIGTERM/SIGINT
  listeners via `registerSignalDisposal`. Without disposal, these listeners
  accumulate across tests and could interfere. Calling `await app.dispose()` at
  the end of each test removes listeners and tears down the runtime.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @ts-expect-error placement needed restructuring**

- **Found during:** Task 1 (SC-2 type tests)
- **Issue:** Plan placed `@ts-expect-error` before
  `app.get("/test", () => Effect.gen(...))`, but the type error is attributed to
  the `Effect.gen` expression inside the callback (2 lines down), not the
  `app.get` call itself. Unused directive error.
- **Fix:** Restructured SC-2 `app.get` test to assign the bad handler to a typed
  variable (`const badHandler: Parameters<typeof app.get>[1] = ...`) with
  `@ts-expect-error` on the line before the assignment. The `createEffectDefine`
  test already worked with the `POST:` property key placement.
- **Files modified:** `packages/effect/tests/types_test.ts`
- **Verification:** `deno check packages/effect/tests/types_test.ts` passes
  cleanly
- **Committed in:** f1a37293

**2. [Rule 2 - Missing Critical] Stream cancellation for signal subprocess
test**

- **Found during:** Task 2 (SC-3 signal test)
- **Issue:** Deno test runner detects resource leaks — ChildProcess
  stdout/stderr streams opened but not cancelled after test.
- **Fix:** Added `await cp.stdout.cancel()` and `await cp.stderr.cancel()` after
  `await cp.status`.
- **Files modified:** `packages/effect/tests/signal_test.ts`
- **Verification:**
  `deno test --allow-env --allow-net --allow-run packages/effect/tests/signal_test.ts`
  passes
- **Committed in:** ed3dfd9c

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical) **Impact on
plan:** Both auto-fixes necessary for correct type checking and test passing. No
scope creep.

## Issues Encountered

None — all test logic worked as designed; only the stream cleanup and
`@ts-expect-error` placement needed adjustment.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 4 Phase 7 success criteria are verified by tests
- Phase 7 is complete — `@fresh/effect` package has core API + full test
  coverage
- Phase 8 (HttpApi integration) can begin: will use `EffectApp.build()` to
  register HttpApi sub-handlers
- Key constraint for Phase 8: `EffectApp.mountApp` accepts `App<State>`, not
  `EffectApp` — use `.app` accessor

---

_Phase: 07-fresh-effect-package_ _Completed: 2026-02-25_
