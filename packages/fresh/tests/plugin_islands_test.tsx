/**
 * plugin_islands_test.tsx — formal requirement tests for plugin islands.
 *
 * Covers:
 * - ISLD-01: Plugin island registered via createPlugin + mountApp appears in host BuildCache
 * - ISLD-02: SSR HTML from a plugin route contains frsh:island markers with export name
 * - ISLD-03: Two plugins with same-named component export get unique island names (no collision)
 *
 * These tests verify that the already-implemented BuildCache island aggregation
 * path (app.ts mountApp island merge, lines 421-423) works correctly through
 * the Plugin<Config,S,R> interface introduced in Phase 15.
 *
 * NOTE: ISLD-02 client-side hydration (browser) is verified manually via
 * `deno task dev` in the Phase 17 demo app — no browser automation here.
 */

/** @jsxImportSource preact */
import { expect } from "@std/expect";
import { App, createPlugin } from "@fresh/core";
import { setBuildCache } from "../src/internals.ts";
import { MockBuildCache } from "../src/test_utils.ts";
import type { ComponentType } from "preact";

// ---------------------------------------------------------------------------
// Fixture island components
// ---------------------------------------------------------------------------

function CounterIsland({ count }: { count: number }) {
  return <p class="count">{count}</p>;
}

function GreetIsland({ name }: { name: string }) {
  return <p class="greet">Hello {name}</p>;
}

// Used by pluginB in ISLD-03 — same export name "CounterIsland", distinct function
function CounterIsland2({ count }: { count: number }) {
  return <p class="count2">{count}</p>;
}

// ---------------------------------------------------------------------------
// ISLD-01: BuildCache aggregation via Plugin
// ---------------------------------------------------------------------------

Deno.test("ISLD-01: plugin island registered via createPlugin + mountApp appears in host BuildCache", () => {
  const plugin = createPlugin({ label: "counter" }, (_config) => {
    const app = new App();
    app.islands({ CounterIsland }, "counter-island-chunk");
    return app;
  });

  const host = new App();
  host.mountApp("/plugin", plugin);

  const cache = new MockBuildCache([], "production");
  setBuildCache(host, cache, "production");

  expect(cache.islandRegistry.has(CounterIsland as ComponentType)).toBe(true);
  const entry = cache.islandRegistry.get(CounterIsland as ComponentType);
  expect(entry).toBeDefined();
  expect(entry!.file).toBe("counter-island-chunk");
  expect(entry!.exportName).toBe("CounterIsland");
});

Deno.test("ISLD-01: host islands and plugin islands both appear in merged registry", () => {
  const plugin = createPlugin({}, (_config) => {
    const app = new App();
    app.islands({ CounterIsland }, "plugin-counter");
    return app;
  });

  const host = new App();
  host.islands({ GreetIsland }, "host-greet");
  host.mountApp("/p", plugin);

  const cache = new MockBuildCache([], "production");
  setBuildCache(host, cache, "production");

  expect(cache.islandRegistry.size).toBe(2);
  expect(cache.islandRegistry.has(CounterIsland as ComponentType)).toBe(true);
  expect(cache.islandRegistry.has(GreetIsland as ComponentType)).toBe(true);
});

// ---------------------------------------------------------------------------
// ISLD-02: SSR HTML from plugin island route contains frsh:island markers
// ---------------------------------------------------------------------------

Deno.test("ISLD-02: SSR HTML from plugin route contains frsh:island markers", async () => {
  const plugin = createPlugin({}, (_config) => {
    const app = new App();
    app.islands({ CounterIsland }, "counter-island-chunk");
    app.get("/widget", (ctx) =>
      ctx.render(
        <html>
          <body>
            <CounterIsland count={7} />
          </body>
        </html>,
      ));
    return app;
  });

  const host = new App();
  host.mountApp("/p", plugin);

  const cache = new MockBuildCache([], "production");
  setBuildCache(host, cache, "production");

  const handler = host.handler();
  const res = await handler(new Request("http://localhost/p/widget"));
  const html = await res.text();

  // SSR content present
  expect(html).toContain("7");
  // Island hydration markers injected by Fresh's preact_hooks
  // NOTE: markers use the component export name, NOT the chunk name
  expect(html).toContain("frsh:island");
  expect(html).toContain("CounterIsland");
});

// ---------------------------------------------------------------------------
// ISLD-03: Two plugins — no name collision for unique component references
// ---------------------------------------------------------------------------

Deno.test("ISLD-03: two plugins with same-named component export get unique island names (no collision)", () => {
  const pluginA = createPlugin({ id: "a" }, (_config) => {
    const app = new App();
    app.islands({ CounterIsland }, "chunk-a");
    return app;
  });

  const pluginB = createPlugin({ id: "b" }, (_config) => {
    const app = new App();
    // Same export name "CounterIsland" but different function reference (CounterIsland2)
    app.islands({ CounterIsland: CounterIsland2 }, "chunk-b");
    return app;
  });

  const host = new App();
  host.mountApp("/a", pluginA);
  host.mountApp("/b", pluginB);

  const cache = new MockBuildCache([], "production");
  setBuildCache(host, cache, "production");

  // Both distinct component references appear in the registry
  expect(cache.islandRegistry.has(CounterIsland as ComponentType)).toBe(true);
  expect(cache.islandRegistry.has(CounterIsland2 as ComponentType)).toBe(true);

  // Each island has a unique name
  const names = new Set<string>();
  for (const [, island] of cache.islandRegistry) {
    names.add(island.name);
  }

  expect(names.size).toBe(2);
});

Deno.test("ISLD-03: two plugins with distinct islands both produce SSR markers", async () => {
  const pluginA = createPlugin({}, (_config) => {
    const app = new App();
    app.islands({ CounterIsland }, "chunk-counter");
    app.get("/view", (ctx) =>
      ctx.render(
        <html>
          <body>
            <CounterIsland count={10} />
          </body>
        </html>,
      ));
    return app;
  });

  const pluginB = createPlugin({}, (_config) => {
    const app = new App();
    app.islands({ GreetIsland }, "chunk-greet");
    app.get("/view", (ctx) =>
      ctx.render(
        <html>
          <body>
            <GreetIsland name="world" />
          </body>
        </html>,
      ));
    return app;
  });

  const host = new App();
  host.mountApp("/a", pluginA);
  host.mountApp("/b", pluginB);

  const cache = new MockBuildCache([], "production");
  setBuildCache(host, cache, "production");

  const handler = host.handler();

  const resA = await handler(new Request("http://localhost/a/view"));
  const htmlA = await resA.text();
  expect(htmlA).toContain("frsh:island");
  expect(htmlA).toContain("CounterIsland");
  expect(htmlA).toContain("10");

  const resB = await handler(new Request("http://localhost/b/view"));
  const htmlB = await resB.text();
  expect(htmlB).toContain("frsh:island");
  expect(htmlB).toContain("GreetIsland");
  expect(htmlB).toContain("world");
});
