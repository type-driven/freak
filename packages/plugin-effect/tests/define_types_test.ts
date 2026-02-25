/**
 * Type-level tests for createEffectDefine.
 *
 * SC-1: R type parameter threads through handler return types — positive tests
 *       using expectTypeOf to verify structural compatibility.
 * SC-2: Undeclared service causes compile error — negative tests using
 *       @ts-expect-error to assert that TypeScript rejects invalid handlers.
 *
 * These are runtime tests that contain type assertions. The @ts-expect-error
 * comments verify that TypeScript raises an error — if the error is NOT raised,
 * the test file itself fails to compile (deno check fails with "Unused directive").
 *
 * NOTE on R type parameter with ServiceMap.Service:
 * When using ServiceMap.Service<Shape>(key), the R parameter in Effect.gen is the
 * Identifier type (which equals Shape when only one type param is provided).
 * Use ServiceMap.Service.Identifier<typeof MyService> to extract the correct R type
 * for use with createEffectDefine<State, R>.
 */

import { expectTypeOf } from "npm:expect-type@^1.1.0";
import { Effect, Layer, ServiceMap } from "effect";
import { App } from "@fresh/core";
import { createEffectDefine } from "../src/define.ts";
import type { EffectDefine, EffectHandlerFn } from "../src/define.ts";

// --- Service definitions (Effect v4 API: ServiceMap.Service, NOT Context.Tag) ---

const DbService = ServiceMap.Service<{ query: (sql: string) => string }>("DbService");
const EmailService = ServiceMap.Service<{ send: (to: string) => void }>("EmailService");
const DbLayer = Layer.succeed(DbService, { query: (sql) => `result: ${sql}` });

// R is the Identifier type extracted from the service (shape type when one type param given)
type DbR = ServiceMap.Service.Identifier<typeof DbService>;
type EmailR = ServiceMap.Service.Identifier<typeof EmailService>;

// Verify the extracted types are the expected shapes
const _verifyDbR: DbR = { query: (sql: string) => `r: ${sql}` };
const _verifyEmailR: EmailR = { send: (_to: string) => {} };

// --- SC-1: R threads through handler return types ---

Deno.test("type: createEffectDefine compiles with R type parameter", () => {
  const app = new App();
  const define = createEffectDefine<unknown, DbR>(app, { layer: DbLayer });
  expectTypeOf(define.handlers).toBeFunction();
  const h = define.handlers({
    GET: (_ctx) =>
      Effect.gen(function* () {
        const db = yield* DbService;
        return new Response(db.query("SELECT 1"));
      }),
  });
  expectTypeOf(h).toHaveProperty("GET");
});

Deno.test("type: createEffectDefine without layer compiles (type-parameter-only)", () => {
  const define = createEffectDefine<unknown, DbR>();
  expectTypeOf(define.handlers).toBeFunction();
  define.handlers({
    GET: () =>
      Effect.gen(function* () {
        const db = yield* DbService;
        return new Response(db.query("test"));
      }),
  });
});

// --- SC-2: Undeclared service causes compile error ---

Deno.test("type: handler with undeclared service causes compile error", () => {
  const app = new App();
  const define = createEffectDefine<unknown, DbR>(app, { layer: DbLayer });
  define.handlers({
    // @ts-expect-error — EmailService is not in R (only DbService is provided)
    POST: () =>
      Effect.gen(function* () {
        yield* EmailService;
        return new Response("ok");
      }),
  });
});

Deno.test("type: single handler function with undeclared service causes compile error", () => {
  const app = new App();
  const define = createEffectDefine<unknown, DbR>(app, { layer: DbLayer });
  // @ts-expect-error — EmailService is not in R
  define.handlers(() =>
    Effect.gen(function* () {
      yield* EmailService;
      return new Response("ok");
    })
  );
});

// --- R=never: service-free effects ---

Deno.test("type: handler with R=never compiles for service-free effects", () => {
  const define = createEffectDefine();
  define.handlers({
    GET: () => Effect.succeed(new Response("hello")),
  });
});

// --- EffectDefine interface shape ---

Deno.test("type: EffectDefine interface has handlers method", () => {
  expectTypeOf<EffectDefine<unknown, never>>().toHaveProperty("handlers");
});

// --- EffectHandlerFn structural compatibility ---

Deno.test("type: EffectHandlerFn is a function type", () => {
  expectTypeOf<EffectHandlerFn<unknown, unknown, never>>().toBeFunction();
});

// --- Multiple services: R includes multiple service requirements ---

Deno.test("type: handler using only declared service compiles", () => {
  const app = new App();
  const define = createEffectDefine<unknown, DbR>(app, { layer: DbLayer });
  define.handlers({
    GET: () =>
      Effect.gen(function* () {
        const db = yield* DbService;
        return new Response(db.query("test"));
      }),
  });
});
