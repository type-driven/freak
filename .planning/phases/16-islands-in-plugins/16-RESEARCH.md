# Phase 16: Islands in Plugins - Research

**Researched:** 2026-03-01
**Domain:** Fresh BuildCache island aggregation, SSR island markers, plugin mounting
**Confidence:** HIGH

## Summary

Phase 16 lifts the "no islands" restriction from `mountApp()`. Research reveals that this work is almost entirely complete in the current codebase. The `mountApp()` method in `app.ts` already propagates `#islandRegistrations` from inner to outer app (lines 421-423), and `setBuildCache` already applies all merged registrations via `IslandPreparer` (lines 196-201). Both the SSR marker path and the chunk-naming collision-prevention path via `UniqueNamer` are fully working.

The critical finding is that `islands_test.ts` and `islands_ssr_demo_test.tsx` already test and pass these exact scenarios: single-plugin island propagation, two-plugin island merging, SSR marker generation, and the `mountApp` island merge path. Phase 16's job is therefore to write the three ISLD-0x requirement tests that formally verify this end-to-end: a plugin calling `app.islands()`, SSR producing `<!--frsh:island:-->` markers, and two plugins with distinct chunk names producing no collision.

The build system (`Builder` / `UniqueNamer`) already prevents chunk naming collisions by using `UniqueNamer.getUniqueName()` across all registered island specifiers before esbuild runs. Plugin islands registered via `app.islands(chunkName)` flow into `islandRegistry` with that chunk name as `file`, which is the post-build browser path. The name field is the collision-safe identifier for SSR markers.

**Primary recommendation:** Write ISLD-01/02/03 tests that exercise the existing implementation. Verify in-process (unit) for ISLD-01/03; verify SSR HTML for ISLD-02. No source code changes are required for basic functionality — the aggregation is already implemented.

---

## BuildCache Mechanics

**Confidence: HIGH** — verified from source.

### Interface: `BuildCache<State>` (`packages/fresh/src/build_cache.ts`)

```typescript
export interface BuildCache<State = any> {
  root: string;
  islandRegistry: ServerIslandRegistry;  // Map<ComponentType, Island>
  clientEntry: string;
  features: { errorOverlay: boolean };
  getFsRoutes(): Command<State>[];
  readFile(pathname: string): Promise<StaticFile | null>;
  getEntryAssets(): string[];
}
```

`ServerIslandRegistry` is `Map<ComponentType, Island>` where `Island` is:

```typescript
export interface Island {
  file: string;       // browser chunk path, e.g. "/_fresh/js/BUILD_ID/counter.js"
  name: string;       // unique SSR identifier, e.g. "Counter" or "Counter_1"
  exportName: string; // JS export name from the module, e.g. "default" or "Counter"
  fn: ComponentType;  // component reference (same as registry key)
  css: string[];      // associated CSS paths
}
```

### `app.islands()` Flow

1. `app.islands(mod, chunkName)` pushes `{ mod, chunkName }` onto `app.#islandRegistrations` — deferred, does not access BuildCache yet.
2. When `setBuildCache(app, cache, mode)` is called:
   - If `app.#islandRegistrations.length > 0`, creates a new `IslandPreparer` and calls `preparer.prepare(cache.islandRegistry, mod, chunkName, chunkName, [])` for each registration.
3. `IslandPreparer.prepare()` iterates `Object.entries(mod)`, skips non-functions, and for each function:
   - Derives `islandName` (uses export name, or `modName` for default exports)
   - Gets a collision-safe unique name via `this.#namer.getUniqueName(islandName)`
   - Calls `registry.set(fn, { exportName, file: chunkName, fn, name: uniqueName, css })`

### Key data flow

```
app.islands({ Counter }, "counter-chunk")
  → #islandRegistrations = [{ mod: { Counter }, chunkName: "counter-chunk" }]

setBuildCache(app, cache, "production")
  → IslandPreparer.prepare(cache.islandRegistry, { Counter }, "counter-chunk", "counter-chunk", [])
  → cache.islandRegistry.set(Counter, { exportName: "Counter", file: "counter-chunk", name: "Counter", fn: Counter, css: [] })
```

Note: in `app.islands()` the `chunkName` arg is passed as both the `chunkName` and `modName` arguments to `IslandPreparer.prepare`. For the dev/prod build path, `file` gets replaced with the actual browser-URL chunk path (e.g., `/_fresh/js/BUILD_ID/Counter.js`) when `islandModNameToChunk` is populated in `builder.ts:344-346`.

---

## mountApp Current Behavior

**Confidence: HIGH** — verified from `app.ts` source.

`mountApp()` in `app.ts` lines 391-433 already handles islands. The exact code:

```typescript
mountApp(path: string, appOrPlugin: App<State> | Plugin<unknown, State, unknown>): this {
  const inner: App<State> = !(appOrPlugin instanceof App)
    ? (appOrPlugin as Plugin<unknown, State, unknown>).app
    : appOrPlugin;

  // 1. Commands: copy with path prefix (skipping App/NotFound commands)
  for (let i = 0; i < inner.#commands.length; i++) { ... }

  // 2. Build cache delegation: inner app reads from outer's cache
  const self = this;
  inner.#getBuildCache = () => self.#getBuildCache();

  // 3. Island propagation: already implemented
  for (const reg of inner.#islandRegistrations) {
    this.#islandRegistrations.push(reg);
  }

  // 4. Effect runner propagation
  if (!this.#effectRunner && inner.#effectRunner) {
    this.#effectRunner = inner.#effectRunner;
  }
  // 5. Atom hydration hook propagation
  if (!this.#atomHydrationHook && inner.#atomHydrationHook) {
    this.#atomHydrationHook = inner.#atomHydrationHook;
  }

  return this;
}
```

**Decision 11-01's "no islands" limitation is already lifted.** The current `mountApp()` already:
- Merges inner island registrations into outer's `#islandRegistrations`
- Delegates `#getBuildCache` so that inner routes use the outer's (shared) registry at render time
- When `setBuildCache(outer, cache, ...)` is called subsequently, all merged registrations are applied to the shared `cache.islandRegistry`

The 11-01 "fix deferred indefinitely" note referred to a _previous_ implementation. The current code in this worktree has already resolved it.

---

## Island SSR Markers

**Confidence: HIGH** — verified from `preact_hooks.ts` source.

### How markers are generated

During SSR (`ctx.render()`):

1. `context.ts:render()` creates a `RenderState(ctx, buildCache, partialId)` and calls `setRenderState(state)`.
2. `RenderState.buildCache` holds the host's `BuildCache` (containing `islandRegistry`).
3. Preact's `options[DIFF]` hook fires on every VNode during `renderToString`.
4. When a function-type VNode fires: `const island = RENDER_STATE.buildCache.islandRegistry.get(vnode.type)`.
5. If `island !== undefined` (component IS in registry), the hook wraps the VNode with `wrapWithMarker(child, "island", "${island.name}:${propsIdx}:${key}")`.
6. `wrapWithMarker` uses preact's `UNSTABLE_comment` feature to emit HTML comments: `<!--frsh:island:Counter:0:-->`.

### The exact SSR comment format

```
<!--frsh:island:ISLAND_NAME:PROPS_IDX:KEY-->
  ... component output ...
<!--/frsh:island-->
```

Where `ISLAND_NAME` is `island.name` from the registry (the unique name assigned by `UniqueNamer`), and `PROPS_IDX` is the index into `islandProps` array (for client-side hydration).

### What island name the test should assert

For a component registered as `{ CounterIsland }` with chunk `"counter-island"`:
- `islandName = "CounterIsland"` (export name)
- `uniqueName = "CounterIsland"` (first occurrence, no collision)
- SSR output: `<!--frsh:island:CounterIsland:0:-->`

Success criterion says `counter-island` in comment — that is the **chunk name**, not the island name. The actual HTML will contain `CounterIsland` (PascalCase component name). The requirement "produces `<!--frsh:island:counter-island:-->` markers" appears to use kebab-case but the actual marker uses the component name. Verify this assumption in tests.

---

## Chunk Naming

**Confidence: HIGH** — verified from `builder.ts` and `build_cache.ts` sources.

### Build-time chunk naming (Builder)

In `Builder.#build()`:

```typescript
const namer = new UniqueNamer();
for (const spec of this.#islandSpecifiers) {
  const specName = specToName(spec);          // derives name from file path/URL
  const name = namer.getUniqueName(specName); // collision-safe via UniqueNamer
  entryPoints[name] = spec;
  buildCache.islandModNameToChunk.set(name, { name, server: spec, browser: null, css: [] });
}
```

`UniqueNamer.getUniqueName(name)` returns `name` for the first occurrence. On collision (duplicate base name), returns `name_1`, `name_2`, etc.

### Island specifiers come from file paths

`Builder.registerIsland(specifier)` adds file paths to `#islandSpecifiers`. These come from `crawlFsItems()` (filesystem crawl of `islandDir`). Plugin islands registered via `app.islands(mod, chunkName)` bypass this path — they go directly into `app.#islandRegistrations`.

### The two naming systems

There are two separate naming systems:

1. **Build-time chunk names** (`UniqueNamer` in `builder.ts`): used for esbuild entry points and output files. These prevent file-system collision for `_fresh/js/BUILD_ID/Counter.js` vs `_fresh/js/BUILD_ID/Counter_1.js`.

2. **Runtime island names** (`UniqueNamer` in `IslandPreparer`): used for SSR marker text (`<!--frsh:island:NAME:...-->`). Each `IslandPreparer` instance has its own `#namer`. Critically, `setBuildCache` creates ONE `IslandPreparer` per call and processes ALL merged registrations through it. This means two plugins each registering a component named `Counter` will get `Counter` and `Counter_1` in the SSR markers — no collision.

### Collision scenario for `app.islands()` (non-build path)

When using `app.islands(mod, chunkName)` with a `MockBuildCache` (tests) or real `BuildCache`:
- The `IslandPreparer` in `setBuildCache` has a fresh `#namer`.
- All registrations (outer + merged inner) are processed in order through the same `IslandPreparer` instance.
- Collision resolution: `Counter` → first registration gets `Counter`, second gets `Counter_1`.

For the build path (`Builder.build()`), the `file` field in the registry entry will be the browser URL (e.g., `/_fresh/js/BUILD_ID/Counter.js`). The `name` field (from `IslandPreparer` in `dev_build_cache.ts:flush()`) is derived from the module's chunk name (e.g., `Counter` from `Counter.js`).

---

## Aggregation Approach

**Confidence: HIGH** — the aggregation is already implemented.

The only change needed to `mountApp()` was adding lines 421-423:

```typescript
for (const reg of inner.#islandRegistrations) {
  this.#islandRegistrations.push(reg);
}
```

This is already present. No further source changes are required for ISLD-01/02/03.

The timing works because:
1. Plugin creates `new App()`, calls `app.islands(...)` — pushes to `#islandRegistrations`
2. Host calls `host.mountApp("/path", plugin)` — merges plugin's registrations into host's `#islandRegistrations`
3. Host calls `setBuildCache(host, cache, mode)` — applies ALL merged registrations to `cache.islandRegistry`
4. Any route rendered by the host reads `buildCache.islandRegistry` via `RENDER_STATE.buildCache` — finds plugin's islands

The `inner.#getBuildCache = () => self.#getBuildCache()` delegation on line 419 ensures that inner routes at render time also see the outer's registry. This matters when an inner app route calls `ctx.render()` — the `Context` constructor receives `buildCache` from the outer app's `handler()` method.

---

## Existing Test Patterns

**Confidence: HIGH** — verified from test files.

### `packages/fresh/tests/islands_test.ts`

Pure unit tests using `MockBuildCache`. No browser required. Pattern:

```typescript
const app = new App();
app.islands({ MyIsland }, "my-chunk");
const cache = new MockBuildCache([], "production");
setBuildCache(app, cache, "production");
expect(cache.islandRegistry.has(MyIsland)).toBe(true);
```

Already covers:
- Single island registration
- Multiple islands in one call
- Multiple `app.islands()` calls
- Correct metadata (`file`, `exportName`, `fn`)
- `mountApp` merging inner islands into outer
- Two plugins both registered
- Routes from inner app reachable after `mountApp`
- Non-function exports skipped

### `packages/fresh/tests/islands_ssr_demo_test.tsx`

In-process SSR test (no browser). Pattern:

```typescript
/** @jsxImportSource preact */
app.islands({ DemoCounter }, "chunk");
const cache = new MockBuildCache([], "production");
setBuildCache(app, cache, "production");
app.get("/", (ctx) => ctx.render(<html><body><DemoCounter count={42} /></body></html>));
const handler = app.handler();
const res = await handler(new Request("http://localhost/"));
const html = await res.text();
expect(html).toContain("frsh:island");
expect(html).toContain("DemoCounter");
```

Already covers:
- Not-registered component → no markers
- Registered component → SSR markers appear
- `mountApp` propagation → inner app's component gets markers in outer-hosted route

### `packages/fresh/tests/mount_effect_atom_test.ts`

Integration tests for `mountApp` with Effect + atoms. Pattern:

```typescript
import { setBuildCache, setEffectRunner, setAtomHydrationHookForApp } from "../src/internals.ts";
```

Tests use the internals export directly to wire up Effect runners and atom hooks.

### Browser-based tests (`islands_test.tsx`)

Use `buildProd()` + `withBrowserApp()` + `@astral/astral` for browser-driven testing. The `buildProd()` helper calls `Builder.build({ snapshot: "memory" })` and returns an apply function:

```typescript
const applySnapshot = await buildProd({ islandDir: ALL_ISLAND_DIR });
function testApp() {
  const app = new App().use(staticFiles()).fsRoutes();
  applySnapshot(app);
  return app;
}
```

ISLD-02's "hydrates on client" criterion requires a browser test using this pattern.

---

## Plugin.app Access After Phase 15

**Confidence: HIGH** — verified from `plugin.ts` and tests.

### `Plugin<Config, S, R>` interface

```typescript
export interface Plugin<Config = unknown, S = unknown, R = never> {
  readonly config: Config;
  readonly app: App<S>;
  readonly _phantom?: R;
}
```

### `createPlugin()` factory

```typescript
export function createPlugin<Config, S, R = never>(
  config: Config,
  factory: (config: Config) => App<S>,
): Plugin<Config, S, R> {
  return { config, app: factory(config) };
}
```

### Usage pattern in tests (`plugin_test.ts`)

```typescript
const plugin = createPlugin({ prefix: "/api" }, (_config) => {
  const app = new App<MyState>();
  app.islands({ CounterIsland }, "counter-island");
  app.get("/route", handler);
  return app;
});

const host = new App();
host.mountApp("/p", plugin); // uses Plugin overload
```

The `mountApp(path, plugin)` overload (line 389-394 in `app.ts`) unwraps `plugin.app` before processing:

```typescript
const inner: App<State> = !(appOrPlugin instanceof App)
  ? (appOrPlugin as Plugin<unknown, State, unknown>).app
  : appOrPlugin;
```

So island registrations flow: `plugin.app.#islandRegistrations` → merged into `host.#islandRegistrations` → applied when `setBuildCache(host, ...)` is called.

---

## Key Files to Modify

**Confidence: HIGH** — no production source modifications needed for ISLD-01/02/03.

### Files to READ (understand, not modify)

| File | Purpose |
|------|---------|
| `packages/fresh/src/app.ts` | `mountApp()` island merge logic (already complete) |
| `packages/fresh/src/build_cache.ts` | `IslandPreparer`, `BuildCache` interface, `setBuildCache` application |
| `packages/fresh/src/runtime/server/preact_hooks.ts` | SSR island marker generation via `wrapWithMarker`, `RenderState` |
| `packages/fresh/src/context.ts` | `ServerIslandRegistry`, `Island` interface, `render()` method |
| `packages/fresh/src/plugin.ts` | `Plugin<Config,S,R>`, `createPlugin()` |
| `packages/fresh/src/dev/builder.ts` | Build-time `UniqueNamer`, `registerIsland()`, `#islandSpecifiers` |
| `packages/fresh/src/dev/dev_build_cache.ts` | `MemoryBuildCache.flush()` applies island registry for dev/prod build |
| `packages/fresh/src/utils.ts` | `UniqueNamer` implementation |

### Files to CREATE (new test file)

`packages/fresh/tests/plugin_islands_test.tsx` — the primary deliverable of Phase 16. Contains ISLD-01, ISLD-02, ISLD-03 tests.

ISLD-01 and ISLD-03 can use `islands_test.ts` style (MockBuildCache, unit tests, no browser).
ISLD-02 requires the `islands_ssr_demo_test.tsx` style (in-process SSR with preact rendering).

For full client-side hydration verification (the "deno task dev" part of SC-2 and SC-3), a manual verification run suffices — the existing `islands_test.tsx` browser tests already prove the underlying plumbing works.

### No source files need modification

The feature is implemented. Phase 16 is writing tests that formally verify and document the behavior for the ISLD-0x requirements.

---

## Risks and Open Questions

### Risk 1: SSR marker format assertion

The success criterion says "produces `<!--frsh:island:counter-island:-->` markers". The actual format uses the **component name** (`CounterIsland`), not the chunk name (`counter-island`). The `island.name` in the marker comes from `UniqueNamer.getUniqueName(exportName)` — for `{ CounterIsland }` the export name IS `CounterIsland`. The marker will be `<!--frsh:island:CounterIsland:0:-->`, not `counter-island`.

**Action:** Tests should assert `frsh:island:CounterIsland` (or just `frsh:island` for the presence check), not `frsh:island:counter-island`.

### Risk 2: `app.islands()` with `MockBuildCache` vs real build

In `islands_test.ts` / `islands_ssr_demo_test.tsx`, `MockBuildCache` is used. The `file` field in the registry entry will be the raw `chunkName` string passed to `app.islands()` (e.g., `"counter-island"`), not a browser URL path. This is correct for testing SSR markers, but the client-side script import in `FreshRuntimeScript` will generate `import CounterIsland from "/counter-island"` — this won't resolve without a real build. The test only checks HTML, not live hydration.

**Action:** ISLD-02 client hydration check ("hydrates on client" in deno task dev) requires a real project. The automated test only checks SSR HTML presence.

### Risk 3: `IslandPreparer` per-call vs shared namer

Each call to `setBuildCache` creates a new `IslandPreparer` with a fresh `UniqueNamer`. This means the naming is consistent only within one `setBuildCache` call. If `setBuildCache` is called multiple times on the same app (not typical), islands could get different names on each call. This is unlikely to be an issue in practice.

### Risk 4: Collision with `default` exports

`IslandPreparer.prepare` uses `modName` (which equals `chunkName`) for `default` exports. If two plugins use the same `chunkName`, their default exports would collide in the namer. The namer handles this via `Counter_1` suffix, but the `file` field would also be the same string for both. This could cause client-side confusion. The test for ISLD-03 should use distinct chunk names, which is the expected usage pattern.

### Open Question 1: Does ISLD-02 need a full browser test?

The success criterion says "hydrates on client — verified by running `deno task dev`". This suggests manual verification for the hydration check, with the automated test covering only SSR markers. The planner should decide: write an automated browser test using `withBrowserApp` + `buildProd` pattern (like `islands_test.tsx`), or keep it as a manual verification step.

Given the existing browser test infrastructure works, a proper browser test is feasible but requires `buildProd({ islandDir })` which needs a file-system island file. For a plugin that registers islands programmatically via `app.islands()`, the `Builder.registerIsland()` path is separate — `app.islands()` only populates `islandRegistry` at runtime, not `islandModNameToChunk` needed for the build. A complete browser-hydration test for plugin islands requires `Builder.registerIsland(specifier)` to include the plugin's island component file as well.

**Recommendation:** ISLD-02 automated test: SSR marker in HTML (in-process, no browser). The client-side hydration relies on the build pipeline using `Builder.registerIsland()` which is out of scope for Phase 16. The success criterion's "deno task dev" clause is a manual verification step.

---

## Sources

### Primary (HIGH confidence)

All findings are from direct source reading:
- `packages/fresh/src/app.ts` — `App` class, `mountApp()`, `islands()`, `setBuildCache`
- `packages/fresh/src/build_cache.ts` — `BuildCache`, `IslandPreparer`, `ProdBuildCache`
- `packages/fresh/src/context.ts` — `ServerIslandRegistry`, `Island`, `render()`
- `packages/fresh/src/runtime/server/preact_hooks.ts` — `RenderState`, `wrapWithMarker`, diff hook
- `packages/fresh/src/plugin.ts` — `Plugin<Config,S,R>`, `createPlugin()`
- `packages/fresh/src/dev/builder.ts` — `Builder`, `UniqueNamer`, `registerIsland`
- `packages/fresh/src/dev/dev_build_cache.ts` — `MemoryBuildCache.flush()`, `IslandPreparer` usage
- `packages/fresh/src/utils.ts` — `UniqueNamer` implementation
- `packages/fresh/tests/islands_test.ts` — existing unit tests for island registration
- `packages/fresh/tests/islands_ssr_demo_test.tsx` — existing SSR marker tests
- `packages/fresh/tests/mount_effect_atom_test.ts` — existing mountApp integration tests
- `packages/fresh/tests/plugin_test.ts` — existing Plugin type tests
- `packages/fresh/tests/islands_test.tsx` — existing browser-based island tests
- `packages/fresh/src/test_utils.ts` — `MockBuildCache`, `FakeServer`
- `packages/fresh/tests/test_utils.tsx` — `buildProd`, `withBrowserApp`, `Doc`

---

## Metadata

**Confidence breakdown:**
- BuildCache mechanics: HIGH — read from source
- mountApp current behavior: HIGH — read from source, island merge already present
- Island SSR markers: HIGH — read from preact_hooks.ts
- Chunk naming: HIGH — read from builder.ts, UniqueNamer
- Aggregation approach: HIGH — already implemented, no code changes needed
- Existing test patterns: HIGH — read from test files

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable codebase, no external dependencies)
