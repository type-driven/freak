/**
 * Integration tests for EffectApp RPC transport layer.
 *
 * Tests all four RPC protocols — HTTP, HTTP-stream, SSE, WebSocket — using
 * Fresh's `app.handler()` as a test double (no real TCP listener required).
 *
 * Each test gets an isolated in-memory TodoService via `makeTestApp()`.
 *
 * Run:
 *   deno test --allow-env packages/examples/core/effect-integration/app.integration.test.ts
 */

import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert@1";
import { HttpError } from "@fresh/core";
import { createEffectApp } from "@fresh/core/effect";
import { Cause, Effect, Layer } from "effect";
import { NotFoundError } from "./services/errors.ts";
import { TodoRpc, TodoRpcHandlers } from "./services/rpc.ts";
import { TodoService } from "./services/TodoService.ts";
import type { Todo } from "./types.ts";

// ---------------------------------------------------------------------------
// Isolated test infrastructure
// ---------------------------------------------------------------------------

/**
 * Creates a fresh isolated TodoService layer backed by a new Map.
 * Each `makeTestApp()` call gets its own store — no cross-test leakage.
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
 * Build a minimal EffectApp with all four RPC endpoints mounted.
 * Returns handler (for sending test requests) and dispose (for cleanup).
 */
function makeTestApp(opts: { allowedOrigins?: string[] } = {}): {
  handler: (req: Request) => Promise<Response>;
  dispose: () => Promise<void>;
} {
  const testLayer = makeTestTodoLayer();
  // deno-lint-ignore no-explicit-any
  const rpcHandlers = Layer.provide(TodoRpcHandlers, testLayer as any);

  const effectApp = createEffectApp({
    // deno-lint-ignore no-explicit-any
    layer: testLayer as any,
    mapError: (cause) => {
      const defect = Cause.squash(cause as never);
      if (defect instanceof NotFoundError) throw new HttpError(404);
      throw new HttpError(500);
    },
  });

  effectApp.rpc({
    group: TodoRpc,
    path: "/rpc/todos",
    protocol: "http",
    handlerLayer: rpcHandlers,
  });
  effectApp.rpc({
    group: TodoRpc,
    path: "/rpc/todos/stream",
    protocol: "http-stream",
    handlerLayer: rpcHandlers,
  });
  effectApp.rpc({
    group: TodoRpc,
    path: "/rpc/todos/sse",
    protocol: "sse",
    handlerLayer: rpcHandlers,
  });
  effectApp.rpc({
    group: TodoRpc,
    path: "/rpc/todos/ws",
    protocol: "websocket",
    handlerLayer: rpcHandlers,
    ...(opts.allowedOrigins ? { allowedOrigins: opts.allowedOrigins } : {}),
  });

  return { handler: effectApp.handler(), dispose: () => effectApp.dispose() };
}

/** Build a POST /rpc/todos request for the given procedure. */
function httpRpc(tag: string, payload: unknown = null): Request {
  return new Request("http://localhost/rpc/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      _tag: "Request",
      id: "1",
      tag,
      payload,
      headers: [],
    }),
  });
}

/**
 * Extract the first Exit from an HTTP polling response body.
 * `Queue.collect` in effect@4.0.0-beta.0 has a double-push bug that returns
 * each response twice — we consistently take `arr[0]`.
 */
// deno-lint-ignore no-explicit-any
function firstExit(text: string): any {
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

// Disable op/resource sanitization: EffectApp creates background fibers that
// outlive individual test assertions (they are properly cleaned up in dispose).
const opts = { sanitizeOps: false, sanitizeResources: false };

// ---------------------------------------------------------------------------
// HTTP polling — /rpc/todos
// ---------------------------------------------------------------------------

Deno.test("HTTP: ListTodos returns empty list", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const res = await handler(httpRpc("ListTodos"));
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers.get("content-type") ?? "", "json");
    const exit = firstExit(await res.text());
    assertEquals(exit._tag, "Exit");
    assertEquals(exit.exit._tag, "Success");
    assertEquals(exit.exit.value, []);
  } finally {
    await dispose();
  }
});

Deno.test("HTTP: CreateTodo returns the new todo", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const res = await handler(httpRpc("CreateTodo", { text: "Buy oat milk" }));
    assertEquals(res.status, 200);
    const exit = firstExit(await res.text());
    assertEquals(exit._tag, "Exit");
    assertEquals(exit.exit._tag, "Success");
    assertEquals(exit.exit.value.text, "Buy oat milk");
    assertEquals(exit.exit.value.done, false);
    assertMatch(exit.exit.value.id, /^[0-9a-f-]{36}$/);
  } finally {
    await dispose();
  }
});

Deno.test("HTTP: created todo appears in ListTodos", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const createExit = firstExit(
      await (await handler(httpRpc("CreateTodo", { text: "Visible" }))).text(),
    );
    const id: string = createExit.exit.value.id;

    const listExit = firstExit(
      await (await handler(httpRpc("ListTodos"))).text(),
    );
    assertEquals(listExit.exit.value.length, 1);
    assertEquals(listExit.exit.value[0].id, id);
  } finally {
    await dispose();
  }
});

Deno.test(
  "HTTP: DeleteTodo removes the todo from ListTodos",
  opts,
  async () => {
    const { handler, dispose } = makeTestApp();
    try {
      const createExit = firstExit(
        await (await handler(httpRpc("CreateTodo", { text: "Gone soon" })))
          .text(),
      );
      const id: string = createExit.exit.value.id;

      await handler(httpRpc("DeleteTodo", { id }));

      const listExit = firstExit(
        await (await handler(httpRpc("ListTodos"))).text(),
      );
      assertEquals(listExit.exit.value, []);
    } finally {
      await dispose();
    }
  },
);

// ---------------------------------------------------------------------------
// HTTP-stream — /rpc/todos/stream
// ---------------------------------------------------------------------------

Deno.test(
  "HTTP-stream: POST returns application/x-ndjson content-type",
  opts,
  async () => {
    const { handler, dispose } = makeTestApp();
    try {
      const controller = new AbortController();
      const res = await handler(
        new Request("http://localhost/rpc/todos/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            _tag: "Request",
            id: "1",
            tag: "WatchTodos",
            payload: null,
            headers: [],
          }),
          signal: controller.signal,
        }),
      );
      assertEquals(res.status, 200);
      assertStringIncludes(res.headers.get("content-type") ?? "", "ndjson");

      // Read until the first complete NDJSON line
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (!buf.includes("\n")) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value);
      }
      controller.abort(); // triggers server-side Effect.async cleanup
      await reader.cancel();

      const firstLine = JSON.parse(buf.split("\n")[0]);
      assertEquals(firstLine._tag, "Chunk");
      // requestId is a BigInt serialized as string by BigInt replacer
      assertEquals(typeof firstLine.requestId, "string");
      assertEquals(Array.isArray(firstLine.values), true);
    } finally {
      await dispose();
    }
  },
);

Deno.test("HTTP-stream: GET returns 405", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const res = await handler(
      new Request("http://localhost/rpc/todos/stream", { method: "GET" }),
    );
    assertEquals(res.status, 405);
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------
// SSE — /rpc/todos/sse
// ---------------------------------------------------------------------------

Deno.test("SSE: GET returns text/event-stream content-type", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const controller = new AbortController();
    const res = await handler(
      new Request("http://localhost/rpc/todos/sse?p=WatchTodos", {
        signal: controller.signal,
      }),
    );
    assertEquals(res.status, 200);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/event-stream",
    );

    // Read until the first complete SSE event (terminated by "\n\n")
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (!buf.includes("\n\n")) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    controller.abort();
    await reader.cancel();

    // SSE format: "data: {...}\n\n"
    assertStringIncludes(buf, "data: ");
    const dataLine = buf.split("\n").find((l) => l.startsWith("data: "))!;
    const event = JSON.parse(dataLine.slice(6));
    assertEquals(event._tag, "Chunk");
  } finally {
    await dispose();
  }
});

Deno.test("SSE: POST returns 405", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const res = await handler(
      new Request("http://localhost/rpc/todos/sse", { method: "POST" }),
    );
    assertEquals(res.status, 405);
  } finally {
    await dispose();
  }
});

// ---------------------------------------------------------------------------
// WebSocket endpoint — method and Origin enforcement
// ---------------------------------------------------------------------------

Deno.test("WS: POST to WS endpoint returns 405", opts, async () => {
  const { handler, dispose } = makeTestApp();
  try {
    const res = await handler(
      new Request("http://localhost/rpc/todos/ws", { method: "POST" }),
    );
    assertEquals(res.status, 405);
  } finally {
    await dispose();
  }
});

Deno.test("WS: GET with disallowed Origin returns 403", opts, async () => {
  const { handler, dispose } = makeTestApp({
    allowedOrigins: ["http://trusted.example.com"],
  });
  try {
    const res = await handler(
      new Request("http://localhost/rpc/todos/ws", {
        headers: { Origin: "http://evil.example.com" },
      }),
    );
    assertEquals(res.status, 403);
  } finally {
    await dispose();
  }
});

Deno.test(
  "WS: GET with no Origin returns 403 when allowedOrigins configured",
  opts,
  async () => {
    const { handler, dispose } = makeTestApp({
      allowedOrigins: ["http://trusted.example.com"],
    });
    try {
      const res = await handler(
        new Request("http://localhost/rpc/todos/ws"),
      );
      assertEquals(res.status, 403);
    } finally {
      await dispose();
    }
  },
);

Deno.test(
  "WS: GET with correct Origin passes the Origin check",
  opts,
  async () => {
    // We cannot perform a real WS upgrade without a TCP connection,
    // but we can verify the Origin check is bypassed (response is not 403).
    // Deno.upgradeWebSocket throws on a non-upgrade request → Fresh returns 500.
    const { handler, dispose } = makeTestApp({
      allowedOrigins: ["http://trusted.example.com"],
    });
    try {
      const res = await handler(
        new Request("http://localhost/rpc/todos/ws", {
          headers: { Origin: "http://trusted.example.com" },
        }),
      );
      assertNotEquals(res.status, 403);
    } finally {
      await dispose();
    }
  },
);

Deno.test(
  "WS: no Origin check when allowedOrigins not configured",
  opts,
  async () => {
    // Default: all origins accepted. A GET (without upgrade) hits Deno.upgradeWebSocket
    // which throws → 500, but not 403.
    const { handler, dispose } = makeTestApp(); // no allowedOrigins
    try {
      const res = await handler(
        new Request("http://localhost/rpc/todos/ws", {
          headers: { Origin: "http://any-origin.example.com" },
        }),
      );
      assertNotEquals(res.status, 403);
    } finally {
      await dispose();
    }
  },
);

// ---------------------------------------------------------------------------
// Error observer — stream must close when the fiber fails
// ---------------------------------------------------------------------------

/**
 * Builds an EffectApp whose http-stream and SSE endpoints use a broken
 * handlerLayer (Layer.fail) so the forked fiber always fails immediately.
 * The error observer added by TODO 5 must close the stream writer so the
 * client body reader reaches `done: true` instead of hanging forever.
 */
function makeBrokenStreamApp(): {
  handler: (req: Request) => Promise<Response>;
  dispose: () => Promise<void>;
} {
  // A layer that always fails to build — simulates a missing service.
  // Layer.unwrap wraps Effect<Layer> and if the Effect fails, the Layer fails.
  // The type cast is intentional: we need a Layer with the right output type
  // for the rpc() call's handlerLayer parameter.
  // deno-lint-ignore no-explicit-any
  const brokenLayer = Layer.unwrap(Effect.fail(new Error("broken"))) as any;

  const effectApp = createEffectApp({
    // deno-lint-ignore no-explicit-any
    layer: Layer.empty as any,
    mapError: () => new Response("error", { status: 500 }),
  });

  effectApp.rpc({
    group: TodoRpc,
    path: "/rpc/todos/stream",
    protocol: "http-stream",
    handlerLayer: brokenLayer,
  });
  effectApp.rpc({
    group: TodoRpc,
    path: "/rpc/todos/sse",
    protocol: "sse",
    handlerLayer: brokenLayer,
  });

  return { handler: effectApp.handler(), dispose: () => effectApp.dispose() };
}

Deno.test(
  "HTTP-stream: stream closes if handler layer fails",
  opts,
  async () => {
    const { handler, dispose } = makeBrokenStreamApp();
    try {
      // Use a 2 s timeout AbortController so the test fails fast if the stream
      // hangs instead of closing (TODO 5 not working).
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await handler(
        new Request("http://localhost/rpc/todos/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            _tag: "Request",
            id: "1",
            tag: "WatchTodos",
            payload: null,
            headers: [],
          }),
          signal: controller.signal,
        }),
      );

      // The response itself is returned immediately (status 200 + streaming body).
      assertEquals(res.status, 200);

      // Read the body to completion — the error observer must close the writer,
      // causing the reader to reach done: true without hanging.
      const reader = res.body!.getReader();
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
      }

      clearTimeout(timeoutId);
      // If we reach here the stream closed on its own — test passes.
    } finally {
      await dispose();
    }
  },
);

Deno.test(
  "SSE: stream closes if handler layer fails",
  opts,
  async () => {
    const { handler, dispose } = makeBrokenStreamApp();
    try {
      // 2 s timeout — catches hangs if the error observer is not wired up.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await handler(
        new Request("http://localhost/rpc/todos/sse?p=WatchTodos", {
          signal: controller.signal,
        }),
      );

      assertEquals(res.status, 200);

      // The error observer must close the writer so the reader finishes.
      const reader = res.body!.getReader();
      let done = false;
      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
      }

      clearTimeout(timeoutId);
    } finally {
      await dispose();
    }
  },
);
