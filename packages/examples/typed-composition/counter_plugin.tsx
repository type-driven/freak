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

import { App, createPlugin, type Plugin } from "@fresh/core";
import { runEffect, setAtom } from "@fresh/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import { CounterIsland } from "./counter_island.tsx";
export { CounterIsland } from "./counter_island.tsx";

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
      reset: () => {
        count = 0;
      },
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
// Plugin app factory
// ---------------------------------------------------------------------------

export function createCounterPlugin<S = unknown>(): Plugin<
  Record<string, never>,
  S,
  CounterServiceShape
> {
  return createPlugin<Record<string, never>, S, CounterServiceShape>(
    {},
    (_config) => {
      const app = new App<S>();

      app.islands({ CounterIsland }, "counter-island");

      app.get("/count", (ctx) =>
        runEffect(
          ctx,
          Effect.gen(function* () {
            const svc = yield* CounterService;
            return Response.json({ count: svc.get() });
          }),
        ));

      app.post("/increment", (ctx) =>
        runEffect(
          ctx,
          Effect.gen(function* () {
            const svc = yield* CounterService;
            const newCount = svc.increment();
            setAtom(ctx, counterAtom, newCount);
            return Response.json({ count: newCount });
          }),
        ));

      app.post("/reset", (ctx) =>
        runEffect(
          ctx,
          Effect.gen(function* () {
            const svc = yield* CounterService;
            svc.reset();
            return Response.json({ count: 0 });
          }),
        ));

      return app;
    },
  );
}
