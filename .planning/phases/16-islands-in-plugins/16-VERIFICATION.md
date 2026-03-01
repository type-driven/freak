---
phase: 16-islands-in-plugins
verified: 2026-03-01T21:27:32Z
status: passed
score: 3/3 must-haves verified
human_verification:
  - test: "Client-side island hydration"
    expected: "Island components registered via a plugin re-hydrate correctly in the browser after deno task dev"
    why_human: "Full browser hydration requires the build pipeline to know about plugin island specifiers, a real island file on disk, buildProd + withBrowserApp flow — cannot be tested with MockBuildCache unit tests. Documented in plan as Phase 17 concern."
---

# Phase 16: Islands-in-Plugins Verification Report

**Phase Goal:** Island components registered via `plugin.app.islands()` appear in the host's BuildCache and produce correct SSR `<!--frsh:island:-->` markers. Two plugins with different island sets can be mounted on the same host without chunk name collisions.
**Verified:** 2026-03-01T21:27:32Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A plugin that registers an island via app.islands() has that island appear in the host's BuildCache after mountApp() + setBuildCache() | VERIFIED | Tests ISLD-01 (x2) pass: `cache.islandRegistry.has(CounterIsland)` returns true; `entry.file` and `entry.exportName` correct |
| 2 | SSR HTML from a route using a plugin-registered island contains frsh:island markers with the component's export name | VERIFIED | Test ISLD-02 passes: html contains "frsh:island" and "CounterIsland"; `preact_hooks.ts` line 485 generates `frsh:${kind}:${markerText}` comments |
| 3 | Two plugins mounting islands with the same export name on the same host produce unique island names (no collision) | VERIFIED | Tests ISLD-03 (x2) pass: `names.size === 2`; UniqueNamer in `IslandPreparer` appends `_1` suffix for second "CounterIsland" export |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/fresh/tests/plugin_islands_test.tsx` | ISLD-01/02/03 tests, min 80 lines | VERIFIED | 211 lines, 5 tests, 20 assertions, no stub patterns |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `plugin_islands_test.tsx` | `packages/fresh/src/app.ts` | `createPlugin` + `mountApp` + `islands()` | WIRED | `createPlugin` imported from `@fresh/core` which re-exports from `plugin.ts`; `App.mountApp` overload with `Plugin<Config,S,R>` at line 389; `islands()` method at line 357 |
| `plugin_islands_test.tsx` | `packages/fresh/src/build_cache.ts` | `setBuildCache` triggers `IslandPreparer` | WIRED | `setBuildCache` (via `internals.ts`) creates `IslandPreparer`, iterates `#islandRegistrations` accumulated by `mountApp`, calls `preparer.prepare(cache.islandRegistry, ...)` |
| `plugin_islands_test.tsx` | `packages/fresh/src/runtime/server/preact_hooks.ts` | SSR render produces `frsh:island` markers | WIRED | `wrapWithMarker()` at line 475 generates `UNSTABLE_comment: frsh:${kind}:${markerText}`; test ISLD-02 asserts HTML contains "frsh:island" and "CounterIsland" after `host.handler()` fetch |

### Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ISLD-01: plugin island registered via createPlugin + mountApp appears in host BuildCache | SATISFIED | 2 passing tests; registry keyed on ComponentType (function ref) |
| ISLD-02: SSR HTML from plugin route contains frsh:island markers with export name | SATISFIED | 1 passing test; `html.includes("frsh:island")` and `html.includes("CounterIsland")` |
| ISLD-03: two plugins with same-named component export get unique island names | SATISFIED | 2 passing tests; UniqueNamer deduplication verified |

### Anti-Patterns Found

None. Zero TODO/FIXME/placeholder patterns. Zero empty returns. File is substantive with 20 real assertions.

### Human Verification Required

#### 1. Client-side island hydration

**Test:** In a dev environment, create a Fresh app that mounts a plugin which registers a real island file via `app.islands()`. Run `deno task dev` and load the page in a browser. Interact with the island component.
**Expected:** The island component hydrates correctly — it becomes interactive (e.g., clicking a counter increments). The browser console shows no hydration errors.
**Why human:** Full client hydration requires a real island file on disk, the Deno build pipeline (`buildProd` or dev server) knowing about plugin island specifiers, and `withBrowserApp` / browser automation. MockBuildCache unit tests cover SSR marker presence only. This is the documented SC-2 from the plan, deferred to Phase 17 demo app.

### Test Execution Results

All tests passed on first verification run:

```
running 5 tests from ./tests/plugin_islands_test.tsx
ISLD-01: plugin island registered via createPlugin + mountApp appears in host BuildCache ... ok (0ms)
ISLD-01: host islands and plugin islands both appear in merged registry ... ok (0ms)
ISLD-02: SSR HTML from plugin route contains frsh:island markers ... ok (2ms)
ISLD-03: two plugins with same-named component export get unique island names (no collision) ... ok (0ms)
ISLD-03: two plugins with distinct islands both produce SSR markers ... ok (0ms)

ok | 5 passed | 0 failed (5ms)
```

Regression tests (19 total) all pass:

```
ok | 19 passed | 0 failed (94ms)
```
(Covers `plugin_test.ts`, `islands_test.ts`, `islands_ssr_demo_test.tsx`)

### Implementation Correctness Notes

The island merge path was already implemented in Phase 14. The wiring chain is:

1. `createPlugin(config, factory)` — `factory` returns an `App` with islands registered via `app.islands()`, storing them in `#islandRegistrations`
2. `host.mountApp("/path", plugin)` — resolves `plugin.app`, pushes all of inner app's `#islandRegistrations` entries into host's `#islandRegistrations` (lines 421-423 of `app.ts`)
3. `setBuildCache(host, cache, "production")` — creates a single `IslandPreparer` (with one `UniqueNamer`) and iterates all accumulated `#islandRegistrations`, calling `preparer.prepare(cache.islandRegistry, mod, chunkName, chunkName, [])` for each
4. `IslandPreparer.prepare()` — for each exported function, calls `UniqueNamer.getUniqueName()` which deduplicates by appending `_1`, `_2`, etc. to colliding export names; sets entry on `registry` keyed by function reference
5. SSR render — `preact_hooks.ts` `wrapWithMarker()` checks `cache.islandRegistry` to detect island components and emits `frsh:island:${islandName}` comment nodes

The ISLD-03 collision test correctly models the real-world scenario: two plugins use the same export name string `"CounterIsland"` but with distinct function references (`CounterIsland` vs `CounterIsland2`). Since the registry is keyed on function reference, both entries exist distinctly. The UniqueNamer ensures the `name` field (used for chunk naming) is unique: "CounterIsland" and "CounterIsland_1".

---

_Verified: 2026-03-01T21:27:32Z_
_Verifier: Claude (gsd-verifier)_
