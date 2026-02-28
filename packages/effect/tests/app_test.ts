/**
 * Runtime tests for createEffectApp — SC-1 and SC-4.
 *
 * SC-1: EffectApp builder methods (get, post, use) work identically to App —
 *       routes respond correctly when handlers return Effects.
 *
 * SC-4: Two EffectApp instances own independent runtimes — disposing one
 *       leaves the other functional.
 *
 * Test harness: FakeServer from @fresh/core test_utils.
 *
 * IMPORTANT: Each test calls await app.dispose() at the end to remove signal
 * listeners registered by registerSignalDisposal. Without disposal, the signal
 * listeners would keep the test process alive and trigger Deno.exit(0) on any
 * SIGINT/SIGTERM during the test run.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, ServiceMap } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import { FakeServer } from "../../fresh/src/test_utils.ts";
import { createEffectApp } from "../src/mod.ts";
import {
  ATOM_HYDRATION_KEY,
  serializeAtomHydration,
  setAtom,
} from "../src/hydration.ts";

// ============================================================================
// Shared service definitions
// ============================================================================

const GreetingService = ServiceMap.Service<{ greet: () => string }>(
  "GreetingService",
);
const LayerA = Layer.succeed(GreetingService, { greet: () => "hello from A" });
const LayerB = Layer.succeed(GreetingService, { greet: () => "hello from B" });
type GreetR = ServiceMap.Service.Identifier<typeof GreetingService>;

// ============================================================================
// SC-1: EffectApp builder methods produce correct HTTP responses
// ============================================================================

Deno.test("SC-1: createEffectApp().get() with Effect handler returns correct response", async () => {
  const app = createEffectApp<unknown, GreetR>({ layer: LayerA });
  app.get("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }));

  const server = new FakeServer(app.handler());
  const res = await server.get("/greet");
  assertEquals(await res.text(), "hello from A");

  await app.dispose();
});

Deno.test("SC-1: createEffectApp().use() with Effect middleware works", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  app.use((_ctx) =>
    Effect.gen(function* () {
      (_ctx.state as Record<string, unknown>).injected = "value";
      return yield* Effect.promise(() => _ctx.next());
    })
  );
  app.get(
    "/state",
    (ctx) =>
      new Response((ctx.state as Record<string, unknown>).injected as string),
  );

  const server = new FakeServer(app.handler());
  const res = await server.get("/state");
  assertEquals(await res.text(), "value");

  await app.dispose();
});

Deno.test("SC-1: createEffectApp().post() with Effect handler returns correct response", async () => {
  const app = createEffectApp<unknown, GreetR>({ layer: LayerA });
  app.post("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }));

  const server = new FakeServer(app.handler());
  const res = await server.post("/greet");
  assertEquals(await res.text(), "hello from A");

  await app.dispose();
});

// ============================================================================
// SC-4: Two EffectApp instances own independent runtimes
// ============================================================================

Deno.test("SC-4: two EffectApp instances own independent runtimes", async () => {
  const appA = createEffectApp<unknown, GreetR>({ layer: LayerA });
  const appB = createEffectApp<unknown, GreetR>({ layer: LayerB });

  appA.get("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }));
  appB.get("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }));

  const serverA = new FakeServer(appA.handler());
  const serverB = new FakeServer(appB.handler());

  // Interleaved requests — no cross-contamination
  const [resA1, resB1, resA2, resB2] = await Promise.all([
    serverA.get("/greet"),
    serverB.get("/greet"),
    serverA.get("/greet"),
    serverB.get("/greet"),
  ]);

  assertEquals(await resA1.text(), "hello from A");
  assertEquals(await resB1.text(), "hello from B");
  assertEquals(await resA2.text(), "hello from A");
  assertEquals(await resB2.text(), "hello from B");

  await appA.dispose();
  await appB.dispose();
});

// ============================================================================
// HYDR: createEffectApp() atom hydration wiring
// ============================================================================

Deno.test("HYDR-1: createEffectApp() auto-initializes atom hydration map on every request", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });

  let capturedMap: unknown;
  app.get("/test", (ctx) => {
    capturedMap = (ctx.state as Record<string | symbol, unknown>)[
      ATOM_HYDRATION_KEY
    ];
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/test");
  assertEquals(res.status, 200);
  assertEquals(capturedMap instanceof Map, true);
  assertEquals((capturedMap as Map<string, unknown>).size, 0);

  await app.dispose();
});

Deno.test("HYDR-2: setAtom works in handler after createEffectApp() middleware initializes map", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "hydr-test-count",
    schema: Schema.Number,
  });

  let capturedJson: string | null = null;
  app.get("/test", (ctx) => {
    setAtom(ctx as { state: unknown }, countAtom, 99);
    capturedJson = serializeAtomHydration(ctx as { state: unknown });
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  await server.get("/test");

  assertEquals(capturedJson, JSON.stringify({ "hydr-test-count": 99 }));

  await app.dispose();
});

Deno.test("HYDR-3: atom hydration map is isolated per request", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "hydr-isolation-count",
    schema: Schema.Number,
  });

  const jsons: (string | null)[] = [];
  app.get("/test", (ctx) => {
    setAtom(ctx as { state: unknown }, countAtom, jsons.length);
    jsons.push(serializeAtomHydration(ctx as { state: unknown }));
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  await server.get("/test");
  await server.get("/test");

  assertEquals(jsons.length, 2);
  assertEquals(JSON.parse(jsons[0]!)["hydr-isolation-count"], 0);
  assertEquals(JSON.parse(jsons[1]!)["hydr-isolation-count"], 1);

  await app.dispose();
});

Deno.test("HYDR-4: serializeAtomHydration returns null when no setAtom calls in handler", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });

  let capturedJson: string | null | undefined = undefined;
  app.get("/test", (ctx) => {
    capturedJson = serializeAtomHydration(ctx as { state: unknown });
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  await server.get("/test");

  assertEquals(capturedJson, null);

  await app.dispose();
});

Deno.test("SC-4: disposing one EffectApp does not affect the other", async () => {
  const appA = createEffectApp<unknown, GreetR>({ layer: LayerA });
  const appB = createEffectApp<unknown, GreetR>({ layer: LayerB });

  appA.get("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }));
  appB.get("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }));

  // Dispose appA's runtime
  await appA.dispose();

  // appB should still serve correctly
  const serverB = new FakeServer(appB.handler());
  const resB = await serverB.get("/greet");
  assertEquals(await resB.text(), "hello from B");

  await appB.dispose();
});
