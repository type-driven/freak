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
import { App } from "../src/app.ts";
import { FakeServer } from "../src/test_utils.ts";
import { createEffectApp } from "../src/effect/mod.ts";
import {
  _initAtomHydrationMap,
  runEffect,
  serializeAtomHydration,
  setAtom,
} from "../src/effect/hydration.ts";

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

Deno.test("HYDR-1: atom hydration map is not created until setAtom is called (lazy init)", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });

  let capturedJson: string | null = "UNSET";
  app.get("/test", (ctx) => {
    // No setAtom called — serialization should return null (lazy init)
    capturedJson = serializeAtomHydration(ctx);
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/test");
  assertEquals(res.status, 200);
  assertEquals(capturedJson, null);

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
    setAtom(ctx, countAtom, 99);
    capturedJson = serializeAtomHydration(ctx);
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
    setAtom(ctx, countAtom, jsons.length);
    jsons.push(serializeAtomHydration(ctx));
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

Deno.test("HYDR-5: setAtom with non-serializable atom returns 500", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const plainAtom = Atom.make(0);

  app.get("/test", (ctx) => {
    // deno-lint-ignore no-explicit-any
    setAtom(ctx, plainAtom as any, 0);
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/test");
  // Fresh catches synchronous handler errors and returns 500
  assertEquals(res.status, 500);

  await app.dispose();
});

Deno.test("HYDR-6: setAtom with duplicate key returns 500", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "hydr6-count",
    schema: Schema.Number,
  });

  app.get("/test", (ctx) => {
    setAtom(ctx, countAtom, 1);
    setAtom(ctx, countAtom, 2); // duplicate key
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/test");
  // Fresh catches synchronous handler errors and returns 500
  assertEquals(res.status, 500);

  await app.dispose();
});

Deno.test("HYDR-7: setAtom lazily creates hydration map in request handler", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "hydr7-lazy-count",
    schema: Schema.Number,
  });

  let beforeJson: string | null = "UNSET";
  let afterJson: string | null = "UNSET";
  app.get("/test", (ctx) => {
    beforeJson = serializeAtomHydration(ctx);
    setAtom(ctx, countAtom, 55);
    afterJson = serializeAtomHydration(ctx);
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  await server.get("/test");

  assertEquals(beforeJson, null);
  assertEquals(afterJson, JSON.stringify({ "hydr7-lazy-count": 55 }));

  await app.dispose();
});

Deno.test("HYDR-8: _initAtomHydrationMap is idempotent — multiple apps share the same per-request Map", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "hydr8-count",
    schema: Schema.Number,
  });
  const labelAtom = Atom.serializable(Atom.make(""), {
    key: "hydr8-label",
    schema: Schema.String,
  });

  let capturedJson: string | null = null;
  app.get("/test", (ctx) => {
    // Simulate a second app calling _initAtomHydrationMap on the same ctx
    _initAtomHydrationMap(ctx);
    setAtom(ctx, countAtom, 42);
    _initAtomHydrationMap(ctx); // must not reset the map
    setAtom(ctx, labelAtom, "merged");
    capturedJson = serializeAtomHydration(ctx);
    return new Response("ok");
  });

  const server = new FakeServer(app.handler());
  await server.get("/test");

  const data = JSON.parse(capturedJson!) as Record<string, unknown>;
  assertEquals(data["hydr8-count"], 42);
  assertEquals(data["hydr8-label"], "merged");

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

// ============================================================================
// RUNE: runEffect() — happy path + error path
// ============================================================================

Deno.test("RUNE-1: runEffect runs Effect using host EffectApp runtime", async () => {
  const app = createEffectApp<unknown, GreetR>({ layer: LayerA });

  app.get("/run", async (ctx) => {
    // runEffect accepts Effect<A, unknown, R> for any R — service requirements
    // (GreetR) are satisfied at runtime by the host EffectApp's layer.
    const greeting = await runEffect(
      ctx,
      Effect.gen(function* () {
        const svc = yield* GreetingService;
        return svc.greet();
      }),
    );
    return new Response(greeting);
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/run");
  assertEquals(await res.text(), "hello from A");

  await app.dispose();
});

Deno.test("RUNE-2: runEffect returns 500 when called outside EffectApp request context", async () => {
  // Plain App — no EffectApp, no _setRequestRunner called
  const app = new App<unknown>();
  app.get("/plain", (ctx) => {
    return runEffect(ctx as unknown as object, Effect.succeed("ok")).then(
      (v) => new Response(v as string),
    );
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/plain");
  assertEquals(res.status, 500);
});

// ============================================================================
// HYDR-CONC: Concurrent requests have isolated hydration maps
// ============================================================================

Deno.test("HYDR-CONC: concurrent requests have isolated hydration maps", async () => {
  const app = createEffectApp<unknown, never>({ layer: Layer.empty });
  const numAtom = Atom.serializable(Atom.make(0), {
    key: "conc-num",
    schema: Schema.Number,
  });

  app.get("/n", (ctx) => {
    const n = parseInt(new URL(ctx.req.url).searchParams.get("n") ?? "0");
    setAtom(ctx, numAtom, n);
    return new Response(serializeAtomHydration(ctx)!);
  });

  const server = new FakeServer(app.handler());
  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, i) => server.get(`/n?n=${i}`)),
  );
  const bodies = await Promise.all(responses.map((r) => r.text()));

  for (let i = 0; i < 10; i++) {
    assertEquals(
      JSON.parse(bodies[i])["conc-num"],
      i,
      `request ${i}: expected conc-num=${i}`,
    );
  }

  await app.dispose();
});
