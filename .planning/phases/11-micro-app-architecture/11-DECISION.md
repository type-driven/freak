# Micro-App Architecture: Architectural Decision

**Date:** 2026-02-27
**Status:** Accepted
**Decision:** Adopt the Programmatic Plugin Pattern as the supported composition model for Freak sub-apps.

---

## 1. Problem Statement

The `mountApp` API in Freak (`App<State>.mountApp(path, app)`) was observed to produce
intermittent failures when used to compose sub-apps. Three failure categories were identified
in real-world usage of the `../platform` project, which mounts `../workflows` and `../authend`:

1. **Islands not hydrating** — Preact island components from a sub-app fail to hydrate on
   the client; they render as static HTML only.

2. **Routes not resolving** — File-system routes registered in a sub-app via `.fsRoutes()`
   return 404 when the sub-app is mounted under the outer app.

3. **Layout and context leaks** — A sub-app's `appWrapper` component (page shell, nav,
   layout) bleeds into the outer app, overriding or being overridden by other app wrappers.

**Failures are intermittent** because they only appear when specific features are used:
if a sub-app has no islands, no `appWrapper`, and no fs-routes, `mountApp` works correctly.
Failures surface only at the intersection of those features with the flat command-merging
implementation of `mountApp`.

The platform project's actual response to these failures was to stop using `mountApp`
entirely and develop the programmatic plugin pattern independently. See section 3 for
production evidence.

---

## 2. Root Cause Analysis

**Source:** Direct reading of `/packages/fresh/src/app.ts`, `commands.ts`, `segments.ts`,
`runtime/server/preact_hooks.ts`. See `11-RESEARCH.md` section 2 for full source listings.

`mountApp` works by **inlining the inner app's command array into the outer app's command
array** at build time. There is no sub-router — the outer app's single `UrlPatternRouter`
handles all routes from all mounted apps. This flat-merge design is the root of all failure
modes.

### Root Cause A: BuildCache is singular and shared

**Code location:** `app.ts`, `mountApp` method — `app.#getBuildCache = () => self.#getBuildCache()`

**What breaks:** After `mountApp`, the inner app's `#getBuildCache` is replaced by a closure
that returns the outer app's `BuildCache`. The `BuildCache` holds the island registry
(`Map<ComponentType, Island>`), client entry path, and fs-routes. If the outer `BuildCache`
was built only for the outer app, islands from the inner app are absent from `islandRegistry`.

**Trigger condition:** Sub-apps have separate builds (each sub-app library is independently
built). This is the standard model for library-style sub-apps.

### Root Cause B: CommandType.App is a global write

**Code location:** `app.ts`, `mountApp` method — `this.#commands.push(cmd)` without path
prefix for `CommandType.App`; `commands.ts`, `applyCommands` — `root.app = cmd.component`

**What breaks:** `CommandType.App` (produced by `app.appWrapper(component)`) is pushed to
the outer app's command list verbatim, without path scoping. When `applyCommands` processes
it, it sets `root.app` — the single app wrapper for the whole server. If two mounted apps
each provide an `appWrapper`, the last one processed wins (last-writer-wins). All routes,
not just the sub-app's routes, are now wrapped by the winning component.

**Trigger condition:** Any sub-app calls `app.appWrapper(component)`.

### Root Cause C: CommandType.NotFound is a global write

**Code location:** `app.ts`, `mountApp` method — same pass-through as `CommandType.App`;
`commands.ts`, `applyCommands` — `root.notFound = cmd`

**What breaks:** Same mechanism as Root Cause B. `CommandType.NotFound` (from
`app.notFound(handler)`) is pushed without path scoping, making the inner app's 404 handler
the global 404 handler for the entire outer app. Multiple sub-apps with `notFound` handlers
conflict.

**Trigger condition:** Any sub-app calls `app.notFound(handler)`.

### Root Cause D: ctx.state has no sub-app namespacing

**Code location:** `context.ts`, `Context<State>` — `state` is a single shared object
per request

**What breaks:** All middleware in a single request shares one `ctx.state` object. If two
sub-apps write to the same key (e.g., both set `ctx.state.user` or `ctx.state.config`),
they silently overwrite each other. No runtime error is produced; the wrong value is read.

**Trigger condition:** Two sub-apps write to the same key on `ctx.state`. Particularly
likely with common names like `user`, `session`, `config`, `tenant`.

### Root Cause E: _atomHydrationHook is a process-level global

**Code location:** `segments.ts` — `let _atomHydrationHook: ((ctx: Context<unknown>) => string | null) | null = null`; `internals.ts` — `setAtomHydrationHook` export

**What breaks:** `setAtomHydrationHook` overwrites a module-level variable. Only one atom
hydration hook can be registered at a time. If two sub-apps (e.g., two Effect plugins)
each call `setAtomHydrationHook`, the second registration silently replaces the first. One
sub-app's atom serialization stops working without any error.

**Trigger condition:** Two sub-apps each use the Effect plugin (or any plugin that calls
`setAtomHydrationHook`).

### Summary table

| Failure | Root Cause | Trigger |
|---------|-----------|---------|
| Islands not hydrating | Inner app islands absent from outer BuildCache's `islandRegistry` | Sub-apps have separate builds |
| Routes not resolving | FsRoute closure reads outer BuildCache; inner fs-routes absent | Inner app uses `.fsRoutes()` |
| Layout bleeding | `CommandType.App` not path-scoped; last writer wins | Multiple sub-apps with `appWrapper` |
| Context leaks | `ctx.state` is a single shared object; no namespacing | Plugins write same state keys |
| Atom hook collision | `_atomHydrationHook` is module-level; second registration wins | Two Effect sub-apps both mount |

---

## 3. Options Evaluated

### Option A: Fix mountApp

**How it would work:** Correct each of the five root causes listed above, making `mountApp`
a general-purpose sub-app composition primitive.

**Technical obstacles:**

1. **BuildCache aggregation** — The outer BuildCache must be built from all sub-app build
   artifacts merged together. This requires a merged build step or a build-time enumeration
   of all sub-apps. Significant build-system work; Freak's current esbuild-based pipeline
   has no merge primitive.

2. **CommandType.App path scoping** — The segment tree (`applyCommands`, `segmentToMiddlewares`)
   must be extended to scope `appWrapper` to a path prefix. Currently the segment model
   has a single root-level `app` field; introducing per-prefix wrappers requires architecture
   change to `RenderState` and `renderRoute`.

3. **CommandType.NotFound path scoping** — Same structural change as above for 404 handlers.

4. **Static prefix limitation** — `mountApp` computes merged patterns at registration time
   (`mergePath(path, cmd.pattern)`). Dynamic segments (e.g., `/orgs/:orgSlug/workflows`)
   cannot be part of the mount path because the pattern is a static string. Supporting
   dynamic prefixes requires deferred pattern computation (lazy mounting), a new command
   type, and changes to how `UrlPatternRouter` resolves routes.

**Gains:** The existing `mountApp` API becomes correct for sub-apps that use islands,
fs-routes, and `appWrapper`. Users could compose `App<State>` instances as designed.

**Complexity:** HIGH. All four obstacles require non-trivial changes spanning the build
system, routing layer, and segment/render model.

**Shared state isolation not addressed:** `ctx.state` remains a single shared object.
`_atomHydrationHook` remains process-level. These would require additional work.

**Verdict:** High-effort path addressing the wrong layer for the current real-world use
case. The platform sub-apps use no islands and no fs-routes, so fixing BuildCache sharing
would not help them. The dynamic mount path limitation is fundamental and requires
redesigning `mountApp` from scratch.

---

### Option B: Programmatic Plugin Pattern (formalize what exists)

**How it works:**

1. Sub-app logic lives in a library (e.g., `@type-driven/workflows`).
2. The library exports a curried factory: `workflowPlugin(config)`.
3. The factory returns `(app: App<unknown>) => void | PluginResult`.
4. Inside the returned function, all routes are registered directly on the host `app` via
   `app.get()`, `app.post()`, `app.all()` with full prefixed paths (e.g., `app.get("/orgs/:orgSlug/workflows", ...)`).
5. No separate `App<State>` is instantiated inside the plugin. No `mountApp` call occurs.

**Why it avoids all mountApp failure modes:**

- Routes register directly on the host router → no BuildCache sharing needed
- No islands in plugin → no `islandRegistry` coordination required
- No `CommandType.App` → no appWrapper conflict
- No `CommandType.NotFound` → no notFound conflict
- Dynamic mount paths work: patterns are registered as complete strings with `:param`
  segments intact; the host router handles param extraction at request time
- Layout integration via `layoutWrapper` callback: plugin renders body HTML as a string,
  host provides the wrapper function — clean separation of content from presentation

**Production evidence:** Both `workflowPlugin` (`workflows/src/plugin.ts`) and `authPlugin`
(`authend/src/plugin.ts`) already implement this pattern in active production use. Neither
uses `mountApp`. The `workflowPlugin` comment in `workflows/src/dashboard/app.ts` explicitly
documents why `mountApp` was abandoned: parameterized mount paths require it. `authPlugin`
was explicitly authored to mirror the `workflowPlugin` pattern.

**Limitations (honest accounting):**

- No Preact islands in plugins — would require BuildCache aggregation (future work)
- `ctx.state` still unnamespaced — convention (prefix keys by plugin name) mitigates; no
  enforcement
- No formal `Plugin<Config>` type in `@fresh/core` — each plugin authored ad-hoc

**Complexity:** LOW. The pattern works in production. The work is documentation, formalization,
and optionally adding a `Plugin<Config>` type to `@fresh/core`.

**Verdict:** Correct choice. Production-validated, covers the real use case, low effort.

---

### Option C: Module Federation

**How it would work:** Each sub-app is built as an MF remote (separate Vite build producing
`remoteEntry.js`). The platform host is built as an MF host. At runtime, the host's browser
code fetches and dynamically loads components from each remote's build artifacts.

**Why it's the wrong layer:**

1. **Wrong problem layer** — MF is a browser-side dynamic code loading mechanism. Freak's
   composition problem is server-side: route registration, middleware ordering, and island
   registry aggregation for SSR. MF does not address any of these server-side concerns.

2. **Requires Vite** — `@module-federation/vite` (the current standard MF implementation)
   is a Vite plugin. Freak uses esbuild. Switching build tooling means replacing the dev
   server, HMR, island bundling, static file hashing, and `_fresh/` output format.

3. **Requires separate deployments** — MF remotes must be served from URLs accessible to
   the host at runtime (browser-side). This means separate deployment artifacts per sub-app
   and a CDN or service per remote.

4. **No Deno-native support** — Deno's URL-based ESM module system has no equivalent to
   MF's shared scope/container protocol. No authoritative Deno MF solution exists.

5. **SSR is unsupported** — MF's server-side rendering story is substantially more complex
   and less mature than its client-side story, especially for island-based SSR.

**Gains:** None applicable to the current problem. MF solves a different problem space
(browser-side runtime composition across deployment boundaries).

**Complexity:** PROHIBITIVE. Full build pipeline replacement required.

**Verdict:** Not applicable to this problem. Removed from consideration.

---

### Comparison table

| Criterion | Fix mountApp | Plugin Pattern | Module Federation |
|-----------|-------------|----------------|-------------------|
| Dynamic mount paths | Requires redesign | Works today | N/A |
| Island hydration | Requires merged BuildCache | N/A (no islands) | N/A |
| appWrapper isolation | Requires architecture change | N/A (not used) | N/A |
| Layout integration | Via appWrapper (currently broken) | Via layoutWrapper (working) | N/A |
| ctx.state isolation | Not fixed | Not fixed | N/A |
| Effect isolation | Already isolated | Already isolated | N/A |
| Implementation effort | HIGH | LOW | PROHIBITIVE |
| Production-validated | No | Yes | No |
| Deno-native | Yes | Yes | No |
| Separate builds per sub-app | Not required | Not required | Required |

---

## 4. Decision

**Adopt the Programmatic Plugin Pattern as the supported composition model for Freak sub-apps.**

**Rationale:**

- **Production-validated by two real plugins:** `workflowPlugin` (`workflows/src/plugin.ts`)
  and `authPlugin` (`authend/src/plugin.ts`) both implement this pattern and are in active
  use in `platform/control-panel/main.ts`. This is not a theoretical design.

- **Supports dynamic mount paths:** Plugins can register routes with parameterized prefixes
  (e.g., `/orgs/:orgSlug/workflows`). `mountApp` cannot support this without a fundamental
  redesign.

- **Avoids all five BuildCache/island/appWrapper failure modes:** Because plugins register
  routes directly on the host app, there is no BuildCache sharing, no `CommandType.App`
  conflict, no `CommandType.NotFound` conflict, and no `FsRoute`/`islandRegistry` mismatch.

- **Low implementation effort:** The pattern already works. Adoption means documenting and
  formalizing the existing convention, optionally adding a `Plugin<Config>` type. No new
  runtime machinery required.

---

## 5. mountApp Scope Clarification

`mountApp` is **not deprecated**. It remains useful for a specific, limited scope:

**mountApp works correctly when:**
- The mount path is a static prefix (no `:param` segments)
- The sub-app contains no Preact islands
- The sub-app does not call `app.appWrapper()`
- The sub-app does not call `app.notFound()`
- The sub-app does not use `.fsRoutes()`
- The sub-app does not call `setAtomHydrationHook` (no Effect plugin)

**Valid use case:** Simple middleware-level composition — a sub-app that is purely route
handlers and middleware, all on a static prefix, with no UI features (no islands, no layout
wrapper, no file-system routes). Example: mounting a health check router or a simple API
namespace.

**Not a general sub-app composition primitive.** The design intent was route merging by
prefix, not full sub-app isolation. For sub-apps with UI, layout, or islands, the plugin
pattern is required.

The known failure modes (BuildCache sharing, `CommandType.App` leakage) are documented in
`11-RESEARCH.md` section 2 and summarized in section 2 above. They are **not fixed in
this phase** — that would be a follow-on phase if `mountApp` expansion becomes a priority.

---

## 6. Reference Implementations

The canonical implementations of the programmatic plugin pattern are:

**workflowPlugin:**
- `workflows/src/plugin.ts` — factory function, config type, returned `(app) => void`
- `workflows/src/dashboard/app.ts` — `createDashboardApp(app, runtime, workflows, config)`:
  registers all routes directly on `app` with full `config.mountPath` prefix; includes the
  comment explaining why `mountApp` was avoided (parameterized paths)

**authPlugin:**
- `authend/src/plugin.ts` — mirrors workflowPlugin pattern (documented explicitly in
  line 1 comment)
- `authend/src/ui/app.ts` — `createAuthApp(app, runtime, config)`: registers sign-in,
  sign-out, callback routes directly on `app`

**Host usage:**
- `platform/control-panel/main.ts` — calls both plugins in curried form:

```typescript
authPlugin({ mountPath: "/auth", tenantId: "...", ... })(app);
workflowPlugin({ mountPath: "/orgs/:orgSlug/workflows", ... })(app);
```

**Calling convention:** Curried factory — `pluginName(config)(app)`. First call creates
the plugin with configuration and captures dependencies. Second call registers routes on
the provided app. This allows the plugin to be configured independently of the app instance,
enabling lazy registration or conditional mounting.

**layoutWrapper pattern:** Plugins accept a `layoutWrapper` callback in their config:

```typescript
readonly layoutWrapper?: (
  bodyHtml: string,
  ctx: { title: string; req: Request },
) => string | Response | Promise<string | Response>;
```

The plugin renders its own body HTML and passes it to `layoutWrapper`. The host provides
the wrapping function that injects the body into the full page shell (nav, sidebar, CSS,
etc.). This is a clean content/presentation separation: the plugin owns content, the host
owns shell.

Fresh's own internal "plugins" (e.g., `staticFiles()`) also follow this model — they are
middleware or route registrars, not separate `App<State>` instances. The programmatic
plugin pattern is already idiomatic in Fresh.

---

## 7. Future Work

These items are explicitly deferred to follow-on phases. They are not part of this phase's
scope.

**1. Islands in plugins** — If a future plugin needs Preact islands (interactive client
components), the plugin pattern cannot support it without BuildCache coordination. The host's
`islandRegistry` must include the plugin's island components at build time. This requires
either a merged BuildCache built from all plugin artifacts, or a plugin manifest that the
host build system reads. This is non-trivial follow-on work.

**2. `Plugin<Config>` formal type in `@fresh/core`** — Currently each plugin is authored
ad-hoc with no shared base type. Adding a `Plugin<Config>` type export to `@fresh/core`
would improve type safety and discoverability for plugin authors. This is a small addition
but belongs after the pattern is documented and stabilized.

**3. ctx.state namespacing** — Plugins currently write to `ctx.state` without namespacing.
A typed sub-state model (each plugin declares its state key and type; the framework enforces
uniqueness) would improve isolation for third-party plugins and make conflicts a compile-time
error rather than a runtime overwrite. Depends on Plugin type formalization above.

**4. Plugin authoring documentation and scaffolding** — Third-party plugin authors need
documentation, examples, and potentially a scaffolding tool (`deno run @fresh/create-plugin`)
to create a compliant plugin. Deferred per `11-CONTEXT.md`.

---

*Phase: 11-micro-app-architecture*
*Researched: 2026-02-27*
*Decision date: 2026-02-27*
