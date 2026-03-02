/**
 * Server-side atom hydration helpers for @fresh/effect.
 *
 * Per-request state (hydration map, effect runner) is stored in module-level
 * WeakMaps keyed on the request ctx object. This keeps ctx.state purely for
 * user domain data and avoids runtime casts.
 */

import * as Atom from "effect/unstable/reactivity/Atom";
import type { Effect } from "effect";

// ---------------------------------------------------------------------------
// Hydration map storage
// ---------------------------------------------------------------------------

// Module-level WeakMap: ctx → per-request atom hydration Map.
// WeakMap ensures the Map is GC'd when ctx goes out of scope (end of request).
const hydrationMaps = new WeakMap<object, Map<string, unknown>>();

/**
 * Typed view of a serializable atom's internal data.
 * Used after Atom.isSerializable() guard to access the [SerializableTypeId]
 * slot without an `as any` escape. encode is typed with the concrete A so
 * callers get type-safe encoding.
 */
interface SerializableAtom<A> {
  readonly [Atom.SerializableTypeId]: {
    readonly key: string;
    readonly encode: (value: A) => unknown;
  };
}

/**
 * Set an atom value for server-side hydration. The value will be serialized
 * into the __FRSH_ATOM_STATE script tag and sent to the client.
 *
 * Requires:
 * - The atom must be wrapped with Atom.serializable({ key, schema })
 * - Each atom key must be unique within a single request
 *
 * @throws If atom is not serializable (missing Atom.serializable wrapper)
 * @throws If atom key is duplicated within the same request
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
    // Lazily create the per-request Map on first setAtom call.
    // Multiple EffectApp instances on the same request share one Map
    // because they all receive the same ctx object.
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
 * Returns null if no atoms were set on this request.
 *
 * Called by the atom hydration hook registered in createEffectApp().
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
 * Idempotent — a second call does not reset the map.
 *
 * @internal Not part of the public API. Use setAtom() directly — it lazily
 * creates the map on first call. Only call this when you need to pre-register
 * the map slot before any setAtom call (e.g., to merge maps across multiple apps).
 */
export function _initAtomHydrationMap<S = unknown>(ctx: { state: S }): void {
  if (!hydrationMaps.has(ctx)) {
    hydrationMaps.set(ctx, new Map<string, unknown>());
  }
}

// ---------------------------------------------------------------------------
// Per-request Effect runner storage
// ---------------------------------------------------------------------------

type RequestRunner = (
  eff: Effect.Effect<unknown, unknown, never>,
) => Promise<unknown>;

// Module-level WeakMap: ctx → per-request Effect runner bound to the host's
// ManagedRuntime. Set by createEffectApp()'s internal middleware.
const requestRunners = new WeakMap<object, RequestRunner>();

/**
 * Store the Effect runner for this request's ctx.
 * Called by createEffectApp()'s internal middleware before route handlers run.
 * @internal
 */
export function _setRequestRunner(
  ctx: object,
  runner: RequestRunner,
): void {
  requestRunners.set(ctx, runner);
}

/**
 * Run an Effect using the host EffectApp's runtime.
 * Returns `Promise<A>` — a valid Fresh route handler return type.
 *
 * Use this from plugin route handlers instead of casting an Effect to Response.
 * The host EffectApp provides all required services at runtime; TypeScript
 * cannot verify cross-app service provision statically (R is unconstrained).
 *
 * @example
 * ```ts
 * app.post("/increment", (ctx) =>
 *   runEffect(ctx, Effect.gen(function* () {
 *     const svc = yield* MyService;
 *     return Response.json({ ok: true });
 *   }))
 * );
 * ```
 *
 * @throws If called outside of an EffectApp request context.
 */
export function runEffect<A>(
  ctx: object,
  eff: Effect.Effect<A, unknown, never>,
): Promise<A> {
  const runner = requestRunners.get(ctx);
  if (!runner) {
    throw new Error(
      "runEffect() called outside of an EffectApp request context. " +
        "Ensure the plugin is mounted on a host EffectApp.",
    );
  }
  return runner(eff as Effect.Effect<unknown, unknown, never>) as Promise<A>; // cast: runner erases A at runtime
}
