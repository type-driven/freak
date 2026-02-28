import type { FreshContext } from "@fresh/core";

export const handler = {
  GET: (_ctx: FreshContext) => {
    const todos = [{ id: "1", text: "Benchmark todo", done: false }];
    return new Response(JSON.stringify(todos), {
      headers: { "content-type": "application/json" },
    });
  },
};
