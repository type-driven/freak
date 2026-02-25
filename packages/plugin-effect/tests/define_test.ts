/**
 * Runtime tests for createEffectDefine standalone path.
 *
 * These tests verify that createEffectDefine(app, { layer }) creates a ManagedRuntime,
 * registers the Effect runner on the app, and handlers run correctly through Fresh's
 * App.route() + FakeServer path.
 *
 * IMPORTANT: Effect handlers must be registered via app.route() (not app.get()).
 * app.route() goes through renderRoute() which calls the effectRunner.
 * app.get() registers raw middlewares that bypass renderRoute entirely.
 *
 * IMPORTANT: Pass handler method directly (.GET!, .POST!) to app.route() —
 * app.route() expects a single HandlerFn, not a method map object.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, ServiceMap } from "effect";
import { App } from "@fresh/core";
import { FakeServer } from "../../fresh/src/test_utils.ts";
import { createEffectDefine } from "../src/define.ts";

// --- Service definitions ---

const MsgService = ServiceMap.Service<{ msg: () => string }>("MsgService");
const MsgLayer = Layer.succeed(MsgService, { msg: () => "hello from define" });

// R is the Identifier type (shape type when one type param is provided to ServiceMap.Service)
type MsgR = ServiceMap.Service.Identifier<typeof MsgService>;

// --- Standalone path tests ---

Deno.test("define: standalone path runs Effect handler with Layer services", async () => {
  const app = new App();
  const define = createEffectDefine<unknown, MsgR>(app, { layer: MsgLayer });
  app.route("/", {
    handler: define.handlers({
      GET: () =>
        Effect.gen(function* () {
          const svc = yield* MsgService;
          return new Response(svc.msg());
        }),
    }).GET!,
  });
  const server = new FakeServer(app.handler());
  const res = await server.get("/");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "hello from define");
});

Deno.test("define: standalone path works with POST handler", async () => {
  const app = new App();
  const define = createEffectDefine<unknown, MsgR>(app, { layer: MsgLayer });
  const handlers = define.handlers({
    POST: () =>
      Effect.gen(function* () {
        const svc = yield* MsgService;
        return new Response(`posted: ${svc.msg()}`, { status: 201 });
      }),
  });
  app.route("/submit", { handler: handlers.POST! });
  const server = new FakeServer(app.handler());
  const res = await server.post("/submit");
  assertEquals(res.status, 201);
  assertEquals(await res.text(), "posted: hello from define");
});

// --- Service-free path tests ---

Deno.test("define: service-free Effect.succeed works with effectPlugin", async () => {
  const { effectPlugin } = await import("../src/mod.ts");
  const define = createEffectDefine();
  const app = new App();
  app.use(effectPlugin(app));
  app.route("/", {
    handler: define.handlers({
      GET: () => Effect.succeed(new Response("no services needed")),
    }).GET!,
  });
  const server = new FakeServer(app.handler());
  const res = await server.get("/");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "no services needed");
});

// --- Identity function verification ---

Deno.test("define: handlers() returns same object (identity function)", () => {
  const define = createEffectDefine();
  const original = {
    GET: () => Effect.succeed(new Response("test")),
  };
  const result = define.handlers(original);
  assertEquals(result, original);
});

// --- Verify handler execution uses the provided Layer ---

Deno.test("define: standalone path provides correct service implementation", async () => {
  const CountService = ServiceMap.Service<{ count: () => number }>("CountService");
  const CountLayer = Layer.succeed(CountService, { count: () => 42 });
  type CountR = ServiceMap.Service.Identifier<typeof CountService>;

  const app = new App();
  const define = createEffectDefine<unknown, CountR>(app, { layer: CountLayer });
  app.route("/count", {
    handler: define.handlers({
      GET: () =>
        Effect.gen(function* () {
          const svc = yield* CountService;
          return new Response(String(svc.count()));
        }),
    }).GET!,
  });

  const server = new FakeServer(app.handler());
  const res = await server.get("/count");
  assertEquals(res.status, 200);
  assertEquals(await res.text(), "42");
});
