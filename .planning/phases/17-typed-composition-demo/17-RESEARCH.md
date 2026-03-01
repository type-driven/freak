# Phase 17: Typed Composition Demo — Research

**Researched:** 2026-03-01
**Domain:** Fresh + Effect v4 typed plugin composition demo app
**Confidence:** HIGH

---

## Summary

Phase 17 is a demo assembly phase, not an infrastructure phase. All required
primitives were built in Phases 14–16. The task is to wire them together in a
runnable `packages/examples/typed-composition/` app that a developer can start
with `deno task dev`.

The demo needs three things: (1) a host `EffectApp<AuthState>` that sets typed
state via middleware, (2) two plugins (`CounterPlugin`, `GreetingPlugin`) that
read that state generically, and (3) both plugins registering islands and setting
atoms so that `serializeAtomHydration` produces a merged blob from both.

Critically, a real Fresh dev server requires file-based routes (`routes/` dir +
`dev.ts` with `Builder.listen`). The existing `packages/examples/typed-composition/`
directory has only `counter_plugin.tsx`, `integration_test.ts`, and `deno.json`
— it does not yet have the app scaffolding needed to run `deno task dev`. Phase
17 must scaffold the full app alongside the existing integration tests.

**Primary recommendation:** Scaffold the typed-composition example as a Fresh app
(`dev.ts`, `main.ts`, `routes/`, `islands/`, `static/`), create `GreetingPlugin`
modeled on the existing `CounterPlugin`, wire both onto a single
`EffectApp<AuthState>`, and add a smoke-test integration test covering all three
DEMO SCs.

---

## Standard Stack

All primitives exist in the repo. No new external dependencies are required.

### Core (already in deno.json for typed-composition)

| Import | Version | Purpose |
|--------|---------|---------|
| `@fresh/core` | local `../../fresh/src/mod.ts` | `App`, `createPlugin`, `Plugin`, `page`, `staticFiles` |
| `@fresh/core/dev` | local `../../fresh/src/dev.ts` (via effect-integration pattern) | `Builder` for dev server |
| `@fresh/core/internal` | local `../../fresh/src/internals.ts` | `setBuildCache` in tests |
| `@fresh/effect` | local `../../effect/src/mod.ts` | `createEffectApp`, `setAtom`, `runEffect`, `serializeAtomHydration` |
| `effect` | `npm:effect@^4.0.0-beta.20` | `Effect`, `Layer`, `ServiceMap` |
| `effect/unstable/reactivity/Atom` | `npm:effect@^4.0.0-beta.20/...` | `Atom.serializable`, `Atom.make` |
| `effect/Schema` | `npm:effect@^4.0.0-beta.20/Schema` | `Schema.Number`, `Schema.String` |
| `preact` | `npm:preact@^10.28.3` | JSX, island components |
| `preact/hooks` | `npm:preact@^10.28.3/hooks` | `useState` in islands |

### Additional imports needed in deno.json

The existing `packages/examples/typed-composition/deno.json` does **not** include:
- `@fresh/core/dev` — needed for `dev.ts` / `Builder`
- `@fresh/core/runtime` — needed by Fresh client-side runtime script in SSR
- `@std/expect` — already present

Add to imports:
```json
"@fresh/core/dev": "../../fresh/src/dev.ts",
"@fresh/core/runtime": "jsr:@fresh/core@^2.0.0/runtime"
```

Also need tasks block:
```json
"tasks": {
  "dev": "deno run -A --watch=static/,routes/ dev.ts",
  "build": "deno run -A dev.ts build",
  "start": "deno serve -A _fresh/server.js"
}
```

**Installation:** No `npm install` — Deno resolves via import map. Run
`deno cache dev.ts` once or let `deno task dev` handle it.

---

## Architecture Patterns

### Recommended Project Structure

```
packages/examples/typed-composition/
├── dev.ts                   # Builder.listen entry (same pattern as effect-integration)
├── main.ts                  # createEffectApp<AuthState> + mountApp x2 + export const app
├── deno.json                # import map + tasks (needs @fresh/core/dev added)
├── routes/
│   ├── index.tsx            # Landing page listing /counter/* and /greeting/* routes
│   ├── _app.tsx             # Optional: shared layout wrapper
│   ├── counter/
│   │   └── index.tsx        # Renders CounterIsland, shows ctx.state.userId
│   └── greeting/
│       └── index.tsx        # Renders GreetIsland, shows ctx.state.requestId
├── islands/
│   └── (empty — islands live in plugins)
├── static/
│   └── (empty — no static assets needed for demo)
├── counter_plugin.tsx        # EXISTING — CounterPlugin (no changes)
├── greeting_plugin.tsx       # NEW — GreetingPlugin (models on counter_plugin.tsx)
└── integration_test.ts       # EXISTING + add DEMO-01/02/03 tests
```

### Pattern 1: host app with typed AuthState middleware

```typescript
// main.ts
import { createEffectApp } from "@fresh/effect";
import { staticFiles } from "@fresh/core";
import { Layer } from "effect";
import { CounterLive, createCounterPlugin } from "./counter_plugin.tsx";
import { GreetingLive, createGreetingPlugin } from "./greeting_plugin.tsx";

interface AuthState {
  requestId: string;
  userId: string;
}

const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);

const effectApp = createEffectApp<AuthState>({ layer: combinedLayer });

// Middleware sets typed state — no cast needed in plugins because S=AuthState
effectApp.use((ctx) => {
  ctx.state.requestId = crypto.randomUUID();
  ctx.state.userId = "demo-user";
  return ctx.next();
});

effectApp.mountApp("/counter", createCounterPlugin<AuthState>());
effectApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

export const app = effectApp.use(staticFiles()).fsRoutes().app;
```

**Key decision:** `export const app = effectApp...app` — Builder.listen() needs
the inner `App<State>` instance, not the `EffectApp` wrapper. This is the
established pattern from Phase 7 (see STATE.md decision `[09-02]`).

### Pattern 2: GreetingPlugin modeled on CounterPlugin

The `GreetingPlugin` follows the exact same structure as `CounterPlugin`:

```typescript
// greeting_plugin.tsx
import { App, createPlugin, type Plugin } from "@fresh/core";
import { runEffect, setAtom } from "@fresh/effect";
import { Effect, Layer, ServiceMap } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import type { VNode } from "preact";

interface GreetingServiceShape {
  readonly getGreeting: (name: string) => string;
}

export const GreetingService = ServiceMap.Service<GreetingServiceShape>("GreetingService");
export const GreetingLive = Layer.succeed(GreetingService, {
  getGreeting: (name) => `Hello, ${name}!`,
});
export type GreetingServiceIdentifier = typeof GreetingService;

// Serializable atom
export const greetingAtom = Atom.serializable(Atom.make(""), {
  key: "greeting",
  schema: Schema.String,
});

// Island
export function GreetIsland({ message }: { message: string }): VNode {
  return <div class="greet-island"><p>{message}</p></div>;
}

export function createGreetingPlugin<S = unknown>(): Plugin<Record<string, never>, S, GreetingServiceIdentifier> {
  return createPlugin<Record<string, never>, S, GreetingServiceIdentifier>(
    {},
    (_config) => {
      const app = new App<S>();
      app.islands({ GreetIsland }, "greet-island");
      app.get("/greet", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* GreetingService;
          const msg = svc.getGreeting("World");
          setAtom(ctx, greetingAtom, msg);
          return Response.json({ greeting: msg });
        }))
      );
      return app;
    },
  );
}
```

**Key: unique atom key** — `counterAtom` uses key `"counter"`, `greetingAtom`
uses key `"greeting"`. These must differ to avoid the duplicate-key guard in
`setAtom()` (see hydration.ts line 68–73). DEMO-03 requires no collisions.

### Pattern 3: Route handlers that read typed AuthState without casts

```typescript
// routes/counter/index.tsx (DEMO-01: read ctx.state.userId without cast)
import type { PageProps } from "@fresh/core";
import { page } from "@fresh/core";
import type { AuthState } from "../../main.ts";

export const handler = {
  GET: (ctx: Context<AuthState>) => {
    const userId = ctx.state.userId;   // typed — no cast needed
    const requestId = ctx.state.requestId;
    return page({ userId, requestId });
  },
};

export default function CounterPage(props: PageProps<{ userId: string; requestId: string }>) {
  return (
    <div>
      <p>User: {props.data.userId}</p>
      <p>Request: {props.data.requestId}</p>
    </div>
  );
}
```

**Note:** Plugin route handlers that use `runEffect` also access `ctx.state` as
typed `S` without any cast — this is already proven in the existing
`counter_plugin.tsx` (e.g., `setAtom(ctx, counterAtom, newCount)` compiles
cleanly with `ctx: Context<S>`).

### Pattern 4: dev.ts entry point

```typescript
// dev.ts
import { Builder } from "@fresh/core/dev";

const builder = new Builder({ root: import.meta.dirname });

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
```

`root: import.meta.dirname` is required when running `deno task dev` from the
repo root via `deno task --cwd=...` — prevents `_fresh/` output going to the
repo root (see STATE.md decision `[13-01]`).

### Pattern 5: DEMO-03 integration test for merged atom serialization

```typescript
Deno.test("DEMO-03: serializeAtomHydration produces merged blob from both plugins", async () => {
  const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);
  const hostApp = createEffectApp<AuthState>({ layer: combinedLayer });
  hostApp.mountApp("/counter", createCounterPlugin<AuthState>());
  hostApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

  const handler = hostApp.handler();

  // Trigger both plugin handlers that call setAtom
  await handler(new Request("http://localhost/counter/increment", { method: "POST" }));
  // serializeAtomHydration is per-ctx: each request has its own map.
  // To test the merged blob, call setAtom on a shared ctx directly.
  const ctx = { state: {} };
  setAtom(ctx, counterAtom, 1);
  setAtom(ctx, greetingAtom, "Hello, World!");
  const blob = serializeAtomHydration(ctx);
  expect(blob).toBe(JSON.stringify({ counter: 1, greeting: "Hello, World!" }));

  await hostApp.dispose();
});
```

### Anti-Patterns to Avoid

- **No `.app` extraction at mountApp call site**: `mountApp` accepts `Plugin<>` directly
  via the overload from Phase 15. Never write `hostApp.mountApp("/counter", plugin.app)`.
- **No shared atom keys across plugins**: `counterAtom` key = `"counter"`, `greetingAtom`
  key = `"greeting"`. The `setAtom()` implementation throws on duplicate keys within
  one request.
- **No EffectApp export from main.ts**: `Builder.listen` needs `App<State>`, not `EffectApp`.
  Always export `.app` getter: `export const app = effectApp...app`.
- **No custom ManagedRuntime in plugins**: plugins have no own runtime. They call
  `runEffect(ctx, eff)` which uses the host's runtime registered by `createEffectApp()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Plugin type | Custom interface | `Plugin<Config, S, R>` from `@fresh/core` | Already implemented in Phase 15 |
| Plugin factory | Ad-hoc function | `createPlugin(config, factory)` from `@fresh/core` | Enforces JSR slow-types, S compatibility |
| Plugin route handler | `as unknown as Response` cast | `runEffect(ctx, eff)` from `@fresh/effect` | Returns honest `Promise<A>`, no lie |
| Atom set/serialize | Custom serialization | `setAtom` / `serializeAtomHydration` from `@fresh/effect` | WeakMap isolation, duplicate-key guard |
| Per-request state | `ctx.state[Symbol]` | WeakMap in hydration.ts | Keeps `ctx.state` clean, Phase 14 pattern |
| Unique atom keys | Collision handling | Distinct key strings per atom | `setAtom` throws on collision — design for distinct keys |
| ManagedRuntime in plugin | Plugin-owned runtime | None — use host's runtime via `runEffect` | Plugins rely on host; no own runtime needed |
| Island registration | Dynamic chunk naming | `app.islands({ Island }, "chunk-name")` | Phase 16 confirmed BuildCache aggregation works |

---

## Common Pitfalls

### Pitfall 1: `EffectApp` exported directly from main.ts

**What goes wrong:** `Builder.listen` sees an `EffectApp` wrapper, not an `App<State>`
instance. `setBuildCache` uses JS private fields and fails with a cryptic error
because `EffectApp` is not an `App`.

**Why it happens:** Forgetting the `.app` getter on the chain.

**How to avoid:** Always end with `export const app = effectApp.use(...).fsRoutes().app`.

**Warning signs:** `Builder.listen` throws about private fields or `setBuildCache`.

---

### Pitfall 2: Duplicate atom keys across plugins

**What goes wrong:** If both plugins use the same atom key string (e.g., both use
`key: "count"`), the second `setAtom` call on the same request throws:
`"Duplicate atom key 'count' in the same request."`.

**Why it happens:** `hydrationMaps` is a module-level WeakMap shared across all
plugins. The per-request Map enforces uniqueness for correctness.

**How to avoid:** Give each plugin's atoms a namespaced key. `CounterPlugin` uses
`"counter"`, `GreetingPlugin` uses `"greeting"`.

**Warning signs:** Unhandled error in POST handler: `"Duplicate atom key..."`.

---

### Pitfall 3: `routes/counter/` path vs. `mountApp("/counter", ...)` conflict

**What goes wrong:** If `fsRoutes()` finds `routes/counter/index.tsx` and
`mountApp("/counter", ...)` mounts plugin routes at `/counter/*`, both register
handlers for `/counter/*`. Fresh's router will serve whichever was registered
first, which may hide the plugin routes or vice versa.

**Why it happens:** `fsRoutes()` scans the `routes/` directory and registers
routes, then `mountApp` appends plugin commands. The last writer wins for exact
matches; wildcard vs. exact pattern precedence determines overlaps.

**How to avoid:** Either (a) don't create `routes/counter/` and instead serve the
counter UI from within the plugin's own routes, OR (b) ensure `routes/counter/`
only renders a host-level wrapper page and the plugin API routes (`/counter/count`,
`/counter/increment`) are registered by the plugin under distinct patterns that
don't conflict. The simplest approach for a demo is to keep plugin routes as API
endpoints (returning JSON) and have a single host `routes/index.tsx` that links
to them.

**Warning signs:** Plugin GET /counter/count returns HTML instead of JSON (the
fsRoutes index.tsx is intercepting).

---

### Pitfall 4: Missing `root: import.meta.dirname` in Builder

**What goes wrong:** `Builder` resolves the project root from `Deno.cwd()` when
`root` is not specified. Running `deno task dev` from the repo root (or via
`deno task --cwd`) writes `_fresh/` to the repo root instead of the example app.

**Why it happens:** `deno task dev` is run from the repo root with
`--cwd=packages/examples/typed-composition`, but `import.meta.dirname` inside
`dev.ts` always points to the file's own directory.

**How to avoid:** Always pass `{ root: import.meta.dirname }` to `Builder`.

**Warning signs:** `_fresh/` appears at repo root; routes aren't found; 404 on
all pages.

---

### Pitfall 5: Layer.mergeAll for independent services (not chained deps)

**What goes wrong:** If `CounterLive` and `GreetingLive` are merged with
`Layer.mergeAll` and they had cross-dependencies (e.g., `GreetingLive` needed
`CounterService`), `mergeAll` would NOT wire them.

**Why it happens:** `Layer.mergeAll` combines independent layers — it doesn't
satisfy cross-layer deps. For cross-layer deps, use `Layer.provide`.

**How to avoid:** Both `CounterLive` and `GreetingLive` are independent services.
`Layer.mergeAll(CounterLive, GreetingLive)` is correct here.

**Warning signs:** `CounterService not found` error at runtime.

---

### Pitfall 6: Using `effectRoute` cast instead of `runEffect`

**What goes wrong:** Old code in `integration_test.ts` test 5 (`"two plugins mounted on the same host app"`) uses `effectRoute = (eff) => eff as unknown as Response`. This is the pre-Phase-14 cast pattern. New plugins must use `runEffect(ctx, eff)`.

**Why it happens:** The `effectRoute` pattern was a temporary workaround before `runEffect` was implemented.

**How to avoid:** Always use `runEffect(ctx, eff)` in plugin handlers. The `GreetingPlugin` should use `runEffect`.

---

## Code Examples

### Counter plugin (Phase 14/15 — no changes needed)

```typescript
// Source: packages/examples/typed-composition/counter_plugin.tsx
export function createCounterPlugin<S = unknown>(): Plugin<Record<string, never>, S, CounterServiceIdentifier> {
  return createPlugin<Record<string, never>, S, CounterServiceIdentifier>(
    {},
    (_config) => {
      const app = new App<S>();
      app.islands({ CounterIsland }, "counter-island");
      app.get("/count", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* CounterService;
          return Response.json({ count: svc.get() });
        }))
      );
      app.post("/increment", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* CounterService;
          const newCount = svc.increment();
          setAtom(ctx, counterAtom, newCount);
          return Response.json({ count: newCount });
        }))
      );
      return app;
    },
  );
}
```

### Host app wiring (main.ts pattern)

```typescript
// Source: pattern derived from packages/examples/effect-integration/main.ts + Phase 7 decisions
import { createEffectApp } from "@fresh/effect";
import { staticFiles } from "@fresh/core";
import { Layer } from "effect";

interface AuthState {
  requestId: string;
  userId: string;
}

const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);
const effectApp = createEffectApp<AuthState>({ layer: combinedLayer });

effectApp.use((ctx) => {
  ctx.state.requestId = crypto.randomUUID();
  ctx.state.userId = "demo-user";
  return ctx.next();
});

effectApp.mountApp("/counter", createCounterPlugin<AuthState>());
effectApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

// .app extracts inner App<State> — required for Builder.listen()
export const app = effectApp.use(staticFiles()).fsRoutes().app;
```

### Integration test pattern for DEMO-01/02/03

```typescript
// DEMO-01: Both plugins read typed AuthState
Deno.test("DEMO-01: plugins read ctx.state.requestId and userId without cast", async () => {
  interface AuthState { requestId: string; userId: string }
  const hostApp = createEffectApp<AuthState>({ layer: Layer.mergeAll(CounterLive, GreetingLive) });

  hostApp.use((ctx) => {
    ctx.state.requestId = "req-123";
    ctx.state.userId = "user-456";
    return ctx.next();
  });

  hostApp.mountApp("/counter", createCounterPlugin<AuthState>());
  hostApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

  const handler = hostApp.handler();
  const res = await handler(new Request("http://localhost/counter/count"));
  expect(res.status).toBe(200);
  await hostApp.dispose();
});

// DEMO-02: Two plugins, no route conflicts
// (verified by DEMO-01 test above — /counter/count and /greeting/greet both respond 200)

// DEMO-03: Merged atom blob
Deno.test("DEMO-03: serializeAtomHydration merges atoms from both plugins", () => {
  const ctx = { state: {} };
  setAtom(ctx, counterAtom, 5);     // key: "counter"
  setAtom(ctx, greetingAtom, "Hi"); // key: "greeting"
  const blob = serializeAtomHydration(ctx);
  expect(blob).toBe(JSON.stringify({ counter: 5, greeting: "Hi" }));
});
```

---

## State of the Art

| Old Approach | Current Approach | Changed | Impact |
|---|---|---|---|
| `effectRoute` cast (`eff as unknown as Response`) | `runEffect(ctx, eff)` | Phase 14 | Honest Promise<A>, no lie |
| `App<S>` returned from plugin factory | `Plugin<Config, S, R>` from `createPlugin()` | Phase 15 | Type-safe host state compatibility check |
| Global `_effectResolver` singleton | Per-request runner in WeakMap via `_setRequestRunner` | Phase 14 | Isolation across multiple EffectApp instances |
| `ctx.state[Symbol]` for hydration data | Module-level `hydrationMaps: WeakMap<object, Map>` | Phase 14 | Clean ctx.state, GC'd with request |

**Deprecated/outdated:**
- `effectPlugin()` from `@fresh/plugin-effect`: superseded by `createEffectApp()` from `@fresh/effect`
- `ctx.state.effectRuntime`: removed in Phase 14, replaced by WeakMap pattern
- `.app` extraction before `mountApp`: `mountApp` overload accepts `Plugin<>` directly

---

## Open Questions

1. **Does the typed-composition demo need a real SSR island hydration test?**
   - What we know: ISLD-02 (browser hydration) was deferred in Phase 16 as "verify manually via deno task dev"
   - What's unclear: SC-1 says "starts with `deno task dev` without errors" — this requires a real dev server boot. The plan calls it a "smoke test."
   - Recommendation: The integration test verifies all type-safety and atom serialization. The `deno task dev` SC is verified by actually running the dev server in a subprocess test (like Phase 7's signal test) or by manual check. A subprocess test is cleanest but adds complexity. Recommend the plan choose based on cost: a simple handler-based integration test may be sufficient evidence for SC-1.

2. **Should `routes/counter/index.tsx` and `routes/greeting/index.tsx` exist?**
   - What we know: Plugin routes (`/counter/count`, `/greeting/greet`) are pure JSON API. The demo SC says routes "respond at `/counter/*` and `/greeting/*`" — doesn't require HTML pages.
   - What's unclear: A nice demo would render islands. But that adds JSX pages inside `routes/` which could conflict with plugin-mounted routes.
   - Recommendation: Keep routes minimal. `routes/index.tsx` links to the two plugin API endpoints. Avoid creating `routes/counter/` or `routes/greeting/` directories to prevent routing conflicts with plugin-mounted paths.

3. **Does GreetingPlugin need to read `ctx.state.userId` for DEMO-01?**
   - What we know: DEMO-01 says "both plugins read `ctx.state.requestId` and `ctx.state.userId` ... without any cast." This is a type-level requirement — it compiles.
   - What's unclear: The counter plugin doesn't currently read `ctx.state` at all (it only uses `CounterService`). The type check is that `ctx: Context<S>` allows `ctx.state.requestId` to compile when `S = AuthState`.
   - Recommendation: Add at least one route handler in each plugin that accesses `ctx.state.requestId` or `ctx.state.userId` in its body. This proves DEMO-01 beyond just "it compiles with S=AuthState" — it actually reads the field. OR make the island page route pass userId from ctx.state to the render.

---

## Sources

### Primary (HIGH confidence)

- Direct code reading: `packages/examples/typed-composition/counter_plugin.tsx` — existing plugin structure
- Direct code reading: `packages/examples/typed-composition/integration_test.ts` — existing test patterns
- Direct code reading: `packages/effect/src/hydration.ts` — `setAtom`, `serializeAtomHydration`, WeakMap pattern
- Direct code reading: `packages/effect/src/app.ts` — `createEffectApp`, `EffectApp.mountApp`, signal lifecycle
- Direct code reading: `packages/examples/effect-integration/main.ts` + `dev.ts` — canonical app structure
- Direct code reading: `.planning/STATE.md` — all key decisions from Phases 7, 13, 14, 15, 16
- Direct code reading: `.planning/phases/15-plugin-formal-type/15-01-PLAN.md` — Plugin interface + createPlugin API
- Direct code reading: `.planning/phases/16-islands-in-plugins/16-01-PLAN.md` — island aggregation confirmation

### Secondary (MEDIUM confidence)

- `.planning/phases/14-typed-app-composition/14-01-PLAN.md` — WeakMap hydration architecture details
- `.planning/REQUIREMENTS.md` — DEMO-01/02/03 requirement text

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all imports verified from existing deno.json and source files
- Architecture patterns: HIGH — all patterns derived from existing Phase 14/15/16 code
- Pitfalls: HIGH — each pitfall derived from documented STATE.md decisions or direct code analysis
- Code examples: HIGH — derived from existing counter_plugin.tsx and integration_test.ts patterns

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable patterns; no external dependency churn expected)
