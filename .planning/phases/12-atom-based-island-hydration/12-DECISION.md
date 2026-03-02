# Atom-Based Island Hydration: Architectural Decision

**Date:** 2026-02-28 **Status:** Accepted **Decision:** Atom-based hydration
layers on top of signal hydration via a separate, parallel channel. No
replacement. No new protocol.

---

## 1. Context

Phase 12 was specified as "research replacing Fresh's signal-based island
hydration with atom-based hydration." The research question was: does atom
hydration _replace_ signal hydration, _layer on top_, or _require a new
protocol_?

Phase 04 (Atom Hydration) was implemented prior to this phase. Its goal was to
allow server-side route handlers to push Effect v4 serializable atom values to
the client without relying on island component props. After tracing the full
implementation in source, the finding is: **the replacement was never needed
because atoms and signals serve different purposes.** Phase 04 correctly
implemented a second, independent hydration channel.

This decision document formalizes that finding, documents both channels for
posterity, assesses the existing API surface for breaking changes, and records
accept/defer decisions for the four genuine gaps identified in 12-RESEARCH.md.

**Context for the decision:** Preact signals (`@preact/signals`) are primitive
reactive values for component-level reactivity. Effect v4 atoms
(`effect/unstable/reactivity/Atom`) are application-level reactive state
primitives with schema-typed cross-boundary identity. They are different systems
for different scopes, and coexistence is correct.

---

## 2. Architecture: Dual-Channel Hydration

Fresh's island hydration uses two completely independent channels. They do not
conflict. Each channel has its own wire format, its own serialization path, and
its own client-side consumer.

### Channel 1: Island Props (Signal Pipeline)

This is the existing Fresh 2 island hydration mechanism. It handles per-island
component props, including Preact signals.

**Server-side flow:**

1. `ctx.render(vnode)` in `context.ts` calls `renderToString()` with
   `RenderState` active.
2. `preact_hooks.ts` `oldDiff` hook intercepts every island component vnode
   during render.
3. For each island, props are collected into `RenderState.islandProps[]`.
4. `FreshRuntimeScript` / `FreshScripts` (rendered inside `<body>`) emits:
   - `<template id="frsh-{id}-{name}">` elements for slot content.
   - A `<script type="module">` calling `boot(islandMap, serializedProps)`.
   - `serializedProps` = `stringify(islandProps, stringifiers)` from
     `jsonify/stringify.ts`.
5. Custom stringifiers in `preact_hooks.ts` handle `Signal` and `Computed`
   types:
   ```typescript
   Signal: (value) => isSignal(value) ? { value: value.peek() } : undefined,
   Computed: (value) => isComputedSignal(value) ? { value: value.peek() } : undefined,
   ```
   Signal VALUES are captured (via `.peek()`), not live bindings.

**Key files (server side):**

- `packages/fresh/src/runtime/server/preact_hooks.ts` — `FreshRuntimeScript`,
  signal stringifiers, `islandProps[]` collection
- `packages/fresh/src/jsonify/stringify.ts` — `stringify()`, `Stringifiers` type

**Client-side flow:**

1. `boot(initialIslands, islandProps)` is called from the inline script.
2. `_walkInner(ctx, document.body)` — DOM walk to find `<!--frsh:island:...-->`
   comment markers.
3. For each island found, `allProps = parse(islandProps, CUSTOM_PARSER)`
   deserializes props.
4. `CUSTOM_PARSER` (in `reviver.ts`) reconstructs `Signal` → `signal(value)`
   (new live Preact signal) and `Computed` → `computed(() => value)`.
5. `revive(props, component, container, slots, allProps)` renders the island via
   Preact `render()`.

**Key files (client side):**

- `packages/fresh/src/runtime/client/reviver.ts` — `boot()`, `CUSTOM_PARSER`,
  `_walkInner`
- `packages/fresh/src/jsonify/parse.ts` — `parse()`, `CustomParser` type

**Important constraints:**

- Atoms are NOT handled by this channel. An `Atom<A>` object passed as an island
  prop would serialize as a plain object — there is no `Atom` stringifier.
- This channel is for per-island props only, not for global reactive state
  shared across islands.

---

### Channel 2: Atom State (`__FRSH_ATOM_STATE` Pipeline)

This is the Effect atom hydration mechanism implemented in Phase 04. It handles
global reactive atom state that crosses island boundaries.

**Server-side flow:**

1. `createEffectApp()` in `packages/effect/src/app.ts` registers at startup:
   - `setAtomHydrationHook((ctx) => serializeAtomHydration(ctx))` — global hook
     in `segments.ts`
   - `setAtomHydrationHookForApp(app, (ctx) => serializeAtomHydration(ctx))` —
     per-app hook stored in `App#atomHydrationHook` (not currently used by
     `FreshRuntimeScript`)
   - `app.use(...)` middleware that calls `initAtomHydrationMap(ctx)` before
     each request

2. Route handler calls `setAtom(ctx, atom, value)`:
   - Verifies `Atom.isSerializable(atom)` — throws if not wrapped with
     `Atom.serializable()`.
   - Extracts `{ key, encode }` from `atom[Atom.SerializableTypeId]`.
   - Stores `{ key -> encode(value) }` in `ctx.state[ATOM_HYDRATION_KEY]` (a
     `Map<string, unknown>`).

3. During render, `FreshRuntimeScript` in `preact_hooks.ts` (non-partial branch,
   lines 636–665):
   - Calls `getAtomHydrationHook()` (the GLOBAL hook from `segments.ts`).
   - Calls `atomHook(ctx)` → `serializeAtomHydration(ctx)` → reads the Map,
     returns `JSON.stringify(obj)`.
   - Emits
     `<script id="__FRSH_ATOM_STATE" type="application/json" nonce={nonce}>{atomJson}</script>`
     BEFORE the module script tag.

**Key files (server side):**

- `packages/fresh/src/segments.ts` — `_atomHydrationHook` global,
  `setAtomHydrationHook()`, `getAtomHydrationHook()`
- `packages/fresh/src/app.ts` — `#atomHydrationHook` private field,
  `setAtomHydrationHookForApp()`, `getAtomHydrationHookForApp()`
- `packages/fresh/src/internals.ts` — exports both `setAtomHydrationHook` and
  `setAtomHydrationHookForApp` for plugin use
- `packages/fresh/src/runtime/server/preact_hooks.ts` — `FreshRuntimeScript`,
  `getAtomHydrationHook()` call, `__FRSH_ATOM_STATE` emission
- `packages/effect/src/hydration.ts` — `setAtom()`, `serializeAtomHydration()`,
  `initAtomHydrationMap()`
- `packages/effect/src/app.ts` — `createEffectApp()` hook registration,
  middleware setup

**Client-side flow:**

1. Module-level code in `island-atoms.ts` runs at ES module import time — before
   `boot()` is called:
   ```typescript
   const el = globalThis.document.getElementById("__FRSH_ATOM_STATE");
   if (el?.textContent) {
     const data = JSON.parse(el.textContent);
     for (const [key, encoded] of Object.entries(data)) {
       registry.setSerializable(key, encoded);
     }
   }
   ```
2. `registry` is a module-level singleton: `AtomRegistry.make()`.
3. `registry.setSerializable(key, encoded)` pre-seeds the registry with
   server-provided values. Values are stored encoded; decoding is lazy (on first
   `registry.get(atom)`).
4. When an island renders and calls `useAtom(todoListAtom)`:
   - `useState(() => registry.get(atom))` — initial state from registry
     (synchronous).
   - `registry.get(atom)` → `ensureNode()` checks `preloadedSerializable` for
     the atom's key.
   - If found, `decode(encoded)` is applied; node value is set to the server
     value.
   - No loading flash — server value is available on first render.

**Key files (client side):**

- `packages/effect/src/island-atoms.ts` — module-level auto-init,
  `useAtomValue`, `useAtomSet`, `useAtom`

**Important properties:**

- Completely separate from island props — does not go through
  `stringify`/`parse`.
- Wire format: `{ [atomKey]: schemaEncoded }` where `schemaEncoded` is whatever
  `Schema.encode()` produces (must be JSON-safe).
- Global scope: one `__FRSH_ATOM_STATE` per page, shared across all islands via
  the `AtomRegistry` singleton.
- Auto-init at import time — no explicit call from the boot script needed.

---

### Wire Format Summary

**Channel 1 (island props):**

```html
<script type="module" nonce="...">
  import { boot } from "/.../runtime-client.js";
  import TodoApp from "/.../TodoApp.js";
  boot({ TodoApp }, '[{"Signal":{"value":42}},...]');
</script>
```

**Channel 2 (atom state):**

```html
<script id="__FRSH_ATOM_STATE" type="application/json" nonce="...">
  { "todo-list": [{ "id": "1", "text": "Buy milk", "done": false }] }
</script>
```

---

## 3. Decision

**Atom-based hydration layers on top of signal hydration. No replacement. No new
protocol.**

**Rationale:**

1. **Different scopes, different purposes.** Signal hydration handles per-island
   component props — each island gets its own props slice. Atom hydration
   handles global cross-island state that all islands share via the
   `AtomRegistry` singleton. These are not competing mechanisms; they are
   complementary tools for different problem shapes.

2. **Different wire format is correct.** The `stringify/parse` pipeline
   (Channel 1) is optimized for heterogeneous per-island prop objects including
   complex types (Signals, Computed, Slots). The `JSON.stringify` approach
   (Channel 2) is simpler and sufficient because atom schemas guarantee the
   encoded form is JSON-safe.

3. **Phase 04 built it correctly.** The implementation uses a separate JSON
   script tag (`__FRSH_ATOM_STATE`) rather than injecting atoms into the island
   props serialization. This is architecturally clean: the two channels remain
   fully independent and changes to one do not affect the other.

4. **No new protocol needed.** The `{ [atomKey]: schemaEncoded }` wire format is
   stable and minimal. It leverages Effect Schema's bidirectional encode/decode
   for type safety while remaining plain JSON on the wire. Extending this
   protocol (e.g., for Partial renders) is an additive change, not a redesign.

**Decision date:** 2026-02-28 **Status:** Accepted

---

## 4. API Surface Assessment

### `setAtom(ctx, atom, value)`

**Location:** `packages/effect/src/hydration.ts`, re-exported from
`packages/plugin-effect/src/hydration.ts`

**Signature:**

```typescript
function setAtom<A>(
  ctx: { state: unknown },
  atom: Atom.Atom<A>,
  value: A,
): void;
```

**Assessment:** No breaking changes. The signature is stable. The `ctx`
parameter is structurally typed (`{ state: unknown }`) so it is
forward-compatible with any changes to `Context<State>`. The `Atom.Atom<A>` type
is from Effect v4 stable API. The runtime behavior (guard on
`Atom.isSerializable`, duplicate key throw) is correct and complete.

**Migration required:** None.

---

### `initAtomHydration()` (client side)

**Location:** `packages/effect/src/island-atoms.ts`

**Signature:**

```typescript
function initAtomHydration(): void;
```

**Assessment:** No breaking changes. As documented in 12-RESEARCH.md,
`initAtomHydration()` is idempotent — calling it again overwrites previously
registered values in the registry with the same values (re-reading from
`__FRSH_ATOM_STATE`). The auto-init at module load time makes explicit calls
unnecessary in production, but the function remains available for test setups
that need explicit initialization ordering. No migration required.

**Migration required:** None.

---

### `setAtomHydrationHook(fn)` / `setAtomHydrationHookForApp(app, fn)`

**Location:** `packages/fresh/src/segments.ts` (global),
`packages/fresh/src/app.ts` (per-app), both exported from
`packages/fresh/src/internals.ts`

**Signatures:**

```typescript
// Global hook — currently used by FreshRuntimeScript
function setAtomHydrationHook(
  fn: (ctx: Context<unknown>) => string | null,
): void;

// Per-app hook — stored but not yet consumed by FreshRuntimeScript
function setAtomHydrationHookForApp(
  app: App<unknown>,
  fn: (ctx: Context<unknown>) => string | null,
): void;
```

**Assessment:** These are internal plugin APIs (`@internal` — exported from
`@fresh/core/internal` for plugin use only). They are not part of the
user-facing API. `createEffectApp()` calls both; user code never calls them
directly.

No breaking changes to either. The per-app variant's unused status is a gap (see
Section 5 Gap G2 below) but does not constitute a breaking change — the function
works, it simply is not yet consumed during render.

**Migration required:** None.

---

### `Atom.serializable()` combinator

**Location:** Effect v4 standard library (`effect/unstable/reactivity/Atom`)

**Current correct form (verified in
`packages/examples/effect-integration/atoms.ts`):**

```typescript
export const todoListAtom = Atom.serializable(
  Atom.make<Todo[]>([]),
  { key: "todo-list", schema: Schema.mutable(Schema.Array(TodoSchema)) },
);
```

**Deprecated form (Effect beta <20 era):**

```typescript
// Do not use — pipe form may fail silently in current Effect version
Atom.make(0).pipe(Atom.serializable({ key, schema }));
```

**Assessment:** This is an Effect library API change, not a Freak API change. No
Freak API breaks. Users who wrote `Atom.make(...).pipe(Atom.serializable(...))`
in beta <20 era may need to update to the combinator form. This is an Effect
migration concern, not a Freak `setAtom` / `initAtomHydration` concern.

**Migration required for Freak users:** Update atom declarations to use the
combinator form. No changes to `setAtom()`, `initAtomHydration()`, or
`setAtomHydrationHook()` needed.

---

## 5. Gap Assessment

Four genuine gaps were identified in 12-RESEARCH.md. Each gap has an explicit
accept/defer decision.

| #  | Gap                          | Description                                                                                                                                                                                                                                                                                                                                    | Impact                                                                                                                                                                                                                                                     | Severity                                                                                                                                          | Decision                                                                                                                                                                                                                                                                                                                                                         |
| -- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1 | Partials gap                 | `__FRSH_ATOM_STATE` is only emitted on full-page renders. Fresh Partials (requests with `?__freshPartial`) go through a separate branch in `FreshRuntimeScript` that does NOT emit atom updates. If a Partial handler calls `setAtom()`, those values are silently lost client-side.                                                           | Atoms set during Partial navigation are not reflected client-side. The client's registry holds pre-navigation values.                                                                                                                                      | Medium — only affects apps that (a) use Fresh Partials AND (b) call `setAtom()` in Partial handlers. Many apps use neither or both without issue. | **Defer** — The workaround (use RPC streams for state that must update post-navigation) is documented in 12-RESEARCH.md. Fixing this requires extending the Partial branch to also emit a delta update — additive work for a follow-on phase.                                                                                                                    |
| G2 | Dead per-app hook            | `setAtomHydrationHookForApp()` stores a hook in `App#atomHydrationHook` (private field), but `FreshRuntimeScript` only calls `getAtomHydrationHook()` (the global hook from `segments.ts`). The per-app hook is never consulted during render. It is architectural scaffolding for future multi-app isolation that was added ahead of use.     | In single-app usage (the common case), the global hook works correctly and the per-app hook being unused causes no visible bug. In a multi-app scenario (two `createEffectApp()` calls), atom serialization uses the last-registered global hook (see G3). | Low — no user-visible defect today.                                                                                                               | **Defer** — The comment in `app.ts` documents this as "infrastructure for future full isolation." Either wire `FreshRuntimeScript` to look up the hook from the `RenderState.ctx`'s app instance, or remove the per-app hook to reduce confusion. Deferred pending multi-app use case becoming concrete.                                                         |
| G3 | Global hook last-writer-wins | `_atomHydrationHook` in `segments.ts` is a single `let` slot, not a registry. If two `createEffectApp()` calls occur (e.g., two Effect sub-apps, or multiple calls in tests), the second `setAtomHydrationHook()` call overwrites the first. Only the second app's atoms are serialized into `__FRSH_ATOM_STATE`.                              | In single-app production usage, not a problem. In tests that create multiple app instances in the same process, atom state from earlier apps may be silently dropped. In multi-Effect-app scenarios, one app loses atom serialization with no error.       | Low in production, Medium in tests.                                                                                                               | **Accept** (document) — Single-app usage is the supported production scenario. Multi-app atom isolation is deferred per the same rationale as G2. The workaround for tests is to use a separate Deno subprocess per test or to mock `getAtomHydrationHook()`. Documented here and in 12-RESEARCH.md.                                                             |
| G4 | `hydration.ts` duplication   | `packages/plugin-effect/src/hydration.ts` and `packages/effect/src/hydration.ts` are functionally identical files (verified by source comparison). The only differences are JSDoc comments referencing `effectPlugin()` vs `createEffectApp()`. The `plugin-effect` package maintains a local copy rather than importing from `@fresh/effect`. | Any bug fix or enhancement to `hydration.ts` must be applied to both copies. Risk of divergence as the files evolve independently.                                                                                                                         | Low today (files are identical), Medium over time.                                                                                                | **Defer** — The local copy in `plugin-effect` exists because `@fresh/effect` may not be a declared dependency of `@fresh/plugin-effect` for JSR publishing isolation. Before deduplicating, verify that `@fresh/plugin-effect`'s deno.json includes `@fresh/effect` as a dependency (or can, without circular issues). Deduplicate in a follow-on cleanup phase. |

---

## 6. Success Criteria Verification

The Phase 12 roadmap specifies three success criteria. Each is verified here.

### SC-1: Current hydration path documented

**Criterion:** The current hydration path (stringify.ts / reviver.ts / island
props) is fully documented — how atoms are serialized server-side and rehydrated
client-side today.

**Verification:**

- **Signal pipeline (Channel 1):** Documented in Section 2 above. Server side:
  `preact_hooks.ts` collects island props into `RenderState.islandProps[]`;
  `stringify.ts` serializes with custom stringifiers for `Signal` (`.peek()` →
  value) and `Computed`. Client side: `reviver.ts` `parse()` reconstructs
  `signal(value)` and `computed(() => value)`. Key files cited throughout.

- **Atom pipeline (Channel 2):** Documented in Section 2 above. Server side:
  `setAtom()` in `hydration.ts` stores schema-encoded values in
  `ctx.state[ATOM_HYDRATION_KEY]`; `FreshRuntimeScript` calls
  `getAtomHydrationHook()` → `serializeAtomHydration()` → emits
  `<script id="__FRSH_ATOM_STATE" type="application/json">`. Client side:
  `island-atoms.ts` module-level auto-init reads `__FRSH_ATOM_STATE` and calls
  `registry.setSerializable(key, encoded)` before `boot()` runs.

**Status: PASS**

---

### SC-2: Decision recorded with rationale

**Criterion:** A decision document records whether atom-based hydration replaces
signal hydration entirely, layers on top, or requires a new protocol — with
rationale.

**Verification:** Section 3 (Decision) states explicitly:

> "Atom-based hydration layers on top of signal hydration. No replacement. No
> new protocol."

Rationale provided: different scopes (per-island props vs global cross-island
state), different wire formats are correct, Phase 04 built it correctly, no new
protocol needed.

**Status: PASS**

---

### SC-3: Breaking changes assessed

**Criterion:** Any breaking changes to the existing `initAtomHydration()` /
`setAtom()` API surface are identified and a migration path is proposed.

**Verification:** Section 4 (API Surface Assessment) covers:

- `setAtom(ctx, atom, value)` — no breaking changes, no migration required
- `initAtomHydration()` — no breaking changes, no migration required
- `setAtomHydrationHook()` / `setAtomHydrationHookForApp()` — internal plugin
  APIs; no breaking changes
- `Atom.serializable()` form change — Effect library change (not Freak),
  combinator form documented

**Finding:** No breaking changes to Freak's `initAtomHydration()` / `setAtom()`
API surface. No migration path required. The only user action needed is updating
`Atom.serializable()` call form if on Effect beta <20 (Effect library migration,
not Freak API migration).

**Status: PASS**

---

## 7. Follow-On Candidates

These items are explicitly deferred from Phase 12. They are candidates for
future phases if the need becomes concrete.

1. **Partial render atom updates** — Extend the `FreshRuntimeScript` Partial
   branch to emit a delta update for atoms set during that partial render.
   Requires: new script tag format for Partial atom deltas + client-side logic
   in `island-atoms.ts` to merge delta on Partial load.

2. **Wire per-app hook to FreshRuntimeScript** — Update `FreshRuntimeScript` to
   look up the atom hydration hook from the rendering App instance (via
   `RenderState`) rather than from the global `_atomHydrationHook` slot.
   Prerequisite for true multi-app atom isolation.

3. **Deduplicate hydration.ts** — Remove
   `packages/plugin-effect/src/hydration.ts` and import from
   `packages/effect/src/hydration.ts`. First verify JSR publishing constraints.

4. **Explicit `hydration.ts` in `plugin-effect/mod.ts`** — Until deduplication,
   ensure `plugin-effect`'s re-export of `setAtom` routes through
   `@fresh/effect` (not its local copy), so behavior is always from the
   canonical source.

---

_Phase: 12-atom-based-island-hydration_ _Researched: 2026-02-28_ _Decision date:
2026-02-28_
