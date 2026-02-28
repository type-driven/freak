import { Effect } from "effect";
import { TodoService, type TodoServiceR } from "../../services/TodoService.ts";

export const handler = {
  GET: (_ctx: unknown) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      return new Response(JSON.stringify(todos), {
        headers: { "content-type": "application/json" },
      });
    }) as Effect.Effect<Response, never, TodoServiceR>,
};
