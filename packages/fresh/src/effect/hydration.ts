/**
 * Server-side atom hydration helpers.
 *
 * Per-request state (hydration map, effect runner) is stored in module-level
 * WeakMaps keyed on the request ctx object.
 */

import * as Atom from "effect/unstable/reactivity/Atom";
import type { Effect } from "effect";

const hydrationMaps = new WeakMap<object, Map<string, unknown>>();

interface SerializableAtom<A> {
  readonly [Atom.SerializableTypeId]: {
    readonly key: string;
    readonly encode: (value: A) => unknown;
  };
}

/**
 * Set an atom value for server-side hydration.
 */
export function setAtom<A, S = unknown>(
  ctx: { state: S },
  atom: Atom.Atom<A>,
  value: A,
): void {
  if (!Atom.isSerializable(atom)) {
    throw new Error(
      "setAtom() requires a serializable atom. " +
        "Wrap with Atom.serializable({ key, schema }).",
    );
  }

  const { key, encode } =
    (atom as unknown as SerializableAtom<A>)[Atom.SerializableTypeId];

  let map = hydrationMaps.get(ctx);
  if (!map) {
    map = new Map<string, unknown>();
    hydrationMaps.set(ctx, map);
  }

  if (map.has(key)) {
    throw new Error(
      `Duplicate atom key "${key}" in the same request. ` +
        "Each atom must have a unique key.",
    );
  }

  map.set(key, encode(value));
}

/**
 * Serialize the per-request atom hydration map to a JSON string.
 */
export function serializeAtomHydration<S = unknown>(
  ctx: { state: S },
): string | null {
  const map = hydrationMaps.get(ctx);
  if (!map || map.size === 0) return null;
  return JSON.stringify(Object.fromEntries(map));
}

/**
 * Initialize the per-request atom hydration map on ctx.
 * @internal
 */
export function _initAtomHydrationMap<S = unknown>(ctx: { state: S }): void {
  if (!hydrationMaps.has(ctx)) {
    hydrationMaps.set(ctx, new Map<string, unknown>());
  }
}

type RequestRunner = (
  eff: Effect.Effect<unknown, unknown, never>,
) => Promise<unknown>;

const requestRunners = new WeakMap<object, RequestRunner>();

/**
 * Store the Effect runner for this request's ctx.
 * @internal
 */
export function _setRequestRunner(
  ctx: object,
  runner: RequestRunner,
): void {
  requestRunners.set(ctx, runner);
}

/**
 * Run an Effect using the host runtime.
 */
export function runEffect<A, R>(
  ctx: object,
  eff: Effect.Effect<A, unknown, R>,
): Promise<A> {
  const runner = requestRunners.get(ctx);
  if (!runner) {
    throw new Error(
      "runEffect() called outside of an EffectApp request context. " +
        "Ensure the plugin is mounted on a host EffectApp.",
    );
  }
  return runner(eff as Effect.Effect<unknown, unknown, never>) as Promise<A>;
}
