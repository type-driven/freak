/**
 * Tests for App.islands() and mountApp island propagation.
 *
 * Covers:
 * - app.islands() registers components in islandRegistry when setBuildCache is called
 * - app.islands() called after setBuildCache still works (direct registration)
 * - mountApp propagates inner app's island registrations to outer app
 * - routes from inner app are reachable on outer app after mountApp
 */

import { expect } from "@std/expect";
import { App } from "@fresh/core";
import { setBuildCache } from "../src/internals.ts";
import { MockBuildCache } from "../src/test_utils.ts";

// ---------------------------------------------------------------------------
// Minimal stub components for island registration
// ---------------------------------------------------------------------------

function MyIsland() {
  return null;
}

function AnotherIsland() {
  return null;
}

// ---------------------------------------------------------------------------
// Helper: create a fresh MockBuildCache
// ---------------------------------------------------------------------------

function makeBuildCache() {
  return new MockBuildCache([], "production");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("App.islands() — components are registered in islandRegistry when setBuildCache is called", () => {
  const app = new App();
  app.islands({ MyIsland }, "my-chunk");

  const cache = makeBuildCache();
  expect(cache.islandRegistry.size).toBe(0);

  // setBuildCache triggers the deferred registration
  setBuildCache(app, cache, "production");

  expect(cache.islandRegistry.size).toBe(1);
  expect(cache.islandRegistry.has(MyIsland)).toBe(true);
});

Deno.test("App.islands() — multiple islands in one call are all registered", () => {
  const app = new App();
  app.islands({ MyIsland, AnotherIsland }, "multi-chunk");

  const cache = makeBuildCache();
  setBuildCache(app, cache, "production");

  expect(cache.islandRegistry.size).toBe(2);
  expect(cache.islandRegistry.has(MyIsland)).toBe(true);
  expect(cache.islandRegistry.has(AnotherIsland)).toBe(true);
});

Deno.test("App.islands() — multiple calls accumulate registrations", () => {
  const app = new App();
  app.islands({ MyIsland }, "chunk-a");
  app.islands({ AnotherIsland }, "chunk-b");

  const cache = makeBuildCache();
  setBuildCache(app, cache, "production");

  expect(cache.islandRegistry.size).toBe(2);
});

Deno.test("App.islands() — island entry has correct metadata", () => {
  const app = new App();
  app.islands({ MyIsland }, "my-chunk");

  const cache = makeBuildCache();
  setBuildCache(app, cache, "production");

  const entry = cache.islandRegistry.get(MyIsland);
  expect(entry).toBeDefined();
  expect(entry!.file).toBe("my-chunk");
  expect(entry!.exportName).toBe("MyIsland");
  expect(entry!.fn).toBe(MyIsland);
});

Deno.test("mountApp — inner app island registrations are merged into outer app", () => {
  const outer = new App();
  const inner = new App();

  inner.islands({ MyIsland }, "inner-chunk");
  outer.mountApp("/inner", inner);

  const cache = makeBuildCache();
  setBuildCache(outer, cache, "production");

  // Inner app's islands should now be in the outer app's registry
  expect(cache.islandRegistry.size).toBe(1);
  expect(cache.islandRegistry.has(MyIsland)).toBe(true);
});

Deno.test("mountApp — outer and inner app islands are both registered", () => {
  const outer = new App();
  const inner = new App();

  outer.islands({ AnotherIsland }, "outer-chunk");
  inner.islands({ MyIsland }, "inner-chunk");
  outer.mountApp("/inner", inner);

  const cache = makeBuildCache();
  setBuildCache(outer, cache, "production");

  expect(cache.islandRegistry.size).toBe(2);
  expect(cache.islandRegistry.has(AnotherIsland)).toBe(true);
  expect(cache.islandRegistry.has(MyIsland)).toBe(true);
});

Deno.test("mountApp — routes from inner app are reachable on outer app", async () => {
  const outer = new App();
  const inner = new App();

  inner.get("/hello", () => new Response("hello from inner"));
  outer.mountApp("/api", inner);

  const handler = outer.handler();
  const res = await handler(new Request("http://localhost/api/hello"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello from inner");
});

Deno.test("mountApp — outer routes are unaffected by inner app mount", async () => {
  const outer = new App();
  const inner = new App();

  outer.get("/outer", () => new Response("outer route"));
  inner.get("/hello", () => new Response("inner route"));
  outer.mountApp("/api", inner);

  const handler = outer.handler();

  const outerRes = await handler(new Request("http://localhost/outer"));
  expect(outerRes.status).toBe(200);
  expect(await outerRes.text()).toBe("outer route");

  const innerRes = await handler(new Request("http://localhost/api/hello"));
  expect(innerRes.status).toBe(200);
  expect(await innerRes.text()).toBe("inner route");
});

Deno.test("App.islands() — non-function exports are skipped", () => {
  const app = new App();
  // Mix of function and non-function exports
  app.islands(
    { MyIsland, notAComponent: "a string", alsoNot: 42 } as Record<
      string,
      unknown
    >,
    "mixed-chunk",
  );

  const cache = makeBuildCache();
  setBuildCache(app, cache, "production");

  // Only MyIsland (a function) should be registered
  expect(cache.islandRegistry.size).toBe(1);
  expect(cache.islandRegistry.has(MyIsland)).toBe(true);
});
