/**
 * greeting_plugin_test.ts — TDD RED phase tests for GreetingPlugin
 *
 * These tests describe the behavior of GreetingPlugin before the implementation exists.
 * They will FAIL until greeting_plugin.tsx is created.
 */

import { expect } from "@std/expect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as Effect from "effect/Effect";
import { createEffectApp } from "@fresh/effect";
import { setAtom, serializeAtomHydration } from "../../effect/src/hydration.ts";

// Importing these will fail until greeting_plugin.tsx exists
import {
  GreetingLive,
  GreetingService,
  greetingAtom,
  createGreetingPlugin,
} from "./greeting_plugin.tsx";

// ---------------------------------------------------------------------------
// TDD: GreetingService.getGreeting returns "Hello, {name}!"
// ---------------------------------------------------------------------------

Deno.test("GreetingService.getGreeting('World') returns 'Hello, World!'", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* GreetingService;
      return svc.getGreeting("World");
    }).pipe(Effect.provide(GreetingLive)),
  );
  expect(result).toBe("Hello, World!");
});

// ---------------------------------------------------------------------------
// TDD: greetingAtom has key "greeting" — distinct from counterAtom key "counter"
// ---------------------------------------------------------------------------

Deno.test("greetingAtom has key 'greeting'", () => {
  expect(Atom.isSerializable(greetingAtom)).toBe(true);
  const ctx = { state: {} };
  setAtom(ctx, greetingAtom, "Hi");
  const json = serializeAtomHydration(ctx);
  expect(json).toBe(JSON.stringify({ greeting: "Hi" }));
});

// ---------------------------------------------------------------------------
// TDD: createGreetingPlugin<AuthState>() — GET /greet returns 200 with greeting
// ---------------------------------------------------------------------------

Deno.test("createGreetingPlugin GET /greet returns 200 with greeting", async () => {
  const hostApp = createEffectApp({ layer: GreetingLive });
  hostApp.mountApp("/greeting", createGreetingPlugin());

  const handler = hostApp.handler();
  const res = await handler(new Request("http://localhost/greeting/greet"));
  expect(res.status).toBe(200);
  const body = await res.json() as { greeting: string };
  expect(body.greeting).toBe("Hello, World!");

  await hostApp.dispose();
});
