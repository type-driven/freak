import { Effect, Layer, ServiceMap } from "effect";
import type { Todo } from "../types.ts";
import { NotFoundError } from "./errors.ts";

const TodoServiceShape = ServiceMap.Service<{
  readonly list: () => Effect.Effect<Todo[]>;
  readonly create: (text: string) => Effect.Effect<Todo>;
  readonly toggle: (id: string) => Effect.Effect<Todo, NotFoundError>;
  readonly remove: (id: string) => Effect.Effect<void, NotFoundError>;
}>("TodoService");

export const TodoService = TodoServiceShape;

export type TodoServiceR = ServiceMap.Service.Identifier<typeof TodoService>;

// In-memory store — simple Map, no external dependencies.
const store = new Map<string, Todo>();

export const TodoLayer = Layer.succeed(TodoService, {
  list: () =>
    Effect.sync(() => Array.from(store.values())),

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
