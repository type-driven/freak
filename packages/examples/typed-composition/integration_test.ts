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
import { Effect, Layer, ServiceMap } from "effect";
import {
  CounterIsland,
  CounterLive,
  counterAtom,
  createCounterPlugin,
} from "./counter_plugin.tsx";

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

async function get(
  handler: (r: Request) => Promise<Response>,
  path: string,
): Promise<Response> {
  return handler(new Request(`http://localhost${path}`));
}

async function post(
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
  expect(cache.islandRegistry.get(CounterIsland as ComponentType)?.file).toBe("counter-island");

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

  const bodies = await Promise.all([res1.json(), res2.json()]) as Array<{ count: number }>;
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
  interface HostState { requestId: string }

  const hostApp = createEffectApp<HostState>({ layer: CounterLive });
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
    }))
  );

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
  const incompatiblePlugin = createPlugin<Record<string, never>, { count: number }, never>(
    {},
    (_config) => new App<{ count: number }>(),
  );
  const host = new App<{ name: string }>();
  // @ts-expect-error Plugin<{}, { count: number }, never> is not assignable to Plugin<{}, { name: string }, unknown>
  host.mountApp("/bad", incompatiblePlugin);
});

Deno.test("composition: PLUG-03 — mounting plugin with incompatible state on EffectApp is a type error", async () => {
  const incompatiblePlugin = createPlugin<Record<string, never>, { count: number }, never>(
    {},
    (_config) => new App<{ count: number }>(),
  );
  const hostApp = createEffectApp<{ name: string }>({ layer: Layer.empty });
  // @ts-expect-error Plugin<{}, { count: number }, never> is not assignable to Plugin<{}, { name: string }, unknown>
  hostApp.mountApp("/bad", incompatiblePlugin);
  await hostApp.dispose();
});
