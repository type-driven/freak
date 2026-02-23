# Phase 4: Atom Hydration - Research

**Researched:** 2026-02-23
**Domain:** Effect v4 Atom serialization, Fresh island hydration pipeline
**Confidence:** HIGH

## Summary

Phase 4 adds server-to-client atom value serialization. An atom value set in an
Effect route handler is serialized into the island's initial props and available
synchronously when the island boots on the client — no loading flash.

All three major sub-systems were examined at source level:

1. **AtomRegistry v4 source** — confirms `setSerializable(key, encoded)` and
   `Atom.serializable({ key, schema })` as the v4-native cross-boundary identity
   mechanism. The registry self-decodes pre-seeded serializable atoms on first
   `get()`.

2. **Fresh serialization pipeline** — Fresh already has an extensible
   `Stringifiers` type (server) and `CUSTOM_PARSER` object (client). Both are
   module-level objects that can be mutated by a plugin before `boot()` runs.

3. **Phase 3 island.ts** — the module-level `registry` singleton is the correct
   attach point for pre-seeded values. Client hydration must call
   `registry.setSerializable(key, encoded)` before any `useAtomValue()` render
   that would call `registry.get(atom)`.

**Primary recommendation:** Use `Atom.serializable({ key, schema })` for atom
identity. On the server, extract serializable atom values from `ctx.state` at
response time, serialize with plain `JSON.stringify()` after applying
`schema.encode()`, and embed as a separate JSON script tag. On the client,
parse that script tag before `boot()` and call `registry.setSerializable()` for
each key-value pair. The `useAtomValue` hook picks up the pre-seeded value
automatically because the registry's `ensureNode()` checks `preloadedSerializable`
on first access.

## Standard Stack

### Core (already in use — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect/unstable/reactivity/Atom` | 4.0.0-beta.0 | `Atom.serializable()`, `SerializableTypeId` | v4-native identity mechanism |
| `effect/unstable/reactivity/AtomRegistry` | 4.0.0-beta.0 | `registry.setSerializable(key, encoded)` | Decodes pre-seeded atoms on first `get()` |
| `@fresh/core` jsonify/stringify.ts | 2.2.1 | `Stringifiers` type; `stringify(data, custom)` | Existing Fresh serialization pipe |
| `@fresh/core` jsonify/parse.ts | 2.2.1 | `CustomParser` type; `parse(str, custom)` | Existing Fresh deserialization pipe |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `effect` `Schema` | 4.0.0-beta.0 | Encode/decode for `Atom.serializable()` | Whenever an atom carries structured data that needs a codec; `Schema.Number` / `Schema.String` for primitives |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `Atom.serializable({ key, schema })` | Developer-assigned string key without Schema | Schema provides encode/decode automatically; skipping it means manually writing serialize/deserialize — more code, more surface area for bugs |
| `registry.setSerializable()` on client | `AtomRegistry.make({ initialValues })` on client | `setSerializable()` is designed for pre-loaded encoded data and decodes on first `get()`; `initialValues` requires already-decoded values which means deserializing before `boot()` — same work, wrong abstraction level |
| Separate JSON script tag for atom data | Piggybacking directly onto island props | Island props are per-island; atom keys are global (module-level singleton). A separate `__FRSH_ATOM_STATE` script tag matches the global scope of the registry singleton and avoids coupling atom data to specific island prop arrays |

**Installation:** No new dependencies required.

## Architecture Patterns

### Recommended Project Structure

```
packages/plugin-effect/src/
├── mod.ts                # effectPlugin() — add atomHydration option
├── island.ts             # registry singleton — add initAtomHydration()
├── resolver.ts           # unchanged
├── runtime.ts            # unchanged
├── types.ts              # unchanged
└── define.ts             # unchanged (optionally expose setAtom ctx helper)
```

### Pattern 1: Atom.serializable() for Cross-Boundary Identity

**What:** The Effect v4 `Atom.serializable({ key, schema })` combinator adds a
`SerializableTypeId` property to an atom. The registry uses the key string
(instead of object identity) as the node map key, and decodes pre-seeded data
on first `ensureNode()` call.

**When to use:** Every atom that must be hydrated from server to client must be
wrapped with `serializable`. Client-only atoms do not need keys.

**Example:**
```typescript
// Source: effect/unstable/reactivity/Atom.d.ts (verified at source)
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

// Developer declares atom with a stable string key and a Schema codec
export const countAtom = Atom.make(0).pipe(
  Atom.serializable({ key: "myapp/count", schema: Schema.Number }),
);
```

### Pattern 2: Server-Side — Collect and Serialize Hydration Map

**What:** In the Effect handler (or Fresh middleware), after computing atom
values, serialize all atoms that are `Atom.isSerializable()` into a
`Record<string, encoded>` using the atom's `schema.encode` method.

**When to use:** Inside the `renderRoute` path, after the Effect has run and
before the HTML is serialized.

**Key insight from source:** The `Serializable` interface in v4:
```typescript
// Source: effect/unstable/reactivity/Atom.d.ts (verified)
interface Serializable<S extends Schema.Top> {
  readonly [SerializableTypeId]: {
    readonly key: string;
    readonly encode: (value: S["Type"]) => S["Encoded"];
    readonly decode: (value: S["Encoded"]) => S["Type"];
  };
}
```

### Pattern 3: Client-Side — Inject Before boot()

**What:** Parse the `__FRSH_ATOM_STATE` script tag before calling `boot()`.
Call `registry.setSerializable(key, encoded)` for each entry. When `boot()`
calls `revive()` which renders islands, `useAtomValue` triggers `registry.get()`
which calls `ensureNode()` which finds and applies the pre-seeded data.

**Critical timing:** `registry.setSerializable()` must run before any island
render that calls `registry.get(atom)`. The `boot()` function in Fresh's
`reviver.ts` calls `revive()` which schedules render via
`scheduler.postTask` or `setTimeout(..., 0)` — so `setSerializable` has until
the scheduler fires. Safe to call synchronously before `boot()`.

**Example:**
```typescript
// In island.ts — to be called before boot() in the generated script
export function initAtomHydration(serialized: string): void {
  const data = JSON.parse(serialized) as Record<string, unknown>;
  for (const [key, encoded] of Object.entries(data)) {
    registry.setSerializable(key, encoded);
  }
}
```

The generated boot script becomes:
```javascript
import { boot } from "/.../runtime-client.js";
import { initAtomHydration as initEffectAtoms } from "/.../plugin-effect-island.js";
// ...island imports...
initEffectAtoms(document.getElementById("__FRSH_ATOM_STATE").textContent);
boot({Counter}, serializedProps);
```

### Pattern 4: Server-Side — Handler API

**What:** How the handler sets atom values that get serialized.

**Recommended approach (Claude's discretion):** Use `ctx.state` as the carrier
for a per-request atom hydration map. The `effectPlugin` middleware initializes
`ctx.state.atomHydration = new Map<Atom<any>, unknown>()` each request. The
handler calls a `setAtom(ctx, atom, value)` helper. The Fresh render hook reads
this map and emits the `__FRSH_ATOM_STATE` script.

**Alternative:** `return { atomValues: [[countAtom, 42]], ...data }` from the
handler — simpler but ties atom hydration data to route data typing.

**Recommended:** Per-request `ctx.state` map, accessed via a `setAtom(ctx, atom, value)` helper exported from `plugin-effect/mod.ts`. Type-safe because `atom` carries its type parameter.

```typescript
// Exported from plugin-effect/mod.ts
export function setAtom<A>(
  ctx: Context<unknown>,
  atom: Atom<A> & Serializable<Schema.Codec<A, unknown>>,
  value: A,
): void {
  // Throws if atom has no serializable key
  const state = ctx.state as Record<string, unknown>;
  const map = state.atomHydration as Map<Atom<any>, unknown>;
  map.set(atom, value);
}
```

### Pattern 5: Fresh Stringifiers Extension Point

**What:** Fresh's server-side serialization accepts a `Stringifiers` object.
It is a module-level `const` in `preact_hooks.ts` — NOT currently extensible
via exported API.

**The gap:** There is no `setStringifiers()` or `addStringifier()` exported from
Fresh core. The `CUSTOM_PARSER` on the client is similarly a module-level
`const` that is mutated directly.

**Resolution:** The atom hydration data does NOT need to go through the island
props `stringify()` pipe. Instead:
- Server: emit a separate `<script id="__FRSH_ATOM_STATE" type="application/json">` tag
  using plain `JSON.stringify()` of the encoded values (which are already JSON-primitive
  after `schema.encode()`). No Fresh stringifier extension needed.
- Client: parse that script tag with `JSON.parse()` directly. No Fresh custom
  parser extension needed.

This approach is simpler and avoids any modification to Fresh core's serialize/parse pipes.

**HOWEVER:** The ROADMAP says "extensible `Stringifiers` registry in `preact_hooks.ts`
+ extensible `CUSTOM_PARSER` in `reviver.ts`" for 04-01. Research shows these are
NOT currently exported or extensible. Making them extensible would require modifying
Fresh core. The simpler path (separate script tag, no Fresh core change) may be
preferable. Flag this as an open question for the plan.

### Anti-Patterns to Avoid

- **Duplicate key registration:** Two atoms with the same `key` string will collide
  in the registry's node map (the registry uses the key as the map key). Detect
  duplicates at atom creation/registration time. The registry itself does NOT error
  on duplicates — it silently overwrites. The plugin must detect and throw.
- **Setting atom values via `registry.set()` on the client before hydration:**
  `registry.set()` on a `Writable` atom triggers the atom's `write` function, which
  might have side effects. `registry.setSerializable()` is the correct API for
  pre-seeding — it bypasses the write function and sets the internal value directly.
- **Creating the client registry AFTER `initAtomHydration()`:** The module-level
  `registry` singleton in `island.ts` is created at import time. `initAtomHydration`
  must operate on the SAME registry instance. Both must be in the same module.
- **Forgetting `Atom.serializable()` wrapper:** A plain `Atom.make(0)` has no string
  key. The registry uses object identity as its map key for non-serializable atoms.
  Pre-seeded data keyed by string will not match. Always require `serializable()` for
  hydrated atoms.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atom string key mechanism | Custom `{ key: string }` metadata on atom objects | `Atom.serializable({ key, schema })` | Built into v4; registry already checks `SerializableTypeId`; decode hook is automatic |
| Encode/decode for atom values | Custom serializers | `schema.encode()` / `schema.decode()` from Effect `Schema` | Type-safe, bidirectional, composable |
| Pre-seeding registry with decoded values | `AtomRegistry.make({ initialValues })` with pre-decoded data | `registry.setSerializable(key, encoded)` | `setSerializable` stores encoded, decodes lazily on first `get()` — correct timing |
| Detect serializable atoms | `typeof atom.key === "string"` | `Atom.isSerializable(atom)` | Official v4 API that checks `SerializableTypeId` |
| Hydration timing guarantee | Wrapping `boot()` in a Promise | Synchronous call before `boot()` | `boot()`'s `revive()` uses `scheduler.postTask` or `setTimeout(0)` — sync setup before `boot()` is always early enough |

**Key insight:** Effect v4 already has a complete atom serialization system.
`Atom.serializable()`, `registry.setSerializable()`, and `Atom.isSerializable()`
are the three primitives. The plugin's job is to wire them into the Fresh
server-render and client-boot lifecycle, not to build a serialization system.

## Common Pitfalls

### Pitfall 1: Hydration Timing — registry.get() Before setSerializable()

**What goes wrong:** If any island renders before `initAtomHydration()` runs,
`registry.get(atom)` is called during render. `ensureNode()` fires — it checks
`preloadedSerializable` but finds nothing. The default value is used. The pre-seeded
value never arrives. The island shows default content (loading flash).

**Why it happens:** The module-level `registry` is created at import time. Island
imports resolve before the boot script runs. If hydration setup is async or
deferred, renders can fire first.

**How to avoid:** Call `initAtomHydration()` synchronously in the generated script
content, before calling `boot()`. The `FreshRuntimeScript` in `preact_hooks.ts`
generates a script tag whose content is:
```javascript
import { boot } from "...";
import IslandA from "...";
boot({IslandA}, serializedProps);
```
The plugin must insert `initAtomHydration(...)` BEFORE `boot(...)` in this script.
This requires the `FreshRuntimeScript` to be aware of atom hydration data — either
via a registered hook, or by injecting a second script tag that runs first.

**Warning signs:** First render shows default value, then immediately updates to
server value — indicates hydration ran after first render.

### Pitfall 2: Orphaned Key Warning — Server Sends Key, Client Has No Atom

**What goes wrong:** Server serializes atom key `"myapp/count"`. No island imports
or uses `countAtom`. The key sits in `registry.preloadedSerializable` forever —
never consumed by `ensureNode()`. The value is never applied.

**Why it happens:** The atom is only used in one route's handler, not in any island
on that page. Or a typo in the key string.

**How to avoid:** After `boot()` completes (or on `DOMContentLoaded`), check
`registry.getNodes()` vs `preloadedSerializable` for keys that were set but never
retrieved. Emit `console.warn` for each orphaned key in dev mode.

**Warning signs:** Data present in page source `__FRSH_ATOM_STATE` but island shows
default value — indicates key mismatch or atom not used.

### Pitfall 3: Duplicate Atom Key — Two Atoms, Same String Key

**What goes wrong:** Two atoms both use `key: "myapp/count"`. The registry uses the
string key as the node map key, so whichever atom calls `ensureNode()` first wins.
The second atom reads from the first atom's node — wrong type, corrupted state.

**Why it happens:** Registry is global; module authors may reuse keys without knowing
about each other.

**How to avoid:** The plugin must maintain a `Set<string>` of registered keys and
throw at `setAtom()` call time if a key is already registered. This is a hard error
per the locked decision in CONTEXT.md.

**Warning signs:** TypeScript type errors at runtime (e.g., number where string
expected) on the atom that was registered second.

### Pitfall 4: Non-JSON-Primitive Encoded Value

**What goes wrong:** `schema.encode()` returns a value that is not JSON-serializable
(e.g., a `Uint8Array`, a `Date` object, a circular reference). `JSON.stringify()`
throws or silently drops it. The atom appears with its default value on the client.

**Why it happens:** Effect Schema's `encode()` may return typed objects that aren't
plain JSON primitives, depending on the schema definition.

**How to avoid:** Only allow schemas where `S["Encoded"]` is a JSON-primitive
compatible type. Throw a hard error at serialize time if `JSON.stringify(encoded)`
throws or produces unexpected output. Alternatively, run the encoded value through
Fresh's `stringify()` for broader type support (Map, Set, Date, URL, etc.).

### Pitfall 5: JSR Constraint — No Effect Types in @fresh/core Public API

**What goes wrong:** If `setAtom()` or any hydration helper is added to
`@fresh/core` (not `@fresh/plugin-effect`), it would import Effect types into
Fresh core's public API — violating the JSR constraint established in prior phases.

**How to avoid:** All atom hydration code lives in `@fresh/plugin-effect`. Any
Fresh core changes are limited to hook registration points that use generic function
types (no Effect imports). The `setEffectResolver()` pattern from Phase 1 is the
model: Fresh core holds a nullable function slot; the plugin registers its
implementation at setup time.

## Code Examples

Verified patterns from official sources:

### Declare a Serializable Atom

```typescript
// Source: effect/unstable/reactivity/Atom.d.ts (verified at source)
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

export const countAtom = Atom.make(0).pipe(
  Atom.serializable({ key: "myapp/count", schema: Schema.Number }),
);
```

### Check if an Atom Is Serializable

```typescript
// Source: effect/unstable/reactivity/Atom.d.ts (verified at source)
import * as Atom from "effect/unstable/reactivity/Atom";

if (Atom.isSerializable(myAtom)) {
  const { key, encode } = myAtom[Atom.SerializableTypeId];
  const encoded = encode(currentValue);
}
```

### Pre-seed Client Registry (setSerializable)

```typescript
// Source: effect/unstable/reactivity/AtomRegistry.ts (verified at source)
// registry.setSerializable(key, encoded) stores in preloadedSerializable Map
// ensureNode() checks and decodes on first get()
registry.setSerializable("myapp/count", 42);
// Later, when useAtomValue(countAtom) calls registry.get(countAtom):
// ensureNode finds "myapp/count" in preloadedSerializable, calls decode(42), sets node value
```

### AtomRegistry.make() with initialValues (confirmed working)

```typescript
// Source: AtomRegistry.d.ts and AtomRegistry.ts (verified at source)
// initialValues takes decoded values (already the atom's A type)
// setSerializable takes encoded values (the schema's Encoded type)
const registry = AtomRegistry.make({
  initialValues: [[countAtom, 42]], // decoded value, sets node directly
});
// vs
registry.setSerializable("myapp/count", 42); // encoded value, decoded on first get
```

### Per-Request Atom Hydration Map in Middleware

```typescript
// effectPlugin middleware — initializes per-request hydration map
return (ctx: Context<unknown>): Response | Promise<Response> => {
  (ctx.state as Record<string, unknown>).effectRuntime = runtime;
  (ctx.state as Record<string, unknown>).atomHydration = new Map<Atom<any>, unknown>();
  return ctx.next();
};
```

### initAtomHydration in island.ts

```typescript
// Exported from island.ts — called before boot() in generated script
export function initAtomHydration(serialized: string): void {
  const data = JSON.parse(serialized) as Record<string, unknown>;
  for (const [key, encoded] of Object.entries(data)) {
    registry.setSerializable(key, encoded);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| v3 `@effect-atom/atom` with `initialValues` | v4 `Atom.serializable({ key, schema })` + `registry.setSerializable()` | Effect v4 beta | v4 has Schema-encoded serialization built in; the registry auto-decodes; no manual encode/decode wiring |
| `AtomRegistry.make({ initialValues })` for SSR | `registry.setSerializable(key, encoded)` | Effect v4 beta | `setSerializable` is the correct API for pre-loaded encoded data; `initialValues` works for decoded values |

**Deprecated/outdated:**
- `@effect-atom/atom`: v3-only package, incompatible with Effect v4 (confirmed in Phase 3 research)
- `AtomRegistry.make({ initialValues })` for hydration: Still works but takes
  decoded values. `setSerializable` is correct for encoded (serialized) data.
  Use `make({ initialValues })` only for test setup with known decoded values.

## Open Questions

1. **Stringifiers extension point in Fresh core**
   - What we know: `stringifiers` in `preact_hooks.ts` and `CUSTOM_PARSER` in
     `reviver.ts` are module-level objects with no exported setter.
   - What's unclear: ROADMAP 04-01 says "extensible `Stringifiers` registry in
     `preact_hooks.ts` + extensible `CUSTOM_PARSER` in `reviver.ts`". This implies
     modifying Fresh core. But atom hydration can be done without this (separate
     script tag + JSON.parse). Which approach does the plan use?
   - Recommendation: Use a separate `<script id="__FRSH_ATOM_STATE">` tag. Avoids
     Fresh core modification. Simpler. Achieves the same result. If the planner wants
     to follow ROADMAP exactly, expose `addStringifier()` / `addParser()` from
     `@fresh/core/internal` — same pattern as `setEffectResolver()`.

2. **How does server hydration data reach the Preact render hook?**
   - What we know: `FreshRuntimeScript` in `preact_hooks.ts` reads `RENDER_STATE`
     which has `islandProps`. There is no current mechanism to inject additional data
     from `ctx.state` into the render script.
   - What's unclear: Does the plugin need to hook into `RenderState`, or can it
     write a second script tag via a different mechanism?
   - Recommendation: Use a `RenderState` extension hook. Register a
     `setAtomHydrationHook(fn)` in Fresh core (via `@fresh/core/internal`) that
     `FreshRuntimeScript` calls to get the atom hydration JSON. The plugin registers
     this hook, which reads `RENDER_STATE.ctx.state.atomHydration`. This is the
     cleanest separation — no Fresh core dependency on Effect types.

3. **Duplicate key detection scope**
   - What we know: The registry uses string key as node map key; duplicates silently
     overwrite.
   - What's unclear: Should duplicate detection be per-page-render or per-module-load?
     Since atoms are module-level constants, key conflicts are global (not per-request).
   - Recommendation: Module-level `Set<string>` in `plugin-effect`. Throw on
     `Atom.serializable()` call if key is already registered (wrap or check at `setAtom`
     time). This matches the "hard error at registration time" decision.

## Sources

### Primary (HIGH confidence)

- `effect/unstable/reactivity/AtomRegistry.ts` (source, verified) — `setSerializable`,
  `preloadedSerializable`, `ensureNode`, `SerializableTypeId`, `atomKey` function
- `effect/unstable/reactivity/Atom.d.ts` (type declarations, verified) — `Serializable`
  interface, `serializable()` combinator, `isSerializable()`, `SerializableTypeId`
- `packages/fresh/src/jsonify/stringify.ts` (source, verified) — `Stringifiers` type,
  `stringify(data, custom)` function, custom stringifier hook pattern
- `packages/fresh/src/jsonify/parse.ts` (source, verified) — `CustomParser` type,
  `parse(str, custom)` function, custom parser hook pattern
- `packages/fresh/src/runtime/server/preact_hooks.ts` (source, verified) — `RenderState`,
  `FreshRuntimeScript`, `stringifiers` const, how serialization is called
- `packages/fresh/src/runtime/client/reviver.ts` (source, verified) — `CUSTOM_PARSER` const,
  `boot(islands, islandProps)` signature, timing of `revive()` via scheduler
- `packages/plugin-effect/src/island.ts` (source, verified) — module-level `registry` singleton,
  Phase 3 hooks
- `packages/fresh/src/internals.ts` (source, verified) — `setEffectResolver` pattern for plugin hooks

### Secondary (MEDIUM confidence)

None required — all critical facts verified from source.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all from verified source files at exact version in use
- Architecture: HIGH — patterns derived directly from reading `AtomRegistry.ts` source
  and `reviver.ts` source; `ensureNode` / `setSerializable` / `preloadedSerializable`
  interaction confirmed by reading implementation
- Pitfalls: HIGH — identified from source-level analysis of timing, registry behavior,
  and existing JSR constraints from prior phase decisions

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable APIs; Effect v4 is still beta — re-verify on version bump)
