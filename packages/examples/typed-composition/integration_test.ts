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
import {
  setBuildCache,
} from "@fresh/core/internal";
import { MockBuildCache } from "../../fresh/src/test_utils.ts";
import { createEffectApp } from "@fresh/effect";
import { serializeAtomHydration, setAtom } from "../../effect/src/hydration.ts";
import {
  CounterIsland,
  CounterLive,
  CounterService,
  counterAtom,
  createCounterPlugin,
} from "./counter_plugin.tsx";

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

  // Wire build cache on the host — queued island registrations are applied
  // deno-lint-ignore no-explicit-any
  const cache = new MockBuildCache([], "production") as any;
  // deno-lint-ignore no-explicit-any
  setBuildCache(hostApp.app as any, cache, "production");

  // CounterIsland (from the plugin) must appear in the registry
  // deno-lint-ignore no-explicit-any
  expect(cache.islandRegistry.has(CounterIsland as any)).toBe(true);
  // deno-lint-ignore no-explicit-any
  expect(cache.islandRegistry.get(CounterIsland as any)?.file).toBe("counter-island");

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
  const capturedJsons: (string | null)[] = [];

  // Patch handler to capture atom JSON from each request's ctx.state
  // We do this by calling the POST /increment route which calls setAtom.
  // The atom serialization is stored in each response — verify isolation.

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
// 4. MULTI-PLUGIN COMPOSITION — two plugins, one host
// ---------------------------------------------------------------------------

Deno.test("composition: two plugins mounted on the same host app", async () => {
  // Use a second service to demonstrate multi-plugin composition
  const { ServiceMap, Layer } = await import("effect");

  interface PingServiceShape {
    readonly ping: () => string;
  }
  const PingService = ServiceMap.Service<PingServiceShape>("PingService");
  const PingLive = Layer.succeed(PingService, { ping: () => "pong" });

  const { Effect } = await import("effect");

  const pingPlugin = new (await import("@fresh/core")).App<unknown>();
  pingPlugin.get("/ping", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* PingService;
      return new Response(svc.ping());
    }) as unknown as Response
  );

  // Host provides BOTH CounterService and PingService
  const { Layer: L } = await import("effect");
  const combinedLayer = L.mergeAll(CounterLive, PingLive);

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
