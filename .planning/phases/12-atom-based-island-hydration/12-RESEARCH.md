# Phase 12: Atom-Based Island Hydration - Research

**Researched:** 2026-02-28 **Domain:** Fresh 2 island hydration pipeline, Effect
v4 atom serialization, server-to-client state transfer **Confidence:** HIGH

## Summary

Phase 12 was specified as "research replacing Fresh's signal-based island
hydration with atom-based hydration." After tracing the full codebase from
server render through client boot, the finding is: **the replacement is already
complete**. Phase 04 implemented atom-based hydration end-to-end and it works
correctly.

This research documents what was actually built (so the "success criteria" from
Phase 12's spec can be verified), identifies the remaining design gaps (signals
are still in the island props pipeline; atoms use a separate, parallel channel),
and assesses what genuine planning work this phase needs.

**What was researched:**

1. The full Fresh 2 signal/island hydration pipeline (stringify.ts, reviver.ts,
   preact_hooks.ts, boot)
2. The atom hydration channel implemented in Phase 04 (hydration.ts,
   island-atoms.ts, segments.ts hook)
3. How the two channels coexist and where atoms vs signals are used
4. The `initAtomHydration()` and `setAtomHydrationHook` APIs and their current
   state
5. Any remaining gaps or architectural mismatches

**Primary finding:** There are two parallel hydration channels. Channel 1
(island props) uses the `stringify/reviver` pipeline with Signal/Computed
stringifiers. Channel 2 (atom state) uses the `__FRSH_ATOM_STATE` JSON script
tag. They do not conflict. Atoms do not use the island props pipeline; they use
their own separate mechanism.

**Primary recommendation:** This phase's planning work is documentation and
hardening of the existing system, not replacement. Write the decision document
the success criteria requires, identify the `getAtomHydrationHook` vs
`getAtomHydrationHookForApp` architectural inconsistency, and assess whether the
global hook (last-writer-wins for multi-app) should be addressed.

## Standard Stack

The established system uses no new libraries. Both hydration channels are built
on existing primitives.

### Core (already in production)

| Library                                   | Version | Purpose                                                                         | Why Standard                                                                                       |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `effect/unstable/reactivity/Atom`         | beta.20 | `Atom.serializable({ key, schema })`, `isSerializable()`, `SerializableTypeId`  | v4-native cross-boundary atom identity; registry uses key string for node lookup                   |
| `effect/unstable/reactivity/AtomRegistry` | beta.20 | `registry.setSerializable(key, encoded)` — pre-seeds atoms before first `get()` | Decodes on first access; correct API for hydration (vs `initialValues` which needs decoded values) |
| `@fresh/core` jsonify/stringify.ts        | 2.x     | `stringify(data, custom)` — serializes island props including signals           | Existing Fresh island prop serialization; NOT used for atoms                                       |
| `@fresh/core` jsonify/parse.ts            | 2.x     | `parse(str, custom)` — deserializes island props including signals              | Existing client-side deserialization; NOT used for atoms                                           |
| `@preact/signals`                         | —       | `Signal`, `ReadonlySignal` types in stringifier/parser                          | Fresh built-in; atoms are NOT signals; separate system                                             |

### No new dependencies needed

The Phase 04 implementation added zero new dependencies. Everything was wired
through existing hook registration patterns.

## Architecture Patterns

### How Fresh 2 Island Hydration Works (Channel 1 — Island Props)

This is the Preact signals pipeline. Fully understood from source.

**Server-side flow:**

1. `ctx.render(vnode)` in `context.ts` calls `renderToString()` with
   `RenderState` active
2. `preact_hooks.ts` `oldDiff` hook intercepts every island component vnode
3. For each island, props are collected into `RenderState.islandProps[]`
4. Props that are JSX/VNode children become `Slot` references
5. `wrapWithMarker` adds `<!--frsh:island:IslandName:propsIdx:key-->` and
   `<!--/frsh:island-->` HTML comments around the rendered island output
6. `FreshScripts` / `FreshRuntimeScript` component (rendered inside `<body>`)
   emits:
   - `<template id="frsh-{id}-{name}">` elements for slot content
   - A `<script type="module">` that calls `boot(islandMap, serializedProps)`
   - `serializedProps` = `stringify(islandProps, stringifiers)` — custom
     stringifiers handle `Signal`, `Computed`, `Slot` types

**The Signal stringifiers in `preact_hooks.ts`:**

```typescript
const stringifiers: Stringifiers = {
  Computed: (value: unknown) => {
    return isComputedSignal(value) ? { value: value.peek() } : undefined;
  },
  Signal: (value: unknown) => {
    return isSignal(value) ? { value: value.peek() } : undefined;
  },
  Slot: (value: unknown) => {/* slot reference */},
};
```

**Client-side flow (`reviver.ts`):**

1. `boot(initialIslands, islandProps)` is called from the inline script
2. `_walkInner(ctx, document.body)` — DOM walk to find `frsh:island` comment
   markers
3. For each island found, `allProps = parse(islandProps, CUSTOM_PARSER)`
   deserializes all props
4. `CUSTOM_PARSER` converts `Signal` entries back to `signal(value)` (live
   Preact signal), `Computed` to `computed(() => value)`
5. `revive(props, component, container, slots, allProps)` renders the island via
   Preact `render()`

**Key points about Channel 1:**

- It serializes the VALUES of signals (via `.peek()`) — not live signal bindings
- Signals are reconstructed as NEW client-side signals with the server's initial
  value
- Atoms are NOT handled here — atoms passed as island props would serialize as
  plain objects (no `Atom` stringifier exists)
- This channel is for island component PROPS, not for global reactive state

### How Atom Hydration Works (Channel 2 — Atom State)

This is the Effect atom pipeline. Fully implemented in Phase 04.

**Server-side flow:**

1. `createEffectApp()` in `@fresh/effect/src/app.ts` registers two things at
   startup:
   - `setAtomHydrationHook((ctx) => serializeAtomHydration(ctx))` — global hook
     in `segments.ts`
   - `setAtomHydrationHookForApp(app, (ctx) => serializeAtomHydration(ctx))` —
     per-app hook in `app.ts`
   - `app.use(...)` middleware that calls `initAtomHydrationMap(ctx)` before
     each request

2. Route handler calls `setAtom(ctx, todoListAtom, todos)`:
   - `setAtom` checks `Atom.isSerializable(atom)` — throws if not wrapped
   - Extracts `key` and `encode` from `atom[Atom.SerializableTypeId]`
   - Stores `{ key -> encode(value) }` in `ctx.state[ATOM_HYDRATION_KEY]` (a
     `Map<string, unknown>`)

3. During render, `FreshRuntimeScript` in `preact_hooks.ts` (non-partial
   branch):
   - Calls `getAtomHydrationHook()` which returns the registered hook function
   - Calls `atomHook(ctx)` which calls `serializeAtomHydration(ctx)` which reads
     the Map and `JSON.stringify`s it
   - Emits
     `<script id="__FRSH_ATOM_STATE" type="application/json" nonce={nonce}>{json}</script>`
     BEFORE the module script tag

**Client-side flow (`@fresh/effect/src/island-atoms.ts`):**

1. Module-level code in `island-atoms.ts` runs at ES module import time (before
   `boot()`)
2. Reads `document.getElementById("__FRSH_ATOM_STATE").textContent`
3. Calls `registry.setSerializable(key, encoded)` for each key-value pair
4. `registry` is a module-level singleton: `AtomRegistry.make()`
5. When island renders and calls `useAtomValue(todoListAtom)`:
   - `useState(() => registry.get(atom))` — initial state from registry
   - `registry.get(atom)` → `ensureNode()` checks `preloadedSerializable` for
     the atom's key
   - If found, `decode(encoded)` is applied, node value is set to the server
     value
   - No loading flash — server value is available synchronously on first render

**Key points about Channel 2:**

- Completely separate from island props — does not go through `stringify/parse`
- JSON-only (plain `JSON.stringify`) — Schema's `encode()` must produce
  JSON-serializable values
- Global scope: one `__FRSH_ATOM_STATE` per page, not per-island
- Shared across all islands via the module-level `AtomRegistry` singleton
- Auto-init happens at import time — no explicit call from the boot script
  needed

### Project Structure (Current)

```
packages/fresh/src/
├── segments.ts                    # _atomHydrationHook (global), setAtomHydrationHook(), getAtomHydrationHook()
├── app.ts                         # #atomHydrationHook (per-app), setAtomHydrationHookForApp(), getAtomHydrationHookForApp()
├── internals.ts                   # Exports setAtomHydrationHook, setAtomHydrationHookForApp for plugins
├── runtime/
│   └── server/
│       └── preact_hooks.ts       # FreshRuntimeScript: emits __FRSH_ATOM_STATE + boot() script
│                                 # stringifiers: Signal, Computed, Slot (NOT Atom)
└── runtime/
    └── client/
        └── reviver.ts            # boot(), CUSTOM_PARSER: Signal->signal(), Computed->computed()
                                  # (no Atom parsing — atoms use separate channel)

packages/effect/src/
├── app.ts                        # createEffectApp() — registers hooks, adds initAtomHydrationMap middleware
├── hydration.ts                  # setAtom(), serializeAtomHydration(), initAtomHydrationMap()
├── island-atoms.ts               # Module-level auto-init, initAtomHydration(), useAtomValue/useAtomSet/useAtom
└── island.ts                     # RPC hooks + re-exports from island-atoms.ts

packages/plugin-effect/src/
├── hydration.ts                  # Identical copy of @fresh/effect/src/hydration.ts
├── island.ts                     # Re-exports from @fresh/effect/island
└── mod.ts                        # effectPlugin() (deprecated) — also registers hooks
```

### Pattern 1: Atom Serialization Round-Trip

```typescript
// Source: packages/effect/src/hydration.ts (verified)
// Server: setAtom() encodes and stores
export function setAtom<A>(ctx, atom, value): void {
  const { key, encode } = atom[Atom.SerializableTypeId];
  const encoded = encode(value); // Schema.encode — must produce JSON-serializable output
  map.set(key, encoded);
}

// Server: FreshRuntimeScript reads the map and emits
// packages/fresh/src/runtime/server/preact_hooks.ts lines 637-666
const atomHook = getAtomHydrationHook();
const atomJson = atomHook ? atomHook(ctx) : null;
// Emits: <script id="__FRSH_ATOM_STATE" type="application/json">{atomJson}</script>

// Client: Auto-init at module load time
// packages/effect/src/island-atoms.ts lines 37-51
const el = document.getElementById("__FRSH_ATOM_STATE");
const data = JSON.parse(el.textContent);
for (const [key, encoded] of Object.entries(data)) {
  registry.setSerializable(key, encoded); // stored; decoded on first registry.get(atom)
}

// Client: Island uses useAtomValue — gets server value synchronously on first render
const [todos, setTodos] = useAtom(todoListAtom);
```

### Pattern 2: Atom Declaration

```typescript
// Source: packages/examples/effect-integration/atoms.ts (verified)
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

export const todoListAtom = Atom.serializable(
  Atom.make<Todo[]>([]),
  {
    key: "todo-list",
    schema: Schema.mutable(Schema.Array(TodoSchema)),
  },
);
// Note: Atom.serializable() is the combinator (first arg = atom, second = options)
// NOT: Atom.make(0).pipe(Atom.serializable(...)) — API changed in beta.20
```

### Anti-Patterns to Avoid

- **Passing atoms as island props:** An `Atom<A>` object passed as an island
  prop will serialize as a plain object (no `Atom` stringifier in the island
  props pipeline). The client will receive an inert object, not a live atom. Use
  Channel 2 (`setAtom()`) instead.
- **Using `Atom.make(0).pipe(Atom.serializable(...))` in beta.20:** The API
  changed — `Atom.serializable` is now a standalone combinator called as
  `Atom.serializable(Atom.make(0), { key, schema })`. The `.pipe()` form fails
  silently in some versions.
- **Calling `setAtomHydrationHook()` from multiple plugins:** The global hook
  (`_atomHydrationHook` in segments.ts) is last-writer-wins. If two Effect apps
  are created (e.g., two `createEffectApp()` calls in tests or multi-app
  scenarios), the second registration overwrites the first.
- **Relying on `getAtomHydrationHook()` when using per-app hooks:** The
  `FreshRuntimeScript` currently calls `getAtomHydrationHook()` (global), not
  `getAtomHydrationHookForApp()`. The per-app hook (`#atomHydrationHook` on
  `App`) exists in `app.ts` but is NOT used by `FreshRuntimeScript`.
- **Expecting `initAtomHydration()` to be called explicitly:** The auto-init at
  module load in `island-atoms.ts` handles this. Calling `initAtomHydration()`
  again is idempotent (values are overwritten in the registry) but unnecessary
  in production.

## Don't Hand-Roll

| Problem                    | Don't Build                            | Use Instead                                  | Why                                                                                             |
| -------------------------- | -------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Atom string key mechanism  | Custom metadata object on atom         | `Atom.serializable({ key, schema })`         | v4-native; registry uses it for cross-boundary identity                                         |
| Cross-island state sharing | Props drilling or global JS vars       | `AtomRegistry` singleton + `useAtomValue`    | Registry subscription model; no custom event bus needed                                         |
| Atom encode/decode         | Custom serializer                      | Schema.encode/decode via `Atom.serializable` | Type-safe, bidirectional, composable                                                            |
| Hydration timing guarantee | Wrapping boot() in Promise             | Module-level auto-init in island-atoms.ts    | ES modules import before boot() script runs                                                     |
| Pre-seeding registry       | `AtomRegistry.make({ initialValues })` | `registry.setSerializable(key, encoded)`     | `setSerializable` takes ENCODED values and decodes lazily; `initialValues` takes decoded values |

## Common Pitfalls

### Pitfall 1: Global Hook Is Last-Writer-Wins

**What goes wrong:** If `createEffectApp()` is called twice (e.g., in tests, or
when two Effect apps are created), `setAtomHydrationHook()` is called twice. The
second call overwrites `_atomHydrationHook` in `segments.ts`. Only the second
app's atoms are serialized.

**Why it happens:** `segments.ts` holds a module-level `let _atomHydrationHook`.
There is no list/registry — only a single slot.

**How to avoid:** In single-app usage (normal production scenario) this is not a
problem. For test isolation, each test should use a separate Deno process or
mock the hook. This is an architectural limitation documented in the project
memory.

**Warning signs:** Atom state from the first app not appearing in
`__FRSH_ATOM_STATE` when two apps are active.

### Pitfall 2: Per-App Hook Is Not Used by FreshRuntimeScript

**What goes wrong:** `createEffectApp()` registers both
`setAtomHydrationHook(...)` (global, used by `FreshRuntimeScript`) and
`setAtomHydrationHookForApp(app, ...)` (per-app, stored in
`App#atomHydrationHook`). `FreshRuntimeScript` only calls
`getAtomHydrationHook()` (global). The per-app hook is technically dead code —
it's stored but never consulted during render.

**Why it happens:** The per-app hook (`setAtomHydrationHookForApp`) was added as
"infrastructure for future full isolation" per the code comment in app.ts.
`FreshRuntimeScript` was not updated to use it.

**Impact:** In current single-app usage, the global hook works correctly. The
per-app hook is architectural scaffolding for a future multi-app scenario. No
user-visible bug today.

**How to address:** Either wire `FreshRuntimeScript` to use the per-app hook via
the App instance, or document that the per-app hook is deferred infrastructure
and remove it to reduce confusion.

### Pitfall 3: Schema.encode Must Produce JSON-Primitive Output

**What goes wrong:** If `schema.encode()` returns a non-JSON-serializable value
(e.g., a `Date` object, `Uint8Array`, circular reference), `JSON.stringify()` in
`serializeAtomHydration()` throws or silently drops data.

**Why it happens:** `serializeAtomHydration()` uses plain `JSON.stringify()`,
not Fresh's richer `stringify()` from jsonify/. Effect Schema's `encode()` may
return typed objects depending on the schema.

**How to avoid:** Use schemas where the encoded type is a JSON-safe primitive
(`string`, `number`, `boolean`, `object`, `array` with JSON-safe leaves). For
complex types, define a `Schema.transform` that produces a JSON-safe encoded
form.

**Warning signs:** `__FRSH_ATOM_STATE` contains `null` values or is missing
keys.

### Pitfall 4: Hydration Only Runs on Full-Page Renders

**What goes wrong:** Partial updates (Fresh Partials — requests with
`?__freshPartial` search param) go through the
`ctx.url.searchParams.has(PARTIAL_SEARCH_PARAM)` branch in `FreshRuntimeScript`.
That branch emits
`<script id="__FRSH_STATE_{partialId}" type="application/json">` (island props
for the partial) but does NOT emit `__FRSH_ATOM_STATE`.

**Why it happens:** See `preact_hooks.ts` lines 583-606: the partial branch
emits `PartialStateJson` with islands+props for the partial. The atom hydration
block (lines 637-666) is only in the else branch (full-page render).

**Impact:** After a Partial navigation, atom state is NOT re-hydrated from the
server. The client's registry holds the atoms' previous values. If the partial's
server handler called `setAtom()`, those values are silently lost.

**How to avoid:** Either accept this limitation (atoms set during partial
renders are not reflected clientside), or extend the partial branch to also emit
atom updates. For now this is an undocumented limitation.

**Warning signs:** After clicking a link that triggers a Fresh Partial
navigation, atom values do not update to reflect the new server state even
though the handler called `setAtom()`.

### Pitfall 5: Duplicate Atom Keys Throw Hard

**What goes wrong:** Calling `setAtom(ctx, atom1, v1)` and
`setAtom(ctx, atom2, v2)` in the same request where `atom1` and `atom2` have the
same `key` string throws `"Duplicate atom key 'x' in the same request"`.

**Why it happens:** `setAtom()` checks `map.has(key)` and throws if already set.
This is intentional — the decision in Phase 04 was "hard error at registration
time."

**How to avoid:** Each serializable atom must have a globally unique key string.
Use namespaced keys like `"myapp/count"`.

## Code Examples

Verified patterns from source:

### Server: Declare and Use a Serializable Atom

```typescript
// atoms.ts — module-level, shared between server and island
// Source: packages/examples/effect-integration/atoms.ts (verified)
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";

export const todoListAtom = Atom.serializable(
  Atom.make<Todo[]>([]),
  { key: "todo-list", schema: Schema.mutable(Schema.Array(TodoSchema)) },
);

// route handler
import { setAtom } from "@fresh/plugin-effect";
// or (preferred):
import { setAtom } from "@fresh/effect";

export const handler = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const todos = yield* TodoService.list();
      setAtom(ctx, todoListAtom, todos); // encodes + stores in per-request map
      return page({ todos });
    }),
});
```

### Client: Use Atom in Island (Hydrated Automatically)

```typescript
// islands/TodoApp.tsx
// Source: packages/examples/effect-integration/islands/TodoApp.tsx (verified)
import { useAtom } from "@fresh/effect/island";
// or (deprecated compat):
import { useAtom } from "@fresh/plugin-effect/island";
import { todoListAtom } from "../atoms.ts";

export default function TodoApp() {
  const [todos, setTodos] = useAtom(todoListAtom);
  // `todos` is the server-hydrated value on first render — no loading flash
  // ...
}
```

### Server Hook Registration (createEffectApp does this automatically)

```typescript
// Source: packages/effect/src/app.ts lines 888-897 (verified)
setAtomHydrationHook((ctx) => serializeAtomHydration(ctx));
setAtomHydrationHookForApp(app, (ctx) => serializeAtomHydration(ctx));
app.use((ctx) => {
  initAtomHydrationMap(ctx);
  return ctx.next();
});
```

### HTML Output (what the browser receives)

```html
<!-- Emitted by FreshRuntimeScript for atom state -->
<script id="__FRSH_ATOM_STATE" type="application/json" nonce="...">
  { "todo-list": [{ "id": "1", "text": "Buy milk", "done": false }] }
</script>
<!-- Then the boot script -->
<script type="module" nonce="...">
  import { boot } from "/.../runtime-client.js";
  import TodoApp from "/.../TodoApp.js";
  boot({ TodoApp }, "...");
</script>
```

### What Triggers Atom Auto-Init on Client

```typescript
// Source: packages/effect/src/island-atoms.ts lines 37-51 (verified)
// This module-level block runs at import time (when the island module is imported)
// It runs BEFORE boot() calls revive() which schedules renders via postTask/setTimeout
if (typeof globalThis.document !== "undefined") {
  const el = globalThis.document.getElementById("__FRSH_ATOM_STATE");
  if (el?.textContent) {
    try {
      const data = JSON.parse(el.textContent);
      for (const [key, encoded] of Object.entries(data)) {
        registry.setSerializable(key, encoded);
      }
    } catch { /* silently skip malformed data */ }
  }
}
```

## The Actual Gap Analysis: What Phase 12 Needs to Decide

The phase 12 spec asks for a decision document. Here is the gap analysis that
should drive it:

### What is already complete and working

1. Server-side: `setAtom(ctx, atom, value)` stores encoded atom values per
   request
2. Server-side: `FreshRuntimeScript` emits `__FRSH_ATOM_STATE` JSON script tag
   (full-page renders only)
3. Client-side: Auto-init at module load reads `__FRSH_ATOM_STATE` and pre-seeds
   `AtomRegistry`
4. Client-side: `useAtomValue/useAtomSet/useAtom` hooks read from the same
   registry
5. The two hydration channels (island props / atom state) are fully independent
   and non-conflicting
6. Signal stringifiers in the island props pipeline remain for backward compat
   but are orthogonal

### What is NOT complete / the genuine gaps

1. **Partial hydration gap:** `__FRSH_ATOM_STATE` is only emitted on full-page
   renders. Partial navigation (Fresh Partials) does not emit atom updates. This
   is undocumented and potentially surprising.

2. **Dead per-app hook:** `setAtomHydrationHookForApp` exists in `app.ts` and
   `internals.ts` but `FreshRuntimeScript` never calls it. Either wire it up or
   remove it to reduce confusion.

3. **Global hook is last-writer-wins:** Single-app usage is fine; multi-app is
   not. The `_atomHydrationHook` in `segments.ts` is a single slot, not a
   registry. The architecture document should clarify the intended scope.

4. **hydration.ts duplication:** `packages/plugin-effect/src/hydration.ts` and
   `packages/effect/src/hydration.ts` are identical files. Phase 12's decision
   doc should document whether this is intentional (the deprecated plugin
   re-exports from @fresh/effect) or a maintenance hazard.

5. **`Atom.serializable()` API inconsistency in codebase:** The Phase 04
   research used `Atom.make(0).pipe(Atom.serializable(...))` while the actual
   implementation in `atoms.ts` uses
   `Atom.serializable(Atom.make(0), { key, schema })`. The API form changed
   between Effect beta versions. The correct current form should be explicitly
   documented.

6. **No validation that `encode()` output is JSON-safe:**
   `serializeAtomHydration()` calls `JSON.stringify()` without a try/catch or
   type guard. A schema that produces non-JSON output would throw during SSR.

### Decision question for this phase

"Does atom-based hydration replace signal hydration, layer on top, or require a
new protocol?"

**Research-grounded answer:**

- **It layers on top** — they are parallel channels. Signal hydration (island
  props) remains unchanged and handles per-island component props. Atom
  hydration handles global reactive state that crosses island boundaries.
- **No replacement needed** — atoms are not signals. Signals are Preact
  primitives for component reactivity. Atoms are Effect v4 primitives for
  application state. They serve different purposes.
- **No new protocol needed** — the existing `__FRSH_ATOM_STATE` script tag
  approach is the correct design. It matches the global scope of the
  `AtomRegistry` singleton.
- **The protocol is complete** — the wire format is `{ [atomKey]: encoded }`
  where encoded is whatever `schema.encode()` produces. No changes to the
  protocol are needed.

## State of the Art

| Old Approach                                         | Current Approach                                                    | When Changed        | Impact                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| Phase 03: only client-side atoms with default values | Phase 04: server-sets atom values, client reads pre-seeded registry | Phase 04 (Feb 2026) | No loading flash; atoms start with server-computed value                      |
| `Atom.make(0).pipe(Atom.serializable(...))`          | `Atom.serializable(Atom.make(0), { key, schema })`                  | Effect beta.20      | API change; pipe form may fail; use combinator form                           |
| `effectPlugin()` from `@fresh/plugin-effect`         | `createEffectApp()` from `@fresh/effect`                            | Phase 07            | `effectPlugin()` is deprecated but still works; both register hydration hooks |

**Deprecated/outdated:**

- `effectPlugin()` from `@fresh/plugin-effect`: deprecated but functional;
  re-exports from `@fresh/effect`
- `@fresh/plugin-effect/island` `useAtom` import: deprecated; now re-exports
  from `@fresh/effect/island`

## Open Questions

1. **Should the per-app hook replace the global hook?**
   - What we know: `#atomHydrationHook` on `App` exists and is set, but
     `FreshRuntimeScript` uses `getAtomHydrationHook()` (global, from
     segments.ts), not the per-app variant
   - What's unclear: Is the per-app hook intended to eventually drive
     `FreshRuntimeScript` for true multi-app isolation?
   - Recommendation: Document in the decision doc that the per-app hook is
     deferred infrastructure. If multi-app isolation is a goal, wire
     `FreshRuntimeScript` to look up the hook from the `RenderState.ctx`'s app
     instance rather than the global slot.

2. **Should atom state be included in Partial renders?**
   - What we know: Fresh Partials use a separate branch in `FreshRuntimeScript`
     that does NOT emit `__FRSH_ATOM_STATE`
   - What's unclear: Is this acceptable? If a partial updates server-side atom
     state, should the client be notified?
   - Recommendation: For now, document this as a known limitation. The
     workaround is to use RPC streams for state that needs to update after
     navigation.

3. **Should `hydration.ts` be deduplicated?**
   - What we know: `plugin-effect/src/hydration.ts` and
     `effect/src/hydration.ts` are identical. The plugin's `mod.ts` re-exports
     from `@fresh/effect` for some symbols but has its own hydration.ts copy.
   - What's unclear: Is the local copy in plugin-effect needed because
     `@fresh/effect` is not in `@fresh/plugin-effect`'s deno.json?
   - Recommendation: Check if `@fresh/plugin-effect`'s `mod.ts` import of
     `@fresh/effect` works via the workspace (root deno.json) or if the local
     hydration.ts is necessary for JSR publishing. Document the rationale.

## Sources

### Primary (HIGH confidence)

- `packages/fresh/src/runtime/server/preact_hooks.ts` (full source read,
  verified) — `RenderState`, `FreshRuntimeScript`, signal `stringifiers`,
  `getAtomHydrationHook()` call, `__FRSH_ATOM_STATE` emission, partial vs
  full-page branch
- `packages/fresh/src/runtime/client/reviver.ts` (full source read, verified) —
  `boot()`, `CUSTOM_PARSER` with Signal/Computed revivers, `_walkInner` DOM
  walker, island marker parsing
- `packages/fresh/src/jsonify/stringify.ts` (full source read, verified) —
  `stringify()`, `Stringifiers` type, custom stringifier pattern
- `packages/fresh/src/jsonify/parse.ts` (full source read, verified) —
  `parse()`, `CustomParser` type
- `packages/fresh/src/segments.ts` (full source read, verified) —
  `_atomHydrationHook`, `setAtomHydrationHook()`, `getAtomHydrationHook()`
- `packages/fresh/src/app.ts` (full source read, verified) —
  `#atomHydrationHook`, `setAtomHydrationHookForApp`,
  `getAtomHydrationHookForApp`
- `packages/fresh/src/internals.ts` (full source read, verified) — exports for
  plugin use
- `packages/effect/src/hydration.ts` (full source read, verified) — `setAtom()`,
  `serializeAtomHydration()`, `initAtomHydrationMap()`
- `packages/effect/src/island-atoms.ts` (full source read, verified) —
  module-level auto-init, `initAtomHydration()`,
  `useAtomValue/useAtomSet/useAtom`, `_hydratedKeys`
- `packages/effect/src/app.ts` (full source read, verified) —
  `createEffectApp()` hook registration, middleware setup
- `packages/effect/src/island.ts` (full source read, verified) — RPC hooks,
  `getBrowserRuntime()`, re-exports atom hooks
- `packages/plugin-effect/src/hydration.ts` (full source read, verified) —
  confirms identical copy to effect/src/hydration.ts
- `packages/plugin-effect/src/mod.ts` (full source read, verified) —
  `effectPlugin()` deprecated, hook registration, re-exports
- `packages/plugin-effect/src/island.ts` (full source read, verified) —
  re-exports from `@fresh/effect/island`
- `packages/examples/effect-integration/atoms.ts` (full source read, verified) —
  `Atom.serializable()` combinator form (current API)
- `packages/examples/effect-integration/islands/TodoApp.tsx` (full source read,
  verified) — `useAtom(todoListAtom)` in island
- `packages/examples/effect-integration/routes/index.tsx` (full source read,
  verified) — `setAtom(ctx, todoListAtom, todos)` in handler
- `.planning/phases/04-atom-hydration/04-RESEARCH.md` (read, verified) — prior
  research; confirms architecture decisions
- `.planning/phases/04-atom-hydration/04-01-SUMMARY.md` (read, verified) —
  confirms Phase 04 completion
- `.planning/phases/04-atom-hydration/04-02-SUMMARY.md` (read, verified) —
  confirms Phase 04-02 completion

### Secondary (MEDIUM confidence)

None required — all critical facts verified at source level.

### Tertiary (LOW confidence)

None.

## Metadata

**Confidence breakdown:**

- Current hydration system (both channels): HIGH — read every relevant source
  file end-to-end
- Gap analysis (partial renders, dead per-app hook, duplication): HIGH —
  identified from direct source inspection
- Decision rationale (layer vs replace): HIGH — follows directly from
  understanding both systems
- API compatibility (Atom.serializable form): HIGH — confirmed from working
  example code

**Research date:** 2026-02-28 **Valid until:** 2026-03-28 (stable codebase;
re-verify if Effect beta version bumps or if Phase 11's programmatic plugin work
changes app.ts)
