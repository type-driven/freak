/** @jsxImportSource preact */

import { staticFiles } from "@fresh/core";
import { createEffectApp } from "@fresh/effect";
import { Layer } from "effect";
import { CounterLive, createCounterPlugin } from "./counter_plugin.tsx";
import { GreetingLive, createGreetingPlugin } from "./greeting_plugin.tsx";

// AuthState: typed state set by the host middleware.
// Both plugins read these fields via generic S = AuthState — no cast needed.
export interface AuthState {
  requestId: string;
  userId: string;
}

// Combine both service layers — CounterLive and GreetingLive are independent,
// so Layer.mergeAll is correct (no cross-layer deps to wire).
const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);

const effectApp = createEffectApp<AuthState>({ layer: combinedLayer });

// Host middleware sets typed auth state — no cast, types flow via S = AuthState.
effectApp.use((ctx) => {
  ctx.state.requestId = crypto.randomUUID();
  ctx.state.userId = "demo-user";
  return ctx.next();
});

// Mount both plugins — each plugin is generic over S = AuthState.
// Plugin routes live at /counter/* and /greeting/* — no overlap with routes/.
effectApp.mountApp("/counter", createCounterPlugin<AuthState>());
effectApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

// Export inner App<State> via .app getter — Builder.listen() requires App<State>,
// not EffectApp. EffectApp is not an App instance; setBuildCache() uses JS private
// fields and would throw if handed an EffectApp wrapper.
export const app = effectApp.use(staticFiles()).fsRoutes().app;
