/**
 * @module
 * EffectApp — Effect-aware wrapper around Fresh's `App<State>`.
 *
 * `createEffectApp({ layer })` creates an `EffectApp<State, AppR>` that:
 * - Wraps an `App<State>` instance
 * - Creates a ManagedRuntime from the provided Layer
 * - Registers an EffectRunner via setEffectRunner() so Effect-returning handlers work
 * - Registers SIGINT/SIGTERM signal handlers for clean ManagedRuntime disposal
 * - Proxies all App builder methods so handler types accept `Effect<Response, unknown, AppR>`
 *   without requiring type casts
 *
 * IMPORTANT: setEffectRunner is called at createEffectApp() time, BEFORE .handler() is called.
 * This ensures the Effect runner is registered before any requests are processed.
 */

import {
  App,
  type ListenOptions,
} from "../app.ts";
import type { FreshConfig, ResolvedFreshConfig } from "../config.ts";
import type { Plugin } from "../plugin.ts";
import type { Context } from "../context.ts";
import type { Middleware } from "../middlewares/mod.ts";
import type { LayoutConfig, MaybeLazy, RouteConfig } from "../types.ts";
import {
  getAtomHydrationHook,
  getEffectRunner,
  setAtomHydrationHook,
  setEffectRunner,
  type EffectRunner,
  type Route,
  type RouteComponent,
} from "../internals.ts";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Socket, SocketServer } from "effect/unstable/socket";
import type { HttpApi, HttpApiGroup } from "effect/unstable/httpapi";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { createResolver, type ResolverOptions } from "./resolver.ts";
import { makeRuntime, registerSignalDisposal } from "./runtime.ts";
import { _setRequestRunner, serializeAtomHydration } from "./hydration.ts";

/**
 * An Effect-aware middleware function. Can return a plain Response,
 * a Promise<Response>, or an Effect<Response, unknown, R>.
 */
type EffectMiddleware<State, R> = (
  ctx: Context<State>,
) => Response | Promise<Response> | Effect.Effect<Response, unknown, R>;

type MaybeLazyEffectMiddleware<State, R> =
  | EffectMiddleware<State, R>
  | (() => EffectMiddleware<State, R>);

/**
 * Options for `createEffectApp`.
 */
export interface CreateEffectAppOptions<AppR, E = never> {
  /**
   * The Effect Layer that provides all services used by route handlers.
   * This Layer is used to create a ManagedRuntime that runs handler Effects.
   */
  layer: Layer.Layer<AppR, E, never>;
  /**
   * Optional Fresh configuration (basePath, mode, etc.).
   */
  config?: FreshConfig;
  /**
   * Optional error mapper for Effect failures. If omitted, failures produce
   * an HttpError(500). See ResolverOptions.mapError for details.
   */
  mapError?: (cause: unknown) => Response;
  /**
   * strict: throw on invalid plugin mount or runner/hydration conflicts.
   * compat: warn and continue to preserve legacy behavior.
   */
  mountValidationMode?: "strict" | "compat";
  /**
   * fail: reject inner runner/hydration hooks.
   * host-wins: keep host hooks and log warning.
   */
  mountConflictPolicy?: "fail" | "host-wins";
}

/**
 * Effect-aware wrapper around Fresh's `App<State>`.
 *
 * Proxies all App builder methods with Effect-compatible handler types.
 * Manages ManagedRuntime lifecycle via signal handlers.
 *
 * @typeParam State The Fresh context state type
 * @typeParam AppR The Effect service requirements (what the Layer provides)
 */
export class EffectApp<State, AppR> {
  #app: App<State>;
  #runtime: ManagedRuntime.ManagedRuntime<AppR, unknown>;
  #cleanupSignals: () => void = () => {};
  #httpApiDisposers: Array<() => Promise<void>> = [];
  #rpcDisposers: Array<() => Promise<void>> = [];
  // deno-lint-ignore no-explicit-any
  #activeWsRuntimes: Map<ManagedRuntime.ManagedRuntime<any, any>, WebSocket> =
    new Map();
  #mountValidationMode: "strict" | "compat";
  #mountConflictPolicy: "fail" | "host-wins";

  constructor(
    app: App<State>,
    runtime: ManagedRuntime.ManagedRuntime<AppR, unknown>,
    options: {
      mountValidationMode: "strict" | "compat";
      mountConflictPolicy: "fail" | "host-wins";
    },
  ) {
    this.#app = app;
    this.#runtime = runtime;
    this.#mountValidationMode = options.mountValidationMode;
    this.#mountConflictPolicy = options.mountConflictPolicy;
  }

  /** @internal */
  _setCleanupSignals(fn: () => void): void {
    this.#cleanupSignals = fn;
  }

  /**
   * Access the underlying `App<State>` instance.
   *
   * Not needed for normal use — `Builder.listen()` unwraps EffectApp
   * automatically. Only necessary when calling `@fresh/core/internal`
   * functions (e.g. `setBuildCache`) that require a bare `App<State>`.
   */
  get app(): App<State> {
    return this.#app;
  }

  /**
   * The resolved Fresh configuration.
   */
  get config(): ResolvedFreshConfig {
    return this.#app.config;
  }

  /**
   * The underlying ManagedRuntime. Available for advanced use cases
   * such as running Effects outside of request handlers.
   */
  get runtime(): ManagedRuntime.ManagedRuntime<AppR, unknown> {
    return this.#runtime;
  }

  /**
   * Add one or more Effect-aware middlewares at the top or specified path.
   */
  use(...middleware: MaybeLazyEffectMiddleware<State, AppR>[]): this;
  use(
    path: string,
    ...middleware: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this;
  use(
    pathOrMiddleware: string | MaybeLazyEffectMiddleware<State, AppR>,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    (this.#app.use as any)(pathOrMiddleware, ...middlewares);
    return this;
  }

  /**
   * Set the app's 404 error handler.
   */
  notFound(routeOrMiddleware: Route<State> | Middleware<State>): this {
    this.#app.notFound(routeOrMiddleware as Route<State>);
    return this;
  }

  /**
   * Set the app's error handler for a given path.
   */
  onError(
    path: string,
    routeOrMiddleware: Route<State> | Middleware<State>,
  ): this {
    this.#app.onError(path, routeOrMiddleware as Route<State>);
    return this;
  }

  /**
   * Set the app wrapper component (rendered around all routes).
   */
  appWrapper(component: RouteComponent<State>): this {
    this.#app.appWrapper(component as RouteComponent<State>);
    return this;
  }

  /**
   * Register a layout component for a given path.
   */
  layout(
    path: string,
    component: RouteComponent<State>,
    config?: LayoutConfig,
  ): this {
    this.#app.layout(path, component as RouteComponent<State>, config);
    return this;
  }

  /**
   * Register a file-based route module at a given path.
   */
  route(
    path: string,
    route: MaybeLazy<Route<State>>,
    config?: RouteConfig,
  ): this {
    this.#app.route(path, route as MaybeLazy<Route<State>>, config);
    return this;
  }

  /**
   * Insert file-system routes at the given pattern.
   */
  fsRoutes(pattern?: string): this {
    if (pattern !== undefined) {
      this.#app.fsRoutes(pattern);
    } else {
      this.#app.fsRoutes();
    }
    return this;
  }

  /**
   * Merge another App instance or typed Plugin into this app at the given path.
   *
   * The mounted app/plugin may require only a subset of host state:
   * `HostState extends MountedState`.
   *
   * When a Plugin is provided, TypeScript also enforces that the plugin's
   * service requirements (PluginR) are a subset of this app's AppR.
   */
  mountApp<Config, MountedState, PluginR extends AppR>(
    path: string,
    plugin: Plugin<Config, MountedState, PluginR> &
      (State extends MountedState ? unknown : never),
  ): this;
  mountApp<MountedState>(
    path: string,
    app: App<MountedState> & (State extends MountedState ? unknown : never),
  ): this;
  mountApp(
    path: string,
    appOrPlugin: App<unknown> | Plugin<unknown, unknown, unknown>,
  ): this {
    const isPlugin = !(appOrPlugin instanceof App);
    const plugin = isPlugin
      ? appOrPlugin as Plugin<unknown, unknown, unknown>
      : undefined;
    const inner = (isPlugin
      ? plugin!.app
      : appOrPlugin as App<unknown>) as App<State>;

    const hostEffectRunner = getEffectRunner(this.#app as App<unknown>);
    const innerEffectRunner = getEffectRunner(inner as App<unknown>);

    if (
      this.#mountConflictPolicy === "fail" &&
      hostEffectRunner !== null &&
      innerEffectRunner !== null
    ) {
      const message =
        `[freak] mountApp conflict at "${path}": both host and mounted app define effectRunner.`;
      if (this.#mountValidationMode === "compat") {
        // deno-lint-ignore no-console
        console.warn(`${message} Keeping host runner.`);
      } else {
        throw new Error(message);
      }
    }
    // Atom hydration hook conflict: both EffectApps share the same module-global hook
    // (set by createEffectApp via setAtomHydrationHook). Check if a hook is already
    // registered — if so, mounting another EffectApp would be a duplicate registration.
    if (
      this.#mountConflictPolicy === "fail" &&
      getAtomHydrationHook() !== null &&
      getEffectRunner(inner as App<unknown>) !== null
    ) {
      const message =
        `[freak] mountApp conflict at "${path}": both host and mounted app define atomHydrationHook.`;
      if (this.#mountValidationMode === "compat") {
        // deno-lint-ignore no-console
        console.warn(`${message} Keeping host hook.`);
      } else {
        throw new Error(message);
      }
    }
    this.#app.mountApp(path, inner);
    return this;
  }

  /**
   * Mount an Effect HttpApi at the given path prefix.
   *
   * Builds the HttpApi layer with group implementations, converts it to a web
   * handler via `HttpRouter.toWebHandler()`, and registers a Fresh middleware
   * at `prefix` that delegates matching requests to the Effect HTTP stack.
   *
   * The Effect sub-handler shares the app's `ManagedRuntime.memoMap`, so group
   * implementations can access services from the app's Layer if explicitly
   * composed into the group layer.
   *
   * The sub-handler's `dispose()` is called automatically when `EffectApp.dispose()`
   * is invoked.
   *
   * @param prefix - URL path prefix (e.g., "/api"). Requests matching this prefix
   *   are forwarded to the Effect handler. Must start with "/".
   * @param api - The HttpApi definition (created with `HttpApi.make(...).add(...)`)
   * @param groupLayers - One or more Layer values providing group implementations
   *   (created with `HttpApiBuilder.group(api, name, build)`)
   *
   * @example
   * ```typescript
   * const Api = HttpApi.make("myApi").add(
   *   HttpApiGroup.make("users").prefix("/users").add(
   *     HttpApiEndpoint.get("list", "/", { success: Schema.Array(UserSchema) })
   *   )
   * );
   * const UsersLive = HttpApiBuilder.group(Api, "users", (h) =>
   *   h.handle("list", () => Effect.succeed([]))
   * );
   * app.httpApi("/api", Api, UsersLive);
   * ```
   */
  httpApi(
    prefix: string,
    api: HttpApi.HttpApi<string, HttpApiGroup.Any>,
    ...groupLayers: [
      Layer.Layer<never, unknown, unknown>,
      ...Array<Layer.Layer<never, unknown, unknown>>,
    ]
  ): this {
    // Build the complete API layer: HttpApiBuilder.layer(api) + group impls + infra services
    const groupLayer = Layer.mergeAll(...groupLayers);
    const apiLayer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(groupLayer),
      Layer.provide(HttpServer.layerServices),
    );

    // Convert to a web handler. Share the app's memoMap so that service instances
    // built by the main ManagedRuntime can be reused in group implementations
    // (when the user explicitly composes AppLayer into their group layer).
    // deno-lint-ignore no-explicit-any
    const { handler, dispose } = HttpRouter.toWebHandler(apiLayer as any, {
      // Keep HttpApi handlers on an isolated router/runtime cache path.
      // Sharing memoMap with RPC mounts can surface duplicate route registration
      // defects in Effect's HttpRouter layer (e.g. "POST / already declared").
      routerConfig: {},
    });

    // Store disposer for cleanup
    this.#httpApiDisposers.push(dispose);

    // Register a Fresh route for all HTTP methods at the prefix. The Effect
    // handler owns all requests at this prefix -- a 404 from the Effect handler
    // is intentional (route matched prefix but the handler returned NotFound).
    //
    // We use app.all(prefix + "/*", ...) so that Fresh's UrlPatternRouter
    // matches any request under the prefix and invokes the middleware. Without
    // a Route registration, app.use(prefix, ...) middleware only runs when
    // another route under the prefix matches -- which never happens here.
    //
    // The prefix must be stripped from the request URL before forwarding to the
    // Effect handler, because the HttpApiEndpoint paths are defined relative to
    // the group root (e.g. "/items/"), not to the mount prefix (e.g. "/api").
    this.#app.all(prefix + "/*", async (ctx) => {
      const url = new URL(ctx.req.url);
      url.pathname = url.pathname.slice(prefix.length) || "/";
      const rewritten = new Request(url.toString(), ctx.req);
      // deno-lint-ignore no-explicit-any
      return await (handler as any)(rewritten);
    });

    return this;
  }

  /**
   * Mount an Effect RPC group at the given path prefix.
   *
   * Builds the RpcServer layer with the given handler implementations, converts it
   * to a web handler via `HttpRouter.toWebHandler()`, and registers Fresh routes at
   * `path` (and `path + "/*"`) that delegate matching requests to the Effect RPC stack.
   *
   * Two protocols are supported:
   * - `"http"` — request/response RPC via HTTP POST, serialized as JSON.
   * - `"websocket"` — server-push streaming via WebSocket, serialized as NDJSON.
   *
   * For WebSocket protocol, two Fresh routes are registered:
   * - `path` — handles the WS upgrade handshake (GET at the exact path)
   * - `path + "/*"` — handles any sub-path requests (forwarded with prefix stripped)
   *
   * The sub-handler shares the app's `ManagedRuntime.memoMap` so handler services
   * can be composed from the app's Layer via `Layer.provide(handlerLayer, AppLayer)`.
   *
   * The sub-handler's `dispose()` is called automatically when `EffectApp.dispose()`
   * is invoked.
   *
   * Returns `this` for method chaining.
   *
   * @param options.group - The RpcGroup definition (created with `RpcGroup.make(...)`)
   * @param options.path - URL path prefix (e.g., "/rpc/todos"). Must start with "/".
   * @param options.protocol - `"http"` for request/response, `"websocket"` for streaming
   * @param options.handlerLayer - Layer providing handler implementations (from `group.toLayer(...)`)
   *
   * @example
   * ```typescript
   * const TodoHandlers = TodoRpc.toLayer({
   *   ListTodos: () => Effect.succeed([]),
   *   CreateTodo: ({ text }) => Effect.succeed({ id: "1", text }),
   * });
   *
   * // HTTP request/response
   * app.rpc({
   *   group: TodoRpc,
   *   path: "/rpc/todos",
   *   protocol: "http",
   *   handlerLayer: Layer.provide(TodoHandlers, AppLayer),
   * });
   *
   * // WebSocket streaming
   * app.rpc({
   *   group: TodoRpc,
   *   path: "/rpc/todos/ws",
   *   protocol: "websocket",
   *   handlerLayer: Layer.provide(TodoHandlers, AppLayer),
   * });
   * ```
   */
  rpc<Rpcs extends Rpc.Any>(options: {
    group: RpcGroup.RpcGroup<Rpcs>;
    path: string;
    protocol: "http" | "http-stream" | "sse" | "websocket";
    handlerLayer: Layer.Layer<Rpc.ToHandler<Rpcs>, unknown, unknown>;
    /**
     * Optional list of allowed origins for WebSocket connections.
     * When provided, the `Origin` request header must match one of the listed
     * origins exactly (e.g. `["https://example.com"]`). Requests from unlisted
     * origins receive a 403. If omitted, all origins are accepted.
     *
     * Only applies to `protocol: "websocket"`. Ignored for other protocols.
     */
    allowedOrigins?: ReadonlyArray<string>;
  }): this {
    if (options.protocol === "http") {
      // HTTP protocol: layerHttp + HttpRouter.toWebHandler (request/response)
      const serverLayer = (RpcServer.layerHttp({
        group: options.group,
        path: "/", // Routes are relative to the mount prefix; Fresh handles the outer path
        protocol: "http",
        // deno-lint-ignore no-explicit-any
      }) as any).pipe(
        Layer.provide(options.handlerLayer),
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(HttpServer.layerServices),
      );

      // Convert to a web handler. Share the app's memoMap so that service instances
      // built by the main ManagedRuntime can be reused in handler implementations.
      //
      // Pass routerConfig: {} so that toWebHandler creates a unique RouterLayer per call
      // (Layer.provide(HttpRouter.layer, configLayer) vs the bare HttpRouter.layer constant).
      // Without this, multiple HTTP-protocol mounts would share the same HttpRouter via
      // memoMap and the second mount's router.add("POST", "/") would fail.
      // deno-lint-ignore no-explicit-any
      const { handler, dispose } = HttpRouter.toWebHandler(serverLayer as any, {
        memoMap: this.#runtime.memoMap,
        routerConfig: {},
      });

      this.#rpcDisposers.push(dispose);

      // RpcClient.layerProtocolHttp uses HttpClientRequest.prependUrl(options.url) and
      // then calls client.post("") (empty sub-path). The internal joinSegments helper
      // adds a "/" separator when neither side has a slash, so the actual request lands
      // on "path/" (trailing slash). We register both forms to handle this.
      //
      // A "/*" wildcard is intentionally omitted: Fresh's router matches "path/*"
      // against the exact path too, causing double execution (duplicate RPC responses).
      const httpHandler = async (ctx: Context<State>) => {
        const url = new URL(ctx.req.url);
        url.pathname = url.pathname.slice(options.path.length) || "/";
        // If the Fresh middleware validated or refreshed the session (e.g. rotating
        // cookie auth) and stored the JWT in ctx.state.jwtToken, inject it as
        // Authorization: Bearer so the Effect RPC middleware can authenticate the
        // request. This handles the case where ae_at has expired and been silently
        // refreshed server-side — the original request has no ae_at cookie, but
        // ctx.state.jwtToken holds the valid token from the upstream middleware.
        // deno-lint-ignore no-explicit-any
        const stateJwt = ((ctx.state as Record<string, unknown>)?.jwtToken) as
          | string
          | undefined;
        let rewritten: Request;
        if (stateJwt && !ctx.req.headers.has("authorization")) {
          const headers = new Headers(ctx.req.headers);
          headers.set("authorization", `Bearer ${stateJwt}`);
          rewritten = new Request(url.toString(), {
            method: ctx.req.method,
            headers,
            body: ctx.req.body,
          } as RequestInit);
        } else {
          rewritten = new Request(url.toString(), ctx.req);
        }
        // deno-lint-ignore no-explicit-any
        return await (handler as any)(rewritten);
      };
      // deno-lint-ignore no-explicit-any
      this.#app.all(options.path, httpHandler as any);
      // Also register the trailing-slash variant — RpcClient posts to "path/" due to
      // joinSegments(path, "") adding a separator slash when path has no trailing slash.
      // deno-lint-ignore no-explicit-any
      this.#app.all(options.path + "/", httpHandler as any);
      return this;
    } else if (options.protocol === "http-stream") {
      // HTTP-stream protocol: POST endpoint streaming responses as NDJSON.
      //
      // Uses makeNoSerialization to bypass the HttpRouter.toWebHandler path, which
      // avoids a shared-memoMap conflict when both "http" and "http-stream" protocols
      // are mounted (both would register POST / on the same cached HttpRouter).
      //
      // The client (useRpcHttpStream) posts a JSON-encoded FromClient message and
      // reads the streaming response body as NDJSON lines. Each line is a JSON-encoded
      // FromServer message: Chunk messages carry stream values, Exit signals completion.
      //
      // BigInt fields (requestId) are serialized as strings; the client's parser.decode
      // accepts string requestIds (as produced by RpcSerialization.layerNdjson).
      const appRuntime = this.#runtime;
      // RpcClient.layerProtocolHttp posts to "" (empty sub-path). joinSegments adds
      // a "/" separator when neither side has a slash, so the actual request lands
      // on "path/" (trailing slash). Register both forms — same as the "http" protocol.
      const httpStreamHandler = async (ctx: Context<State>) => {
        if (ctx.req.method !== "POST") {
          return new Response(
            "Method Not Allowed — HTTP-stream endpoints require POST",
            {
              status: 405,
            },
          );
        }

        // Parse the request body (one JSON line from layerNdjson client).
        // deno-lint-ignore no-explicit-any
        let request: any;
        try {
          const contentLength = parseInt(
            ctx.req.headers.get("content-length") ?? "0",
            10,
          );
          if (!isNaN(contentLength) && contentLength > 65536) {
            return new Response("Request body too large", { status: 413 });
          }
          const text = await ctx.req.text();
          request = JSON.parse(text.trim().split("\n")[0]);
        } catch {
          return new Response("Bad Request — expected JSON body", {
            status: 400,
          });
        }

        const procedure = request.tag ?? "";
        // deno-lint-ignore no-explicit-any
        const payload: any = request.payload ?? null;
        // RequestId is a branded bigint — encoded as string "1" by layerNdjson.
        const requestId = BigInt(request.id ?? "1");

        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        let closed = false;
        let resolveDone: (() => void) | undefined;
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });

        const close = () => {
          if (!closed) {
            closed = true;
            writer.close().catch(() => {});
            resolveDone?.();
          }
        };

        const effect = Effect.scoped(Effect.gen(function* () {
          // deno-lint-ignore no-explicit-any
          const server = yield* (RpcServer.makeNoSerialization as any)(
            options.group,
            {
              // deno-lint-ignore no-explicit-any
              onFromServer: (response: any) =>
                Effect.sync(() => {
                  if (closed) return;
                  // Serialize with BigInt-safe replacer.
                  const line = JSON.stringify(
                    response,
                    (_k, v) => typeof v === "bigint" ? String(v) : v,
                  );
                  writer.write(enc.encode(line + "\n")).catch(() => {
                    close();
                  });
                  // Non-streaming procedures complete with a single Exit response.
                  if (response._tag === "Exit" || response._tag === "Defect") {
                    close();
                  }
                }),
            },
          );

          // Send the request to the server. requestId was parsed from the request body.
          // deno-lint-ignore no-explicit-any
          yield* (server as any).write(0, {
            _tag: "Request",
            id: requestId,
            tag: procedure,
            payload,
            headers: [],
          });

          // Block until the stream ends (Exit/Defect received) or the client disconnects.
          yield* Effect.callback<void>((resume) => {
            done.then(() => resume(Effect.void));
            ctx.req.signal?.addEventListener(
              "abort",
              () => resume(Effect.void),
              { once: true },
            );
            if (ctx.req.signal?.aborted) resume(Effect.void);
          });
        })).pipe(
          // deno-lint-ignore no-explicit-any
          Effect.provide(options.handlerLayer as any),
        );

        // deno-lint-ignore no-explicit-any
        appRuntime.runFork(effect as any);

        return new Response(readable, {
          headers: {
            "Content-Type": "application/x-ndjson",
            "Cache-Control": "no-cache",
          },
        });
      };
      // deno-lint-ignore no-explicit-any
      this.#app.all(options.path, httpStreamHandler as any);
      // Also register the trailing-slash variant — RpcClient posts to "path/" due to
      // joinSegments(path, "") adding a separator slash when path has no trailing slash.
      // deno-lint-ignore no-explicit-any
      this.#app.all(options.path + "/", httpStreamHandler as any);
      return this;
    } else if (options.protocol === "sse") {
      // SSE protocol: GET endpoint streaming responses as Server-Sent Events.
      //
      // Uses makeNoSerialization to run the RPC handler without going through the
      // HTTP protocol machinery (which only supports POST). Each SSE connection:
      // 1. Reads the procedure name from ?p=ProcedureName query param
      // 2. Reads optional JSON payload from ?payload=... query param
      // 3. Starts the RPC handler via makeNoSerialization
      // 4. Streams each FromServer response as "data: {json}\n\n" in SSE format
      // 5. Closes the stream when the client disconnects (req.signal abort)
      //
      // BigInt fields (requestId) are serialized as strings in the SSE data.
      // Compatible with browser EventSource API (GET-only).
      const appRuntime = this.#runtime;
      this.#app.all(options.path, (ctx) => {
        if (ctx.req.method !== "GET") {
          return new Response(
            "Method Not Allowed — SSE endpoints require GET",
            {
              status: 405,
            },
          );
        }

        const url = new URL(ctx.req.url);
        const procedure = url.searchParams.get("p") ?? "";
        const payloadStr = url.searchParams.get("payload");
        // deno-lint-ignore no-explicit-any
        const payload: any = payloadStr ? JSON.parse(payloadStr) : null;

        const { readable, writable } = new TransformStream<Uint8Array>();
        const writer = writable.getWriter();
        const enc = new TextEncoder();
        let closed = false;

        const close = () => {
          if (!closed) {
            closed = true;
            writer.close().catch(() => {});
          }
        };

        const effect = Effect.scoped(Effect.gen(function* () {
          // deno-lint-ignore no-explicit-any
          const server = yield* (RpcServer.makeNoSerialization as any)(
            options.group,
            {
              // deno-lint-ignore no-explicit-any
              onFromServer: (response: any) =>
                Effect.sync(() => {
                  if (closed) return;
                  // Serialize with BigInt-safe replacer (requestId is a branded bigint).
                  const data = JSON.stringify(
                    response,
                    (_k, v) => typeof v === "bigint" ? String(v) : v,
                  );
                  writer.write(enc.encode(`data: ${data}\n\n`)).catch(() => {
                    closed = true;
                  });
                  // Stream over for non-streaming procedures (single Exit response).
                  if (response._tag === "Exit" || response._tag === "Defect") {
                    close();
                  }
                }),
            },
          );

          // Send the initial RPC request to the server.
          // id is a RequestId (branded bigint) — BigInt(1) satisfies the brand at runtime.
          // deno-lint-ignore no-explicit-any
          yield* (server as any).write(0, {
            _tag: "Request",
            id: BigInt(1),
            tag: procedure,
            payload,
            headers: [],
          });

          // Block until the client disconnects (AbortSignal fires on connection close).
          yield* Effect.callback<void>((resume) => {
            ctx.req.signal?.addEventListener(
              "abort",
              () => resume(Effect.void),
              { once: true },
            );
            // If signal already aborted, resume immediately.
            if (ctx.req.signal?.aborted) resume(Effect.void);
          });
        })).pipe(
          // deno-lint-ignore no-explicit-any
          Effect.provide(options.handlerLayer as any),
        );

        // Run in background using the app runtime (shares memoMap → shared TodoService).
        // deno-lint-ignore no-explicit-any
        appRuntime.runFork(effect as any);

        return new Response(readable, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            // Disable proxy/nginx buffering so chunks flush immediately.
            "X-Accel-Buffering": "no",
          },
        });
      });
      return this;
    } else {
      // WebSocket protocol: use Deno.upgradeWebSocket + per-connection SocketServer.
      //
      // HttpRouter.toWebHandler wraps requests in a ServerRequestImpl whose `.upgrade`
      // getter always returns Effect.fail — so RpcServer.layerHttp({ protocol: "websocket" })
      // can never upgrade. Instead, we upgrade directly with Deno.upgradeWebSocket and
      // create a one-shot SocketServer from the resulting socket, then use
      // RpcServer.layerProtocolSocketServer to bypass the HttpRequest upgrade path.
      //
      // Registered as GET-only: WS upgrades always arrive as GET requests. Registering
      // with app.get() means non-GET requests naturally receive a 405 from Fresh's router
      // instead of hitting Deno.upgradeWebSocket (which would throw a 500).
      const allowedOrigins = options.allowedOrigins;
      if (!allowedOrigins || allowedOrigins.length === 0) {
        const isDev = this.#app.config.mode !== "production";
        if (isDev) {
          // deno-lint-ignore no-console
          console.warn(
            `[EffectApp] WebSocket endpoint at "${options.path}" has no allowedOrigins configured — ` +
              `any origin can connect. Set allowedOrigins to restrict access in production.`,
          );
        }
      }
      this.#app.get(options.path, (ctx) => {
        // Optional Origin validation — prevents cross-origin WebSocket connections.
        // Any site can open a WS to a permissive server, bypassing CORS. When
        // allowedOrigins is provided, enforce an exact match on the Origin header.
        if (allowedOrigins !== undefined && allowedOrigins.length > 0) {
          const origin = ctx.req.headers.get("Origin");
          if (origin === null || !allowedOrigins.includes(origin)) {
            return new Response("Forbidden — origin not allowed", {
              status: 403,
            });
          }
        }

        // Upgrade the HTTP request to a WebSocket. Returns the 101 response
        // and the server-side WebSocket instance.
        const { response, socket: denoWs } = Deno.upgradeWebSocket(ctx.req);

        // Build rpcBaseLayer FRESH per connection so each gets a new object identity.
        // A shared identity would cause the memoMap to return stale cached state from
        // a prior connection after its runtime disposes.
        //
        // Wrap layerProtocolSocketServer in Layer.fresh so it bypasses the memoMap
        // entirely (neither lookup nor insertion). Without this, even a new rpcBaseLayer
        // object would find the stale constant layerProtocolSocketServer entry in the
        // shared memoMap after connection 1 closed — giving connection 2 a protocol
        // with a dead clients map and no Pong responses.
        //
        // options.handlerLayer (e.g. TodoService) is the same reference so it is
        // still memoized and shared across HTTP and WebSocket handlers.
        // deno-lint-ignore no-explicit-any
        const rpcBaseLayer = (RpcServer.layer(options.group) as any).pipe(
          Layer.provide(
            // deno-lint-ignore no-explicit-any
            Layer.fresh(RpcServer.layerProtocolSocketServer as any),
          ),
          Layer.provide(options.handlerLayer),
          Layer.provide(RpcSerialization.layerNdjson),
        );

        // Wrap the Deno WebSocket in a one-shot Effect SocketServer.
        // When run(handler) is called by layerProtocolSocketServer, the handler
        // receives our single socket and runs the RPC session to completion.
        // Effect.never blocks until the connection runtime's scope is closed.
        const socketServerLayer = Layer.effect(
          SocketServer.SocketServer,
          Effect.map(
            Socket.fromWebSocket(
              Effect.succeed(denoWs as unknown as globalThis.WebSocket),
            ),
            (sock) =>
              SocketServer.SocketServer.of({
                address: {
                  _tag: "TcpAddress" as const,
                  hostname: "localhost",
                  port: 0,
                },
                // deno-lint-ignore no-explicit-any
                run: (handler: any): any =>
                  Effect.flatMap(handler(sock), () => Effect.never),
              }),
          ),
        );

        // Full layer for this connection
        // deno-lint-ignore no-explicit-any
        const connectionLayer = (rpcBaseLayer as any).pipe(
          Layer.provide(socketServerLayer),
        );

        // Create a per-connection ManagedRuntime. Share the app's memoMap so that
        // service instances from the app layer (e.g. in-memory stores, DB pools) are
        // reused across HTTP and WebSocket handlers rather than duplicated per-connection.
        // deno-lint-ignore no-explicit-any
        const connectionRuntime = ManagedRuntime.make(connectionLayer as any, {
          memoMap: this.#runtime.memoMap,
        });

        // Running Effect.never causes the runtime to eagerly build connectionLayer
        // (starting the SocketServer + RPC background fibers) and stay alive until
        // the connection is torn down.
        this.#activeWsRuntimes.set(
          connectionRuntime,
          denoWs as unknown as WebSocket,
        );
        // deno-lint-ignore no-explicit-any
        connectionRuntime.runFork(Effect.never as any);

        // Dispose the runtime when the WebSocket closes, which closes the scope and
        // interrupts all background fibers (SocketServer run loop, RPC fiber).
        // wasActive is false when dispose() already cleared the map and is handling
        // disposal itself — skip the redundant second dispose() in that case.
        denoWs.addEventListener("close", () => {
          const wasActive = this.#activeWsRuntimes.delete(connectionRuntime);
          if (wasActive) {
            connectionRuntime.dispose().catch((err) => {
              // deno-lint-ignore no-console
              console.error(
                "[EffectApp] WS connection runtime dispose error:",
                err,
              );
            });
          }
        });

        return response;
      });
      return this;
    }
  }

  /**
   * Add Effect-aware middlewares for GET requests at the given path.
   */
  get(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.get(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for POST requests at the given path.
   */
  post(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.post(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for PATCH requests at the given path.
   */
  patch(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.patch(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for PUT requests at the given path.
   */
  put(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.put(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for DELETE requests at the given path.
   */
  delete(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.delete(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for HEAD requests at the given path.
   */
  head(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.head(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for all HTTP verbs at the given path.
   */
  all(
    path: string,
    ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]
  ): this {
    // deno-lint-ignore no-explicit-any
    this.#app.all(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Create a handler function for `Deno.serve` or for use in testing.
   * The EffectRunner was registered at createEffectApp() time, so Effects
   * in handlers will be dispatched correctly.
   */
  handler(): (
    request: Request,
    info?: Deno.ServeHandlerInfo,
  ) => Promise<Response> {
    return this.#app.handler();
  }

  /**
   * Spawn a server for this app. Blocks until the server stops.
   */
  listen(options?: ListenOptions): Promise<void> {
    return this.#app.listen(options);
  }

  /**
   * Dispose all resources: signal listeners, HttpApi sub-handler runtimes,
   * and the main ManagedRuntime.
   *
   * Call this if you want to tear down the app programmatically
   * (e.g., in tests) rather than relying on signal handlers.
   *
   * This is the canonical dispose path — SIGINT/SIGTERM also routes through
   * this method so that HttpApi sub-handlers are always cleaned up.
   */
  async dispose(): Promise<void> {
    this.#cleanupSignals();
    // Drain active WebSocket connections BEFORE disposing the main runtime.
    // This ensures WS connection finalizers can still access shared services
    // (e.g. TodoService) that live in the main runtime's memoMap.
    //
    // We snapshot the map, clear it, then for each entry:
    //   1. Close the WebSocket so the client receives a close frame (fires close event)
    //   2. Dispose the runtime (interrupts Effect.never + scope finalizers)
    // The close event handler checks wasActive via .delete() — since the map is already
    // cleared, it gets false and skips the redundant second dispose().
    const activeEntries = [...this.#activeWsRuntimes.entries()];
    this.#activeWsRuntimes.clear();
    await Promise.all(
      activeEntries.map(async ([rt, ws]) => {
        try {
          ws.close();
        } catch { /* ignore if already closed */ }
        await rt.dispose().catch((err) => {
          // deno-lint-ignore no-console
          console.error(
            "[EffectApp] WS connection runtime dispose error during shutdown:",
            err,
          );
        });
      }),
    );
    // Dispose all HttpApi sub-handler runtimes
    for (const disposer of this.#httpApiDisposers) {
      await disposer();
    }
    // Dispose all RPC sub-handler runtimes
    for (const disposer of this.#rpcDisposers) {
      await disposer();
    }
    await this.#runtime.dispose();
  }
}

/**
 * Create an `EffectApp` — an Effect-aware wrapper around Fresh's `App<State>`.
 *
 * This is the primary entry point for the `@fresh/core/effect` v2 API. It:
 * 1. Creates an `App<State>` instance
 * 2. Creates a `ManagedRuntime` from the provided Layer
 * 3. Calls `setEffectRunner(app, runner)` so Effect-returning handlers work
 * 4. Registers SIGINT/SIGTERM signal handlers for clean ManagedRuntime disposal
 * 5. Returns an `EffectApp<State, AppR>` that proxies all App builder methods
 *
 * IMPORTANT: setEffectRunner is called before .handler() — this ensures the
 * Effect runner is registered before any requests are processed.
 *
 * @example
 * ```typescript
 * import { createEffectApp } from "@fresh/core/effect";
 * import { DbLayer } from "./layers.ts";
 *
 * const app = createEffectApp<AppState, typeof DbService>({ layer: DbLayer });
 *
 * app.get("/api/items", (ctx) =>
 *   Effect.gen(function* () {
 *     const db = yield* DbService;
 *     const items = yield* db.list();
 *     return Response.json(items);
 *   })
 * );
 *
 * await app.listen({ port: 8000 });
 * ```
 */
export function createEffectApp<State = unknown, AppR = never, E = never>(
  options: CreateEffectAppOptions<AppR, E>,
): EffectApp<State, AppR> {
  const app = new App<State>(options.config);
  // deno-lint-ignore no-explicit-any
  const runtime = makeRuntime(options.layer as Layer.Layer<any, any, never>);
  const resolverOptions: ResolverOptions = {};
  if (options.mapError) {
    resolverOptions.mapError = options.mapError;
  }
  const resolver = createResolver(runtime, resolverOptions);
  const runner: EffectRunner = (value, ctx) =>
    resolver(value, ctx) as Promise<unknown>;
  // deno-lint-ignore no-explicit-any
  setEffectRunner(app as App<any>, runner);

  // Register per-request runner so plugin handlers can call runEffect(ctx, eff).
  // The middleware runs before any route handler, so runEffect is always available.
  app.use((ctx) => {
    _setRequestRunner(ctx, (eff) => resolver(eff, ctx) as Promise<unknown>);
    return ctx.next();
  });

  // Register atom hydration hook — called by FreshRuntimeScript during SSR
  // to serialize atom state into the __FRSH_ATOM_STATE script tag.
  // Multiple EffectApp instances naturally merge: setAtom() lazily initializes
  // a shared per-request Map on ctx.state, so all apps contribute to the same Map.
  setAtomHydrationHook(serializeAtomHydration);

  const effectApp = new EffectApp<State, AppR>(
    app,
    runtime as ManagedRuntime.ManagedRuntime<AppR, unknown>,
    {
      mountValidationMode: options.mountValidationMode ?? "strict",
      mountConflictPolicy: options.mountConflictPolicy ?? "fail",
    },
  );
  // Register signal disposal AFTER creating EffectApp so that SIGINT/SIGTERM
  // calls effectApp.dispose() — which disposes ALL resources (httpApi sub-handlers
  // + main runtime) rather than only the main runtime.
  const cleanupSignals = registerSignalDisposal(() => effectApp.dispose());
  effectApp._setCleanupSignals(cleanupSignals);
  return effectApp;
}
