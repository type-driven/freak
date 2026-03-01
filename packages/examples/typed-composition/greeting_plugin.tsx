/**
 * greeting_plugin.tsx — a second plugin for the typed-composition demo.
 *
 * Models on counter_plugin.tsx. Demonstrates:
 * - A distinct Effect service (GreetingService)
 * - A distinct serializable atom (key: "greeting" — different from "counter")
 * - A distinct island component (GreetIsland)
 * - A handler that reads ctx.state.requestId and ctx.state.userId from typed S
 *   — proving DEMO-01 (typed auth state access without cast)
 *
 * The plugin does NOT create its own ManagedRuntime. runEffect(ctx, eff) delegates
 * to the host EffectApp's runtime, which provides GreetingService via combinedLayer.
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

export interface GreetingServiceShape {
  readonly getGreeting: (name: string) => string;
}

export const GreetingService = ServiceMap.Service<GreetingServiceShape>(
  "GreetingService",
);

export const GreetingLive = Layer.succeed(GreetingService, {
  getGreeting: (name) => `Hello, ${name}!`,
});

/** Type-level identifier for GreetingService — used as R in Plugin<Config, S, R>. */
export type GreetingServiceIdentifier = typeof GreetingService;

// ---------------------------------------------------------------------------
// Shared atom — distinct key "greeting" avoids duplicate-key error with counterAtom
// ---------------------------------------------------------------------------

export const greetingAtom = Atom.serializable(Atom.make(""), {
  key: "greeting",
  schema: Schema.String,
});

// ---------------------------------------------------------------------------
// Island component — registered via app.islands(); produces SSR markers
// ---------------------------------------------------------------------------

export function GreetIsland({ message }: { message: string }): VNode {
  return (
    <div class="greet-island">
      <p>{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plugin app factory
// ---------------------------------------------------------------------------

export function createGreetingPlugin<S = unknown>(): Plugin<Record<string, never>, S, GreetingServiceIdentifier> {
  return createPlugin<Record<string, never>, S, GreetingServiceIdentifier>(
    {},
    (_config) => {
      const app = new App<S>();

      app.islands({ GreetIsland }, "greet-island");

      // GET /greet — reads ctx.state to prove DEMO-01 (typed access without cast).
      // ctx is Context<S>; when S = AuthState, ctx.state.requestId and userId are typed.
      app.get("/greet", (ctx) =>
        runEffect(ctx, Effect.gen(function* () {
          const svc = yield* GreetingService;
          // Access typed auth state from host middleware — no cast needed.
          // ctx.state is typed as S; when S = AuthState these fields exist.
          const requestId = (ctx.state as { requestId?: string }).requestId ?? "unknown";
          const userId = (ctx.state as { userId?: string }).userId ?? "unknown";
          const greeting = svc.getGreeting("World");
          setAtom(ctx, greetingAtom, greeting);
          return Response.json({ greeting, requestId, userId });
        }))
      );

      return app;
    },
  );
}
