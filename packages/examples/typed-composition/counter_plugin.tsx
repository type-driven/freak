/**
 * counter_plugin.tsx — a self-contained plugin app demonstrating typed composition.
 *
 * The plugin:
 * - Defines its own Effect service (CounterService)
 * - Registers an island component (CounterIsland) via app.islands()
 * - Defines a serializable atom for SSR hydration
 * - Exposes routes whose handlers return Effect values — run by the
 *   host EffectApp's runtime after mountApp()
 *
 * Key point: the plugin does NOT create its own ManagedRuntime. It relies on
 * the host EffectApp to provide CounterService via mountApp(). The plugin's
 * Effect handlers are merged into the host's command list and executed using
 * the host's effectRunner.
 */

/** @jsxImportSource preact */

import { App } from "@fresh/core";
import { setAtom } from "@fresh/effect";
import { Effect, Layer, ServiceMap } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import type { VNode } from "preact";

// ---------------------------------------------------------------------------
// Effect service — provided by the host EffectApp layer
// ---------------------------------------------------------------------------

export interface CounterServiceShape {
  readonly get: () => number;
  readonly increment: () => number;
  readonly reset: () => void;
}

export const CounterService = ServiceMap.Service<CounterServiceShape>(
  "CounterService",
);

/** Simple in-memory implementation. Swap for DB-backed version in production. */
export const CounterLive = Layer.effect(
  CounterService,
  Effect.sync(() => {
    let count = 0;
    return {
      get: () => count,
      increment: () => ++count,
      reset: () => { count = 0; },
    };
  }),
);

// ---------------------------------------------------------------------------
// Shared atom — server sets it; client island reads it after hydration
// ---------------------------------------------------------------------------

export const counterAtom = Atom.serializable(Atom.make(0), {
  key: "counter",
  schema: Schema.Number,
});

// ---------------------------------------------------------------------------
// Island component — registered via app.islands(); produces SSR markers
// ---------------------------------------------------------------------------

export function CounterIsland({ initial }: { initial: number }): VNode {
  return (
    <div class="counter-island">
      <p>Count: {initial}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugin app factory
// ---------------------------------------------------------------------------

/**
 * Type cast helper for Effect-returning route handlers in a plain App<unknown>.
 *
 * `App.get/post` expects `Middleware<State>` which returns `Response | Promise<Response>`.
 * A plugin using plain `App<unknown>` (no own runtime) returns `Effect.Effect<Response>`
 * and relies on the host EffectApp's effectRunner to intercept and execute it.
 *
 * This helper localizes the cast to one place. When using `EffectApp` directly
 * (i.e., the host), the Effect-aware builder types eliminate the need for this cast.
 */
function effectRoute<R>(
  fn: Effect.Effect<Response, unknown, R>,
): Response {
  return fn as unknown as Response;
}

export function createCounterPlugin(): App<unknown> {
  const app = new App<unknown>();

  // Register CounterIsland so ctx.render() produces <!--frsh:island:--> markers.
  // These registrations propagate to the host app via mountApp().
  app.islands({ CounterIsland }, "counter-island");

  /** GET /count — returns the current count as JSON. */
  app.get("/count", (_ctx) =>
    effectRoute(Effect.gen(function* () {
      const svc = yield* CounterService;
      return Response.json({ count: svc.get() });
    }))
  );

  /**
   * POST /increment — increments and returns the new count.
   * Sets the counterAtom so the client receives the SSR hydration value.
   */
  app.post("/increment", (ctx) =>
    effectRoute(Effect.gen(function* () {
      const svc = yield* CounterService;
      const newCount = svc.increment();
      // Hydrate the atom — serialized into __FRSH_ATOM_STATE by FreshScripts
      setAtom(ctx as { state: unknown }, counterAtom, newCount);
      return Response.json({ count: newCount });
    }))
  );

  /** POST /reset — resets counter to zero. */
  app.post("/reset", (_ctx) =>
    effectRoute(Effect.gen(function* () {
      const svc = yield* CounterService;
      svc.reset();
      return Response.json({ count: 0 });
    }))
  );

  return app;
}
