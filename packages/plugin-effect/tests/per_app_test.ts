/**
 * Per-app isolation and Phase 6 success criteria tests.
 *
 * These tests verify all four Phase 6 success criteria:
 *
 * SC-1: Per-app isolation — two App instances with distinct Layers see only
 *       their own services; setting the runner on one app does not affect
 *       another app.
 *
 * SC-2: app.get() Effect dispatch — handlers registered via app.get() that
 *       return an Effect are dispatched through the effectRunner registered
 *       on that app.
 *
 * SC-3: app.use() Effect middleware — middlewares registered via app.use()
 *       that return an Effect are dispatched through effectRunner, enabling
 *       Effect-based middleware in the request chain.
 *
 * SC-4: Existing tests pass — see integration_test.ts which verifies the
 *       existing behavior (Effect.succeed, Effect.fail, mapError) is unchanged.
 *
 * Test harness: same as integration_test.ts (App + FakeServer from fresh core).
 *
 * Note on type casts: app.get() and app.use() are typed to return
 * `Response | Promise<Response>`, not `EffectLike`. At runtime, runMiddlewares
 * checks isEffectLike() and dispatches through effectRunner. The type casts
 * below (as unknown as Response) bypass compile-time checks to test runtime
 * dispatch behavior — the actual SC for this type-level concern is Phase 7.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, ServiceMap } from "effect";
import { App } from "@fresh/core";
import { FakeServer } from "../../fresh/src/test_utils.ts";
import { effectPlugin } from "../src/mod.ts";

// ============================================================================
// SC-1: Per-app isolation
// ============================================================================
//
// Two App instances, each with effectPlugin using a distinct Layer. Each Layer
// provides a service that returns a different string. Requests to each app
// assert only that app's service value is used.

const GreetingService = ServiceMap.Service<{ greet: () => string }>(
  "GreetingService",
);

const LayerA = Layer.succeed(GreetingService, { greet: () => "hello from A" });
const LayerB = Layer.succeed(GreetingService, { greet: () => "hello from B" });

Deno.test("SC-1: per-app isolation — two apps with distinct Layers produce distinct responses", async () => {
  const appA = new App();
  appA.use(effectPlugin(appA, { layer: LayerA }));
  appA.route("/greet", {
    handler: () =>
      Effect.gen(function* () {
        const svc = yield* GreetingService;
        return new Response(svc.greet());
      }),
  });

  const appB = new App();
  appB.use(effectPlugin(appB, { layer: LayerB }));
  appB.route("/greet", {
    handler: () =>
      Effect.gen(function* () {
        const svc = yield* GreetingService;
        return new Response(svc.greet());
      }),
  });

  const serverA = new FakeServer(appA.handler());
  const serverB = new FakeServer(appB.handler());

  const resA = await serverA.get("/greet");
  const resB = await serverB.get("/greet");

  assertEquals(await resA.text(), "hello from A");
  assertEquals(await resB.text(), "hello from B");
});

Deno.test("SC-1: per-app isolation — effectRunner on appA does not bleed into appB", async () => {
  // appA has effectPlugin (runner registered)
  const appA = new App();
  appA.use(effectPlugin(appA, { layer: LayerA }));
  appA.route("/greet", {
    handler: () =>
      Effect.gen(function* () {
        const svc = yield* GreetingService;
        return new Response(svc.greet());
      }),
  });

  // appB has effectPlugin with a DIFFERENT layer
  const appB = new App();
  appB.use(effectPlugin(appB, { layer: LayerB }));
  appB.route("/greet", {
    handler: () =>
      Effect.gen(function* () {
        const svc = yield* GreetingService;
        return new Response(svc.greet());
      }),
  });

  const serverA = new FakeServer(appA.handler());
  const serverB = new FakeServer(appB.handler());

  // Make requests interleaved to verify no cross-contamination
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
});

// ============================================================================
// SC-2: app.get() Effect dispatch
// ============================================================================
//
// app.get() registers handlers as middlewares. The effectRunner registered by
// effectPlugin enables Effect-returning handlers in app.get() paths too.
// runMiddlewares() checks isEffectLike(result) at runtime and dispatches
// through the effectRunner regardless of the TypeScript type signature.

Deno.test("SC-2: app.get() Effect dispatch — Effect.succeed(Response) produces 200", async () => {
  const app = new App();
  app.use(effectPlugin(app));
  // Cast to unknown as Response: app.get() type is Middleware<State> = (ctx) => Response|Promise<Response>
  // At runtime, runMiddlewares checks isEffectLike() and dispatches through effectRunner.
  app.get(
    "/test",
    () => Effect.succeed(new Response("ok")) as unknown as Response,
  );

  const server = new FakeServer(app.handler());
  const res = await server.get("/test");

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "ok");
});

Deno.test("SC-2: app.get() Effect dispatch — Effect with service from Layer", async () => {
  const app = new App();
  app.use(effectPlugin(app, { layer: LayerA }));
  app.get("/greet", () =>
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return new Response(svc.greet());
    }) as unknown as Response);

  const server = new FakeServer(app.handler());
  const res = await server.get("/greet");

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "hello from A");
});

// ============================================================================
// SC-3: app.use() Effect middleware
// ============================================================================
//
// A middleware registered via app.use() can return an Effect. The Effect must
// ultimately produce a Response. To call downstream handlers, the middleware
// Effect wraps ctx.next() via Effect.promise.

Deno.test("SC-3: app.use() Effect middleware — sets ctx.state then calls ctx.next()", async () => {
  const app = new App();
  app.use(effectPlugin(app));

  // Effect middleware: set ctx.state.injected, then call ctx.next() for downstream.
  // Cast needed: MaybeLazyMiddleware return type doesn't include EffectLike.
  // At runtime, runMiddlewares checks isEffectLike() and dispatches through effectRunner.
  app.use(
    (ctx) =>
      Effect.gen(function* () {
        (ctx.state as Record<string, unknown>).injected = "value";
        return yield* Effect.promise(() => ctx.next());
      }) as unknown as Promise<Response>,
  );

  // Downstream plain handler reads the injected state
  app.get("/state", (ctx) =>
    new Response((ctx.state as Record<string, unknown>).injected as string));

  const server = new FakeServer(app.handler());
  const res = await server.get("/state");

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "value");
});

Deno.test("SC-3: app.use() Effect middleware — can short-circuit without calling ctx.next()", async () => {
  const app = new App();
  app.use(effectPlugin(app));

  // Effect middleware that short-circuits on a specific path
  app.use((ctx) => {
    if (ctx.url.pathname === "/blocked") {
      return Effect.succeed(new Response("blocked", { status: 403 })) as unknown as Response;
    }
    return ctx.next();
  });

  app.get("/allowed", () => new Response("allowed", { status: 200 }));
  app.get("/blocked", () => new Response("should not reach here", { status: 200 }));

  const server = new FakeServer(app.handler());

  const blockedRes = await server.get("/blocked");
  assertEquals(blockedRes.status, 403);
  assertEquals(await blockedRes.text(), "blocked");

  const allowedRes = await server.get("/allowed");
  assertEquals(allowedRes.status, 200);
  assertEquals(await allowedRes.text(), "allowed");
});

// ============================================================================
// SC-4: Note — existing tests verify backward compatibility
// ============================================================================
//
// The integration_test.ts file verifies SC-4: existing plugin-effect behavior
// is preserved. It tests:
// - Effect.succeed(Response) produces the same response as async handler
// - Effect.fail produces 500 response (not crash)
// - effectPlugin({ mapError }) returns custom error response
// - Non-Effect handlers still work alongside Effect handlers
// - Mixed Effect and plain routes on the same app
//
// Run: deno test --allow-env packages/plugin-effect/tests/integration_test.ts
