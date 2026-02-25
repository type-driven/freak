/**
 * Type-level tests for SC-2: TypeScript rejects handlers using services not
 * in the provided Layer.
 *
 * These tests use @ts-expect-error directives to assert that TypeScript raises
 * a type error for handlers requiring services not declared in AppR. If the
 * error is NOT raised, `deno check` fails with "Unused '@ts-expect-error'
 * directive" — meaning the test is broken.
 *
 * Run: deno check packages/effect/tests/types_test.ts
 * Run: deno test --allow-env packages/effect/tests/types_test.ts
 *
 * NOTE: createEffectDefine in @fresh/effect is type-only (no app/layer args).
 * Runtime management is EffectApp's job. Use createEffectDefine<State, R>()
 * to constrain handler types.
 */

import { expectTypeOf } from "npm:expect-type@^1.1.0";
import { Effect, Layer, ServiceMap } from "effect";
import { createEffectApp, createEffectDefine } from "../src/mod.ts";
import type { EffectDefine } from "../src/mod.ts";

// ============================================================================
// Shared service definitions
// ============================================================================

const DbService = ServiceMap.Service<{ query: (sql: string) => string }>("DbService");
const EmailService = ServiceMap.Service<{ send: (to: string) => void }>("EmailService");
const DbLayer = Layer.succeed(DbService, { query: (sql) => `result: ${sql}` });
type DbR = ServiceMap.Service.Identifier<typeof DbService>;

// ============================================================================
// SC-2: EffectApp.get() type rejection tests
// ============================================================================

Deno.test("SC-2: EffectApp.get() accepts handler using declared service", () => {
  const app = createEffectApp<unknown, DbR>({ layer: DbLayer });
  // Must compile without error — DbService is in AppR
  app.get("/test", () =>
    Effect.gen(function* () {
      const db = yield* DbService;
      return new Response(db.query("1"));
    }));
  // No dispose needed — this is a type-only test (no FakeServer, no requests)
  void app.dispose();
});

Deno.test("SC-2: EffectApp.get() rejects handler using undeclared service", () => {
  const app = createEffectApp<unknown, DbR>({ layer: DbLayer });
  // Assign the bad handler to a variable typed to EffectApp's handler signature.
  // TypeScript will reject this assignment because EmailService is not in DbR.
  type GoodHandler = Parameters<typeof app.get>[1];
  // @ts-expect-error — EmailService is not in AppR (only DbService is provided)
  const badHandler: GoodHandler = () => Effect.gen(function* () {
    yield* EmailService;
    return new Response("ok");
  });
  // deno-lint-ignore no-explicit-any
  app.get("/test", badHandler as any);
  void app.dispose();
});

// ============================================================================
// SC-2: createEffectDefine type rejection tests
// ============================================================================

Deno.test("SC-2: createEffectDefine rejects handler using undeclared service", () => {
  const define = createEffectDefine<unknown, DbR>();
  define.handlers({
    // @ts-expect-error — EmailService is not in R (only DbService is declared)
    POST: () =>
      Effect.gen(function* () {
        yield* EmailService;
        return new Response("ok");
      }),
  });
});

Deno.test("SC-2: createEffectDefine accepts handler using declared service", () => {
  const define = createEffectDefine<unknown, DbR>();
  // Must compile without error — DbService is in R
  define.handlers({
    GET: () =>
      Effect.gen(function* () {
        const db = yield* DbService;
        return new Response(db.query("1"));
      }),
  });
});

// ============================================================================
// Additional type shape tests
// ============================================================================

Deno.test("type: EffectDefine interface has handlers method", () => {
  expectTypeOf<EffectDefine<unknown, never>>().toHaveProperty("handlers");
});

Deno.test("type: createEffectDefine returns EffectDefine", () => {
  const define = createEffectDefine<unknown, DbR>();
  expectTypeOf(define.handlers).toBeFunction();
});
