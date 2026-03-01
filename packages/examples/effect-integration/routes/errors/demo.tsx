import { Effect } from "effect";
import { createEffectDefine } from "@fresh/effect";
import { TodoService, type TodoServiceR } from "../../services/TodoService.ts";

const define = createEffectDefine<unknown, TodoServiceR>();

export const handler = define.handlers({
  GET: () =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      // Deliberately look up a non-existent todo to trigger NotFoundError
      yield* svc.toggle("non-existent-id");
      return new Response("This should not be reached");
    }),
});

export default function ErrorDemoPage() {
  return (
    <div class="max-w-2xl mx-auto py-8 px-4">
      <h1 class="text-2xl font-bold mb-4">Error Demo</h1>
      <p>This page deliberately triggers a typed Effect error.</p>
      <p class="mt-2 text-gray-600">
        Check the server console for the Cause.pretty() output showing
        the full error trace including the tagged NotFoundError.
      </p>
    </div>
  );
}
