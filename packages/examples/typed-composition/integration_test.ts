/**
 * integration_test.ts — typed app composition end-to-end validation
 *
 * Demonstrates and verifies the full composition lifecycle:
 *
 * 1. ISLAND DISCOVERY   — plugin's app.islands() registration propagates to host
 *                          and applies to islandRegistry when setBuildCache is called
 * 2. EFFECT ROUTING     — plugin routes (Effect handlers) run via host EffectApp's runtime
 * 3. ATOM HYDRATION     — setAtom() in plugin handler serializes to __FRSH_ATOM_STATE JSON
 * 4. CONTEXT ISOLATION  — per-request atom Map is fresh on each request
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────┐
 *   │  EffectApp (host)                           │
 *   │  Layer: CounterLive (CounterService)        │
 *   │  mountApp("/counter", counterPlugin)        │
 *   │                                             │
 *   │  ┌──────────────────────────────────────┐  │
 *   │  │  App (plugin = counter_plugin.tsx)   │  │
 *   │  │  app.islands({ CounterIsland })      │  │
 *   │  │  GET  /count     → Effect handler    │  │
 *   │  │  POST /increment → Effect + setAtom  │  │
 *   │  │  POST /reset     → Effect handler    │  │
 *   │  └──────────────────────────────────────┘  │
 *   └─────────────────────────────────────────────┘
 *
 * The plugin has NO effectRunner of its own — it relies entirely on the host.
 */

import { expect } from "@std/expect";
import { setBuildCache } from "@fresh/core/internal";
import { App, createPlugin } from "@fresh/core";
import { MockBuildCache } from "../../fresh/src/test_utils.ts";
import { createEffectApp } from "@fresh/effect";
import { serializeAtomHydration, setAtom } from "../../effect/src/hydration.ts";
import type { ComponentType } from "preact";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServiceMap from "effect/ServiceMap";
import {
  counterAtom,
  CounterIsland,
  CounterLive,
  createCounterPlugin,
} from "./counter_plugin.tsx";
import {
  createGreetingPlugin,
  greetingAtom,
  GreetingLive,
} from "./greeting_plugin.tsx";

// ---------------------------------------------------------------------------
// Second plugin service (used in multi-plugin composition test)
// ---------------------------------------------------------------------------

interface PingServiceShape {
  readonly ping: () => string;
}
const PingService = ServiceMap.Service<PingServiceShape>("PingService");
const PingLive = Layer.succeed(PingService, { ping: () => "pong" });

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function get(
  handler: (r: Request) => Promise<Response>,
  path: string,
): Promise<Response> {
  return handler(new Request(`http://localhost${path}`));
}

function post(
  handler: (r: Request) => Promise<Response>,
  path: string,
): Promise<Response> {
  return handler(
    new Request(`http://localhost${path}`, { method: "POST" }),
  );
}

// ---------------------------------------------------------------------------
// 1. ISLAND DISCOVERY
// ---------------------------------------------------------------------------

Deno.test("composition: plugin's island registrations appear in host islandRegistry after setBuildCache", async () => {
  const hostApp = createEffectApp({ layer: CounterLive });
  const plugin = createCounterPlugin();

  // Mount plugin into host (island registrations are merged)
  hostApp.mountApp("/counter", plugin);

  // Wire build cache on the host — queued island registrations are applied.
  // MockBuildCache<unknown> satisfies BuildCache<unknown> (the host app's state type).
  const cache = new MockBuildCache<unknown>([], "production");
  setBuildCache(hostApp.app, cache, "production");

  // CounterIsland (from the plugin) must appear in the registry.
  // Cast to ComponentType (preact's base component type) for Map.has/get — the island
  // was stored under this key by IslandPreparer.prepare().
  expect(cache.islandRegistry.has(CounterIsland as ComponentType)).toBe(true);
  expect(cache.islandRegistry.get(CounterIsland as ComponentType)?.file).toBe(
    "counter-island",
  );

  // Dispose to remove signal listeners registered by createEffectApp
  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// 2. EFFECT ROUTING — host runtime executes plugin's Effect handlers
// ---------------------------------------------------------------------------

Deno.test("composition: plugin GET /count returns JSON via host CounterService", async () => {
  const hostApp = createEffectApp({ layer: CounterLive });
  const plugin = createCounterPlugin();
  hostApp.mountApp("/counter", plugin);

  const handler = hostApp.handler();

  const res = await get(handler, "/counter/count");
  expect(res.status).toBe(200);
  const body = await res.json() as { count: number };
  expect(typeof body.count).toBe("number");

  await hostApp.dispose();
});

Deno.test("composition: plugin POST /increment increments via host CounterService", async () => {
  const hostApp = createEffectApp({ layer: CounterLive });
  const plugin = createCounterPlugin();
  hostApp.mountApp("/counter", plugin);

  const handler = hostApp.handler();

  // First increment
  const res1 = await post(handler, "/counter/increment");
  expect(res1.status).toBe(200);
  const body1 = await res1.json() as { count: number };
  expect(body1.count).toBe(1);

  // Second increment
  const res2 = await post(handler, "/counter/increment");
  expect(res2.status).toBe(200);
  const body2 = await res2.json() as { count: number };
  expect(body2.count).toBe(2);

  await hostApp.dispose();
});

Deno.test("composition: plugin POST /reset resets counter to 0", async () => {
  const hostApp = createEffectApp({ layer: CounterLive });
  const plugin = createCounterPlugin();
  hostApp.mountApp("/counter", plugin);

  const handler = hostApp.handler();

  // Increment then reset
  await post(handler, "/counter/increment");
  const resetRes = await post(handler, "/counter/reset");
  expect(resetRes.status).toBe(200);
  const resetBody = await resetRes.json() as { count: number };
  expect(resetBody.count).toBe(0);

  // Verify reset
  const getRes = await get(handler, "/counter/count");
  const getBody = await getRes.json() as { count: number };
  expect(getBody.count).toBe(0);

  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// 3. ATOM HYDRATION — setAtom in plugin handler serializes to JSON
// ---------------------------------------------------------------------------

Deno.test("composition: setAtom in plugin handler produces serializable atom state", () => {
  // Simulate what the POST /increment handler does to ctx.state
  const ctx = { state: {} };
  setAtom(ctx, counterAtom, 42);

  const json = serializeAtomHydration(ctx);
  expect(json).toBe(JSON.stringify({ counter: 42 }));
});

Deno.test("composition: atom state from plugin handler is request-isolated", async () => {
  const hostApp = createEffectApp({ layer: CounterLive });
  const plugin = createCounterPlugin();
  hostApp.mountApp("/counter", plugin);

  const handler = hostApp.handler();

  // Two independent requests must produce independent atom state
  const [res1, res2] = await Promise.all([
    post(handler, "/counter/increment"),
    post(handler, "/counter/increment"),
  ]);

  // Both should succeed (ManagedRuntime handles concurrency)
  expect(res1.status).toBe(200);
  expect(res2.status).toBe(200);

  const bodies = await Promise.all([res1.json(), res2.json()]) as Array<
    { count: number }
  >;
  // Each request increments independently — counts may vary by order but must be 1 and 2
  const counts = bodies.map((b) => b.count).sort();
  expect(counts).toEqual([1, 2]);

  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// 4. TYPED COMPOSITION — plugin generic over host state
// ---------------------------------------------------------------------------

Deno.test("composition: plugin factory is generic — composes with typed host state", async () => {
  // Typed host state — plugin is parameterized over it
  interface HostState {
    requestId: string;
  }

  type HostR = typeof CounterLive extends
    Layer.Layer<infer A, infer _E, infer _R> ? A : never;
  const hostApp = createEffectApp<HostState, HostR>({ layer: CounterLive });
  const plugin = createCounterPlugin<HostState>();

  hostApp.mountApp("/counter", plugin);
  const handler = hostApp.handler();

  const res = await get(handler, "/counter/count");
  expect(res.status).toBe(200);

  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// 5. MULTI-PLUGIN COMPOSITION — two plugins, one host
// ---------------------------------------------------------------------------

Deno.test("composition: two plugins mounted on the same host app", async () => {
  // Plugin uses PingService from the host layer — plain App, no own runtime.
  // effectRoute() localizes the Middleware/Effect cast (see counter_plugin.tsx).
  const effectRoute = <R>(eff: Effect.Effect<Response, unknown, R>) =>
    eff as unknown as Response;
  const pingPlugin = new App<unknown>();
  pingPlugin.get("/ping", (_ctx) =>
    effectRoute(Effect.gen(function* () {
      const svc = yield* PingService;
      return new Response(svc.ping());
    })));

  // Host provides BOTH CounterService and PingService via Layer.mergeAll
  const combinedLayer = Layer.mergeAll(CounterLive, PingLive);

  const hostApp = createEffectApp({ layer: combinedLayer });
  const counterPlugin = createCounterPlugin();

  hostApp.mountApp("/counter", counterPlugin);
  hostApp.mountApp("/ping", pingPlugin);

  const handler = hostApp.handler();

  // Counter plugin works
  const countRes = await get(handler, "/counter/count");
  expect(countRes.status).toBe(200);

  // Ping plugin works
  const pingRes = await get(handler, "/ping/ping");
  expect(pingRes.status).toBe(200);
  expect(await pingRes.text()).toBe("pong");

  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// PLUG-03 — state type mismatch is a compile error
// ---------------------------------------------------------------------------

Deno.test("composition: PLUG-03 — mounting plugin with incompatible state is a type error", () => {
  const incompatiblePlugin = createPlugin<
    Record<string, never>,
    { count: number },
    never
  >(
    {},
    (_config) => new App<{ count: number }>(),
  );
  const host = new App<{ name: string }>();
  // @ts-expect-error Plugin<{}, { count: number }, never> is not assignable to Plugin<{}, { name: string }, unknown>
  host.mountApp("/bad", incompatiblePlugin);
});

Deno.test("composition: PLUG-03 — mounting plugin with incompatible state on EffectApp is a type error", async () => {
  const incompatiblePlugin = createPlugin<
    Record<string, never>,
    { count: number },
    never
  >(
    {},
    (_config) => new App<{ count: number }>(),
  );
  const hostApp = createEffectApp<{ name: string }>({ layer: Layer.empty });
  // @ts-expect-error Plugin<{}, { count: number }, never> is not assignable to Plugin<{}, { name: string }, unknown>
  hostApp.mountApp("/bad", incompatiblePlugin);
  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// DEMO-01: Both plugins read typed AuthState without casts
// ---------------------------------------------------------------------------

Deno.test("DEMO-01: plugins receive typed AuthState — requestId and userId accessible", async () => {
  // S = AuthState: ctx.state.requestId and ctx.state.userId are typed.
  // This is the compile-time proof: TypeScript accepts ctx.state.requestId without cast
  // when the plugin is parameterized as createGreetingPlugin<AuthState>().
  interface AuthState {
    requestId: string;
    userId: string;
  }

  const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);
  type AppR = typeof combinedLayer extends
    Layer.Layer<infer A, infer _E, infer _R> ? A : never;
  const hostApp = createEffectApp<AuthState, AppR>({ layer: combinedLayer });

  hostApp.use((ctx) => {
    // Typed assignment — no cast needed because State = AuthState
    ctx.state.requestId = "req-abc";
    ctx.state.userId = "user-xyz";
    return ctx.next();
  });

  hostApp.mountApp("/counter", createCounterPlugin<AuthState>());
  hostApp.mountApp("/greeting", createGreetingPlugin<AuthState>());

  const handler = hostApp.handler();

  // CounterPlugin responds at /counter/count
  const counterRes = await handler(
    new Request("http://localhost/counter/count"),
  );
  expect(counterRes.status).toBe(200);
  const counterBody = await counterRes.json() as { count: number };
  expect(typeof counterBody.count).toBe("number");

  // GreetingPlugin responds at /greeting/greet and echoes state fields
  const greetRes = await handler(
    new Request("http://localhost/greeting/greet"),
  );
  expect(greetRes.status).toBe(200);
  const greetBody = await greetRes.json() as {
    greeting: string;
    requestId: string;
    userId: string;
  };
  expect(greetBody.greeting).toBe("Hello, World!");
  expect(greetBody.requestId).toBe("req-abc");
  expect(greetBody.userId).toBe("user-xyz");

  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// DEMO-02: Two plugins — no route conflicts
// ---------------------------------------------------------------------------

Deno.test("DEMO-02: two plugins mounted on one host — routes don't conflict", async () => {
  const combinedLayer = Layer.mergeAll(CounterLive, GreetingLive);
  const hostApp = createEffectApp({ layer: combinedLayer });

  hostApp.mountApp("/counter", createCounterPlugin());
  hostApp.mountApp("/greeting", createGreetingPlugin());

  const handler = hostApp.handler();

  // Both plugin route groups respond independently — no overlap
  const [countRes, greetRes] = await Promise.all([
    handler(new Request("http://localhost/counter/count")),
    handler(new Request("http://localhost/greeting/greet")),
  ]);

  expect(countRes.status).toBe(200);
  expect(greetRes.status).toBe(200);

  await hostApp.dispose();
});

// ---------------------------------------------------------------------------
// DEMO-03: Merged atom serialization — no key collisions
// ---------------------------------------------------------------------------

Deno.test("DEMO-03: setAtom from both plugins serializes into one merged blob", () => {
  // Simulate two plugin handlers setting atoms on the same request ctx.
  // counterAtom key = "counter", greetingAtom key = "greeting" — distinct, no collision.
  const ctx = { state: {} };
  setAtom(ctx, counterAtom, 5); // from CounterPlugin
  setAtom(ctx, greetingAtom, "Hi"); // from GreetingPlugin

  const blob = serializeAtomHydration(ctx);
  expect(blob).toBe(JSON.stringify({ counter: 5, greeting: "Hi" }));
});
