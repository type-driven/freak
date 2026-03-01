# Phase 15: Plugin Formal Type - Research

**Researched:** 2026-03-01
**Domain:** TypeScript interface design, JSR slow-types constraints, App<State> variance
**Confidence:** HIGH

## Summary

Phase 15 formalizes the plugin pattern that already works in Phase 14 by adding a `Plugin<Config, S, R>` interface and `createPlugin()` factory to `@fresh/core`. The research confirms all three success criteria are achievable with verified TypeScript type mechanics.

`App<State>` is **invariant** in `State` — this is a structural TypeScript property that emerges from the private `#getBuildCache`, `#commands`, and other private fields typed as `T<State>`. Because of this invariance, `mountApp(path, app: App<State>)` already rejects any `App<OtherState>` argument. A `Plugin<Config, S, R>` interface with `readonly app: App<S>` delegates all state-compatibility checking to the existing `mountApp` signature. No changes to `mountApp` are required.

The `R` type parameter is a **phantom type** in `Plugin<Config, S, R>` — it appears only in the type signature and is never imported from npm:effect. This makes the interface 100% safe for JSR publication in `@fresh/core`. Verified: adding `Plugin<>` and `createPlugin()` to `@fresh/core/src/mod.ts` and running `deno publish --dry-run` produces exactly 1 error (the pre-existing `FreshScripts` missing return type), no new errors. `createPlugin` can live in `@fresh/core` alongside the interface.

**Primary recommendation:** Define `Plugin<Config, S, R>` and `createPlugin()` in `packages/fresh/src/plugin.ts`, export from `src/mod.ts`. Add `mountApp(path, plugin: Plugin<Config, State, unknown>)` overload to `App<State>` and `EffectApp<State, AppR>`. Write PLUG-03 test using `@ts-expect-error` pattern from `types_test.ts`.

## Standard Stack

No new library dependencies are required. This phase is pure TypeScript interface design.

### Core
| Item | What it is | Why |
|------|-----------|-----|
| TypeScript phantom types | R parameter never referenced in value positions | Allows `R` to represent Effect requirements without importing Effect |
| `@ts-expect-error` directives | Type-error assertions in tests | Established pattern in this codebase (see `types_test.ts`, `rpc_types_test.ts`) |
| `expect-type` | Runtime type assertion library | Already in effect/deno.json for type shape tests |

### Files to Create/Modify
| File | Action | What |
|------|--------|------|
| `packages/fresh/src/plugin.ts` | Create | `Plugin<>` interface + `createPlugin()` factory |
| `packages/fresh/src/mod.ts` | Modify | Export `Plugin`, `createPlugin` |
| `packages/fresh/src/app.ts` | Modify | Add `mountApp(path, plugin: Plugin<Config, State, unknown>)` overload |
| `packages/effect/src/app.ts` | Modify | Add `mountApp(path, plugin: Plugin<Config, State, unknown>)` overload on EffectApp |
| `packages/examples/typed-composition/counter_plugin.tsx` | Modify | Use `createPlugin()`, return `Plugin<Config, S, R>` |
| `packages/examples/typed-composition/integration_test.ts` | Modify | Add PLUG-03 type error test |

**Installation:** No new packages.

## Architecture Patterns

### Plugin Interface Design
```typescript
// Source: verified by probe in packages/fresh/src/plugin_test_stub.ts
// packages/fresh/src/plugin.ts

import type { App } from "./app.ts";

/**
 * A typed plugin that provides routes for mounting into a host App.
 *
 * Type parameters:
 * - Config: The configuration object the plugin factory accepts
 * - S: The host state shape the plugin requires (must match host App<S>)
 * - R: Effect service requirements (phantom type — never imported from npm:effect)
 *
 * The R parameter is a phantom — it only exists in the type system to document
 * what Effect services the plugin's handlers require from the host EffectApp layer.
 * It is NEVER used at runtime and does NOT import from npm:effect.
 */
// deno-lint-ignore no-explicit-any
export interface Plugin<Config = unknown, S = unknown, R = any> {
  readonly config: Config;
  readonly app: App<S>;
}

/**
 * Create a typed plugin from a config object and an App builder function.
 *
 * @param config Plugin configuration object passed to the factory
 * @param factory Function receiving config, returns the plugin's App<S>
 * @returns Plugin<Config, S, R>
 */
export function createPlugin<Config, S, R = never>(
  config: Config,
  factory: (config: Config) => App<S>,
): Plugin<Config, S, R> {
  return { config, app: factory(config) };
}
```

### mountApp Overloads on App<State>
```typescript
// packages/fresh/src/app.ts — add overload signatures

// Existing:
mountApp(path: string, app: App<State>): this;

// New overload (add BEFORE existing overload):
mountApp<Config, R>(path: string, plugin: Plugin<Config, State, R>): this;

// Implementation (delegates to plugin.app):
mountApp<Config, R>(
  path: string,
  appOrPlugin: App<State> | Plugin<Config, State, R>,
): this {
  const inner = "app" in appOrPlugin ? appOrPlugin.app : appOrPlugin;
  // existing mountApp body with `inner` instead of `app`
}
```

### mountApp Overloads on EffectApp<State, AppR>
```typescript
// packages/effect/src/app.ts — EffectApp.mountApp

// Import Plugin type from @fresh/core
import type { Plugin } from "@fresh/core";

// Existing:
mountApp(path: string, app: App<State>): this;

// New overload:
mountApp<Config, PluginR>(path: string, plugin: Plugin<Config, State, PluginR>): this;

// Implementation:
mountApp<Config, PluginR>(
  path: string,
  appOrPlugin: App<State> | Plugin<Config, State, PluginR>,
): this {
  const inner = "app" in appOrPlugin ? appOrPlugin.app : appOrPlugin;
  this.#app.mountApp(path, inner);
  return this;
}
```

### Counter Plugin with createPlugin
```typescript
// packages/examples/typed-composition/counter_plugin.tsx
import { createPlugin } from "@fresh/core";
import type { Plugin } from "@fresh/core";
import type { ServiceMap } from "effect"; // only in @fresh/effect consumers

export interface CounterPluginConfig {
  prefix?: string;
}

// R is CounterService identifier — phantom type, not imported by @fresh/core
export function createCounterPlugin<S = unknown, R = never>(): Plugin<CounterPluginConfig, S, R> {
  return createPlugin<CounterPluginConfig, S, R>(
    {},
    (_config) => {
      const app = new App<S>();
      app.get("/count", (ctx) => runEffect(ctx, ...));
      // ...
      return app;
    }
  );
}
```

### PLUG-03 Type Error Test Pattern
```typescript
// packages/examples/typed-composition/integration_test.ts
// Uses @ts-expect-error directive — same pattern as types_test.ts

Deno.test("PLUG-03: mounting plugin with incompatible state type is a type error", () => {
  const plugin = createPlugin<{}, { count: number }>(
    {},
    () => new App<{ count: number }>(),
  );

  const host = new App<{ name: string }>();
  // @ts-expect-error — Plugin<{}, { count: number }, never> is not assignable
  // to Plugin<{}, { name: string }, unknown> (state type mismatch)
  host.mountApp("/bad", plugin);

  // Test passes when deno check confirms the @ts-expect-error fires.
  // If the error is NOT raised, deno check fails with "Unused @ts-expect-error".
});
```

### Recommended Project Structure
```
packages/fresh/src/
├── plugin.ts           # NEW: Plugin<Config,S,R> interface + createPlugin()
├── mod.ts              # +export Plugin, createPlugin
└── app.ts              # +mountApp overload accepting Plugin<>

packages/examples/typed-composition/
├── counter_plugin.tsx  # Updated: use createPlugin(), typed R
└── integration_test.ts # +PLUG-03 type error test
```

### Anti-Patterns to Avoid
- **Importing Effect types in Plugin interface:** `R` must be a plain unconstrained generic, never `Layer.Layer<R>` or any Effect import in `@fresh/core`. Phantom type means NO `extends` constraint on R.
- **Requiring EffectApp.mountApp instead of App.mountApp:** The `mountApp(plugin)` overload belongs on the base `App<State>` class first. EffectApp delegates via `this.#app.mountApp()`.
- **`App<unknown>` as "compatible with everything":** `App<unknown>` is NOT assignable to `App<{ name: string }>` — invariance blocks it. Do not document `createPlugin<Config, unknown>` as a general solution for "any host." Document `createPlugin<Config, S>` where `S` matches the target host.
- **Implementing the overload with a type cast:** The implementation body can use `"app" in appOrPlugin` to discriminate the union at runtime — this is zero-cost and avoids any `as any`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State compatibility checking | Custom validation logic | TypeScript's existing App<State> invariance | Already works — verified by variance probe |
| Plugin registry/catalog | Central plugin map/registry | Direct `host.mountApp("/prefix", plugin)` | Overkill; composition is just mounting at a path |
| Effect service validation at mountApp | Runtime check for R requirements | Document via phantom type + EffectApp layer | Enforced by EffectApp's `AppR` type at createEffectApp time, not at mountApp |

## Common Pitfalls

### Pitfall 1: R Phantom Type in @fresh/core vs @fresh/effect
**What goes wrong:** Developer adds `R extends SomeEffectType` constraint on Plugin interface in @fresh/core, importing from npm:effect. JSR slow-types checker flags it.
**Why it happens:** Wanting type safety for R while keeping the interface in @fresh/core.
**How to avoid:** Keep R as an unconstrained phantom: `interface Plugin<Config, S, R>`. R's constraint is enforced by EffectApp's `AppR` type at `createEffectApp<State, AppR>()` call site — not at `mountApp`.
**Warning signs:** Any import of `npm:effect` in `packages/fresh/src/plugin.ts` is wrong.

### Pitfall 2: mountApp Overload Implementation with Private Field Access
**What goes wrong:** The `mountApp` implementation accesses `app.#commands` (private field). Adding an overload that accepts `Plugin<>` means the implementation body must handle both union members, but private field syntax prevents `plugin.app.#commands` outside the class.
**Why it happens:** `#commands` is a private field on App — accessible only inside the class body.
**How to avoid:** The overload implementation extracts `plugin.app` first (`const inner = "app" in appOrPlugin ? appOrPlugin.app : appOrPlugin`), then passes `inner` through the existing private-field path. Both branches end up as `App<State>` before hitting the private field logic.
**Warning signs:** TS error "Property '#commands' is not accessible outside class 'App'" in overload implementation.

### Pitfall 3: `unknown` Host State Breaks the SC-3 Test
**What goes wrong:** Developer writes `new App<unknown>()` as the host in the PLUG-03 type error test. Because `App<unknown>` has `State = unknown`, and `unknown` does not conflict with `{ count: number }` from TypeScript's perspective in some positions, the `@ts-expect-error` may not fire.
**Why it happens:** Variance probe showed `App<unknown>` IS rejected by `mountApp` on a typed host — but `new App<unknown>().mountApp("/", plugin_with_unknown_state)` would NOT reject (both are unknown). Use a concrete typed host (`App<{ name: string }>`) in the PLUG-03 test.
**How to avoid:** Always use two concrete incompatible types for the PLUG-03 test, e.g. `App<{ name: string }>` vs plugin typed to `{ count: number }`.

### Pitfall 4: EffectApp.mountApp Must Import Plugin type
**What goes wrong:** `Plugin` is defined in `@fresh/core` but EffectApp needs `Plugin` in its `mountApp` overload signature. If the import is missing or uses a wrong path, the type isn't available.
**Why it happens:** EffectApp lives in `@fresh/effect`, which imports from `@fresh/core` via JSR. The import path is `import type { Plugin } from "@fresh/core"`.
**How to avoid:** Add `import type { Plugin } from "@fresh/core"` to `packages/effect/src/app.ts`. This is a `type`-only import so it doesn't affect the runtime bundle.

### Pitfall 5: createPlugin Return Type and Slow Types
**What goes wrong:** `createPlugin` has an implicit return type in some configurations. JSR's slow-types checker requires explicit return types on all exported functions in the public API.
**Why it happens:** `return { config, app: factory(config) }` — TypeScript infers the return type but JSR requires it to be explicit.
**How to avoid:** Annotate: `): Plugin<Config, S, R> {`. Verified: `createPlugin` with explicit return type `Plugin<Config, S, R>` passes `deno publish --dry-run` with no new errors.

## Code Examples

Verified patterns from probe files:

### Current mountApp variance (no change needed for basic typing)
```typescript
// Source: variance_probe.ts probe result (HIGH confidence — verified by deno check)

const host = new App<{ name: string }>();
const compatible = new App<{ name: string }>();
host.mountApp("/ok", compatible);          // OK — exact state match

const incompatible = new App<{ count: number }>();
host.mountApp("/bad", incompatible);       // TS2345 — state type mismatch
// Error: Argument of type 'App<{ count: number; }>' is not assignable to
// parameter of type 'App<{ name: string; }>'
```

### Plugin interface type error at mount site
```typescript
// Source: plugin_interface_probe.ts probe (HIGH confidence — verified by deno check)

const plugin = createPlugin<{}, { name: string }, CounterServiceR>(
  {},
  () => new App<{ name: string }>()
);

const goodHost = new App<{ name: string }>();
goodHost.mountApp("/counter", plugin.app);  // OK

const badHost = new App<{ email: string }>();
badHost.mountApp("/counter", plugin.app);   // TS2345 — state mismatch
```

### Plugin overload on extended App class
```typescript
// Source: plugin_overload_probe.ts probe (HIGH confidence — verified by deno check)

class AppWithPluginMount<State> extends App<State> {
  mountPlugin<Config, R>(path: string, plugin: Plugin<Config, State, R>): this {
    this.mountApp(path, plugin.app);
    return this;
  }
}

host.mountPlugin("/good", goodPlugin);  // OK
host.mountPlugin("/bad", badPlugin);    // TS2345 — Plugin state mismatch
```

### @ts-expect-error pattern for type-error tests
```typescript
// Source: packages/effect/tests/types_test.ts (HIGH confidence — established pattern)

Deno.test("PLUG-03: type error at mount site", () => {
  // @ts-expect-error — state type mismatch caught at mount site
  host.mountApp("/bad", plugin_with_wrong_state);
  // If TS does NOT raise an error, deno check fails:
  // "error[TS2578]: Unused '@ts-expect-error' directive."
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `createCounterPlugin<S>(): App<S>` (Phase 14) | `createPlugin<Config, S, R>(): Plugin<Config, S, R>` | Phase 15 | Formal interface with phantom R for Effect service documentation |
| `host.mountApp("/prefix", plugin)` with raw App<S> | `host.mountApp("/prefix", plugin)` with Plugin<Config, S, R> overload | Phase 15 | Single mount call works whether passing App or Plugin |
| No formal type for plugin | `Plugin<Config, S, R>` exported from `@fresh/core` | Phase 15 | Type documentation for ecosystem |

## Open Questions

1. **mountApp overload implementation: union discrimination**
   - What we know: `"app" in appOrPlugin` narrows the union at runtime
   - What's unclear: whether TypeScript correctly narrows `Plugin<Config, State, R> | App<State>` through the `"app" in` check — `App<State>` does not have a public `app` property, so this should work
   - Recommendation: Probe `"app" in appOrPlugin` narrowing in a small test before implementing

2. **Whether R phantom should use `_r?: R` or nothing**
   - What we know: `_r?: R` makes R structurally visible; an empty interface with R in generic position may cause type erasure concerns
   - What's unclear: whether TypeScript erases unused generic params that appear nowhere in the type body
   - Recommendation: Use `readonly _phantom?: R` — makes R nominally visible to the type system, clearly marks it as phantom (not runtime data)

3. **Export location for createPlugin**
   - What we know: JSR allows it in `@fresh/core` (no Effect imports needed). The factory is simple enough for `@fresh/core`.
   - What's unclear: whether @fresh/effect consumers should get `createPlugin` from `@fresh/core` or a re-export from `@fresh/effect`
   - Recommendation: Export from `@fresh/core` only. Users doing Effect plugins import `createPlugin` from `@fresh/core` and use Effect types in `R` without any issue — R is just a generic.

## Sources

### Primary (HIGH confidence)
- Variance probe: `packages/fresh/variance_probe.ts` (created and verified with `deno check`) — confirms App<State> invariance
- Plugin interface probe: `packages/fresh/plugin_interface_probe.ts` (created and verified) — confirms Plugin<Config,S,R> in @fresh/core without Effect import works and type error fires
- Plugin overload probe: `packages/fresh/plugin_overload_probe.ts` (verified) — confirms Plugin-accepting mountPlugin overload fires correct type error
- `deno publish --dry-run` (run from packages/fresh/) — confirms Plugin export adds 0 new errors (1 pre-existing FreshScripts error unchanged)
- Source files directly inspected: `app.ts`, `mod.ts`, `handlers.ts`, `internals.ts`, `effect/src/app.ts`, `effect/src/hydration.ts`
- Phase 14 summary/plan: `14-typed-app-composition/14-01-SUMMARY.md` — confirms WeakMap state design complete

### Secondary (MEDIUM confidence)
- `packages/effect/tests/types_test.ts` — established `@ts-expect-error` test pattern for PLUG-03
- `packages/effect/tests/rpc_types_test.ts` — confirms pattern works for type-level test SCs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, only TypeScript mechanics
- Architecture: HIGH — verified by 3 deno check probes with concrete type errors
- Pitfalls: HIGH — sourced from actual TypeScript error messages from probes
- JSR constraint: HIGH — verified by deno publish --dry-run with Plugin added to exports

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stable TypeScript mechanics, no fast-moving dependencies)
