/**
 * @module
 * Client-side Preact hooks for typed Effect RPC calls.
 *
 * Import this module in Fresh island components (client-side only).
 * Do NOT import from this module in server-side code — it depends on
 * `preact/hooks` and browser APIs.
 *
 * Two hooks are provided:
 * - `useRpcResult(group, { url })` — request/response over HTTP, returns `[state, client]`
 * - `useRpcStream(group, { url, procedure })` — server-push streaming over WebSocket
 *
 * Usage:
 * ```typescript
 * import { useRpcResult, useRpcStream } from "@fresh/effect/island";
 * import { TodoRpc } from "../rpc/todo.ts";
 *
 * export default function TodoIsland() {
 *   const [state, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });
 *   const streamState = useRpcStream(TodoRpc, {
 *     url: "ws://localhost:8000/rpc/todos/ws",
 *     procedure: "WatchTodos",
 *   });
 *
 *   // state._tag: "idle" | "loading" | "ok" | "err"
 *   // streamState._tag: "connecting" | "connected" | "error" | "closed"
 * }
 * ```
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { BrowserSocket } from "@effect/platform-browser";
import type { RpcGroup } from "effect/unstable/rpc";
import type { Rpc } from "effect/unstable/rpc";

// ──────────────────────────────────────────────────────────────────────────────
// Streaming protocol selector
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Which transport to use for a streaming RPC subscription.
 *
 * - `"websocket"` — bidirectional WebSocket; best for full-duplex or low-latency push
 * - `"http-stream"` — HTTP POST with framed NDJSON streaming response; works everywhere fetch works
 * - `"sse"` — GET + Server-Sent Events; works with `EventSource` and automatic reconnect
 * - `"poll"` — repeated HTTP requests on a schedule; no persistent connection
 */
export type RpcStreamProtocol = "websocket" | "http-stream" | "sse" | "poll";

// ──────────────────────────────────────────────────────────────────────────────
// State types
// ──────────────────────────────────────────────────────────────────────────────

/**
 * State returned by `useRpcResult`. Represents the lifecycle of a single
 * RPC call: idle before any call, loading during the request, then ok or err.
 */
export type RpcResultState<A, E> =
  | { readonly _tag: "idle" }
  | { readonly _tag: "loading" }
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "err"; readonly error: E };

/**
 * State returned by `useRpcStream`. Represents the lifecycle of a WebSocket
 * stream connection: connecting on mount, connected with latest push value,
 * error on failure, or closed after unmount.
 */
export type RpcStreamState<A, E> =
  | { readonly _tag: "connecting" }
  | { readonly _tag: "connected"; readonly latest: A | null }
  | { readonly _tag: "error"; readonly error: E }
  | { readonly _tag: "closed" };

// ──────────────────────────────────────────────────────────────────────────────
// useRpcResult
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for typed request/response RPC calls over HTTP.
 *
 * Returns `[state, client]` where:
 * - `state` is a `RpcResultState` (starts as `{ _tag: "idle" }`)
 * - `client` is a proxy object whose methods match the RpcGroup's procedure tags
 *
 * Each procedure call on `client` triggers a new HTTP request, updating `state`
 * through loading → ok/err. The HTTP connection is stateless (scoped per call).
 *
 * @param group - The RpcGroup definition (created with `RpcGroup.make(...)`)
 * @param options.url - The server-side RPC mount path (e.g., "/rpc/todos")
 *
 * @example
 * ```typescript
 * const [state, client] = useRpcResult(TodoRpc, { url: "/rpc/todos" });
 *
 * // Trigger an RPC call:
 * client.ListTodos({});
 *
 * // Render based on state:
 * if (state._tag === "ok") return <ul>{state.value.map(t => <li>{t.text}</li>)}</ul>;
 * ```
 */
// deno-lint-ignore no-explicit-any
export function useRpcResult<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string },
  // deno-lint-ignore no-explicit-any
): [RpcResultState<any, any>, any] {
  const [state, setState] = useState<RpcResultState<unknown, unknown>>({
    _tag: "idle",
  });
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Build the HTTP protocol layer.
  // Layer.provide chains deps: layerProtocolHttp requires HttpClient + RpcSerialization;
  // provide each in turn so all requirements are satisfied before runtime creation.
  // deno-lint-ignore no-explicit-any
  const layer = RpcClient.layerProtocolHttp({ url: options.url }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
    // deno-lint-ignore no-explicit-any
  ) as any as Layer.Layer<never, never, never>;

  // deno-lint-ignore no-explicit-any
  const client = new Proxy({} as any, {
    // deno-lint-ignore no-explicit-any
    get: (_target, prop: string) => (payload: any) => {
      setState({ _tag: "loading" });
      // deno-lint-ignore no-explicit-any
      const effect: Effect.Effect<unknown, unknown, never> = Effect.scoped(
        Effect.gen(function* () {
          // deno-lint-ignore no-explicit-any
          const c = yield* RpcClient.make(group as any as Rpcs extends Rpc.Any ? RpcGroup.RpcGroup<Rpcs> : never);
          // deno-lint-ignore no-explicit-any
          return yield* (c as any)[prop](payload);
          // deno-lint-ignore no-explicit-any
        }),
      ).pipe(Effect.provide(layer)) as any;
      Effect.runPromise(effect).then(
        (value) => {
          if (!unmountedRef.current) setState({ _tag: "ok", value });
        },
        (error) => {
          if (!unmountedRef.current) setState({ _tag: "err", error });
        },
      );
    },
  });

  return [state, client];
}

// ──────────────────────────────────────────────────────────────────────────────
// useRpcStream
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for server-push streaming RPC over WebSocket.
 *
 * Establishes a WebSocket connection on mount and delivers push events as
 * state updates. The connection is automatically closed on unmount.
 *
 * The `procedure` must be a streaming procedure defined with `stream: true`
 * in the RpcGroup (e.g., `Rpc.make("WatchTodos", { success: ..., stream: true })`).
 *
 * @param group - The RpcGroup definition (created with `RpcGroup.make(...)`)
 * @param options.url - The full WebSocket URL (e.g., "ws://localhost:8000/rpc/todos/ws")
 * @param options.procedure - The name of the streaming procedure to subscribe to
 *
 * @example
 * ```typescript
 * const streamState = useRpcStream(TodoRpc, {
 *   url: "ws://localhost:8000/rpc/todos/ws",
 *   procedure: "WatchTodos",
 * });
 *
 * if (streamState._tag === "connected" && streamState.latest !== null) {
 *   return <ul>{streamState.latest.map(t => <li>{t.text}</li>)}</ul>;
 * }
 * ```
 */
// deno-lint-ignore no-explicit-any
export function useRpcStream<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string; procedure: string; payload?: unknown },
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });

  useEffect(() => {
    // Build the WebSocket protocol layer.
    // Layer.provide chains deps: layerProtocolSocket requires Socket + RpcSerialization;
    // provide each in turn so all requirements are satisfied before runtime creation.
    // deno-lint-ignore no-explicit-any
    const layer = RpcClient.layerProtocolSocket().pipe(
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(BrowserSocket.layerWebSocket(options.url)),
      // deno-lint-ignore no-explicit-any
    ) as any as Layer.Layer<never, never, never>;

    // Create a ManagedRuntime per hook instance for the WS lifecycle.
    // Disposed on unmount to close the WebSocket connection.
    // deno-lint-ignore no-explicit-any
    const runtime = ManagedRuntime.make(layer as any);

    // Run the streaming procedure. Stream.runForEach updates state on each push.
    // deno-lint-ignore no-explicit-any
    const effect: Effect.Effect<void, unknown, never> = Effect.scoped(
      Effect.gen(function* () {
        // deno-lint-ignore no-explicit-any
        const client = yield* RpcClient.make(group as any);
        // Streaming procedures return Stream directly (not Effect<Stream>), so no yield*.
        // deno-lint-ignore no-explicit-any
        const stream = (client as any)[options.procedure](
          options.payload,
        ) as Stream.Stream<unknown, unknown, never>;
        setState({ _tag: "connected", latest: null });
        yield* Stream.runForEach(stream, (value) =>
          Effect.sync(() => setState({ _tag: "connected", latest: value })),
        );
      }),
      // deno-lint-ignore no-explicit-any
    ) as any;

    runtime.runPromise(effect).then(
      () => setState({ _tag: "closed" }),
      (error) => setState({ _tag: "error", error }),
    );

    return () => {
      // Dispose closes the WS connection and interrupts all running fibers.
      runtime.dispose();
    };
  }, [options.url, options.procedure, options.payload]);

  return state;
}

// ──────────────────────────────────────────────────────────────────────────────
// useRpcHttpStream
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for streaming RPC over HTTP (framed NDJSON).
 *
 * Uses a long-lived HTTP POST request with a streaming response body. The server
 * must be mounted with `protocol: "http-stream"` so it uses `layerNdjson` (framed),
 * which streams each chunk as it arrives rather than buffering the entire response.
 *
 * Compared to `useRpcStream` (WebSocket):
 * - No WebSocket upgrade — works in all HTTP/1.1 environments
 * - Unidirectional (server → client only); no client-side mid-stream messages
 * - Each reconnect creates a new HTTP request
 *
 * @param group - The RpcGroup definition
 * @param options.url - The HTTP-stream mount path (e.g., "/rpc/todos/stream")
 * @param options.procedure - The name of the streaming procedure
 * @param options.payload - Optional payload (defaults to `undefined` / Schema.Void)
 */
// deno-lint-ignore no-explicit-any
export function useRpcHttpStream<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string; procedure: string; payload?: unknown },
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });

  useEffect(() => {
    // Layer.provide chains: layerProtocolHttp requires HttpClient + RpcSerialization.
    // layerNdjson has includesFraming = true → server streams chunks, client reads r.stream.
    // deno-lint-ignore no-explicit-any
    const layer = RpcClient.layerProtocolHttp({ url: options.url }).pipe(
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(FetchHttpClient.layer),
      // deno-lint-ignore no-explicit-any
    ) as any as Layer.Layer<never, never, never>;

    // deno-lint-ignore no-explicit-any
    const runtime = ManagedRuntime.make(layer as any);

    // deno-lint-ignore no-explicit-any
    const effect: Effect.Effect<void, unknown, never> = Effect.scoped(
      Effect.gen(function* () {
        // deno-lint-ignore no-explicit-any
        const client = yield* RpcClient.make(group as any);
        // Streaming procedures return Stream directly (not Effect<Stream>), so no yield*.
        // deno-lint-ignore no-explicit-any
        const stream = (client as any)[options.procedure](
          options.payload,
        ) as Stream.Stream<unknown, unknown, never>;
        setState({ _tag: "connected", latest: null });
        yield* Stream.runForEach(stream, (value) =>
          Effect.sync(() => setState({ _tag: "connected", latest: value })),
        );
      }),
      // deno-lint-ignore no-explicit-any
    ) as any;

    runtime.runPromise(effect).then(
      () => setState({ _tag: "closed" }),
      (error) => setState({ _tag: "error", error }),
    );

    return () => {
      runtime.dispose();
    };
  }, [options.url, options.procedure, options.payload]);

  return state;
}

// ──────────────────────────────────────────────────────────────────────────────
// useRpcSse
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for streaming RPC over Server-Sent Events (SSE).
 *
 * Uses the browser's native `EventSource` API to receive server-push events.
 * The server must be mounted with `protocol: "sse"`. The procedure name is sent
 * as `?p=ProcedureName`; optional payload as `?payload=<json-encoded>`.
 *
 * SSE advantages over WebSocket:
 * - Native browser reconnect (EventSource auto-reconnects on disconnect)
 * - Works through HTTP/1.1 proxies without upgrade support
 * - Simple GET-based — no CORS preflight for same-origin requests
 *
 * Limitation: payload must be serializable as a URL query string (avoid large payloads).
 * For void-payload procedures (Schema.Void) no ?payload is sent.
 *
 * @param group - The RpcGroup definition (not used for transport but kept for consistency)
 * @param options.url - The SSE endpoint URL (e.g., "/rpc/todos/sse")
 * @param options.procedure - The procedure name (e.g., "WatchTodos")
 * @param options.payload - Optional payload to send as ?payload=<json>
 */
// deno-lint-ignore no-explicit-any
export function useRpcSse<Rpcs extends Rpc.Any>(
  _group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string; procedure: string; payload?: unknown },
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });

  useEffect(() => {
    // Build the SSE URL with procedure and optional payload as query params.
    const sseUrl = new URL(
      options.url,
      typeof window !== "undefined" ? window.location.href : "http://localhost",
    );
    sseUrl.searchParams.set("p", options.procedure);
    if (options.payload !== undefined) {
      sseUrl.searchParams.set("payload", JSON.stringify(options.payload));
    }

    const source = new EventSource(sseUrl.toString());

    source.onopen = () => {
      setState({ _tag: "connected", latest: null });
    };

    source.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        // FromServer Chunk messages carry stream values.
        // values is NonEmptyReadonlyArray<SuccessChunk> — for WatchTodos, each is Todo[].
        if (msg._tag === "Chunk" && Array.isArray(msg.values) && msg.values.length > 0) {
          // Emit the last value in the batch (most recent state).
          setState({ _tag: "connected", latest: msg.values[msg.values.length - 1] });
        } else if (msg._tag === "Exit" || msg._tag === "Defect") {
          source.close();
          setState({ _tag: "closed" });
        }
      } catch (e) {
        setState({ _tag: "error", error: e });
      }
    };

    source.onerror = (error: Event) => {
      // EventSource fires onerror on network errors AND on server close.
      // readyState CLOSED means the server ended the stream (not a reconnect).
      if (source.readyState === EventSource.CLOSED) {
        setState({ _tag: "closed" });
      } else {
        setState({ _tag: "error", error });
      }
    };

    return () => {
      source.close();
    };
  }, [options.url, options.procedure, options.payload]);

  return state;
}

// ──────────────────────────────────────────────────────────────────────────────
// useRpcPolled
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for polling an RPC procedure on a schedule.
 *
 * Calls the procedure via HTTP request/response every `interval` milliseconds
 * and exposes the latest result as `RpcStreamState`. Ideal for non-streaming
 * procedures (e.g., ListTodos) in environments where persistent connections
 * are not available or desired.
 *
 * The server must expose a `protocol: "http"` endpoint for this hook to call.
 *
 * @param group - The RpcGroup definition
 * @param options.url - The HTTP endpoint URL (e.g., "/rpc/todos")
 * @param options.procedure - The procedure name (e.g., "ListTodos")
 * @param options.interval - Poll interval in milliseconds (default: 2000)
 * @param options.payload - Optional payload (defaults to `undefined` / Schema.Void)
 */
// deno-lint-ignore no-explicit-any
export function useRpcPolled<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: { url: string; procedure: string; interval?: number; payload?: unknown },
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    const intervalMs = options.interval ?? 2000;

    // deno-lint-ignore no-explicit-any
    const layer = RpcClient.layerProtocolHttp({ url: options.url }).pipe(
      Layer.provide(RpcSerialization.layerJson),
      Layer.provide(FetchHttpClient.layer),
      // deno-lint-ignore no-explicit-any
    ) as any as Layer.Layer<never, never, never>;

    const runPoll = () => {
      // deno-lint-ignore no-explicit-any
      const effect = Effect.scoped(
        Effect.gen(function* () {
          // deno-lint-ignore no-explicit-any
          const client = yield* RpcClient.make(group as any);
          // deno-lint-ignore no-explicit-any
          return yield* (client as any)[options.procedure](
            options.payload,
          );
        }),
        // deno-lint-ignore no-explicit-any
      ).pipe(Effect.provide(layer as any)) as any;

      Effect.runPromise(effect).then(
        (value) => {
          if (!unmountedRef.current) {
            setState({ _tag: "connected", latest: value });
          }
        },
        (error) => {
          if (!unmountedRef.current) setState({ _tag: "error", error });
        },
      );
    };

    // Poll immediately on mount, then on interval.
    runPoll();
    const id = setInterval(runPoll, intervalMs);

    return () => {
      unmountedRef.current = true;
      clearInterval(id);
    };
  }, [options.url, options.procedure, options.payload, options.interval]);

  return state;
}
