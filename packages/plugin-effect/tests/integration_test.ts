/**
 * Integration tests for the Effect plugin through Fresh's full request path.
 *
 * These tests use Fresh's App + FakeServer to verify that:
 * - Effect.succeed(Response) produces the same HTTP response as an async handler (SC-1)
 * - Effect failures produce 500 responses via Fresh's error handling, not crashes (SC-3)
 * - effectPlugin({ mapError }) returns custom error responses
 * - Non-Effect handlers still work when effectPlugin is registered
 *
 * Import pattern: App from @fresh/core (workspace-local), FakeServer from
 * relative path to packages/fresh/src/test_utils.ts (not in public API).
 *
 * IMPORTANT: Effect handlers must be registered via app.route() (not app.get()).
 * app.route() goes through renderRoute() which calls _effectResolver.
 * app.get() registers raw middlewares that bypass renderRoute entirely.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { Effect } from "effect";
import { App } from "@fresh/core";
import { FakeServer } from "../../fresh/src/test_utils.ts";
import { effectPlugin } from "../src/mod.ts";

// --- SC-1: Effect.succeed(Response) produces same response as async handler ---

Deno.test("integration: Effect.succeed(Response) produces same response as async handler", async () => {
  // Baseline: async handler returning a Response directly
  const asyncApp = new App()
    .route("/", { handler: () => new Response("hello from effect", { status: 200 }) });

  const asyncServer = new FakeServer(asyncApp.handler());
  const asyncRes = await asyncServer.get("/");
  const asyncText = await asyncRes.text();

  // Effect handler — uses app.route() which calls renderRoute → _effectResolver
  const effectApp = new App()
    .use(effectPlugin())
    .route("/", {
      handler: () => Effect.succeed(new Response("hello from effect", { status: 200 })),
    });

  const effectServer = new FakeServer(effectApp.handler());
  const effectRes = await effectServer.get("/");
  const effectText = await effectRes.text();

  assertEquals(effectRes.status, asyncRes.status);
  assertEquals(effectText, asyncText);
});

Deno.test("integration: Effect handler with custom status and body", async () => {
  const app = new App()
    .use(effectPlugin())
    .route("/api/data", {
      handler: () =>
        Effect.succeed(
          new Response(JSON.stringify({ count: 42 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    });

  const server = new FakeServer(app.handler());
  const res = await server.get("/api/data");

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "application/json");
  const body = await res.json();
  assertEquals(body.count, 42);
});

// --- SC-3: Effect.fail produces 500 response, not crash ---

Deno.test("integration: Effect.fail produces 500 response (not crash)", async () => {
  const app = new App()
    .use(effectPlugin())
    .route("/fail", { handler: () => Effect.fail("something went wrong") });

  const server = new FakeServer(app.handler());
  const res = await server.get("/fail");

  // Resolver throws HttpError(500), Fresh error handling returns 500
  assertEquals(res.status, 500);
});

Deno.test("integration: Effect.die produces 500 response (not crash)", async () => {
  const app = new App()
    .use(effectPlugin())
    .route("/die", { handler: () => Effect.die(new Error("unexpected defect")) });

  const server = new FakeServer(app.handler());
  const res = await server.get("/die");

  assertEquals(res.status, 500);
});

// --- effectPlugin({ mapError }) custom error response ---

Deno.test("integration: effectPlugin({ mapError }) returns custom error response", async () => {
  const app = new App()
    .use(effectPlugin({
      mapError: (_cause) =>
        new Response("custom error page", { status: 503 }),
    }))
    .route("/fail", { handler: () => Effect.fail("domain error") });

  const server = new FakeServer(app.handler());
  const res = await server.get("/fail");

  assertEquals(res.status, 503);
  assertEquals(await res.text(), "custom error page");
});

// --- Non-Effect handlers still work ---

Deno.test("integration: non-Effect handlers work when effectPlugin is registered", async () => {
  const app = new App()
    .use(effectPlugin())
    .route("/plain", { handler: () => new Response("plain response", { status: 200 }) })
    .route("/async", {
      handler: async () => {
        await Promise.resolve();
        return new Response("async response", { status: 201 });
      },
    });

  const server = new FakeServer(app.handler());

  const plainRes = await server.get("/plain");
  assertEquals(plainRes.status, 200);
  assertEquals(await plainRes.text(), "plain response");

  const asyncRes = await server.get("/async");
  assertEquals(asyncRes.status, 201);
  assertEquals(await asyncRes.text(), "async response");
});

// --- Routing: mixed Effect and plain routes on same app ---

Deno.test("integration: mixed Effect and plain routes on same app", async () => {
  const app = new App()
    .use(effectPlugin())
    .route("/effect", { handler: () => Effect.succeed(new Response("from effect")) })
    .route("/plain", { handler: () => new Response("from plain") });

  const server = new FakeServer(app.handler());

  const effectRes = await server.get("/effect");
  assertEquals(await effectRes.text(), "from effect");

  const plainRes = await server.get("/plain");
  assertEquals(await plainRes.text(), "from plain");
});
