/**
 * @module
 * Client-side Preact hooks for typed Effect RPC calls.
 *
 * Import this module in Fresh island components (client-side only).
 * Do NOT import from this module in server-side code — it depends on
 * `preact/hooks` and browser APIs.
 *
 * Hooks provided:
 * - `useQuery(key, effect, opts?)` — react-query style data fetching with cache
 * - `useMutation(fn, opts?)` — mutations with optimistic update support
 * - `useRpcQuery(group, opts)` — RPC data fetching built on useQuery
 * - `useRpcResult(group, { url })` — request/response over HTTP, returns `[state, client]`
 * - `useRpcStream(group, { url })` — server-push streaming over WebSocket
 * - `useRpcHttpStream(group, { url })` — server-push streaming over HTTP NDJSON
 * - `useRpcSse({ url, procedure })` — server-push streaming over SSE (native EventSource)
 * - `useRpcPolled(group, { url })` — repeated HTTP polling on a schedule
 *
 * A shared `ManagedRuntime` (browser singleton) is created on first use and
 * disposed on page unload. All hooks share its memoMap so services are only
 * built once per page.
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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { BrowserSocket } from "@effect/platform-browser";
import type { RpcGroup } from "effect/unstable/rpc";
import type { Rpc } from "effect/unstable/rpc";

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Typed record for dynamic RPC procedure dispatch on a client proxy.
 *
 * Covers both request/response procedures (return `Effect`) and streaming
 * procedures (return `Stream`), eliminating double-casts at call sites.
 */
// deno-lint-ignore no-explicit-any
type RpcProxyCall = Record<
  string,
  // deno-lint-ignore no-explicit-any
  (payload?: unknown) => Effect.Effect<unknown, unknown, any> | Stream.Stream<unknown, unknown, any>
>;

/**
 * Build the HTTP transport layer for RPC calls.
 *
 * Dependency chain: layerProtocolHttp ← layerJson ← FetchHttpClient.layer
 *
 * Exported so island authors can build a typed ManagedRuntime for mutations
 * that share the browser runtime's memoMap (same pattern as `useRpcQuery`).
 */
export function makeRpcHttpLayer(url: string) {
  return RpcClient.layerProtocolHttp({ url }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(FetchHttpClient.layer),
  );
}

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
// Shared Browser Runtime
// ──────────────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
let _browserRuntime: ManagedRuntime.ManagedRuntime<any, never> | null = null;

/**
 * Returns the module-level shared `ManagedRuntime` backed by `FetchHttpClient`.
 * Creates it on first call; disposed on page unload.
 *
 * All hooks share this runtime's `memoMap` so services are built only once.
 */
// deno-lint-ignore no-explicit-any
function getBrowserRuntime(): ManagedRuntime.ManagedRuntime<any, never> {
  if (!_browserRuntime) {
    _browserRuntime = ManagedRuntime.make(FetchHttpClient.layer);
    globalThis.addEventListener?.("unload", () => {
      _browserRuntime?.dispose();
      _browserRuntime = null;
    }, { once: true });
  }
  return _browserRuntime;
}

/**
 * Hook that returns the shared browser `ManagedRuntime`.
 * Useful for island authors who want to run arbitrary effects using
 * the same runtime (and memoMap) as the built-in hooks.
 */
export function useBrowserRuntime() {
  return getBrowserRuntime();
}

// ──────────────────────────────────────────────────────────────────────────────
// Query Cache
// ──────────────────────────────────────────────────────────────────────────────

interface QueryCacheEntry {
  data: unknown;
  error: unknown;
  status: "idle" | "loading" | "success" | "error";
  /** Each subscriber is the `rerender` function from a `useQuery` instance. */
  subscribers: Set<() => void>;
  /** Non-null while a fetch is in-flight; used for request deduplication. */
  inFlight: Promise<void> | null;
}

const queryCache = new Map<string, QueryCacheEntry>();

function getOrCreateEntry(key: string): QueryCacheEntry {
  let entry = queryCache.get(key);
  if (!entry) {
    entry = {
      data: undefined,
      error: undefined,
      status: "idle",
      subscribers: new Set(),
      inFlight: null,
    };
    queryCache.set(key, entry);
  }
  return entry;
}

/**
 * Read the current cached value for a query key.
 * Useful in `useMutation.onMutate` for optimistic updates.
 */
export function getCacheData<A>(key: string): A | undefined {
  return queryCache.get(key)?.data as A | undefined;
}

/**
 * Write a value directly into the cache and notify all subscribers.
 * Useful for optimistic updates — set the expected result immediately,
 * then roll back in `onError` if the mutation fails.
 */
export function setCacheData<A>(key: string, data: A): void {
  const entry = getOrCreateEntry(key);
  entry.data = data;
  entry.status = "success";
  entry.error = undefined;
  for (const sub of entry.subscribers) sub();
}

/**
 * Mark a cache entry as stale (status → "idle") and notify subscribers.
 * Any mounted `useQuery` instance watching `key` will automatically refetch.
 */
export function invalidateQuery(key: string): void {
  const entry = queryCache.get(key);
  if (entry) {
    entry.status = "idle";
    entry.inFlight = null;
    for (const sub of entry.subscribers) sub();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// useQuery
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for data fetching with a shared module-level cache.
 *
 * `effect` must be fully satisfied (`R = never`). Use the `runner` option to
 * supply a `ManagedRuntime.runPromise` when the effect's services should be
 * resolved through a specific runtime (e.g., `useRpcQuery`).
 *
 * Features:
 * - Cache keyed by `key` — multiple components sharing the same key share data
 * - Request deduplication — concurrent fetches for the same key coalesce
 * - `invalidateQuery(key)` triggers a refetch in all mounted consumers
 * - `setCacheData(key, data)` / `getCacheData(key)` for optimistic updates
 *
 * @param key - Cache key (string); determines which cache entry is used
 * @param effect - A fully-satisfied Effect to run on fetch
 * @param options.enabled - If false, never fetch automatically (default: true)
 * @param options.runner - Optional executor; defaults to `Effect.runPromise`
 */
export function useQuery<A, E>(
  key: string,
  effect: Effect.Effect<A, E, never>,
  options?: {
    enabled?: boolean;
    /**
     * Custom executor for the effect. Defaults to `Effect.runPromise`.
     * Pass `(e) => runtime.runPromise(e)` to run through a `ManagedRuntime`
     * whose layer provides services the effect depends on.
     */
    runner?: (e: Effect.Effect<A, E, never>) => Promise<A>;
  },
): { data: A | undefined; error: E | undefined; isLoading: boolean; refetch: () => void } {
  const [renderCount, setRenderCount] = useState(0);
  const rerender = useCallback(() => setRenderCount((n) => n + 1), []);

  // Store latest effect + runner in refs so `fetch` callback doesn't go stale.
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const runnerRef = useRef(options?.runner);
  runnerRef.current = options?.runner;

  const enabled = options?.enabled ?? true;

  const fetch = useCallback(() => {
    const e = getOrCreateEntry(key);
    if (e.inFlight) return; // deduplicate
    e.status = "loading";
    for (const sub of e.subscribers) sub();
    const run = runnerRef.current ?? Effect.runPromise;
    const p = run(effectRef.current).then(
      (data: A) => {
        const ent = getOrCreateEntry(key);
        ent.data = data;
        ent.status = "success";
        ent.error = undefined;
        ent.inFlight = null;
        for (const sub of ent.subscribers) sub();
      },
      (error: unknown) => {
        const ent = getOrCreateEntry(key);
        ent.error = error;
        ent.status = "error";
        ent.inFlight = null;
        for (const sub of ent.subscribers) sub();
      },
    );
    e.inFlight = p as Promise<void>;
  }, [key]);

  useEffect(() => {
    const entry = getOrCreateEntry(key);
    entry.subscribers.add(rerender);
    return () => {
      entry.subscribers.delete(rerender);
      // GC the entry when the last subscriber unmounts so the cache doesn't
      // grow unboundedly across navigations with many distinct keys.
      if (entry.subscribers.size === 0) queryCache.delete(key);
    };
  }, [key, rerender]);

  useEffect(() => {
    const entry = getOrCreateEntry(key);
    if (enabled && entry.status === "idle" && !entry.inFlight) {
      fetch();
    }
  }, [renderCount, key, fetch, enabled]);

  const entry = queryCache.get(key) ?? getOrCreateEntry(key);
  return {
    data: entry.data as A | undefined,
    error: entry.error as E | undefined,
    isLoading: entry.status === "loading",
    refetch: fetch,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// useMutation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for executing mutations with optional optimistic update support.
 *
 * `fn` must return a fully-satisfied Effect (`R = never`). It is run via the
 * shared browser runtime, which shares its memoMap with all RPC hooks.
 *
 * Optimistic update pattern:
 * ```typescript
 * useMutation(createTodo, {
 *   onMutate: (text) => {
 *     const prev = getCacheData<Todo[]>("todos");
 *     setCacheData("todos", [...(prev ?? []), { id: "temp", text }]);
 *     return { rollback: () => setCacheData("todos", prev) };
 *   },
 *   onError: (_err, _payload, ctx) => ctx.rollback(),
 *   invalidates: ["todos"],
 * });
 * ```
 *
 * @param fn - Function that takes a payload and returns an Effect to run
 * @param options.onMutate - Called synchronously before the mutation; return value is `ctx`
 * @param options.onSuccess - Called on success with data, payload, and ctx
 * @param options.onError - Called on failure; ctx holds rollback info from onMutate
 * @param options.invalidates - Cache keys to invalidate (triggering refetch) on success
 */
export function useMutation<A, E, Payload, Ctx = void>(
  fn: (payload: Payload) => Effect.Effect<A, E, never>,
  options?: {
    onMutate?: (payload: Payload) => Ctx;
    onSuccess?: (data: A, payload: Payload, ctx: Ctx) => void;
    onError?: (error: unknown, payload: Payload, ctx: Ctx) => void;
    invalidates?: string[];
  },
): { mutate: (payload: Payload) => void; isPending: boolean; error: unknown; data: A | undefined } {
  const [state, setState] = useState<{
    isPending: boolean;
    error: unknown;
    data: A | undefined;
  }>({ isPending: false, error: undefined, data: undefined });

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mutate = useCallback((payload: Payload) => {
    const ctx = (optionsRef.current?.onMutate?.(payload) ?? undefined) as Ctx;
    setState((prev) => ({ ...prev, isPending: true }));
    // Run through the shared browser runtime so its memoMap is used when
    // building any RPC or HTTP layers inside the effect.
    getBrowserRuntime().runPromise(fnRef.current(payload) as Effect.Effect<A, E, never>).then(
      (data: A) => {
        setState({ isPending: false, error: undefined, data });
        optionsRef.current?.onSuccess?.(data, payload, ctx);
        for (const k of optionsRef.current?.invalidates ?? []) {
          invalidateQuery(k);
        }
      },
      (error: unknown) => {
        setState((prev) => ({ ...prev, isPending: false, error }));
        optionsRef.current?.onError?.(error, payload, ctx);
      },
    );
  }, []); // stable: fn/options accessed via refs

  return { mutate, ...state };
}

// ──────────────────────────────────────────────────────────────────────────────
// useRpcQuery
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for typed RPC data fetching, built on `useQuery`.
 *
 * Constructs the HTTP protocol + JSON serialization layer from `options.url`
 * and materializes it in a per-component `ManagedRuntime` that shares the
 * browser singleton's memoMap. This ensures `FetchHttpClient` is reused
 * rather than rebuilt in an isolated scope on every fetch.
 *
 * @param group - The RpcGroup definition
 * @param options.key - Cache key for this query
 * @param options.url - The server-side RPC mount path (e.g., "/rpc/todos")
 * @param options.procedure - The RPC procedure name (e.g., "ListTodos")
 * @param options.payload - Optional payload (defaults to `undefined` / Schema.Void)
 * @param options.enabled - If false, skip automatic fetching (default: true)
 */
// deno-lint-ignore no-explicit-any
export function useRpcQuery<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: {
    key: string;
    url: string;
    procedure: string;
    payload?: unknown;
    enabled?: boolean;
  },
) {
  const layer = useMemo(() => makeRpcHttpLayer(options.url), [options.url]);

  // Create a ManagedRuntime per URL change, sharing the browser runtime's
  // memoMap so the already-live FetchHttpClient instance is reused.
  // This is the same pattern as useRpcStream and is critical for HTTP hooks.
  // deno-lint-ignore no-explicit-any
  const runtimeRef = useRef<ManagedRuntime.ManagedRuntime<any, never> | null>(null);
  useEffect(() => {
    runtimeRef.current = ManagedRuntime.make(layer, {
      memoMap: getBrowserRuntime().memoMap,
    });
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [layer]);

  // The effect uses the runtime's provided services — no Effect.provide needed.
  // Cast to Effect<any,any,never> since the runtime satisfies R at execution time.
  const effect = useMemo(
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.logDebug(
            "[useRpcQuery] making RPC client for: " + options.procedure,
          );
          // deno-lint-ignore no-explicit-any
          const client = yield* RpcClient.make(group as any);
          const result = yield* (
            (client as unknown as RpcProxyCall)[options.procedure](options.payload) as Effect.Effect<unknown, unknown, never>
          );
          yield* Effect.logDebug("[useRpcQuery] got result for: " + options.procedure);
          return result;
        }),
        // deno-lint-ignore no-explicit-any
      ) as Effect.Effect<any, any, never>,
    [group, options.procedure, options.payload],
  );

  return useQuery(options.key, effect, {
    enabled: options.enabled,
    // Run via the per-URL runtime so layers are built in the correct scope.
    runner: (e) => {
      const rt = runtimeRef.current;
      return rt ? rt.runPromise(e) : Effect.runPromise(e);
    },
  });
}

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
 * client.ListTodos();
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
): [RpcResultState<any, any>, RpcProxyCall] {
  const [state, setState] = useState<RpcResultState<unknown, unknown>>({
    _tag: "idle",
  });
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  const layer = useMemo(() => makeRpcHttpLayer(options.url), [options.url]);

  // Create a ManagedRuntime per URL change, sharing the browser runtime's
  // memoMap. The runtime lives for the component's mounted lifetime and is
  // shared across all calls on the returned client proxy.
  // deno-lint-ignore no-explicit-any
  const runtimeRef = useRef<ManagedRuntime.ManagedRuntime<any, never> | null>(null);
  useEffect(() => {
    runtimeRef.current = ManagedRuntime.make(layer, {
      memoMap: getBrowserRuntime().memoMap,
    });
    return () => {
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, [layer]);

  // Stable proxy — created once and stored in a ref so the returned `client`
  // reference is stable across re-renders. Handlers close over runtimeRef so
  // they always use the current runtime.
  const proxyRef = useRef<RpcProxyCall | null>(null);
  if (!proxyRef.current) {
    proxyRef.current = new Proxy({} as unknown as RpcProxyCall, {
      get: (_target, prop: string) => (payload?: unknown) => {
        setState({ _tag: "loading" });
        const effect = Effect.scoped(
          Effect.gen(function* () {
            // deno-lint-ignore no-explicit-any
            const c = yield* RpcClient.make(group as any);
            return yield* (
              (c as unknown as RpcProxyCall)[prop](payload) as Effect.Effect<unknown, unknown, never>
            );
          }),
          // deno-lint-ignore no-explicit-any
        ) as Effect.Effect<unknown, unknown, never>;
        const rt = runtimeRef.current;
        (rt ? rt.runPromise(effect) : Effect.runPromise(effect)).then(
          (value) => {
            if (!unmountedRef.current) setState({ _tag: "ok", value });
          },
          (error) => {
            if (!unmountedRef.current) setState({ _tag: "err", error });
          },
        );
      },
    });
  }

  return [state as RpcResultState<any, any>, proxyRef.current];
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal: shared streaming hook implementation
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Shared implementation for streaming RPC hooks.
 *
 * Accepts a pre-built transport layer so each public hook only needs to
 * supply the appropriate layer (WebSocket, HTTP NDJSON, etc.). All other
 * lifecycle logic — runtime creation, stream subscription, state management,
 * and cleanup — is handled here.
 *
 * @param group - The RpcGroup definition
 * @param layer - Fully-configured transport layer for this connection
 * @param procedure - The streaming procedure name
 * @param payload - Optional procedure payload
 * @param deps - useEffect dependency array (should list everything that changes layer/procedure/payload)
 */
// deno-lint-ignore no-explicit-any
function useStreamingRpc<Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  // deno-lint-ignore no-explicit-any
  layer: Layer.Layer<any, any, never>,
  procedure: string,
  payload: unknown,
  deps: readonly unknown[],
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });

  useEffect(() => {
    // Share the browser runtime's memoMap so already-built services aren't duplicated.
    // deno-lint-ignore no-explicit-any
    const runtime = ManagedRuntime.make(layer as any, {
      memoMap: getBrowserRuntime().memoMap,
    });

    // deno-lint-ignore no-explicit-any
    const effect: Effect.Effect<void, unknown, never> = Effect.scoped(
      Effect.gen(function* () {
        // deno-lint-ignore no-explicit-any
        const client = yield* RpcClient.make(group as any);
        // Streaming procedures return Stream directly (not Effect<Stream>), so no yield*.
        const stream = (client as unknown as RpcProxyCall)[procedure](
          payload,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state as RpcStreamState<any, any>;
}

// ──────────────────────────────────────────────────────────────────────────────
// resolveWsUrl helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Convert a relative path to an absolute WebSocket URL using window.location.
 * Absolute ws:// or wss:// URLs are returned unchanged.
 * Guards against SSR (window undefined) by falling back to ws://localhost.
 */
function resolveWsUrl(url: string): string {
  if (url.startsWith("ws://") || url.startsWith("wss://")) return url;
  const protocol =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "wss:"
      : "ws:";
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost";
  return `${protocol}//${host}${url}`;
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
 * Supports relative paths (e.g. `/rpc/todos/ws`) — they are resolved against
 * `window.location` with the appropriate `ws:` / `wss:` protocol.
 *
 * @param group - The RpcGroup definition (created with `RpcGroup.make(...)`)
 * @param options.url - WebSocket URL or relative path (e.g., "/rpc/todos/ws")
 * @param options.procedure - The name of the streaming procedure to subscribe to
 *
 * @example
 * ```typescript
 * const streamState = useRpcStream(TodoRpc, {
 *   url: "/rpc/todos/ws",
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
): RpcStreamState<any, any> {
  const wsUrl = resolveWsUrl(options.url);
  const layer = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(BrowserSocket.layerWebSocket(wsUrl)),
  );
  return useStreamingRpc(
    group,
    layer,
    options.procedure,
    options.payload,
    [wsUrl, options.procedure, options.payload],
  );
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
 * Relative paths (e.g. `/rpc/todos/stream`) are supported — FetchHttpClient
 * resolves them against `window.location` automatically.
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
): RpcStreamState<any, any> {
  // layerNdjson (includesFraming=true) → server streams chunks, client reads r.stream.
  const layer = RpcClient.layerProtocolHttp({ url: options.url }).pipe(
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(FetchHttpClient.layer),
  );
  return useStreamingRpc(
    group,
    layer,
    options.procedure,
    options.payload,
    [options.url, options.procedure, options.payload],
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// useRpcSse
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Preact hook for streaming RPC over Server-Sent Events (SSE).
 *
 * Uses the browser's native `EventSource` API (not Effect RPC machinery) to
 * receive server-push events. The server must be mounted with `protocol: "sse"`.
 * The procedure name is sent as `?p=ProcedureName`; optional payload as
 * `?payload=<json-encoded>`.
 *
 * Note: procedure names are not type-checked against any RpcGroup — this hook
 * operates on raw EventSource and parses the wire format directly.
 *
 * SSE advantages over WebSocket:
 * - Native browser reconnect (EventSource auto-reconnects on disconnect)
 * - Works through HTTP/1.1 proxies without upgrade support
 * - Simple GET-based — no CORS preflight for same-origin requests
 *
 * Limitation: payload must be serializable as a URL query string (avoid large payloads).
 * For void-payload procedures (Schema.Void) no ?payload is sent.
 *
 * Accepts either `(options)` or `(group, options)` for backwards compatibility.
 * The `group` argument is ignored — it existed only for API consistency with
 * other hooks.
 *
 * @param options.url - The SSE endpoint URL (e.g., "/rpc/todos/sse")
 * @param options.procedure - The procedure name (e.g., "WatchTodos")
 * @param options.payload - Optional payload to send as ?payload=<json>
 */
// deno-lint-ignore no-explicit-any
export function useRpcSse(
  groupOrOptions: unknown,
  maybeOptions?: { url: string; procedure: string; payload?: unknown },
  // deno-lint-ignore no-explicit-any
): RpcStreamState<any, any> {
  const options = (maybeOptions ?? groupOrOptions) as {
    url: string;
    procedure: string;
    payload?: unknown;
  };
  const [state, setState] = useState<RpcStreamState<unknown, unknown>>({
    _tag: "connecting",
  });

  useEffect(() => {
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
    _tag: "connected",
    latest: null,
  });
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    const layer = makeRpcHttpLayer(options.url);
    const runtime = ManagedRuntime.make(layer, {
      memoMap: getBrowserRuntime().memoMap,
    });
    const intervalMs = options.interval ?? 2000;

    const runPoll = () => {
      // deno-lint-ignore no-explicit-any
      const effect = Effect.scoped(
        Effect.gen(function* () {
          // deno-lint-ignore no-explicit-any
          const client = yield* RpcClient.make(group as any);
          return yield* (
            (client as unknown as RpcProxyCall)[options.procedure](options.payload) as Effect.Effect<unknown, unknown, never>
          );
        }),
        // deno-lint-ignore no-explicit-any
      ) as Effect.Effect<unknown, unknown, never>;

      runtime.runPromise(effect).then(
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

    runPoll();
    const id = setInterval(runPoll, intervalMs);

    return () => {
      unmountedRef.current = true;
      clearInterval(id);
      runtime.dispose();
    };
  }, [options.url, options.procedure, options.payload, options.interval]);

  return state;
}

// Re-export atom hooks from island-atoms.ts
export { useAtom, useAtomValue, useAtomSet } from "./island-atoms.ts";
