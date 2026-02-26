/**
 * HttpApi integration tests — verifies all 3 Phase 8 success criteria.
 *
 * SC-1: GET to mounted HttpApi endpoint returns expected JSON body.
 * SC-2: Invalid query params return HTTP 400 with HttpApiSchemaError body.
 * SC-3: Handler returning HttpApiError.NotFound produces HTTP 404 status.
 *
 * Test harness: FakeServer from @fresh/core test_utils.
 *
 * IMPORTANT: Each test calls await app.dispose() at the end to remove signal
 * listeners registered by registerSignalDisposal. Without disposal, the signal
 * listeners would keep the test process alive and trigger Deno.exit(0) on any
 * SIGINT/SIGTERM during the test run.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { FakeServer } from "../../fresh/src/test_utils.ts";
import { createEffectApp } from "../src/mod.ts";

// ============================================================================
// Shared API definition — used by all tests
// ============================================================================

const ItemSchema = Schema.Struct({ id: Schema.String, name: Schema.String });

const Api = HttpApi.make("testApi").add(
  HttpApiGroup.make("items")
    .add(
      HttpApiEndpoint.get("list", "/items/", {
        success: Schema.Array(ItemSchema),
      }),
    )
    .add(
      HttpApiEndpoint.get("search", "/items/search", {
        // FiniteFromString (not NumberFromString) correctly rejects NaN — decodes to Finite, not Number
        query: { page: Schema.FiniteFromString },
        success: Schema.Array(ItemSchema),
      }),
    )
    .add(
      HttpApiEndpoint.get("getById", "/items/:id", {
        params: { id: Schema.String },
        success: ItemSchema,
        error: HttpApiError.NotFound,
      }),
    ),
);

// ============================================================================
// Group implementation
// ============================================================================

const ItemsLive = HttpApiBuilder.group(Api, "items", (handlers) =>
  handlers
    .handle("list", () =>
      Effect.succeed([{ id: "1", name: "Widget" }, { id: "2", name: "Gadget" }])
    )
    .handle("search", ({ query }) =>
      Effect.succeed([{ id: "1", name: `Page ${query.page}` }])
    )
    .handle("getById", ({ params }) =>
      Effect.gen(function* () {
        if (params.id === "1") return { id: "1", name: "Widget" };
        return yield* new HttpApiError.NotFound({});
      })
    )
);

// ============================================================================
// Shared app factory — creates a fresh EffectApp for each test
// ============================================================================

function makeTestApp() {
  const app = createEffectApp({ layer: Layer.empty });
  app.httpApi("/api", Api, ItemsLive);
  return app;
}

// ============================================================================
// SC-1: GET request returns expected JSON
// ============================================================================

Deno.test("SC-1: GET to mounted HttpApi endpoint returns expected JSON body", async () => {
  const app = makeTestApp();
  const server = new FakeServer(app.handler());
  const res = await server.get("/api/items/");
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, [{ id: "1", name: "Widget" }, { id: "2", name: "Gadget" }]);
  await app.dispose();
});

// ============================================================================
// SC-2: Invalid query params return 400 with HttpApiSchemaError body
// ============================================================================

Deno.test("SC-2: Invalid query params return 400 with HttpApiSchemaError body", async () => {
  const app = makeTestApp();
  const server = new FakeServer(app.handler());
  const res = await server.get("/api/items/search?page=notanumber");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body._tag, "HttpApiSchemaError");
  await app.dispose();
});

// ============================================================================
// SC-3: Typed HttpApiError.NotFound produces 404
// ============================================================================

Deno.test("SC-3: Handler returning HttpApiError.NotFound produces 404 status", async () => {
  const app = makeTestApp();
  const server = new FakeServer(app.handler());
  const res = await server.get("/api/items/99");
  assertEquals(res.status, 404);
  await app.dispose();
});

// ============================================================================
// Dispose lifecycle
// ============================================================================

Deno.test("httpApi dispose: app.dispose() succeeds without error", async () => {
  const app = makeTestApp();
  app.handler();
  await app.dispose();
});
