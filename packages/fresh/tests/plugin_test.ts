/**
 * plugin_test.ts — type-level and runtime tests for Plugin<Config, S, R> and createPlugin().
 */
import { expect } from "@std/expect";
import { App, createPlugin } from "../src/mod.ts";

Deno.test("Plugin: createPlugin returns Plugin with config and app", () => {
  const plugin = createPlugin({ port: 3000 }, (config) => {
    const app = new App();
    expect(config.port).toBe(3000);
    return app;
  });

  expect(plugin.config).toEqual({ port: 3000 });
  expect(plugin.app).toBeInstanceOf(App);
});

Deno.test("Plugin: createPlugin with typed state", () => {
  interface MyState {
    userId: string;
  }
  const plugin = createPlugin<{ prefix: string }, MyState>(
    { prefix: "/api" },
    (_config) => new App<MyState>(),
  );

  const _app: App<MyState> = plugin.app;
  expect(_app).toBeInstanceOf(App);
});

Deno.test("Plugin: mountApp accepts Plugin via overload", () => {
  const plugin = createPlugin<{ label: string }, unknown>(
    { label: "test" },
    (_config) => {
      const app = new App();
      app.get("/hello", () => new Response("hello"));
      return app;
    },
  );

  const host = new App();
  host.mountApp("/test", plugin);
});

Deno.test("Plugin: mountApp with Plugin routes work at runtime", async () => {
  const plugin = createPlugin({}, (_config) => {
    const app = new App();
    app.get("/hello", () => new Response("world"));
    return app;
  });

  const host = new App();
  host.mountApp("/p", plugin);

  const handler = host.handler();
  const res = await handler(new Request("http://localhost/p/hello"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("world");
});

Deno.test("Plugin: PLUG-03 — incompatible state produces type error on App.mountApp", () => {
  const plugin = createPlugin<Record<string, never>, { count: number }, never>(
    {},
    (_config) => new App<{ count: number }>(),
  );
  const host = new App<{ name: string }>();
  // @ts-expect-error Plugin<{}, { count: number }, never> not assignable to Plugin<{}, { name: string }, ...>
  host.mountApp("/bad", plugin);
});

Deno.test("Plugin: backward compat — mountApp still accepts plain App<State>", async () => {
  const subApp = new App();
  subApp.get("/hi", () => new Response("sub"));

  const host = new App();
  host.mountApp("/sub", subApp);

  const handler = host.handler();
  const res = await handler(new Request("http://localhost/sub/hi"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("sub");
});
