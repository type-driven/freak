/**
 * RPC group definition and handler implementations for the example app.
 *
 * Defines TodoRpc with procedures for todo CRUD and a live-update stream.
 * - ListTodos — list all todos (no payload)
 * - CreateTodo — create a todo (payload: { text })
 * - DeleteTodo — delete a todo by id (payload: { id }) — ignores NotFoundError
 * - WatchTodos — streaming: emits current todo list every 2 seconds
 *
 * WatchTodos uses RpcSchema.Stream (not stream: true) so TypeScript can
 * correctly type the handler as returning a Stream value directly.
 */

import { Effect, Schedule, Schema, Stream } from "effect";
import { Rpc, RpcGroup, RpcSchema } from "effect/unstable/rpc";
import { TodoService } from "./TodoService.ts";
import { TodoSchema } from "../types.ts";

// ---------------------------------------------------------------------------
// Procedure definitions
// ---------------------------------------------------------------------------

const ListTodos = Rpc.make("ListTodos", {
  success: Schema.Array(TodoSchema),
});

const CreateTodo = Rpc.make("CreateTodo", {
  payload: Schema.Struct({ text: Schema.String }),
  success: TodoSchema,
});

const DeleteTodo = Rpc.make("DeleteTodo", {
  payload: Schema.Struct({ id: Schema.String }),
  success: Schema.Void,
});

// Streaming procedure: emits the full todo list on a 2-second schedule.
// Uses RpcSchema.Stream (not stream: true) for correct TypeScript typing —
// the handler returns a Stream<A, E, R> directly, not wrapped in Effect.
const WatchTodos = Rpc.make("WatchTodos", {
  success: RpcSchema.Stream(Schema.Array(TodoSchema), Schema.Never),
});

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

export const TodoRpc = RpcGroup.make(ListTodos, CreateTodo, DeleteTodo, WatchTodos);

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

export const TodoRpcHandlers = TodoRpc.toLayer({
  ListTodos: () =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.list();
    }),

  CreateTodo: ({ text }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      return yield* svc.create(text);
    }),

  // Silently succeed if todo not found — Effect.ignore drops the NotFoundError
  DeleteTodo: ({ id }) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      yield* Effect.ignore(svc.remove(id));
    }),

  WatchTodos: () =>
    // Emit current todo list every 2 seconds.
    // A production app would use a SubscriptionRef or event bus for real push.
    Stream.fromEffectSchedule(
      Effect.gen(function* () {
        const svc = yield* TodoService;
        return yield* svc.list();
      }),
      Schedule.spaced("2 seconds"),
    ),
});
