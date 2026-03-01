import { Effect } from "effect";
import { createEffectDefine } from "@fresh/effect";
import { TodoService, type TodoServiceR } from "../../services/TodoService.ts";

const define = createEffectDefine<unknown, TodoServiceR>();

export const handler = define.handlers({
  POST: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const body = yield* Effect.tryPromise(() => ctx.req.json());
      yield* svc.create(body.text);
      const all = yield* svc.list();
      return new Response(JSON.stringify(all), {
        headers: { "content-type": "application/json" },
      });
    }),

  PATCH: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const body = yield* Effect.tryPromise(() => ctx.req.json());
      yield* svc.toggle(body.id);
      const all = yield* svc.list();
      return new Response(JSON.stringify(all), {
        headers: { "content-type": "application/json" },
      });
    }),

  DELETE: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const body = yield* Effect.tryPromise(() => ctx.req.json());
      yield* svc.remove(body.id);
      return new Response(null, { status: 204 });
    }),
});
