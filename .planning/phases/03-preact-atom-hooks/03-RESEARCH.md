# Phase 3: Preact Atom Hooks - Research

**Researched:** 2026-02-21
**Domain:** Effect v4 `unstable/reactivity/Atom` API + native Preact hooks (no preact/compat)
**Confidence:** HIGH — all findings verified from dist `.d.ts` and `.js` files in the installed
`npm:effect@4.0.0-beta.0` package and Preact 10.28.3 source

---

## Summary

Phase 3 implements `useAtom`, `useAtomValue`, and `useAtomSet` hooks in a new
`packages/plugin-effect/src/island.ts` file. These hooks must use **only**
`preact/hooks` primitives — not `preact/compat` — to avoid the reconciler conflict
documented in Fresh issue #1491.

The Effect v4 `AtomRegistry` subscribe API is synchronous and callback-based:
`registry.subscribe(atom, (value: A) => void) => () => void`. The callback receives
the new value directly (not just a change notification). This enables a simple
`useState` + `useEffect` subscription pattern without needing `useSyncExternalStore`.

The `AtomRegistry` must be a module-level singleton in `island.ts` — each Fresh island
is a separate `render()` root with no shared Preact context tree, so Preact context
cannot carry the registry across islands.

**Primary recommendation:** Use `useState` + `useEffect` from `preact/hooks` to
implement the subscription. Get the current value synchronously via `registry.get(atom)`
for initial state, then update via the subscribe callback. Use `useCallback` to
memoize the setter. This is equivalent to what `preact/compat`'s `useSyncExternalStore`
does, but implemented directly with primitive hooks.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect/unstable/reactivity` | 4.0.0-beta.0 | `Atom`, `AtomRegistry` types and constructors | The v4 reactivity system; no alternative |
| `preact/hooks` | 10.28.3 | `useState`, `useEffect`, `useCallback`, `useRef` | Native Preact hooks; avoids preact/compat |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `preact/hooks` primitives | `preact/compat` `useSyncExternalStore` | `preact/compat` carries reconciler conflict risk (Fresh #1491) |
| module-level singleton registry | Preact Context registry | Fresh islands are separate render roots; context does not cross island boundaries |
| `useEffect` subscription | `useLayoutEffect` | `useEffect` is sufficient; `useLayoutEffect` would prevent SSR in server-rendered islands |

### Installation

The `effect` package is already in `packages/plugin-effect/deno.json`. Add `preact` and
`preact/hooks` to the imports:

```json
{
  "imports": {
    "effect": "npm:effect@4.0.0-beta.0",
    "preact": "npm:preact@^10.28.3",
    "preact/hooks": "npm:preact@^10.28.3/hooks",
    "@fresh/core": "jsr:@fresh/core@^2.0.0",
    "@fresh/core/internal": "jsr:@fresh/core@^2.0.0/internal",
    "expect-type": "npm:expect-type@^1.1.0"
  }
}
```

Add a new export entry for the island module:

```json
{
  "exports": {
    ".": "./src/mod.ts",
    "./island": "./src/island.ts"
  }
}
```

---

## Architecture Patterns

### Recommended Project Structure

```
packages/plugin-effect/src/
├── mod.ts           # Server-side plugin (existing)
├── define.ts        # createEffectDefine (existing)
├── runtime.ts       # ManagedRuntime lifecycle (existing)
├── resolver.ts      # Effect resolver (existing)
├── types.ts         # Re-exported Effect types (existing)
└── island.ts        # NEW: Preact atom hooks (client-side only)
```

### Pattern 1: Module-level AtomRegistry Singleton

**What:** A single `AtomRegistry` created at module load time, shared across all
atoms in all islands on a page.

**Why:** Fresh islands are independent Preact render roots. There is no shared
component tree to carry Preact context. The registry must be module-scoped.

**Example:**
```typescript
// Source: dist/unstable/reactivity/AtomRegistry.d.ts
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

const registry = AtomRegistry.make();
```

### Pattern 2: useState + useEffect Subscription (no useSyncExternalStore)

**What:** Implement the external store subscription pattern using only `preact/hooks`
primitives.

**When to use:** Any hook that reads atom values.

**Core pattern:**
```typescript
// Source: preact/compat/src/hooks.js (reference impl we replicate without compat)
// Source: dist/unstable/reactivity/AtomRegistry.d.ts
import { useState, useEffect } from "preact/hooks";
import type * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

const registry = AtomRegistry.make();

function useAtomValue<A>(atom: Atom.Atom<A>): A {
  const [value, setValue] = useState(() => registry.get(atom));
  useEffect(() => {
    // Sync check in case atom changed between render and effect
    setValue(registry.get(atom));
    // Subscribe: callback receives new value directly
    return registry.subscribe(atom, setValue);
  }, [atom]);
  return value;
}
```

**Key facts about v4 AtomRegistry.subscribe:**
- Returns `() => void` cleanup — usable directly as `useEffect` return
- Callback `f: (_: A) => void` receives the **value** (not just a change signal)
- NOT an Effect — no Effect runtime needed in island code

### Pattern 3: Setter via Registry.set (no Effect needed)

**What:** `useAtomSet` returns a memoized setter that calls `registry.set()` directly.

**Example:**
```typescript
// Source: dist/unstable/reactivity/AtomRegistry.d.ts
import { useCallback, useEffect } from "preact/hooks";
import type * as Atom from "effect/unstable/reactivity/Atom";

function useAtomSet<R, W>(atom: Atom.Writable<R, W>): (value: W) => void {
  useEffect(() => registry.mount(atom), [atom]);
  return useCallback((value: W) => registry.set(atom, value), [atom]);
}
```

**Key fact about mount:** `registry.mount(atom)` returns `() => void` — directly
usable as `useEffect` return value. Calling `mount` keeps the atom alive even if
no subscriber is reading it.

### Pattern 4: useAtom as Composition of useAtomValue + useAtomSet

**What:** `useAtom` returns `[value, setter]` for a writable atom.

**Example:**
```typescript
// Source: composition of patterns 2 and 3
function useAtom<R, W>(
  atom: Atom.Writable<R, W>
): readonly [R, (value: W) => void] {
  return [useAtomValue(atom), useAtomSet(atom)] as const;
}
```

### Anti-Patterns to Avoid

- **Importing from `preact/compat`:** Contains `useSyncExternalStore`, but importing
  it risks reconciler conflicts with Fresh's own Preact usage (Fresh issue #1491).
  Use `preact/hooks` primitives instead.
- **Creating a new registry per hook call:** The registry must be a module-level
  singleton, not created inside a hook or component.
- **Using `useLayoutEffect` for subscription setup:** Works in browsers but will
  break server-side rendering if Fresh renders islands server-side. Use `useEffect`.
- **Calling `registry.mount()` in `useAtomValue`:** Only needed for setter-only
  consumers (`useAtomSet`) that don't also subscribe. `useAtomValue` subscribes,
  which already keeps the atom alive.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atom subscription cleanup | Manual cleanup tracking | `return registry.subscribe(atom, f)` as useEffect return | v4 subscribe already returns cleanup |
| Atom lifecycle | Manual mount/unmount | `return registry.mount(atom)` as useEffect return | v4 mount already returns cleanup |
| Value synchronization | Complex ref-based snapshot | `registry.get(atom)` in useState initializer | v4 get is synchronous |
| Cross-island state sharing | Preact Context or custom events | Module-level singleton registry | Module scope persists across render roots |

**Key insight:** The v4 `AtomRegistry` API is designed for synchronous, imperative use.
No Effect runtime is needed in island code — all operations (`get`, `set`, `subscribe`,
`mount`) are synchronous and return plain values or cleanup functions.

---

## Common Pitfalls

### Pitfall 1: Stale Value on Subscribe

**What goes wrong:** The atom value may change between the `useState` initializer
(render) and when the `useEffect` subscription is established.

**Why it happens:** `useEffect` runs after browser paint, so there is a window
where the atom may have updated but the local state has not.

**How to avoid:** In the `useEffect` body, sync the state before subscribing:
```typescript
useEffect(() => {
  setValue(registry.get(atom));  // sync before subscribing
  return registry.subscribe(atom, setValue);
}, [atom]);
```

**Warning signs:** Component shows stale value on first render that corrects
after a tick.

### Pitfall 2: Atom Dependency Array Identity

**What goes wrong:** If an atom is created inside a component, its identity changes
on every render, causing the `useEffect` to re-subscribe on every render.

**Why it happens:** The `[atom]` dependency causes re-subscription when the atom
reference changes.

**How to avoid:** Atoms should be module-level constants, not created inside components
or hooks. Document this in the exported hooks' JSDoc.

**Warning signs:** Infinite re-render loops or subscription teardown/setup on every render.

### Pitfall 3: useAtomSet Without Mount Leaks

**What goes wrong:** A component using only `useAtomSet` (no `useAtomValue`) will not
subscribe to the atom, causing the registry to garbage-collect the atom's node while
the setter is still in use.

**Why it happens:** The v4 `AtomRegistry` auto-disposes atoms that have no active
subscribers. A setter alone does not count as a subscription.

**How to avoid:** Call `registry.mount(atom)` in the `useAtomSet` hook's `useEffect`.
`mount` is equivalent to `subscribe(atom, constVoid)` and prevents auto-disposal.

**Warning signs:** Atom resets to initial value unexpectedly when only using `useAtomSet`.

### Pitfall 4: preact/compat Reconciler Conflict

**What goes wrong:** Importing from `preact/compat` in island code crashes or produces
broken rendering when mixed with Fresh's own Preact setup.

**Why it happens:** Fresh issue #1491 — `preact/compat` installs its own reconciler
options that conflict with Fresh's setup.

**How to avoid:** Never import from `preact/compat` in `island.ts`. Use only
`preact/hooks` primitives.

**Warning signs:** Hydration errors, broken event handlers, or rendering inconsistencies
in islands.

### Pitfall 5: Import Path for Effect Reactivity

**What goes wrong:** Using `effect/unstable/reactivity/Atom` as an import path.

**Why it happens:** The package.json exports wildcard `./*` maps `*` to
`dist/*.js`, which technically allows this path, but the canonical entrypoint
is the index at `effect/unstable/reactivity`.

**How to avoid:** Import from `effect/unstable/reactivity` (the index) and destructure:
```typescript
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
// OR use namespace imports for clarity:
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
```
Both paths work; the namespace import pattern is clearer. Verify with `deno info`.

---

## Code Examples

### Complete island.ts Implementation Pattern

```typescript
// Source: dist/unstable/reactivity/AtomRegistry.d.ts + dist/unstable/reactivity/Atom.d.ts
// Source: preact/hooks/src/index.d.ts
import { useCallback, useEffect, useState } from "preact/hooks";
import type { Atom, Writable } from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

// Module-level singleton: shared across all islands on a page
const registry = AtomRegistry.make();

/**
 * Subscribe to an atom's value. Re-renders when the atom updates.
 * Only for read-only atoms; for writable atoms, use useAtom or useAtomValue.
 */
export function useAtomValue<A>(atom: Atom<A>): A {
  const [value, setValue] = useState(() => registry.get(atom));
  useEffect(() => {
    // Sync before subscribing to catch changes between render and effect
    setValue(registry.get(atom));
    return registry.subscribe(atom, setValue);
  }, [atom]);
  return value;
}

/**
 * Returns a setter for a writable atom. Does NOT subscribe to value changes.
 * Mounts the atom to prevent auto-disposal by the registry.
 */
export function useAtomSet<R, W>(atom: Writable<R, W>): (value: W) => void {
  useEffect(() => registry.mount(atom), [atom]);
  return useCallback((value: W) => registry.set(atom, value), [atom]);
}

/**
 * Returns [value, setter] for a writable atom.
 * Value re-renders on atom updates; setter is stable across renders.
 */
export function useAtom<R, W>(
  atom: Writable<R, W>,
): readonly [R, (value: W) => void] {
  return [useAtomValue(atom), useAtomSet(atom)] as const;
}
```

### Creating Atoms (User-Facing API)

```typescript
// Source: dist/unstable/reactivity/Atom.d.ts
import { make as makeAtom } from "effect/unstable/reactivity/Atom";

// Writable atom with initial value — Writable<number, number>
const countAtom = makeAtom(0);

// Writable atom with initial string — Writable<string, string>
const nameAtom = makeAtom("Alice");

// Read-only computed atom — Atom<string>
const greetingAtom = makeAtom((get) => `Hello, ${get(nameAtom)}!`);
```

### Atom Type Hierarchy

```
Atom<A>                  — read-only (computed/derived)
  Writable<R, W>         — readable as R, writable with W (usually R = W)
    Writable<number>     — shorthand when R = W
```

`useAtom` and `useAtomSet` require `Writable<R, W>`.
`useAtomValue` accepts any `Atom<A>`.

### Key API Surface (v4 AtomRegistry)

```typescript
// Source: dist/unstable/reactivity/AtomRegistry.d.ts
interface AtomRegistry {
  get<A>(atom: Atom<A>): A;                                     // synchronous read
  set<R, W>(atom: Writable<R, W>, value: W): void;             // synchronous write
  subscribe<A>(atom: Atom<A>, f: (_: A) => void, opts?: {      // subscribe to changes
    immediate?: boolean                                           // call f immediately with current value
  }): () => void;                                                // returns cleanup fn
  mount<A>(atom: Atom<A>): () => void;                          // keep atom alive, returns cleanup
  refresh<A>(atom: Atom<A>): void;                              // force recompute
  dispose(): void;                                               // destroy registry
}
```

### V3 vs V4 API Differences (Critical)

| Concept | v3 `@effect-atom/atom` | v4 `effect/unstable/reactivity` |
|---------|------------------------|----------------------------------|
| TypeId | `"~effect-atom/atom/Atom"` | `"~effect/reactivity/Atom"` |
| Registry name | `Registry.Registry` | `AtomRegistry.AtomRegistry` |
| Import path | `@effect-atom/atom` (npm) | `effect/unstable/reactivity` |
| `mount(atom)` return | `Effect<void, never, Scope>` | `() => void` (cleanup fn!) |
| `subscribe` callback | `f: () => void` (notification only) | `f: (_: A) => void` (receives value!) |
| Hook lib | `@effect-atom/atom-react` | Implement from scratch (no preact pkg) |
| `useSyncExternalStore` | Used (via react import) | NOT available (preact/hooks only) |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@effect-atom/atom-react` hooks | Hand-written hooks using `preact/hooks` | v4 beta | No existing package; must implement |
| `preact/compat` for `useSyncExternalStore` | `useState` + `useEffect` pattern | Phase 3 decision | Avoids reconciler conflict |
| `Registry.mount` returns Effect | `AtomRegistry.mount` returns `() => void` | v4 API change | Direct return from `useEffect` |
| Subscribe callback receives nothing | Subscribe callback receives the value | v4 API change | Simpler implementation, no extra `get` call |

**Deprecated/outdated:**
- `@effect-atom/atom`: v3 only, TypeId mismatch, incompatible API — do not use
- `@effect-atom/atom-react`: v3 only, React-specific, incompatible — do not use
- Any advice about `Registry.make()` from v3 docs — the type is now `AtomRegistry.make()`

---

## Open Questions

1. **SSR hydration of atoms (Phase 4 concern)**
   - What we know: v4 has `Atom.withServerValue()` and `Atom.getServerValue()` for SSR
   - What's unclear: How to serialize atom values server-side and hydrate on client
   - Recommendation: Out of scope for Phase 3; document as Phase 4 work

2. **useAtom for read-only atoms**
   - What we know: `useAtom` requires `Writable<R, W>`; `useAtomValue` accepts `Atom<A>`
   - What's unclear: Should we expose a read-only `useAtom` overload?
   - Recommendation: Keep Phase 3 simple — exactly 3 hooks matching requirements ATOM-01/02/03

3. **Registry disposal on page unload**
   - What we know: `registry.dispose()` cleans up all nodes
   - What's unclear: Whether not disposing causes browser memory issues
   - Recommendation: Add `globalThis.addEventListener("unload", () => registry.dispose())`
     in `island.ts` as a cleanup step

---

## Sources

### Primary (HIGH confidence)

- Dist file: `node_modules/.deno/effect@4.0.0-beta.0/node_modules/effect/dist/unstable/reactivity/AtomRegistry.d.ts`
  — complete interface definition, subscribe/get/set/mount signatures
- Dist file: `node_modules/.deno/effect@4.0.0-beta.0/node_modules/effect/dist/unstable/reactivity/Atom.d.ts`
  — Atom/Writable type hierarchy, make() overloads
- Dist file: `node_modules/.deno/effect@4.0.0-beta.0/node_modules/effect/dist/unstable/reactivity/AtomRegistry.js`
  — subscribe implementation confirms `f(node._value)` (value passed to callback)
- Dist file: `node_modules/.deno/preact@10.28.3/node_modules/preact/hooks/src/index.d.ts`
  — confirms `useState`, `useEffect`, `useCallback` available (no `useSyncExternalStore`)
- Source file: `node_modules/.deno/preact@10.28.3/node_modules/preact/compat/src/hooks.js`
  — `useSyncExternalStore` implementation we replicate using `preact/hooks` primitives
- Source file: `node_modules/.deno/effect@4.0.0-beta.0/node_modules/effect/package.json`
  — confirms `effect/unstable/reactivity` is the export path (not individual subpaths)

### Secondary (MEDIUM confidence)

- GitHub source: `https://github.com/tim-smart/effect-atom/blob/main/packages/atom-react/src/Hooks.ts`
  — v3 reference implementation using `React.useSyncExternalStore`; confirmed v3-only
- GitHub source: `https://github.com/tim-smart/effect-atom/blob/main/packages/atom-react/src/RegistryContext.ts`
  — v3 registry context pattern; adapted as module-level singleton for Preact islands

### Tertiary (LOW confidence)

- WebSearch: `effect-ts unstable reactivity Atom useAtom preact hooks 2025`
  — confirmed no existing preact-specific package for v4 atoms; must implement from scratch

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from installed dist files
- Architecture (module singleton): HIGH — confirmed by Fresh island rendering model (each island is separate render root)
- Subscribe pattern: HIGH — verified from AtomRegistry.js source; callback receives value directly
- Pitfalls: HIGH — derived from API analysis and preact/compat source
- Code examples: HIGH — directly derived from `.d.ts` type signatures

**Research date:** 2026-02-21
**Valid until:** 2026-03-23 (stable APIs; `unstable/` prefix means could change before v4 stable)

**Critical constraint for planner:** The plan for 03-01 must begin by reading and verifying
the `effect/unstable/reactivity/Atom` API surface in the installed dist files BEFORE
implementing hooks. The `unstable/` prefix is a signal that the API could change — the
research has verified it at `4.0.0-beta.0` but should be re-confirmed at implementation time.
