---
phase: 08-httpapi-integration
plan: 02
subsystem: api
tags: [effect, httpapi, fresh, testing, schema-validation, layer, dispatch-routing]

# Dependency graph
requires:
  - phase: 08-httpapi-integration/08-01
    provides: EffectApp.httpApi() method, HttpRouter.toWebHandler integration, dispose chain

provides:
  - httpapi_test.ts with 4 passing tests covering all 3 Phase 8 success criteria
  - Fixed httpApi() route registration (use → all) so middleware actually triggers
  - Fixed httpApi() URL prefix stripping so Effect handler routes correctly
  - Example app services/api.ts with TodoApi definition and TodosLive group implementation
  - Updated example app main.ts mounting TodoApi at /api via httpApi()
  - Updated example app deno.json with import map entries for effect/unstable/http and effect/unstable/httpapi

affects: [09-rpc-integration, 10-migration-example]

# Tech tracking
tech-stack:
  added: [effect/unstable/httpapi (HttpApiError.NotFound, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder)]
  patterns:
    - "FiniteFromString over NumberFromString for integer query params — NumberFromString accepts NaN (Getter.Number coercion), FiniteFromString decodes to Finite and rejects NaN"
    - "httpApi prefix stripping: strip prefix from URL before forwarding to Effect handler using URL.pathname.slice(prefix.length)"
    - "httpApi route registration via app.all(prefix + '/*') not app.use(prefix) — use() middleware only fires when a Route is matched, all() registers an actual route"
    - "Layer.provide(GroupLive, AppLayer) pre-composition for httpApi group layers — ensures service dependencies are available before group builds"

key-files:
  created:
    - packages/effect/tests/httpapi_test.ts
    - packages/examples/effect-integration/services/api.ts
  modified:
    - packages/effect/src/app.ts
    - packages/examples/effect-integration/main.ts
    - packages/examples/effect-integration/deno.json

key-decisions:
  - "httpApi() uses app.all(prefix + '/*', ...) not app.use(prefix, ...) — Fresh middleware added via use() only fires when a Route is matched by the UrlPatternRouter; all() registers an actual route that the router matches"
  - "URL prefix must be stripped before forwarding to Effect handler — HttpApiEndpoint paths are relative to group root, not to the mount prefix"
  - "Schema.FiniteFromString preferred over Schema.NumberFromString for integer query params — NumberFromString uses Getter.Number (coercion, never fails) and returns NaN for non-numeric strings; FiniteFromString decodes to Finite and correctly fails with a schema error"

patterns-established:
  - "httpApi integration test pattern: createEffectApp({ layer: Layer.empty }) + httpApi() + FakeServer — one app per test, dispose at end"
  - "Group layer pre-composition: Layer.provide(GroupLive, AppLayer) before passing to httpApi() — required when handlers need AppLayer services"

# Metrics
duration: 10min
completed: 2026-02-26
---

# Phase 8 Plan 2: HttpApi Integration Tests + Example App Summary

**httpApi() integration verified with 3 passing SC tests; two bugs fixed in httpApi() dispatch; example app demonstrates end-to-end TodoApi with TodoService**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-02-26T13:52:22Z
- **Completed:** 2026-02-26T14:02:22Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 updated)

## Accomplishments
- Written `httpapi_test.ts` with 4 tests (SC-1 200 JSON list, SC-2 400 schema error, SC-3 404 NotFound, dispose) — all 3 Phase 8 success criteria verified
- Fixed two bugs in `EffectApp.httpApi()` discovered during test authoring: route dispatch registration and URL prefix stripping
- Added `TodoApi + TodosLive` to example app demonstrating real-world HttpApi integration with an existing service layer
- All 16 @fresh/effect tests pass (5 app, 4 httpapi, 1 signal, 6 types)

## Task Commits

Each task was committed atomically:

1. **Task 1: Write httpapi_test.ts covering all 3 success criteria** - `fc4f2287` (feat)
2. **Task 2: Add HttpApi to example app + update deno.json** - `0433b045` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/effect/tests/httpapi_test.ts` - 4 integration tests for SC-1, SC-2, SC-3, and dispose lifecycle
- `packages/effect/src/app.ts` - Fixed httpApi() route registration (use → all) and URL prefix stripping
- `packages/examples/effect-integration/services/api.ts` - TodoApi definition with list/getById/create endpoints + TodosLive implementation
- `packages/examples/effect-integration/main.ts` - Mounts TodoApi at /api via httpApi() with Layer.provide pre-composition
- `packages/examples/effect-integration/deno.json` - Added effect/unstable/http and effect/unstable/httpapi import map entries

## Decisions Made

- **httpApi() uses `app.all(prefix + "/*", ...)` not `app.use(prefix, ...)`:** Fresh's `use(path, middleware)` adds middleware to a path segment — it only fires when the UrlPatternRouter matches a Route. Since no Route is registered at the prefix, the middleware never fires. Using `all(prefix + "/*", fn)` registers an actual route that the router matches for all HTTP methods under the prefix.

- **URL prefix stripping in httpApi() middleware:** The Effect HttpRouter only knows endpoint paths relative to the group root (e.g. `/items/`), not the mount prefix. The request URL includes the full path (`/api/items/`), so the prefix must be stripped before forwarding to the Effect handler.

- **`Schema.FiniteFromString` over `Schema.NumberFromString`:** In effect v4 beta, `NumberFromString` uses `Getter.Number()` (globalThis.Number coercion, "pure, never fails") and decodes to `Number` (not `Finite`). It accepts `"notanumber"` → `NaN` without error. `FiniteFromString` decodes to `Finite` via `Transformation.numberFromString` and correctly rejects NaN with a schema error, producing 400.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] httpApi() route registration: `use(prefix, ...)` never triggers**
- **Found during:** Task 1 (SC-1 test returning 404 instead of 200)
- **Issue:** `this.#app.use(prefix, handler)` adds middleware to a path segment in the segment tree. Segment middleware only executes when the UrlPatternRouter matches a Route at that path. Since no Route is registered at the prefix (only a middleware), the handler never fires — all requests return 404.
- **Fix:** Changed to `this.#app.all(prefix + "/*", handler)` which registers an actual route in the UrlPatternRouter for all HTTP methods, matching any path under the prefix.
- **Files modified:** `packages/effect/src/app.ts`
- **Verification:** SC-1 test passes (200 response received)
- **Committed in:** fc4f2287 (Task 1 commit)

**2. [Rule 1 - Bug] httpApi() URL forwarding: prefix not stripped from request URL**
- **Found during:** Task 1 (same bug investigation as above)
- **Issue:** After fixing route registration, SC-1 still returned 404. The Effect handler received the full URL `/api/items/` but its router only knows `/items/` (from HttpApiEndpoint path). Path mismatch → Effect router 404.
- **Fix:** Added URL prefix stripping: `url.pathname = url.pathname.slice(prefix.length) || "/"` and forward a rewritten Request to the Effect handler.
- **Files modified:** `packages/effect/src/app.ts`
- **Verification:** All 3 SC tests pass; Effect logger output shows `/items/` as the matched path
- **Committed in:** fc4f2287 (Task 1 commit)

**3. [Rule 1 - Bug] `Schema.NumberFromString` accepts NaN — use `Schema.FiniteFromString` instead**
- **Found during:** Task 1 (SC-2 test returning 200 instead of 400 for `?page=notanumber`)
- **Issue:** `Schema.NumberFromString` in effect v4 beta uses `Getter.Number()` which is documented as "pure, never fails" (delegates to `globalThis.Number`). `Number("notanumber")` = NaN — no schema error is raised. SC-2 asserts 400 but received 200 with `{ "name": "Page NaN" }`.
- **Fix:** Changed `{ page: Schema.NumberFromString }` to `{ page: Schema.FiniteFromString }`. `FiniteFromString` decodes to `Finite` and applies `Number.isFinite()` check — NaN fails validation → `HttpApiSchemaError` → 400.
- **Files modified:** `packages/effect/tests/httpapi_test.ts`
- **Verification:** SC-2 test passes (400 with `_tag: "HttpApiSchemaError"` body)
- **Committed in:** fc4f2287 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs — all discovered via failing tests)
**Impact on plan:** The two httpApi() bugs were latent in Plan 01's implementation; discovered and fixed here. The FiniteFromString discovery is a v4 beta API behavior. All fixes required for plan success criteria.

## Issues Encountered
- `Schema.NumberFromString` vs `Schema.FiniteFromString` behavior difference: the type annotation suggests `NumberFromString` extends `decodeTo<Finite, String>` but the implementation decodes to `Number` (not Finite) — effectively accepting NaN. FiniteFromString is the correct schema when you need to reject non-finite values.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 3 Phase 8 success criteria verified by passing tests
- Phase 8 is complete: EffectApp.httpApi() implemented, tested, and demonstrated in example app
- Phase 9 (RPC integration) can proceed
- The httpApi() URL prefix stripping fix and route registration fix should be noted in Phase 9 if RPC uses a similar mounting pattern

---
*Phase: 08-httpapi-integration*
*Completed: 2026-02-26*
