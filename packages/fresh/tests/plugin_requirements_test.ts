import { expect } from "@std/expect";
import { App, createPlugin } from "../src/mod.ts";

// Minimal no-op factory for testing
function makeApp(): App<unknown> {
  return new App();
}

Deno.test("createPlugin stores requirements on Plugin", () => {
  const requirements = [
    { capability: "auth", required: true, reason: "needed for user routes" },
    { capability: "db", required: false },
  ];
  const plugin = createPlugin({}, makeApp, requirements);
  expect(plugin.requirements).toEqual(requirements);
});

Deno.test("createPlugin with no requirements stores undefined", () => {
  const plugin = createPlugin({}, makeApp);
  expect(plugin.requirements).toBeUndefined();
});

Deno.test("mountApp: required capability provided — no error", () => {
  const plugin = createPlugin(
    {},
    makeApp,
    [{ capability: "auth", required: true }],
  );
  const host = new App();
  // Should not throw
  expect(() =>
    host.mountApp("/plugin", plugin, { provides: ["auth"] })
  ).not.toThrow();
});

Deno.test("mountApp: required capability missing — throws descriptive error", () => {
  const plugin = createPlugin(
    {},
    makeApp,
    [{ capability: "auth", required: true, reason: "routes are protected" }],
  );
  const host = new App();
  expect(() =>
    host.mountApp("/plugin", plugin, { provides: [] })
  ).toThrow(/capability "auth"/);
});

Deno.test("mountApp: optional capability missing — no error", () => {
  const plugin = createPlugin(
    {},
    makeApp,
    [{ capability: "cache", required: false }],
  );
  const host = new App();
  // optional requirements never throw
  expect(() =>
    host.mountApp("/plugin", plugin)
  ).not.toThrow();
});

Deno.test("mountApp: multiple requirements, one missing — throws for the missing one", () => {
  const plugin = createPlugin(
    {},
    makeApp,
    [
      { capability: "auth", required: true },
      { capability: "db", required: true },
    ],
  );
  const host = new App();
  // provides auth but not db
  expect(() =>
    host.mountApp("/plugin", plugin, { provides: ["auth"] })
  ).toThrow(/capability "db"/);
});

Deno.test("mountApp: plugin with no requirements — no error even with empty provides", () => {
  const plugin = createPlugin({}, makeApp);
  const host = new App();
  expect(() => host.mountApp("/plugin", plugin)).not.toThrow();
});
