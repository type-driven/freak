/** @jsxImportSource preact */

import { staticFiles } from "@fresh/core";
import { createEffectApp } from "@fresh/core/effect";
import * as Layer from "effect/Layer";
import { CounterLive, createCounterPlugin } from "./counter_plugin.tsx";
import { createGreetingPlugin, GreetingLive } from "./greeting_plugin.tsx";
import {
  COUNTER_SUB_APP_TEMPLATE,
  GREETING_SUB_APP_TEMPLATE,
} from "./paths.ts";

// AuthState: typed state set by the host middleware.
// Both plugins read these fields via generic S = AuthState — no cast needed.
export interface AuthState {
  requestId: string;
  userId: string;
  orgSlug: string;
}

// Combine both service layers — CounterLive and GreetingLive are independent,
// so Layer.mergeAll is correct (no cross-layer deps to wire).
const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);

// AppR: inferred from the combined layer's Out type. Must be specified explicitly —
// TypeScript cannot partially infer generic params, so specifying State = AuthState
// forces AppR to be explicit too. Inferring from the layer avoids coupling to
// individual shape types.
type AppR = typeof combinedLayer extends
  Layer.Layer<infer A, infer _E, infer _R> ? A : never;

const effectApp = createEffectApp<AuthState, AppR>({ layer: combinedLayer });

// Host middleware sets typed auth state — no cast, types flow via S = AuthState.
effectApp.use((ctx) => {
  const match = new URL(ctx.req.url).pathname.match(/^\/orgs\/([^/]+)/);
  ctx.state.requestId = crypto.randomUUID();
  ctx.state.userId = "demo-user";
  ctx.state.orgSlug = match?.[1] ? decodeURIComponent(match[1]) : "demo-org";
  return ctx.next();
});

// Mount both plugins — each plugin is generic over S = AuthState.
// Platform-style integration path mirrors control-panel mount patterns:
// /orgs/:orgSlug/platform/<sub-app>/*
effectApp.mountApp(COUNTER_SUB_APP_TEMPLATE, createCounterPlugin<AuthState>());
effectApp.mountApp(
  GREETING_SUB_APP_TEMPLATE,
  createGreetingPlugin<AuthState>(),
);

// Export inner App<State> via .app getter — Builder.listen() requires App<State>,
// not EffectApp. EffectApp is not an App instance; setBuildCache() uses JS private
// fields and would throw if handed an EffectApp wrapper.
export const app = effectApp.use(staticFiles()).fsRoutes().app;
