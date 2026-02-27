# Phase 11 Research: Micro-App Architecture

**Researched:** 2026-02-27
**Domain:** Fresh App composition, micro-frontend patterns, sub-app mounting
**Confidence:** HIGH (direct source reading; LOW for Module Federation Deno-specific claims)

---

## 1. mountApp — Current Implementation

**Source:** Direct reading of `/packages/fresh/src/app.ts` (lines 345–373)

`mountApp(path: string, app: App<State>): this` works by **inlining the inner app's
command array into the outer app's command array** at build time (when `.handler()` is
called or when commands are applied). It is not a runtime delegation pattern — there is
no inner request router that receives requests.

### Exact mechanism

```typescript
mountApp(path: string, app: App<State>): this {
  for (let i = 0; i < app.#commands.length; i++) {
    const cmd = app.#commands[i];

    if (cmd.type !== CommandType.App && cmd.type !== CommandType.NotFound) {
      // Prefix inner commands with the mount path
      let effectivePattern = cmd.pattern;
      if (app.config.basePath) {
        effectivePattern = mergePath(app.config.basePath, cmd.pattern, false);
      }
      const clone = {
        ...cmd,
        pattern: mergePath(path, effectivePattern, true),
        includeLastSegment: cmd.pattern === "/" || cmd.includeLastSegment,
      };
      this.#commands.push(clone);
      continue;
    }

    // CommandType.App and CommandType.NotFound are passed through unchanged
    this.#commands.push(cmd);
  }

  // Delegate BuildCache: inner app now reads from outer app's BuildCache
  const self = this;
  app.#getBuildCache = () => self.#getBuildCache();

  return this;
}
```

Key behaviors:
- **Shallow clone** of each command: `{ ...cmd, pattern: mergedPath }`. All
  non-pattern fields (including closures, lazy resolvers) are shared by reference.
- **CommandType.App and CommandType.NotFound are NOT prefixed**: they are pushed to the
  outer app verbatim. This means the inner app's `appWrapper` and `notFound` handlers
  affect the outer app globally.
- **BuildCache delegation**: After mounting, `app.#getBuildCache` is replaced with
  a closure that delegates to `self.#getBuildCache()`. This is a mutable side-effect on
  the inner app object.
- **FsRoute commands** (CommandType.FsRoute) contain a `getItems` closure that calls
  `this.#getBuildCache()` on the inner app at evaluation time. After mounting, this
  closure reads the outer app's BuildCache.

### What "mounting" actually produces

After `outer.mountApp("/foo", inner)` where `inner` has commands `[middleware("/"), get("/")]`:
- outer commands now contain: `[..., middleware("/foo/*"), get("/foo")]`
- The inner app's `#getBuildCache` now points to the outer app's cache

There is **no sub-router** for the inner app. Its commands are merged flat into the
outer app's command list, and the outer app's single `UrlPatternRouter` handles all
routes.

---

## 2. Root Cause Analysis — Why Failures Occur

**Confidence:** HIGH — derived directly from source code inspection.

### 2a. BuildCache is singular and shared

Each `App<State>` has exactly one `BuildCache`. The BuildCache holds:
- `islandRegistry`: `Map<ComponentType, Island>` — maps component functions to their
  client-side chunk files, names, and CSS
- `clientEntry`: path to the Fresh client runtime JS
- `getFsRoutes()`: file-system routes from the build output

When `mountApp` is called, the inner app's `#getBuildCache` is overwritten to return the
outer app's BuildCache. This is correct for simple cases but breaks when:

**Scenario: Two sub-apps each built independently**

If `inner1` and `inner2` each have their own build artifact with their own island
registries, and both are mounted on `outer`, only ONE BuildCache can win. After
`outer.mountApp("/a", inner1)` and `outer.mountApp("/b", inner2)`, both inner apps
read the outer app's BuildCache. If the outer BuildCache was built only for the outer
app, islands from `inner1` and `inner2` are absent from `islandRegistry` →
**islands do not hydrate**.

**Scenario: FsRoute commands with wrong BuildCache**

A `CommandType.FsRoute` command captures `this.#getBuildCache` via closure at the time
`.fsRoutes()` is called. When `mountApp` runs, it replaces `app.#getBuildCache`, so
future `getItems()` calls (during `.handler()`) now return the outer app's fs-routes.
If the outer app's build does not include the inner app's file routes, `getItems()`
returns an empty array or incorrect routes → **routes not resolving**.

### 2b. CommandType.App is global

When `applyCommands` processes a `CommandType.App` command (from `app.appWrapper()`),
it sets `root.app = cmd.component`. There is only one `root` segment per call to
`applyCommands`. If two mounted apps each provide an `appWrapper`, the last one to be
processed wins (last-writer-wins).

In `mountApp`, `CommandType.App` commands are passed through **without path prefixing**:
```typescript
// CommandType.App and NotFound go through unchanged:
this.#commands.push(cmd);
```

This means the inner app's `appWrapper` component is installed at the outer app's root
segment level, not scoped to the mount path. It overwrites or is overwritten by other
app wrappers → **layout bleeding / context leaks**.

### 2c. CommandType.NotFound is global

Same problem as `CommandType.App`: `CommandType.NotFound` commands are pushed through
without path scoping. The inner app's `notFound` handler replaces the outer app's
`notFound` handler at `root.notFound`. If two sub-apps each define a `notFound` handler,
only the last one applies globally.

### 2d. Shared state via the State generic

The `App<State>` generic `State` object is shared across all middleware in a single
request. If two sub-apps write to the same keys on `ctx.state`, they will interfere
with each other. There is no state namespacing by sub-app.

### 2e. _atomHydrationHook is a process-level global

In `/packages/fresh/src/segments.ts`:
```typescript
let _atomHydrationHook: ((ctx: Context<unknown>) => string | null) | null = null;
```

`setAtomHydrationHook` overwrites this module-level variable. If two sub-apps call
`setAtomHydrationHook` (e.g., two Effect plugins), the second registration silently
replaces the first. Only one atom hydration hook can be active at a time. Confirmed
comment in source: "Keeps Fresh core free of Effect dependency." This is a known
intentional design for single-app; it becomes a multi-app hazard.

### 2f. RENDER_STATE is a process-level global

In `/packages/fresh/src/runtime/server/preact_hooks.ts`:
```typescript
let RENDER_STATE: RenderState | null = null;
```

This global is set per-render via `setRenderState`. For synchronous SSR (which Fresh
uses: `renderToString` is synchronous), this is safe **within a single request**.
However, it means the `islandRegistry` used during rendering is the one from the
BuildCache stored in the `RenderState` constructed at request time. If the BuildCache
does not contain islands from a sub-app, those components are invisible to the island
serialization pass.

### Summary: failure trigger conditions

| Failure | Root Cause | Trigger |
|---------|-----------|---------|
| Islands not hydrating | Inner app islands not in outer BuildCache's `islandRegistry` | Sub-apps have separate builds |
| Routes not resolving | FsRoute closure reads outer BuildCache, inner fs-routes absent | Inner app uses `.fsRoutes()` |
| Layout bleeding | `CommandType.App` not path-scoped; last writer wins | Multiple sub-apps with `appWrapper` |
| Context leaks | `ctx.state` is a single shared object; no sub-app namespacing | Plugins write same state keys |
| Atom hook collision | `_atomHydrationHook` is module-level; second `setAtomHydrationHook` wins | Two Effect sub-apps |

**The intermittent nature** of the failures is explained: if sub-apps have mostly
non-overlapping routes, no islands, and no `appWrapper`, `mountApp` works. Failures
appear only when the specific broken features (islands, fs-routes, app wrapper) are
used.

---

## 3. Platform Usage Evidence

**Sources:** Direct reading of:
- `/Users/davidpeter/workspace/type-driven.com/platform/control-panel/main.ts`
- `/Users/davidpeter/workspace/type-driven.com/workflows/src/plugin.ts`
- `/Users/davidpeter/workspace/type-driven.com/workflows/src/dashboard/app.ts`
- `/Users/davidpeter/workspace/type-driven.com/authend/src/plugin.ts`
- `/Users/davidpeter/workspace/type-driven.com/authend/src/ui/app.ts`

### The platform project exists and is in active production use

`/platform/control-panel/main.ts` is a real server entry point with workers, workflow
engines, and auth. It imports and invokes plugins that mount sub-app routes.

### mountApp is NOT used

This is the critical finding: **neither `workflowPlugin` nor `authPlugin` uses
`mountApp`**. They have independently evolved away from it.

The pattern actually in use is the **programmatic plugin pattern**:

```typescript
// workflows/src/dashboard/app.ts — comment explains why:
/**
 * Registers workflow dashboard routes directly on the parent Fresh App using
 * the full mountPath prefix. This avoids app.mountApp() which requires a
 * static prefix, allowing mountPath to be a parameterized route like
 * "/orgs/:orgSlug/workflows".
 */
function createDashboardApp(app, runtime, workflows, config) {
  const p = config.mountPath;
  app.get(`${p}/api/health`, ...);
  app.get(`${p}`, ...);
  // etc.
}
```

```typescript
// authend/src/ui/app.ts — same pattern:
function createAuthApp(app, runtime, config) {
  app.get(cfg.mountPath, ...redirect...);
  registerSignInPage(app, runtime, cfg);
  // etc.
}
```

The plugins take `app: App<unknown>` and call `app.get()`, `app.post()`, `app.all()`
directly on it — registering routes with full prefixed paths. No separate `App<State>`
is instantiated for the sub-app. No `mountApp` call occurs.

### Why the plugins abandoned mountApp

The `workflowPlugin` comment explicitly states the reason: `mountPath` can be a
parameterized route like `/orgs/:orgSlug/workflows`. `mountApp` only supports static
path prefixes because it prefixes command patterns via string concatenation at
registration time. A dynamic segment in the mount path would require runtime resolution
that the command-flattening approach cannot support.

### Plugin calling convention

```typescript
// platform/control-panel/main.ts

// Pattern: pluginFactory(config)(app)
authPlugin({ mountPath: "/auth", tenantId: "...", ... })(app);
workflowPlugin({ mountPath: "/orgs/:orgSlug/workflows", ... })(app);
```

Both plugins return `(app: App<unknown>) => void`. The pattern is a curried function:
first call creates the plugin with config, second call registers it on the app.

### What the plugins do NOT share with the host

- No shared island registry (neither plugin uses Preact islands)
- No shared BuildCache
- No `appWrapper` or `notFound` registration
- No fs-routes
- Layout is handled via `layoutWrapper` callback — the host passes in an HTML
  wrapping function, and the plugin calls it to inject body HTML into the host's shell

This avoids **all** of the `mountApp` failure modes: no BuildCache sharing needed, no
island registry needed, no appWrapper conflict, no fs-route conflict.

### The layoutWrapper workaround

Instead of letting the sub-app render a complete HTML page, plugins accept a
`layoutWrapper` callback:
```typescript
readonly layoutWrapper?: (
  bodyHtml: string,
  ctx: { title: string; req: Request },
) => string | Response | Promise<string | Response>;
```

The sub-app renders its own body HTML as a string, then the host wraps it in the full
page shell with nav, sidebar, CSS, etc. This is a clean interface: the plugin produces
content, the host provides presentation context.

---

## 4. Module Federation in Deno

**Confidence:** MEDIUM-LOW — verified that MF requires Vite, confirmed Deno has no
native MF support, but specific Deno+Vite interop not deeply tested.

**Sources:** WebFetch of `https://github.com/module-federation/vite#readme`;
WebSearch results.

### What Module Federation is

Module Federation (MF) is a build-time + runtime mechanism that allows separately
compiled JS applications ("remotes") to expose modules that other applications ("hosts")
can load dynamically at runtime via network fetch. Each remote is a standalone build
output. The host app loads the remote's `remoteEntry.js` at runtime and imports
components or code from it.

The canonical modern implementation is `@module-federation/vite` (version 1.11.0 as of
January 2026, actively maintained).

### MF requires Vite (or Webpack/Rspack)

`@module-federation/vite` is a Vite plugin — it requires Vite as the build tool. Fresh
2 / Freak uses esbuild (via Deno's built-in bundler). There is no `@module-federation/esbuild` plugin with comparable capability. A native federation project
(`vite-plugin-federation` by originjs) also targets Vite only.

**If MF is adopted, the build pipeline must switch to Vite.** Deno can run Vite via
`deno run -A npm:vite`, but the development/production build pipeline in Fresh 2 is
deeply integrated with esbuild: island bundling, dev server HMR, static file hashing,
and the `_fresh/` output format all assume esbuild.

### Deno has no native Module Federation support

Module Federation is not a Deno-native feature. Deno's module system is URL-based ESM
— it does not have a runtime mechanism equivalent to MF's shared scope / container
protocol. A community question about using MF with rspack + Deno exists but no
authoritative solution was found.

### What "separate builds per sub-app" means in this context

For MF to work:
1. Each sub-app (workflows, authend) would be built independently by Vite with MF
   config, producing a `remoteEntry.js` + chunk files
2. The platform (host) would be built by Vite with host MF config, listing remotes
3. At runtime, the host's browser-side code fetches `remoteEntry.js` from each remote
   URL and loads components/code dynamically

This implies:
- Separate deployment artifacts per sub-app
- A CDN or service serving each remote's build output
- Runtime network round-trip to load remote code
- Version coordination (host must know each remote's URL)

For a server-side-rendered app like Fresh/Freak, **MF solves the wrong problem**. MF
is designed for client-side composition — loading UI components across browser
boundaries. Fresh's composition challenge is server-side: route registration, middleware
ordering, and BuildCache aggregation for SSR island hydration. MF does not address any
of these.

### Verdict on Module Federation

**Module Federation is not applicable to Freak's composition problem.**

The problem is server-side route composition and BuildCache sharing, not browser-side
dynamic code loading. MF would require:
1. Switching from esbuild to Vite (substantial build pipeline change)
2. Deploying separate build artifacts per sub-app
3. Accepting a client-side-only solution that does not address server-side route
   mounting, middleware ordering, or island registry aggregation

This is a high-cost solution that addresses the wrong layer. It is not a genuine option
for intra-process server-side sub-app composition.

---

## 5. Programmatic Plugin Pattern

**Confidence:** HIGH — the production pattern is already in use in `workflows/` and
`authend/`.

### Description

The programmatic plugin pattern is:
1. Sub-app logic lives in a library (e.g. `@type-driven/workflows`)
2. The library exports a plugin factory function: `workflowPlugin(config)`
3. The factory returns `(app: App<unknown>) => void | PluginResult`
4. Inside the returned function, all routes are registered on the host `app` directly
   using `app.get()`, `app.post()`, `app.all()` with full prefixed paths
5. No separate `App<State>` is instantiated inside the plugin

### Why it works

- Routes are registered directly on the host app → host's single router owns them
- No BuildCache sharing needed (no islands, no fs-routes in sub-app)
- No `CommandType.App` or `CommandType.NotFound` conflicts
- Mount path can include dynamic segments (e.g., `/orgs/:orgSlug/workflows`) because
  patterns are registered as-is; the host router handles param extraction
- The host's `ctx.params` contains the dynamic segments, accessible to plugin route
  handlers

### Layout integration

The `layoutWrapper` callback solves the host-shell integration problem without
coupling:
- Plugin renders body HTML as a string (SSR via its own renderer or template)
- Host provides the wrapping function that produces the full HTML document
- Plugin calls `layoutWrapper(bodyHtml, { title, req })` before returning a Response

This is effectively a template injection interface: clean separation of content from
presentation.

### Isolation properties

| Concern | mountApp | Plugin Pattern |
|---------|---------|---------------|
| Routes isolated to mount prefix | Yes (static prefix only) | Yes (plugin uses full prefix) |
| Dynamic mount path (`:orgSlug`) | No | Yes |
| BuildCache sharing | Required | Not needed (no islands) |
| Island hydration | Broken (single BuildCache) | N/A (no islands in plugin) |
| appWrapper isolation | Broken (global) | N/A (not used) |
| notFound isolation | Broken (global) | N/A (not used) |
| ctx.state isolation | None | None (same shared object) |
| Layout integration | Via appWrapper (broken) | Via layoutWrapper callback |

### How Fresh's own plugins work (staticFiles example)

```typescript
// packages/fresh/src/middlewares/static_files.ts
export function staticFiles<T>(): Middleware<T> {
  return async function staticFilesMiddleware(ctx) {
    // reads from ctx's BuildCache to serve _fresh/* and public/* files
  };
}
```

`staticFiles()` returns a middleware function — not a sub-app. It is registered via
`app.use(staticFiles())`. Fresh's internal "plugins" are middlewares or route
registrars, not separate App instances. This confirms the plugin pattern is already
the idiomatic Fresh approach.

### Extending to more complex sub-apps

The production pattern handles:
- Multiple route types (GET, POST, GET with wildcards)
- Effect runtimes (each plugin owns its own `ManagedRuntime`)
- Parameterized mount paths
- Optional API mounting vs. UI-only modes
- layoutWrapper for host shell injection

What it does NOT currently handle (limitation for future plugin authors):
- Preact islands in the sub-app (would need island registration in host BuildCache)
- File-system routes in the sub-app
- Sub-app `appWrapper`

For the current platform use case (authend, workflows), neither islands nor fs-routes
are needed — plugins render HTML directly via string templates.

---

## 6. Option Comparison Foundation

### Option A: Fix mountApp

**Technical obstacles:**

1. **BuildCache is singular** — `mountApp` delegates the inner app's `#getBuildCache`
   to the outer app's BuildCache. For this to work correctly with islands, the outer
   BuildCache must include islands from all sub-apps. This requires either:
   - A merged BuildCache that combines multiple build artifacts (significant build-system work)
   - OR a requirement that all sub-apps and the host app be built together in one
     build invocation (defeats the "separate sub-app library" model)

2. **CommandType.App global leakage** — `mountApp` currently passes `CommandType.App`
   commands through without path scoping. Fixing this requires either:
   - Scoping `appWrapper` to a path prefix in the segment tree (architecture change to
     `applyCommands`/`segmentToMiddlewares`)
   - OR prohibiting `appWrapper` in sub-apps (API restriction)

3. **Static prefix limitation** — `mountApp` only supports static path prefixes (no
   `:param` segments) because patterns are computed at registration time. Supporting
   dynamic prefixes would require deferred pattern computation (lazy mounting).

4. **FsRoute commands read outer BuildCache** — after mounting, `inner.#getBuildCache`
   returns the outer BuildCache. If the outer BuildCache does not contain the inner
   app's file routes, `getItems()` returns nothing. Fixing this requires either a
   merged BuildCache or a separate `FsRoute` command type that carries its own
   BuildCache reference.

**Gains:** The existing `mountApp` API surface would become correct. Users could
compose `App<State>` instances as designed.

**Complexity:** HIGH — requires build system changes (merged BuildCache), routing
changes (path-scoped appWrapper), and possibly a lazy-mounting redesign for dynamic
prefixes.

**Shared state isolation:** NOT improved. `ctx.state` remains a shared object.
`_atomHydrationHook` remains a global. Effect runners remain per-app (already isolated).

**Verdict:** Fix mountApp is a high-effort path that addresses the wrong layer for the
current real-world use case. The platform sub-apps do not use islands or fs-routes, so
fixing BuildCache sharing would not help them. The more fundamental problem
(dynamic mount paths, layout integration) requires rethinking the abstraction.

---

### Option B: Programmatic Plugin Pattern (formalize what exists)

**Technical obstacles:**

Essentially none — the pattern already works in production. The obstacles are
documentation and convention rather than implementation:

1. **No islands in plugins** — plugins cannot register islands (no BuildCache
   integration). This is a genuine limitation if future plugins need interactive
   client components.

2. **ctx.state is unnamespaced** — plugins can accidentally write to the same state
   keys as the host or other plugins. Convention can mitigate this (prefix keys with
   plugin name) but there is no enforcement.

3. **No formal plugin contract** — currently, each plugin (workflowPlugin, authPlugin)
   is independently authored with no shared base type. A formal `Plugin<Config>` type
   would enable typed plugin registries.

**Gains:**
- Works today, proven in production
- Supports dynamic mount paths (e.g., `/orgs/:orgSlug/workflows`)
- No BuildCache or island issues
- No global state conflicts
- Clean layout integration via `layoutWrapper`
- Low learning curve: plugins call familiar `app.get()`, `app.post()`, etc.

**Complexity:** LOW — formalize and document the existing pattern; optionally add a
`Plugin<Config>` type to `@fresh/core`.

**Shared state isolation:** Partial — routes are isolated by path, Effect runtimes are
isolated per-plugin, but `ctx.state` is still shared. Acceptable for the current
platform use case.

**Verdict:** The right choice for the current problem. The pattern is already validated
by the production codebase; the work is documentation, formalization, and potentially a
small `Plugin<Config>` type addition.

---

### Option C: Module Federation

**Technical obstacles:**

1. **Wrong layer** — MF solves browser-side code loading across deployment boundaries.
   Freak's problem is server-side route registration and island registry aggregation.
   MF does not help with either.

2. **Requires Vite** — Fresh 2 / Freak uses esbuild. Switching build tooling would
   require replacing the entire dev server, build pipeline, and island bundling system.

3. **Requires separate deployments** — MF remotes must be served from a URL accessible
   to the host at runtime. This means separate deployment artifacts per sub-app,
   defeating the intra-process composition model.

4. **No Deno-native support** — Deno has no built-in MF capability.

5. **SSR is unsupported** — MF's server-side rendering story is significantly more
   complex and less mature than its client-side story, especially for island-based SSR.

**Gains:** None that apply to the current problem. MF solves a different problem space.

**Complexity:** PROHIBITIVE — would require a full build pipeline replacement.

**Shared state isolation:** Not applicable — MF operates at a different layer.

**Verdict:** Not applicable to this problem. Remove from consideration.

---

### Comparison summary

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

## 7. Existing Guidance / Stack Conventions

**Source:** Direct inspection of production code in `workflows/src/plugin.ts`,
`authend/src/plugin.ts`, `platform/control-panel/main.ts`.

### The plugin pattern is the de facto standard in this stack

Both `@type-driven/workflows` and `@authend/plugin` implement the same pattern:
- Factory function: `pluginName(config): (app: App<unknown>) => PluginResult | void`
- Route registration via `app.get/post/all` with full prefixed paths
- Layout via `layoutWrapper` callback
- Effect runtime encapsulated inside the plugin (not exposed to host unless `exposeRuntime: true`)
- Signal handlers optionally registered by plugin (default: true; host can suppress with `registerSignalHandlers: false`)

This is not a coincidence — `authPlugin` was explicitly described as mirroring the
`workflowPlugin` pattern (`authend/src/plugin.ts`, line 1 comment: "Mirrors the
workflowPlugin pattern from @workflows").

### No CLAUDE.md or stack guide exists for this pattern

`/Users/davidpeter/workspace/type-driven.com/freak/CLAUDE.md` does not exist. There
are no `.planning`-level skill guides documenting the plugin pattern. The pattern
exists in production code but has not been documented as a formal convention.

### Planning implications

The planner should treat the workflowPlugin + authPlugin implementations as the
canonical reference implementation of the programmatic plugin pattern. Any formalization
work should align with this existing API surface.

---

## 8. Planning Recommendations

### Recommended architectural decision: Formalize the Programmatic Plugin Pattern

**Rationale:**
1. It works today in production (platform uses it with two plugins)
2. It solves the actual problems (dynamic mount paths, no BuildCache sharing, clean
   layout integration)
3. Module Federation is categorically wrong for this problem (server-side, not
   client-side; wrong build tooling; wrong deployment model)
4. Fixing mountApp requires significant build-system investment to solve a problem that
   the plugin pattern already avoids

**Decision to document:**
- `mountApp` is not deprecated but its scope is clarified: it works only for
  programmatically composed apps with static prefixes, no islands from sub-apps, no
  sub-app `appWrapper`, and no fs-routes. It is a utility for simple middleware
  composition, not a general sub-app mounting primitive.
- The programmatic plugin pattern is the supported composition model for sub-apps.
- `mountApp`'s known failure modes (BuildCache sharing, appWrapper leakage) should be
  documented as known limitations, not fixed in this phase.

**Items for the decision doc:**
1. Root cause analysis of mountApp failures (documented above in section 2)
2. Evidence that the platform already uses the plugin pattern, not mountApp (section 3)
3. Why MF is not applicable (section 4)
4. The plugin pattern as the recommended model, with canonical reference implementation
   from workflows + authend (sections 5–6)
5. Future work: if islands in plugins become a requirement, a merged BuildCache approach
   would be needed — that is a separate phase

### For the decision doc structure

Given the CONTEXT.md says "whatever makes the decision most durable as internal notes":

Recommended structure:
- Problem statement (what mountApp failures were observed and under what conditions)
- Root cause (4-5 bullets, each linked to specific code)
- Options evaluated (table from section 6 above)
- Decision (Plugin Pattern) with rationale
- What mountApp is still good for (simple cases)
- Reference implementations (workflowPlugin, authPlugin)
- What the plugin pattern does NOT solve (islands, fs-routes) and when that matters

### Open questions for follow-on phases

1. **Islands in plugins** — If a future plugin needs Preact islands (interactive client
   components), the current plugin pattern cannot support it. BuildCache aggregation
   would be required. This is a non-trivial follow-on.

2. **Plugin contract type** — A formal `Plugin<Config>` type in `@fresh/core` would
   improve discoverability and type safety. Currently undocumented; could be added as a
   small type export.

3. **ctx.state namespacing** — Plugins currently write to `ctx.state` without
   namespacing. Convention (prefix keys by plugin name) is sufficient for now but
   runtime enforcement (typed sub-state) would improve isolation for third-party plugins.

4. **Plugin authoring DX** — Scaffolding, documentation, and examples for third-party
   plugin authors are deferred per CONTEXT.md.

---

## Sources

### Primary (HIGH confidence)
- Direct source: `/packages/fresh/src/app.ts` — mountApp implementation
- Direct source: `/packages/fresh/src/commands.ts` — applyCommands, CommandType
- Direct source: `/packages/fresh/src/segments.ts` — _atomHydrationHook global, segmentToMiddlewares
- Direct source: `/packages/fresh/src/runtime/server/preact_hooks.ts` — RENDER_STATE global, islandRegistry lookup
- Direct source: `/packages/fresh/src/build_cache.ts` — BuildCache interface, islandRegistry, getFsRoutes
- Direct source: `/packages/fresh/src/context.ts` — ServerIslandRegistry, Context class
- Direct source: `/Users/davidpeter/workspace/type-driven.com/workflows/src/plugin.ts` — workflowPlugin
- Direct source: `/Users/davidpeter/workspace/type-driven.com/workflows/src/dashboard/app.ts` — createDashboardApp (why mountApp was avoided)
- Direct source: `/Users/davidpeter/workspace/type-driven.com/authend/src/plugin.ts` — authPlugin
- Direct source: `/Users/davidpeter/workspace/type-driven.com/authend/src/ui/app.ts` — createAuthApp
- Direct source: `/Users/davidpeter/workspace/type-driven.com/platform/control-panel/main.ts` — production usage

### Secondary (MEDIUM confidence)
- WebFetch: `https://github.com/module-federation/vite#readme` — MF requirements (Vite-only, no Deno)
- WebSearch: "Module Federation Deno 2025 2026" — no evidence of Deno-native MF support
- WebSearch: "module federation vite esbuild 2025 micro-frontend" — confirmed MF requires Vite or Webpack/Rspack

---

## Metadata

**Confidence breakdown:**
- mountApp implementation: HIGH — read directly from source
- Root cause analysis: HIGH — derived from source code mechanics
- Platform usage evidence: HIGH — read directly from production source
- Module Federation feasibility: MEDIUM — official docs read, Deno-specific gaps noted
- Plugin pattern: HIGH — production code is authoritative

**Research date:** 2026-02-27
**Valid until:** 90 days (stable source code; MF ecosystem moves fast but decision impact is LOW)

---

## RESEARCH COMPLETE
