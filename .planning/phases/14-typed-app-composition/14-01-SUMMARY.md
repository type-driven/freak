# Phase 14, Plan 1: Summary

**Completed:** 2026-03-01 **Branch:** worktree-typed-composition

## What Was Accomplished

Eliminated all `as any` and forced casts from the @fresh/effect hydration +
plugin layer by introducing two architectural improvements:

1. **WeakMap-based per-request state** — `hydrationMaps` and `requestRunners`
   are module-level WeakMaps keyed on the ctx object. `ctx.state` stays purely
   user-domain; no Symbol keys, no hidden fields, GC-friendly.

2. **`SerializableAtom<A>` typed interface** — Uses `Atom.SerializableTypeId` as
   a computed property key in a structural interface. After an
   `isSerializable()` guard, the cast is `as unknown as SerializableAtom<A>`
   (safe) rather than `as any`.

3. **`runEffect(ctx, eff): Promise<A>`** — Honest return type for plugin
   handlers. The per-ctx runner is stored in the WeakMap by a middleware in
   `createEffectApp()`; `runEffect` retrieves it and executes the Effect. No
   Effect-as-Response lie at the call site.

4. **Generic hydration functions** — `setAtom<A,S>`,
   `serializeAtomHydration<S>`, `initAtomHydrationMap<S>` accept `{ state: S }`
   for any `S`. Plugin factories parameterized as `App<S>` get their
   `ctx: Context<S>` accepted without any cast.

## Key Decisions

- WeakMap on ctx (not ctx.state) — no user-visible side effects, ctx object is
  short-lived per request so WeakMap entries are GC'd automatically
- `runEffect` retrieves runner from WeakMap — decouples plugin handlers from
  EffectApp internals, no re-export of the resolver function needed
- `SerializableAtom<A>` uses `Atom.SerializableTypeId` string literal as key —
  avoids `as any`, preserves encode/key type info through the interface

## Files Changed

- `packages/effect/src/hydration.ts` — complete rewrite (WeakMaps,
  SerializableAtom, generic functions, runEffect)
- `packages/effect/src/app.ts` — added _setRequestRunner middleware
- `packages/effect/src/mod.ts` — exported runEffect
- `packages/examples/typed-composition/counter_plugin.tsx` — generic factory,
  runEffect, no casts
- `packages/effect/tests/hydration_test.ts` — removed ATOM_HYDRATION_KEY
  assertions
- `packages/effect/tests/app_test.ts` — removed ATOM_HYDRATION_KEY, rewrote
  HYDR-1/7
- `packages/fresh/tests/mount_effect_atom_test.ts` — removed stale casts
- `packages/examples/typed-composition/integration_test.ts` — 8 tests (added
  typed composition test)

## All SCs Verified

1. ✓ Generic ctx accepted — `setAtom(ctx, atom, val)` in `counter_plugin.tsx`
   with `ctx: Context<S>` compiles
2. ✓ `runEffect` return type — accepted by `app.get()` as `Promise<Response>`;
   no cast
3. ✓ ctx.state clean — WeakMap stores state; no Symbol keys in ctx.state
4. ✓ Generic plugin factory — `createCounterPlugin<HostState>()` accepted by
   `hostApp.mountApp()`

All 166 tests pass.
