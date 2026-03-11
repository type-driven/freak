/**
 * @module
 * Preact atom hooks for Effect v4 reactivity.
 *
 * Import this module in Fresh island components (client-side only).
 * Do NOT import from this module in server-side code — it depends on
 * `preact/hooks` which is client-only.
 *
 * Usage:
 * ```typescript
 * import { useAtom, useAtomValue, useAtomSet } from "@fresh/core/effect/island";
 * import { countAtom } from "../atoms.ts";
 *
 * export default function Counter() {
 *   const [count, setCount] = useAtom(countAtom);
 *   return <button onClick={() => setCount(count + 1)}>{count}</button>;
 * }
 * ```
 */

import { useCallback, useEffect, useState } from "preact/hooks";
import type { Atom, Writable } from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

// Tracks which atom keys were pre-seeded via hydration.
// Used for orphan detection (deferred — requires AtomRegistry instrumentation).
const _hydratedKeys = new Set<string>();

// Module-level singleton: shared across all atoms in all islands on a page.
// Fresh islands are separate Preact render roots with no shared component tree,
// so Preact context cannot carry the registry across islands. Module scope persists.
const registry = AtomRegistry.make();

// Auto-initialize hydration from DOM if available.
// Module-level code runs at import time, which happens BEFORE boot() calls revive().
// This ensures useAtomValue() returns the server-hydrated value on first render.
if (typeof globalThis.document !== "undefined") {
  const el = globalThis.document.getElementById("__FRSH_ATOM_STATE");
  if (el?.textContent) {
    try {
      const data = JSON.parse(el.textContent) as Record<string, unknown>;
      for (const [key, encoded] of Object.entries(data)) {
        registry.setSerializable(key, encoded);
        _hydratedKeys.add(key);
      }
    } catch {
      // Silently skip malformed data — initAtomHydration() provides the
      // explicit API with a warning for callers who need error visibility.
    }
  }
}

// Clean up registry on page unload to prevent memory leaks.
globalThis.addEventListener("unload", () => registry.dispose());

/**
 * Initialize client-side atom hydration from a `<script id="__FRSH_ATOM_STATE">`
 * tag or a serialized JSON string.
 *
 * This function is called automatically at module import time for the DOM case.
 * Use this explicit export in tests or server-rendered environments where you
 * want to pass the JSON string directly.
 *
 * @param serialized - Optional JSON string to parse. If omitted, reads from
 *   `document.getElementById("__FRSH_ATOM_STATE").textContent`.
 *
 * @example
 * ```typescript
 * // In tests (pass JSON directly):
 * initAtomHydration(JSON.stringify({ count: 42 }));
 *
 * // DOM-based hydration happens automatically at module import time.
 * ```
 */
export function initAtomHydration(serialized?: string): void {
  let json: string | null | undefined = serialized;
  if (json === undefined) {
    const el = globalThis.document?.getElementById("__FRSH_ATOM_STATE");
    if (!el) return;
    json = el.textContent;
  }
  if (!json) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json);
  } catch {
    if (typeof globalThis.console !== "undefined") {
      // deno-lint-ignore no-console
      console.warn("[fresh-effect] Malformed atom hydration data, skipping.");
    }
    return;
  }

  for (const [key, encoded] of Object.entries(data)) {
    registry.setSerializable(key, encoded);
    _hydratedKeys.add(key);
  }
}

/**
 * No-op. Active orphan detection deferred — requires AtomRegistry instrumentation.
 * @internal
 */
export function _checkOrphanedKeys(): void {
  // Active orphan detection deferred -- requires AtomRegistry instrumentation.
}

/**
 * Subscribe to an atom's value. Re-renders when the atom updates.
 *
 * Accepts any `Atom<A>` — both read-only (computed/derived) and writable atoms.
 * For writable atoms where you also need the setter, use `useAtom` instead.
 *
 * NOTE: The atom should be a module-level constant, not created inside the component.
 * If the atom reference changes on every render (e.g., created inside the component),
 * the subscription will be re-established on every render, causing performance issues
 * or infinite re-render loops.
 *
 * @example
 * ```typescript
 * // Module-level atom (correct)
 * const countAtom = Atom.make(0);
 *
 * function Counter() {
 *   const count = useAtomValue(countAtom);
 *   return <span>{count}</span>;
 * }
 * ```
 */
export function useAtomValue<A>(atom: Atom<A>): A {
  const [value, setValue] = useState(() => registry.get(atom));
  useEffect(() => {
    // Sync before subscribing to catch changes between render and effect setup.
    // useEffect runs after browser paint, so the atom may have updated in the window
    // between the useState initializer (render) and when the subscription is established.
    setValue(registry.get(atom));
    return registry.subscribe(atom, setValue);
  }, [atom]);
  return value;
}

/**
 * Returns a stable setter function for a writable atom. Does NOT subscribe to
 * value changes — the component will NOT re-render when the atom updates.
 *
 * Mounts the atom to prevent auto-disposal by the registry. The Effect v4
 * AtomRegistry auto-disposes atoms that have no active subscribers; a setter
 * alone does not count as a subscription. Mounting keeps the atom alive while
 * this hook is used.
 *
 * Requires a `Writable<R, W>` atom. For read-only (computed/derived) atoms,
 * use `useAtomValue` instead.
 *
 * NOTE: The atom should be a module-level constant, not created inside the component.
 *
 * @example
 * ```typescript
 * const countAtom = Atom.make(0);
 *
 * function IncrementButton() {
 *   const setCount = useAtomSet(countAtom);
 *   return <button onClick={() => setCount(prev => prev + 1)}>+</button>;
 * }
 * ```
 */
export function useAtomSet<R, W>(atom: Writable<R, W>): (value: W) => void {
  useEffect(() => registry.mount(atom), [atom]);
  return useCallback((value: W) => registry.set(atom, value), [atom]);
}

/**
 * Returns `[value, setter]` tuple for a writable atom.
 * The component re-renders when the atom updates. The setter is stable across renders.
 *
 * Composition of `useAtomValue` and `useAtomSet`.
 *
 * Requires a `Writable<R, W>` atom. For read-only (computed/derived) atoms,
 * use `useAtomValue` instead.
 *
 * NOTE: The atom should be a module-level constant, not created inside the component.
 * Creating atoms inside a component causes the reference to change on every render,
 * which forces re-subscription on every render.
 *
 * @example
 * ```typescript
 * const countAtom = Atom.make(0);
 *
 * function Counter() {
 *   const [count, setCount] = useAtom(countAtom);
 *   return <button onClick={() => setCount(count + 1)}>{count}</button>;
 * }
 * ```
 */
export function useAtom<R, W>(
  atom: Writable<R, W>,
): readonly [R, (value: W) => void] {
  return [useAtomValue(atom), useAtomSet(atom)] as const;
}
