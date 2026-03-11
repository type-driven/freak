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

import { App, createPlugin, type Plugin } from "@fresh/core";
import { runEffect, setAtom } from "@fresh/core/effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";
import { GreetIsland } from "./greet_island.tsx";
import { greetingAtom, platformStatusAtom } from "./shared_atoms.ts";
export { GreetIsland } from "./greet_island.tsx";
export { greetingAtom } from "./shared_atoms.ts";

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

function getAuthFields(
  state: unknown,
): { requestId?: string; userId?: string } {
  if (typeof state !== "object" || state === null) return {};
  const record = state as Record<string, unknown>;
  return {
    requestId: typeof record.requestId === "string"
      ? record.requestId
      : undefined,
    userId: typeof record.userId === "string" ? record.userId : undefined,
  };
}

// ---------------------------------------------------------------------------
// Plugin app factory
// ---------------------------------------------------------------------------

export function createGreetingPlugin<S = unknown>(): Plugin<
  Record<string, never>,
  S,
  GreetingServiceShape
> {
  return createPlugin<Record<string, never>, S, GreetingServiceShape>(
    {},
    (_config) => {
      const app = new App<S>();

      app.islands({ GreetIsland }, "greet-island");

      // GET /greet — reads ctx.state to prove DEMO-01 (typed access without cast).
      // ctx is Context<S>; when S = AuthState, ctx.state.requestId and userId are typed.
      app.get("/greet", (ctx) =>
        runEffect(
          ctx,
          Effect.gen(function* () {
            const svc = yield* GreetingService;
            const { requestId, userId } = getAuthFields(ctx.state);
            const url = new URL(ctx.req.url);
            const name = url.searchParams.get("name")?.trim() || "World";
            const greeting = svc.getGreeting(name);
            setAtom(ctx, greetingAtom, greeting);
            setAtom(
              ctx,
              platformStatusAtom,
              `greeting:${userId ?? "unknown-user"}:${
                requestId ?? "unknown-request"
              }`,
            );
            return Response.json({
              greeting,
              name,
              requestId: requestId ?? "unknown",
              userId: userId ?? "unknown",
            });
          }),
        ));

      return app;
    },
  );
}
