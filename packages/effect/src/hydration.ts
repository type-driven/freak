/**
 * Server-side atom hydration helpers for @fresh/effect.
 *
 * These functions manage a per-request Map of atom key -> encoded value.
 * The map is stored on ctx.state[ATOM_HYDRATION_KEY] and serialized into
 * the __FRSH_ATOM_STATE script tag by FreshRuntimeScript.
 */

import * as Atom from "effect/unstable/reactivity/Atom";

// Symbol used as the key on ctx.state for the per-request hydration map.
// Symbol.for() ensures the same symbol is used across module reloads.
export const ATOM_HYDRATION_KEY = Symbol.for("fresh_atom_hydration");

/**
 * Set an atom value for server-side hydration. The value will be serialized
 * into the __FRSH_ATOM_STATE script tag and sent to the client.
 *
 * Requires:
 * - The atom must be wrapped with Atom.serializable({ key, schema })
 * - effectPlugin() middleware must be active (initializes the hydration map)
 * - Each atom key must be unique within a single request
 *
 * @throws If atom is not serializable (missing Atom.serializable wrapper)
 * @throws If atom key is duplicated within the same request
 * @throws If effectPlugin() middleware has not initialized the hydration map
 */
export function setAtom<A>(
  ctx: { state: unknown },
  atom: Atom.Atom<A>,
  value: A,
): void {
  if (!Atom.isSerializable(atom)) {
    throw new Error(
      "setAtom() requires a serializable atom. " +
        "Wrap with Atom.serializable({ key, schema }).",
    );
  }

  // deno-lint-ignore no-explicit-any
  const serializable = (atom as any)[Atom.SerializableTypeId] as {
    readonly key: string;
    readonly encode: (value: A) => unknown;
  };

  const key = serializable.key;

  const state = ctx.state as Record<string | symbol, unknown>;
  let map = state[ATOM_HYDRATION_KEY] as Map<string, unknown> | undefined;
  if (!map) {
    // Lazily create the per-request Map on first setAtom call.
    // This avoids allocating a Map on every request for routes that don't use atoms,
    // and enables multiple EffectApp instances to share the same per-request Map.
    map = new Map<string, unknown>();
    state[ATOM_HYDRATION_KEY] = map;
  }

  if (map.has(key)) {
    throw new Error(
      `Duplicate atom key "${key}" in the same request. ` +
        "Each atom must have a unique key.",
    );
  }

  const encoded = serializable.encode(value);
  map.set(key, encoded);
}

/**
 * Serialize the per-request atom hydration map to a JSON string.
 * Returns null if no atoms were set on this request.
 *
 * Called by the atom hydration hook registered in createEffectApp().
 */
export function serializeAtomHydration(
  ctx: { state: unknown },
): string | null {
  const state = ctx.state as Record<string | symbol, unknown>;
  const map = state[ATOM_HYDRATION_KEY] as Map<string, unknown> | undefined;

  if (!map || map.size === 0) return null;

  return JSON.stringify(Object.fromEntries(map));
}

/**
 * Initialize the per-request atom hydration map on ctx.state.
 * Called automatically by createEffectApp() middleware before ctx.next().
 */
export function initAtomHydrationMap(ctx: { state: unknown }): void {
  const state = ctx.state as Record<string | symbol, unknown>;
  if (!state[ATOM_HYDRATION_KEY]) {
    state[ATOM_HYDRATION_KEY] = new Map<string, unknown>();
  }
}
