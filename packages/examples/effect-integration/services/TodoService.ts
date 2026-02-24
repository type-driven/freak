import { Effect, Layer, ServiceMap } from "effect";
import type { Todo } from "../types.ts";
import { KvError, NotFoundError } from "./errors.ts";

/**
 * TodoService shape: list, create, toggle, remove operations backed by Deno KV.
 */
const TodoServiceShape = ServiceMap.Service<{
  readonly list: () => Effect.Effect<Todo[], KvError>;
  readonly create: (text: string) => Effect.Effect<Todo, KvError>;
  readonly toggle: (id: string) => Effect.Effect<Todo, KvError | NotFoundError>;
  readonly remove: (id: string) => Effect.Effect<void, KvError | NotFoundError>;
}>("TodoService");

export const TodoService = TodoServiceShape;

export type TodoServiceR = ServiceMap.Service.Identifier<typeof TodoService>;

/**
 * TodoLayer: provides TodoService backed by Deno.openKv().
 * The KV handle is opened once when the Layer is built and reused for all requests.
 */
export const TodoLayer = Layer.effect(
  TodoService,
  Effect.tryPromise({
    try: () => Deno.openKv(),
    catch: (e) =>
      new KvError({
        message: e instanceof Error ? e.message : String(e),
      }),
  }).pipe(
    Effect.map((kv) => ({
      list: (): Effect.Effect<Todo[], KvError> =>
        Effect.tryPromise({
          try: async () => {
            const todos: Todo[] = [];
            for await (
              const entry of kv.list<Todo>({ prefix: ["todos"] })
            ) {
              todos.push(entry.value);
            }
            return todos;
          },
          catch: (e) =>
            new KvError({
              message: e instanceof Error ? e.message : String(e),
            }),
        }),

      create: (text: string): Effect.Effect<Todo, KvError> =>
        Effect.tryPromise({
          try: async () => {
            const id = crypto.randomUUID();
            const todo: Todo = { id, text, done: false };
            await kv.set(["todos", id], todo);
            return todo;
          },
          catch: (e) =>
            new KvError({
              message: e instanceof Error ? e.message : String(e),
            }),
        }),

      toggle: (id: string): Effect.Effect<Todo, KvError | NotFoundError> =>
        Effect.tryPromise({
          try: async () => {
            const entry = await kv.get<Todo>(["todos", id]);
            if (!entry.value) {
              throw new NotFoundError({ id });
            }
            const updated: Todo = { ...entry.value, done: !entry.value.done };
            await kv.set(["todos", id], updated);
            return updated;
          },
          catch: (e) => {
            if (e instanceof NotFoundError) return e;
            return new KvError({
              message: e instanceof Error ? e.message : String(e),
            });
          },
        }),

      remove: (id: string): Effect.Effect<void, KvError | NotFoundError> =>
        Effect.tryPromise({
          try: async () => {
            const entry = await kv.get<Todo>(["todos", id]);
            if (!entry.value) {
              throw new NotFoundError({ id });
            }
            await kv.delete(["todos", id]);
          },
          catch: (e) => {
            if (e instanceof NotFoundError) return e;
            return new KvError({
              message: e instanceof Error ? e.message : String(e),
            });
          },
        }),
    })),
  ),
);
