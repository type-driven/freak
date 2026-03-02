/**
 * Tests for TodoRpc group and handler implementations.
 *
 * Uses RpcTest.makeClient for in-process testing (no HTTP/WS transport needed).
 * Uses TestClock to deterministically test the WatchTodos streaming schedule.
 *
 * Run: deno test --allow-env packages/examples/effect-integration/services/rpc.test.ts
 */

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { Effect, Fiber, Layer, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { TestClock } from "effect/testing";
import { TodoRpc, TodoRpcHandlers } from "./rpc.ts";
import { TodoService } from "./TodoService.ts";
import { NotFoundError } from "./errors.ts";
import type { Todo } from "../types.ts";

// ============================================================================
// Test-local TodoService — fresh in-memory store per test
// ============================================================================

/**
 * Creates an isolated TodoService Layer backed by a fresh Map.
 * Each test gets its own store so tests do not interfere with each other.
 *
 * Uses `as any` on the Layer return because ServiceMap.Service in effect-smol
 * beta uses opaque type identity — the shape is structurally identical to the
 * production TodoLayer but TypeScript cannot prove identity equality across
 * different Layer.succeed call sites.
 */
// deno-lint-ignore no-explicit-any
function makeTestTodoLayer(): Layer.Layer<any> {
  const store = new Map<string, Todo>();
  // deno-lint-ignore no-explicit-any
  return Layer.succeed(TodoService as any, {
    list: () => Effect.sync(() => Array.from(store.values())),
    create: (text: string) =>
      Effect.sync(() => {
        const id = crypto.randomUUID();
        const todo: Todo = { id, text, done: false };
        store.set(id, todo);
        return todo;
      }),
    toggle: (id: string) =>
      Effect.gen(function* () {
        const existing = store.get(id);
        if (!existing) return yield* new NotFoundError({ id });
        const updated: Todo = { ...existing, done: !existing.done };
        store.set(id, updated);
        return updated;
      }),
    remove: (id: string) =>
      Effect.gen(function* () {
        if (!store.has(id)) return yield* new NotFoundError({ id });
        store.delete(id);
      }),
  });
}

/**
 * Build an isolated handler layer for a single test.
 */
// deno-lint-ignore no-explicit-any
function makeTestHandlers(): Layer.Layer<any> {
  return Layer.provide(TodoRpcHandlers, makeTestTodoLayer());
}

// ============================================================================
// ListTodos
// ============================================================================

Deno.test("ListTodos: returns empty array when no todos exist", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      const todos = yield* client.ListTodos();
      assertEquals(todos, []);
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

Deno.test("ListTodos: returns created todos", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);

      yield* client.CreateTodo({ text: "Buy milk" });
      yield* client.CreateTodo({ text: "Walk dog" });

      const todos = yield* client.ListTodos();
      assertEquals(todos.length, 2);
      assertEquals(
        todos.map((t: Todo) => t.text).sort(),
        ["Buy milk", "Walk dog"],
      );
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

// ============================================================================
// CreateTodo
// ============================================================================

Deno.test("CreateTodo: returns a todo with the given text", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      const todo = yield* client.CreateTodo({ text: "Test todo" });

      assertEquals(todo.text, "Test todo");
      assertEquals(todo.done, false);
      assertNotEquals(todo.id, "");
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

Deno.test("CreateTodo: each todo gets a unique id", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      const a = yield* client.CreateTodo({ text: "A" });
      const b = yield* client.CreateTodo({ text: "B" });
      assertNotEquals(a.id, b.id);
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

// ============================================================================
// DeleteTodo
// ============================================================================

Deno.test("DeleteTodo: removes a todo by id", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      const todo = yield* client.CreateTodo({ text: "To delete" });

      yield* client.DeleteTodo({ id: todo.id });
      const todos = yield* client.ListTodos();
      assertEquals(todos.length, 0);
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

Deno.test("DeleteTodo: silently succeeds for non-existent id", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      // Should not throw — handler uses Effect.ignore to swallow NotFoundError
      yield* client.DeleteTodo({ id: "non-existent-id" });
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

Deno.test("DeleteTodo: only removes the targeted todo", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      yield* client.CreateTodo({ text: "Keep" });
      const b = yield* client.CreateTodo({ text: "Remove" });

      yield* client.DeleteTodo({ id: b.id });
      const todos = yield* client.ListTodos();
      assertEquals(todos.length, 1);
      assertEquals(todos[0].text, "Keep");
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

// ============================================================================
// WatchTodos (streaming) — uses TestClock for deterministic time control
// ============================================================================

Deno.test("WatchTodos: emits current todo list on each tick", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);

      // Create a todo before subscribing so the first emission includes it
      yield* client.CreateTodo({ text: "Initial" });

      // WatchTodos returns a Stream (via RpcSchema.Stream).
      // Take 3 emissions to verify repeated schedule ticks.
      const stream = client.WatchTodos();
      const collected: Array<readonly Todo[]> = [];

      // Fork the stream consumer so we can advance the TestClock
      const fiber = yield* Stream.runForEach(
        stream.pipe(Stream.take(3)) as Stream.Stream<
          readonly Todo[],
          never,
          never
        >,
        (todos: readonly Todo[]) => Effect.sync(() => collected.push(todos)),
      ).pipe(Effect.forkChild);

      // Stream.fromEffectSchedule emits immediately (first tick), then waits
      // for each Schedule.spaced("2 seconds") interval.

      // First emission is immediate — advance a tiny bit to let it process
      yield* TestClock.adjust("0 millis");
      yield* Effect.yieldNow;

      // Second emission at 2 seconds
      yield* TestClock.adjust("2 seconds");
      yield* Effect.yieldNow;

      // Third emission at 4 seconds
      yield* TestClock.adjust("2 seconds");
      yield* Effect.yieldNow;

      yield* Fiber.join(fiber);

      assertEquals(collected.length, 3);
      // All three emissions should contain the same todo
      for (const todos of collected) {
        assertEquals(todos.length, 1);
        assertEquals(todos[0].text, "Initial");
      }
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    Effect.provide(TestClock.layer()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

Deno.test("WatchTodos: reflects mutations between emissions", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);

      const stream = client.WatchTodos();
      const collected: Array<readonly Todo[]> = [];

      const fiber = yield* Stream.runForEach(
        stream.pipe(Stream.take(3)) as Stream.Stream<
          readonly Todo[],
          never,
          never
        >,
        (todos: readonly Todo[]) => Effect.sync(() => collected.push(todos)),
      ).pipe(Effect.forkChild);

      // Emission 1: empty list
      yield* TestClock.adjust("0 millis");
      yield* Effect.yieldNow;

      // Add a todo before the next emission
      yield* client.CreateTodo({ text: "Added between ticks" });

      // Emission 2: should include the new todo
      yield* TestClock.adjust("2 seconds");
      yield* Effect.yieldNow;

      // Delete it before the next emission
      const todos2 = collected[1];
      if (todos2 && todos2.length > 0) {
        yield* client.DeleteTodo({ id: todos2[0].id });
      }

      // Emission 3: should be empty again
      yield* TestClock.adjust("2 seconds");
      yield* Effect.yieldNow;

      yield* Fiber.join(fiber);

      assertEquals(collected.length, 3);
      assertEquals(collected[0].length, 0);
      assertEquals(collected[1].length, 1);
      assertEquals(collected[1][0].text, "Added between ticks");
      assertEquals(collected[2].length, 0);
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    Effect.provide(TestClock.layer()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});

// ============================================================================
// Independent state per test — tests do not share store
// ============================================================================

Deno.test("independent state: separate test layers have isolated stores", async () => {
  // Test A: create a todo
  const todosA: Todo[] = await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      yield* client.CreateTodo({ text: "Only in A" });
      return yield* client.ListTodos();
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );

  // Test B: should have empty store (no leakage from A)
  const todosB: Todo[] = await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);
      return yield* client.ListTodos();
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );

  assertEquals(todosA.length, 1);
  assertEquals(todosB.length, 0);
});

// ============================================================================
// CRUD round-trip
// ============================================================================

Deno.test("CRUD round-trip: create, list, delete, list", async () => {
  await Effect.scoped(
    Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(TodoRpc);

      // Create
      const todo = yield* client.CreateTodo({ text: "Round-trip" });
      assertEquals(todo.text, "Round-trip");

      // List — should contain the created todo
      const afterCreate = yield* client.ListTodos();
      assertEquals(afterCreate.length, 1);
      assertEquals(afterCreate[0].id, todo.id);

      // Delete
      yield* client.DeleteTodo({ id: todo.id });

      // List — should be empty
      const afterDelete = yield* client.ListTodos();
      assertEquals(afterDelete.length, 0);
    }),
  ).pipe(
    Effect.provide(makeTestHandlers()),
    // deno-lint-ignore no-explicit-any
    Effect.runPromise as any,
  );
});
