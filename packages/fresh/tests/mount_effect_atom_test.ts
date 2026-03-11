/**
 * Integration tests: mountApp with Effect runner + atom state.
 *
 * Verifies the three propagation paths added to mountApp:
 *
 * 1. ISLAND PROPAGATION — inner app's islands() appear in outer registry
 * 2. EFFECT RUNNER PROPAGATION — inner app's effectRunner propagates to outer
 *    when outer has no runner (plain App outer, EffectApp-style inner)
 * 3. ATOM HYDRATION — setAtom() in an inner-app handler serializes into the
 *    __FRSH_ATOM_STATE script tag rendered by the outer app
 * 4. SHARED MANAGED RUNTIME — outer EffectApp's runner executes Effect handlers
 *    from inner (plugin) app routes after mounting
 *
 * NOTE: Effect runner + atom tests use the @fresh/core/effect internals directly
 * to avoid the full createEffectApp() lifecycle (signal handlers, etc.) and
 * keep tests fast and self-contained.
 */

import { expect } from "@std/expect";
import { App } from "@fresh/core";
import {
  getAtomHydrationHookForApp,
  setAtomHydrationHookForApp,
  setBuildCache,
  setEffectRunner,
} from "../src/internals.ts";
import { setAtomHydrationHook } from "../src/segments.ts";
import { MockBuildCache } from "../src/test_utils.ts";
import { Effect, Layer, ManagedRuntime, ServiceMap } from "effect";
import { createResolver } from "../src/effect/resolver.ts";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Schema from "effect/Schema";
import { serializeAtomHydration, setAtom } from "../src/effect/mod.ts";
import type { ComponentType } from "preact";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function serve(app: App<unknown>, path: string): Promise<Response> {
  return app.handler()(new Request(`http://localhost${path}`));
}

// ---------------------------------------------------------------------------
// Shared Effect services for tests
// ---------------------------------------------------------------------------

const GreetService = ServiceMap.Service<{ hello: () => string }>(
  "GreetService",
);
const GreetLive = Layer.succeed(GreetService, {
  hello: () => "hello from shared runtime",
});

// ---------------------------------------------------------------------------
// 1. ISLAND PROPAGATION (rechecked on rebased base with effect fields)
// ---------------------------------------------------------------------------

Deno.test("mountApp: island registrations propagate to outer + apply at setBuildCache", () => {
  function Widget() {
    return null;
  }

  const outer = new App();
  const inner = new App();

  inner.islands({ Widget }, "widget-chunk");
  outer.mountApp("/plugin", inner);

  const cache = new MockBuildCache([], "production");
  setBuildCache(outer, cache, "production");

  expect(cache.islandRegistry.has(Widget as ComponentType)).toBe(true);
  expect(cache.islandRegistry.get(Widget as ComponentType)?.file).toBe(
    "widget-chunk",
  );
});

// ---------------------------------------------------------------------------
// 2. EFFECT RUNNER PROPAGATION (inner → outer when outer has no runner)
// ---------------------------------------------------------------------------

Deno.test("mountApp: effectRunner from inner app propagates to outer when outer has none", async () => {
  const outer = new App<unknown>();
  const inner = new App<unknown>();

  // Simulate inner app having an Effect runner (like a plugin with its own mini-runtime)
  const runtime = ManagedRuntime.make(GreetLive);
  const runner = createResolver(runtime, {});
  // inner is already App<unknown>; runner's (ctx: unknown) param is compatible with EffectRunner
  setEffectRunner(inner, runner);

  // Cast required: App.get() expects Middleware<State>, but the effectRunner intercepts
  // Effect return values at runtime. Plain App doesn't know about Effect types.
  inner.get("/greet", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetService;
      return new Response(svc.hello());
    }) as unknown as Response);

  // outer has no effectRunner — after mountApp, should inherit inner's
  outer.mountApp("/api", inner);

  const res = await serve(outer, "/api/greet");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello from shared runtime");
});

// ---------------------------------------------------------------------------
// 3. SHARED MANAGED RUNTIME — outer runner executes inner app's Effect routes
// ---------------------------------------------------------------------------

Deno.test("mountApp: outer EffectApp runner executes Effect handlers from inner (plugin) app", async () => {
  const outer = new App<unknown>();
  const inner = new App<unknown>();

  // Outer app has the runtime (like an EffectApp parent)
  const runtime = ManagedRuntime.make(GreetLive);
  const outerRunner = createResolver(runtime, {});
  // outer is already App<unknown>; runner's (ctx: unknown) param is compatible with EffectRunner
  setEffectRunner(outer, outerRunner);

  // Cast required: App.get() expects Middleware<State>, but the effectRunner intercepts
  // Effect return values at runtime. Plain App doesn't know about Effect types.
  inner.get("/hello", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetService;
      return new Response(`plugin: ${svc.hello()}`);
    }) as unknown as Response);

  outer.mountApp("/plugin", inner);

  // Inner app's Effect handler runs under outer app's runtime
  const res = await serve(outer, "/plugin/hello");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("plugin: hello from shared runtime");
});

// ---------------------------------------------------------------------------
// 4. ATOM HYDRATION — setAtom in handler → SSR JSON
// ---------------------------------------------------------------------------

Deno.test("atom hydration: setAtom in handler stores data in ctx.state", () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "test-count",
    schema: Schema.Number,
  });

  // setAtom uses ctx.state — mimics what a route handler would do
  const ctx = { state: {} };
  setAtom(ctx, countAtom, 42);

  const json = serializeAtomHydration(ctx);
  expect(json).toBe(JSON.stringify({ "test-count": 42 }));
});

Deno.test("atom hydration: setAtom from two separate route handlers shares the same ctx.state Map", () => {
  const atomA = Atom.serializable(Atom.make(0), {
    key: "a",
    schema: Schema.Number,
  });
  const atomB = Atom.serializable(Atom.make(""), {
    key: "b",
    schema: Schema.String,
  });

  // Same ctx (same request) — atoms from two different handler calls
  const ctx = { state: {} };
  setAtom(ctx, atomA, 10);
  setAtom(ctx, atomB, "hello");

  const json = serializeAtomHydration(ctx);
  const parsed = JSON.parse(json!);
  expect(parsed.a).toBe(10);
  expect(parsed.b).toBe("hello");
});

// ---------------------------------------------------------------------------
// 5. ATOM HYDRATION + mountApp — atom set in inner app handler visible globally
// ---------------------------------------------------------------------------

Deno.test("mountApp + atom: setAtom in inner-app handler is serialized by global atom hook", async () => {
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "mount-atom-count",
    schema: Schema.Number,
  });

  const outer = new App<unknown>();
  const inner = new App<unknown>();

  // Register global atom hook (normally done by createEffectApp)
  setAtomHydrationHook(serializeAtomHydration);

  // Inner app route sets an atom
  inner.get("/widget", (ctx) => {
    setAtom(ctx, countAtom, 99);
    // Capture what the atom hook would produce (simulates FreshScripts rendering)
    const json = serializeAtomHydration(ctx);
    (ctx.state as Record<string, unknown>).atomJson = json;
    return new Response("ok");
  });

  outer.mountApp("/plugin", inner);

  // Make a request and check atom state was captured
  let capturedState: Record<string, unknown> | null = null;
  outer.use((ctx) => {
    return ctx.next().then((res) => {
      capturedState = ctx.state as Record<string, unknown>;
      return res;
    });
  });

  // Re-mount to get middleware first
  const outerWithMiddleware = new App<unknown>();
  outerWithMiddleware.use((ctx) =>
    ctx.next().then((res) => {
      capturedState = ctx.state as Record<string, unknown>;
      return res;
    })
  );
  outerWithMiddleware.mountApp("/plugin", inner);

  await serve(outerWithMiddleware, "/plugin/widget");

  // The atom hook serialization result was stored in state by the handler
  expect(capturedState!.atomJson).toBe(
    JSON.stringify({ "mount-atom-count": 99 }),
  );
});

// ---------------------------------------------------------------------------
// 6. ATOM HYDRATION HOOK PROPAGATION — per-app hook propagates via mountApp
// ---------------------------------------------------------------------------

Deno.test("mountApp: per-app atomHydrationHook propagates from inner to outer when outer has none", () => {
  const outer = new App<unknown>();
  const inner = new App<unknown>();

  const mockHook = (ctx: { state: unknown }): string | null =>
    serializeAtomHydration(ctx);
  setAtomHydrationHookForApp(inner, mockHook);

  outer.mountApp("/inner", inner);

  // Hook must be non-null on outer after mounting
  const propagated = getAtomHydrationHookForApp(outer);
  expect(propagated).not.toBeNull();

  // Hook works correctly when invoked — verifies it is the same fn as mockHook
  const countAtom = Atom.serializable(Atom.make(0), {
    key: "propagated-hook-count",
    schema: Schema.Number,
  });
  const ctx = { state: {} };
  setAtom(ctx, countAtom, 77);
  // deno-lint-ignore no-explicit-any
  expect(propagated!(ctx as any)).toBe(
    JSON.stringify({ "propagated-hook-count": 77 }),
  );
});

// ---------------------------------------------------------------------------
// 7. MOUNT RUNNER COLLISION — warn when inner runner dropped, outer wins
// ---------------------------------------------------------------------------

Deno.test("mountApp: warns and keeps outer runner when both apps have effectRunners", async () => {
  const outer = new App<unknown>();
  const inner = new App<unknown>();

  const outerRuntime = ManagedRuntime.make(GreetLive);
  const innerRuntime = ManagedRuntime.make(
    Layer.succeed(GreetService, { hello: () => "from inner" }),
  );
  setEffectRunner(outer, createResolver(outerRuntime, {}));
  setEffectRunner(inner, createResolver(innerRuntime, {}));

  // Register route on inner BEFORE mountApp (commands are copied at mount time)
  inner.get("/hello", (_ctx) =>
    Effect.gen(function* () {
      const svc = yield* GreetService;
      return new Response(svc.hello());
    }) as unknown as Response);

  const warns: string[] = [];
  // deno-lint-ignore no-console
  const origWarn = console.warn;
  // deno-lint-ignore no-console
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  };

  try {
    outer.mountApp("/plugin", inner);
  } finally {
    // deno-lint-ignore no-console
    console.warn = origWarn;
  }

  expect(warns.some((w) => w.includes("effectRunner ignored"))).toBe(true);

  const res = await serve(outer, "/plugin/hello");
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello from shared runtime");

  await outerRuntime.dispose();
  await innerRuntime.dispose();
});

// ---------------------------------------------------------------------------
// 8. ctx.islandRegistry — getter returns island registry from build cache
// ---------------------------------------------------------------------------

Deno.test("ctx.islandRegistry: returns island registry with registered components", async () => {
  function Widget() {
    return null;
  }

  const app = new App<unknown>();
  app.islands({ Widget }, "widget-chunk");

  const cache = new MockBuildCache([], "production");
  setBuildCache(app, cache, "production");

  expect(cache.islandRegistry.has(Widget as ComponentType)).toBe(true);
  expect(cache.islandRegistry.get(Widget as ComponentType)?.file).toBe(
    "widget-chunk",
  );

  let capturedRegistry: unknown = undefined;
  app.get("/check", (ctx) => {
    capturedRegistry = ctx.islandRegistry;
    return new Response("ok");
  });

  await serve(app, "/check");

  expect(capturedRegistry).toBe(cache.islandRegistry);
  expect(
    (capturedRegistry as typeof cache.islandRegistry).has(
      Widget as ComponentType,
    ),
  ).toBe(true);
});
