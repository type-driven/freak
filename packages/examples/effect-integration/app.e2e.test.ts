/**
 * E2E tests for RPC WebSocket streaming.
 *
 * These tests start a real Deno HTTP server on a dynamic port so that
 * Deno.upgradeWebSocket can perform a genuine TCP-level WebSocket handshake.
 * That is the only way to test actual WS message exchange; the handler-function
 * approach used in integration tests cannot perform real upgrades.
 *
 * Coverage:
 *   - WS connects and receives the initial WatchTodos stream emission
 *   - Todos created via HTTP are visible to an active WatchTodos stream
 *   - dispose() completes cleanly while a WS connection is open (graceful shutdown)
 *
 * Run:
 *   deno test --allow-env --allow-net packages/examples/effect-integration/app.e2e.test.ts
 */

import { assertEquals } from "jsr:@std/assert@1";
import { HttpError } from "@fresh/core";
import { createEffectApp } from "@fresh/effect";
import { Cause, Effect, Layer } from "effect";
import { NotFoundError } from "./services/errors.ts";
import { TodoRpc, TodoRpcHandlers } from "./services/rpc.ts";
import { TodoService } from "./services/TodoService.ts";
import type { Todo } from "./types.ts";

// ---------------------------------------------------------------------------
// Isolated test infrastructure
// ---------------------------------------------------------------------------

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
 * Start a real HTTP/WS server on a random port.
 * Returns `{ port, httpBase, wsBase, stop }`.
 *
 * stop() disposes the EffectApp (drains active WS connections) then shuts
 * down the HTTP listener. The order matters: dispose first so that
 * Deno.serve's shutdown doesn't block waiting for Effect.never fibers.
 */
async function startServer(): Promise<{
  port: number;
  httpBase: string;
  wsBase: string;
  stop: () => Promise<void>;
}> {
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
    path: "/rpc/todos/ws",
    protocol: "websocket",
    handlerLayer: rpcHandlers,
  });

  const handler = effectApp.handler();
  // port: 0 → OS assigns a free port
  // onListen: suppress "Listening on …" log spam in test output
  const server = Deno.serve({ port: 0, handler, onListen: () => {} });
  const port = (server.addr as Deno.NetAddr).port;

  const stop = async () => {
    // Dispose the EffectApp first so active WS connection runtimes are drained
    // (interrupting Effect.never fibers) before Deno.serve tries to shut down.
    // Without this order, server.shutdown() would block indefinitely waiting
    // for the Effect.never fiber to complete.
    await effectApp.dispose();
    await server.shutdown();
  };

  return {
    port,
    httpBase: `http://localhost:${port}`,
    wsBase: `ws://localhost:${port}`,
    stop,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open a WebSocket, await the "open" event, return the WebSocket. */
async function connectWs(url: string): Promise<WebSocket> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`WS connection failed: ${url}`));
  });
  return ws;
}

/** Send a RPC request message over a WebSocket (NDJSON: one JSON line). */
function sendRpc(ws: WebSocket, tag: string, payload: unknown = null, id = "1"): void {
  ws.send(
    JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }) + "\n",
  );
}

/** Await the next message from a WebSocket and parse it as JSON. */
// deno-lint-ignore no-explicit-any
function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      ws.removeEventListener("message", handler);
      try {
        resolve(JSON.parse(e.data));
      } catch (err) {
        reject(err);
      }
    };
    ws.addEventListener("message", handler);
  });
}

/**
 * Send an Ack for a Chunk message (required by supportsAck: true protocol).
 * The server holds back the next Chunk until the client acknowledges the previous one.
 */
// deno-lint-ignore no-explicit-any
function ackChunk(ws: WebSocket, chunk: any): void {
  ws.send(
    JSON.stringify({ _tag: "Ack", requestId: chunk.requestId, length: chunk.values.length }) + "\n",
  );
}

/**
 * POST a RPC request to the HTTP endpoint and return the first Exit from the response.
 * (Queue.collect beta bug doubles responses; we take arr[0].)
 */
// deno-lint-ignore no-explicit-any
async function httpRpc(base: string, tag: string, payload: unknown = null): Promise<any> {
  const res = await fetch(`${base}/rpc/todos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _tag: "Request", id: "1", tag, payload, headers: [] }),
  });
  const text = await res.text();
  const arr = JSON.parse(text);
  return Array.isArray(arr) ? arr[0] : arr;
}

const e2eOpts = { sanitizeOps: false, sanitizeResources: false };

// ---------------------------------------------------------------------------
// WS streaming — WatchTodos
// ---------------------------------------------------------------------------

Deno.test("E2E WS: connects and receives initial WatchTodos emission", e2eOpts, async () => {
  const { wsBase, stop } = await startServer();
  try {
    const ws = await connectWs(`${wsBase}/rpc/todos/ws`);
    sendRpc(ws, "WatchTodos");

    const msg = await nextMessage(ws);

    // First message for a streaming RPC should be a Chunk carrying the initial
    // snapshot of the todo list (empty store → values[0] = [])
    assertEquals(msg._tag, "Chunk");
    assertEquals(Array.isArray(msg.values), true);
    assertEquals(msg.values[0], []);

    ws.close();
  } finally {
    await stop();
  }
});

Deno.test("E2E WS: stream reflects todos created via HTTP", e2eOpts, async () => {
  const { httpBase, wsBase, stop } = await startServer();
  try {
    // Create a todo via HTTP before opening the WS stream
    const createExit = await httpRpc(httpBase, "CreateTodo", { text: "E2E todo" });
    assertEquals(createExit.exit._tag, "Success");
    const createdId: string = createExit.exit.value.id;

    // Connect WS and subscribe to WatchTodos
    const ws = await connectWs(`${wsBase}/rpc/todos/ws`);
    sendRpc(ws, "WatchTodos");

    const msg = await nextMessage(ws);

    assertEquals(msg._tag, "Chunk");
    assertEquals(msg.values[0].length, 1);
    assertEquals(msg.values[0][0].id, createdId);
    assertEquals(msg.values[0][0].text, "E2E todo");

    ws.close();
  } finally {
    await stop();
  }
});

Deno.test("E2E WS: subsequent tick reflects mutation made between ticks", e2eOpts, async () => {
  const { httpBase, wsBase, stop } = await startServer();
  try {
    const ws = await connectWs(`${wsBase}/rpc/todos/ws`);
    sendRpc(ws, "WatchTodos");

    // First emission: empty list
    const first = await nextMessage(ws);
    assertEquals(first._tag, "Chunk");
    assertEquals(first.values[0], []);

    // Acknowledge the first Chunk so the server will send the next one
    // (layerProtocolSocketServer has supportsAck: true)
    ackChunk(ws, first);

    // Create a todo between ticks
    const createExit = await httpRpc(httpBase, "CreateTodo", { text: "Between ticks" });
    const createdId: string = createExit.exit.value.id;

    // Second emission (after ~2 s real clock tick): should include the new todo
    const second = await nextMessage(ws);
    assertEquals(second._tag, "Chunk");
    assertEquals(second.values[0].length, 1);
    assertEquals(second.values[0][0].id, createdId);

    ws.close();
  } finally {
    await stop();
  }
  // Note: this test waits up to 2 s for the WatchTodos schedule tick.
});

Deno.test("E2E WS: dispose() completes without hanging with active connection", e2eOpts, async () => {
  const { wsBase, stop } = await startServer();

  const ws = await connectWs(`${wsBase}/rpc/todos/ws`);
  sendRpc(ws, "WatchTodos");

  // Confirm the connection is live by waiting for the first Chunk
  await nextMessage(ws);

  // Track whether the WS receives a close event after stop()
  const closedPromise = new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
  });

  // stop() calls effectApp.dispose() THEN server.shutdown().
  // effectApp.dispose() drains #activeWsRuntimes (closes the connection runtime,
  // interrupting Effect.never). server.shutdown() should then complete quickly
  // because there are no blocking fibers left.
  const t0 = Date.now();
  await stop();
  const elapsed = Date.now() - t0;

  // stop() should complete in well under 5 s — if Effect.never was not interrupted
  // by dispose(), server.shutdown() would block until the OS kills the socket.
  assertEquals(elapsed < 5000, true, `stop() took ${elapsed}ms — likely hung`);

  // WS should close (either from runtime dispose or server shutdown)
  await Promise.race([
    closedPromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("WS not closed within 3s after stop()")), 3000)
    ),
  ]);
  assertEquals(ws.readyState, WebSocket.CLOSED);
});
