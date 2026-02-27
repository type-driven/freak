/**
 * RPC integration tests — verifies Phase 9 success criteria.
 *
 * SC-1: RPC call returns typed response from handler implementation.
 * SC-2 (smoke): Both HTTP and WebSocket protocols register without error.
 *
 * Test harness: RpcTest.makeClient for in-process testing (no HTTP needed).
 *
 * IMPORTANT: Each test that creates an EffectApp calls await app.dispose() at
 * the end to remove signal listeners registered by registerSignalDisposal.
 * Without disposal, the signal listeners would keep the test process alive.
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Layer, Schema } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc";
import { createEffectApp } from "../src/mod.ts";

// ============================================================================
// Shared RPC group definition — used by all tests
// ============================================================================

const ItemSchema = Schema.Struct({ id: Schema.String, name: Schema.String });

const ListItems = Rpc.make("ListItems", {
  success: Schema.Array(ItemSchema),
});

const CreateItem = Rpc.make("CreateItem", {
  payload: Schema.Struct({ name: Schema.String }),
  success: ItemSchema,
});

const TestRpc = RpcGroup.make(ListItems, CreateItem);

// ============================================================================
// Handler layer
// ============================================================================

const TestHandlers = TestRpc.toLayer({
  // ListItems has no payload — takes no arg
  ListItems: () => Effect.succeed([{ id: "1", name: "Widget" }]),
  // CreateItem has a payload — destructure name
  CreateItem: ({ name }) => Effect.succeed({ id: "2", name }),
});

// ============================================================================
// SC-1: RPC call returns typed response via RpcTest.makeClient (in-process)
// ============================================================================

Deno.test("SC-1: RPC call returns typed response via RpcTest.makeClient", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TestRpc);

      // ListItems — no payload, call with no args
      const items = yield* client.ListItems();
      assertEquals(items, [{ id: "1", name: "Widget" }]);

      // CreateItem — with payload
      const created = yield* client.CreateItem({ name: "Gadget" });
      assertEquals(created, { id: "2", name: "Gadget" });
    }),
  ).pipe(
    Effect.provide(TestHandlers),
    Effect.runPromise,
  );
});

// ============================================================================
// Dispose lifecycle
// ============================================================================

Deno.test("rpc dispose: app.dispose() succeeds without error", async () => {
  const app = createEffectApp({ layer: Layer.empty });
  app.rpc({
    group: TestRpc,
    path: "/rpc/test",
    protocol: "http",
    handlerLayer: TestHandlers,
  });
  app.handler();
  await app.dispose();
});

// ============================================================================
// SC-2 (smoke): WebSocket registration does not throw
//
// This test catches broken WS mounts (registration failures, path conflicts)
// without requiring a real WebSocket connection. Full SC-2 browser verification
// is done via the example app's /rpc-demo route.
// ============================================================================

Deno.test("SC-2 smoke: WS protocol registration does not throw", async () => {
  const app = createEffectApp({ layer: Layer.empty });

  // Register both HTTP and WS protocols for the same group
  app.rpc({
    group: TestRpc,
    path: "/rpc/test",
    protocol: "http",
    handlerLayer: TestHandlers,
  });
  app.rpc({
    group: TestRpc,
    path: "/rpc/test/ws",
    protocol: "websocket",
    handlerLayer: TestHandlers,
  });

  // Get handler — if WS registration breaks, this will throw
  const handler = app.handler();

  // Verify handler is a function (not null/undefined)
  assertEquals(typeof handler, "function");

  await app.dispose();
});
