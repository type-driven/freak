import { Effect, Layer, ServiceMap } from "effect";

export const TodoService = ServiceMap.Service<{
  readonly list: () => Effect.Effect<
    Array<{ id: string; text: string; done: boolean }>
  >;
}>("TodoService");

export type TodoServiceR = ServiceMap.Service.Identifier<typeof TodoService>;

export const TodoLayer = Layer.succeed(TodoService, {
  list: () =>
    Effect.sync(() => [{ id: "1", text: "Benchmark todo", done: false }]),
});
