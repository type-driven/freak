/**
 * Type-level tests for SC-3: TypeScript rejects a call to a procedure not
 * declared in the RpcGroup schema.
 *
 * Uses @ts-expect-error directives to assert that TypeScript raises a type
 * error when accessing a property not declared on the typed RPC client. If the
 * error is NOT raised (meaning TS considers the access valid), `deno check`
 * fails with "Unused '@ts-expect-error' directive" — meaning the SC-3
 * guarantee is broken.
 *
 * Run: deno check packages/effect/tests/rpc_types_test.ts
 * Run: deno test --allow-env packages/effect/tests/rpc_types_test.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import { Effect, Schema } from "effect";
import { Rpc, RpcGroup, RpcTest } from "effect/unstable/rpc";

// ============================================================================
// Test RpcGroup — only declares ListItems, not NonExistent
// ============================================================================

const ListItems = Rpc.make("ListItems", {
  success: Schema.Array(Schema.String),
});

const TestRpc = RpcGroup.make(ListItems);

const TestHandlers = TestRpc.toLayer({
  ListItems: () => Effect.succeed(["item1", "item2"]),
});

// ============================================================================
// SC-3: TypeScript rejects a call to an undeclared procedure
// ============================================================================

Deno.test("SC-3: TypeScript rejects call to undeclared procedure", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TestRpc);

      // Valid call — compiles without error (ListItems is declared)
      const items = yield* client.ListItems();
      assertEquals(items, ["item1", "item2"]);

      // @ts-expect-error — "NonExistent" is not declared in TestRpc
      client.NonExistent;
    }),
  ).pipe(
    Effect.provide(TestHandlers),
    Effect.runPromise,
  );
});

// ============================================================================
// Additional: declared procedure is a function (not undefined)
// ============================================================================

Deno.test("type: declared procedure is callable on typed client", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TestRpc);
      // Type system allows accessing ListItems — it is a function
      assertEquals(typeof client.ListItems, "function");
    }),
  ).pipe(
    Effect.provide(TestHandlers),
    Effect.runPromise,
  );
});
