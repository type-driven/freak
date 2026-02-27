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

  // Build the HTTP protocol layer: protocol + serialization + HTTP client
  const layer = Layer.mergeAll(
    RpcClient.layerProtocolHttp({ url: options.url }),
    RpcSerialization.layerJson,
    FetchHttpClient.layer,
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
  options: { url: string; procedure: string },
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });

  useEffect(() => {
    // Build the WebSocket protocol layer: socket protocol + ndjson serialization + browser WS
    // deno-lint-ignore no-explicit-any
    const layer = Layer.mergeAll(
      RpcClient.layerProtocolSocket(),
      RpcSerialization.layerNdjson,
      BrowserSocket.layerWebSocket(options.url),
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
        // deno-lint-ignore no-explicit-any
        const stream = (yield* (client as any)[options.procedure](
          {},
        )) as Stream.Stream<unknown, unknown, never>;
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
  }, [options.url, options.procedure]);

  return state;
}
