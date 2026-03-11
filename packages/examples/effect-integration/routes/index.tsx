import { Effect } from "effect";
import { createEffectDefine, setAtom } from "@fresh/core/effect";
import { page } from "@fresh/core";
import type { PageProps } from "@fresh/core";
import { TodoService, type TodoServiceR } from "../services/TodoService.ts";
import { todoListAtom } from "../atoms.ts";
import type { Todo } from "../types.ts";
import TodoApp from "../islands/TodoApp.tsx";

const define = createEffectDefine<unknown, TodoServiceR>();

export const handler = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* TodoService;
      const todos = yield* svc.list();
      setAtom(ctx, todoListAtom, todos);
      return page({ todos });
    }),
});

export default function IndexPage(_props: PageProps<{ todos: Todo[] }>) {
  return (
    <div class="max-w-2xl mx-auto py-8 px-4">
      <h1 class="text-3xl font-bold mb-2">Fresh + Effect v4</h1>
      <p class="text-gray-600 mb-8">
        Todo app demonstrating Effect-returning handlers, typed Layers, atom
        hydration, and Preact island hooks.
      </p>
      <TodoApp />
      <footer class="mt-12 pt-4 border-t border-gray-200 text-sm text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
        <a href="/query-demo" class="text-blue-600 hover:underline">
          useQuery + useMutation demo
        </a>
        <a href="/rpc-demo" class="text-blue-600 hover:underline">
          RPC demo
        </a>
        <a href="/streaming-modes" class="text-blue-600 hover:underline">
          Streaming modes
        </a>
        <a href="/errors/demo" class="text-blue-600 hover:underline">
          Error demo
        </a>
      </footer>
    </div>
  );
}
