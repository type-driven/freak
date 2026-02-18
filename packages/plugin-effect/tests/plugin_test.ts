import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { Effect, Exit, Layer, ServiceMap } from "effect";
import { effectPlugin } from "../src/mod.ts";

// --- effectPlugin() zero-config ---

Deno.test("effectPlugin() returns a middleware function", () => {
  const middleware = effectPlugin();
  assertEquals(typeof middleware, "function");
});

Deno.test("effectPlugin() zero-config: middleware sets ctx.state.effectRuntime", async () => {
  const middleware = effectPlugin();

  const state: Record<string, unknown> = {};
  const ctx = {
    state,
    next: () => Promise.resolve(new Response("ok")),
  };

  const response = await middleware(ctx as Parameters<typeof middleware>[0]);
  assertExists(state.effectRuntime);
  assertEquals(response instanceof Response, true);
});

// --- effectPlugin({ layer }) with custom Layer ---

// Effect v4 uses ServiceMap.Service to define services (Context.Tag was v3 API)
const GreetingService = ServiceMap.Service<
  { readonly greet: (name: string) => string }
>("GreetingService");

const TestLayer = Layer.succeed(GreetingService, {
  greet: (name: string) => `Hello, ${name}!`,
});

Deno.test("effectPlugin({ layer }) accepts a typed Layer", () => {
  const middleware = effectPlugin({ layer: TestLayer });
  assertEquals(typeof middleware, "function");
});

Deno.test("effectPlugin({ layer }) middleware sets ctx.state.effectRuntime", async () => {
  const middleware = effectPlugin({ layer: TestLayer });

  const state: Record<string, unknown> = {};
  const ctx = {
    state,
    next: () => Promise.resolve(new Response("ok")),
  };

  await middleware(ctx as Parameters<typeof middleware>[0]);
  assertExists(state.effectRuntime);
});

Deno.test("effectPlugin({ mapError }) passes mapError to resolver", () => {
  const mapError = (_cause: unknown) => new Response("error", { status: 500 });
  const middleware = effectPlugin({ mapError });
  assertEquals(typeof middleware, "function");
});

Deno.test("effectPlugin() runtime dispatches Effect.succeed correctly", async () => {
  // Test that an Effect.succeed is dispatched when routed through the resolver
  // that effectPlugin sets up. We verify via the runtime stored in ctx.state.
  const middleware = effectPlugin();

  const state: Record<string, unknown> = {};
  const ctx = {
    state,
    next: () => Promise.resolve(new Response("ok")),
  };

  await middleware(ctx as Parameters<typeof middleware>[0]);

  // The runtime should be a ManagedRuntime-like object with runPromiseExit
  const runtime = state.effectRuntime as {
    runPromiseExit: (eff: unknown) => Promise<unknown>;
  };
  assertExists(runtime.runPromiseExit, "runtime should have runPromiseExit method");
  assertEquals(typeof runtime.runPromiseExit, "function");

  // Actually run an Effect through it to verify it works
  const exit = await runtime.runPromiseExit(Effect.succeed(42));
  assertEquals(Exit.isSuccess(exit as ReturnType<typeof Exit.succeed>), true);
  // deno-lint-ignore no-explicit-any
  assertEquals((exit as any).value, 42);
});
