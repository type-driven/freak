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

import { App, createPlugin, type Plugin } from "@fresh/core";
import { runEffect, setAtom } from "@fresh/effect";
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

/** Type-level identifier for CounterService — used as R in Plugin<Config, S, R>. */
export type CounterServiceIdentifier = typeof CounterService;

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

export function createCounterPlugin<S = unknown>(): Plugin<Record<string, never>, S, CounterServiceIdentifier> {
  return createPlugin<Record<string, never>, S, CounterServiceIdentifier>(
    {},
    (_config) => {
      const app = new App<S>();

      app.islands({ CounterIsland }, "counter-island");

      app.get("/count", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* CounterService;
          return Response.json({ count: svc.get() });
        }))
      );

      app.post("/increment", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* CounterService;
          const newCount = svc.increment();
          setAtom(ctx, counterAtom, newCount);
          return Response.json({ count: newCount });
        }))
      );

      app.post("/reset", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* CounterService;
          svc.reset();
          return Response.json({ count: 0 });
        }))
      );

      return app;
    },
  );
}
