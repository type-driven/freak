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

import { App, type FreshConfig, type ListenOptions } from "@fresh/core";
import type { Context } from "@fresh/core";
import type { Middleware, MiddlewareFn } from "@fresh/core";
import type { MaybeLazy, RouteConfig, LayoutConfig } from "@fresh/core";
import { setEffectRunner } from "@fresh/core/internal";
import type { EffectRunner } from "@fresh/core/internal";
import { ManagedRuntime, Layer, type Effect } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { RpcServer, RpcSerialization } from "effect/unstable/rpc";
import { createResolver, type ResolverOptions } from "./resolver.ts";
import { makeRuntime, registerSignalDisposal } from "./runtime.ts";

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

  constructor(
    app: App<State>,
    runtime: ManagedRuntime.ManagedRuntime<AppR, unknown>,
  ) {
    this.#app = app;
    this.#runtime = runtime;
  }

  /** @internal */
  _setCleanupSignals(fn: () => void): void {
    this.#cleanupSignals = fn;
  }

  /**
   * Access the underlying App instance. Useful for passing to
   * setBuildCache() and other @fresh/core/internal functions.
   */
  get app(): App<State> {
    return this.#app;
  }

  /**
   * The resolved Fresh configuration.
   */
  get config() {
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
  use(path: string, ...middleware: MaybeLazyEffectMiddleware<State, AppR>[]): this;
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
  // deno-lint-ignore no-explicit-any
  notFound(routeOrMiddleware: any): this {
    // deno-lint-ignore no-explicit-any
    this.#app.notFound(routeOrMiddleware as any);
    return this;
  }

  /**
   * Set the app's error handler for a given path.
   */
  // deno-lint-ignore no-explicit-any
  onError(path: string, routeOrMiddleware: any): this {
    // deno-lint-ignore no-explicit-any
    this.#app.onError(path, routeOrMiddleware as any);
    return this;
  }

  /**
   * Set the app wrapper component (rendered around all routes).
   */
  // deno-lint-ignore no-explicit-any
  appWrapper(component: any): this {
    // deno-lint-ignore no-explicit-any
    this.#app.appWrapper(component as any);
    return this;
  }

  /**
   * Register a layout component for a given path.
   */
  // deno-lint-ignore no-explicit-any
  layout(path: string, component: any, config?: LayoutConfig): this {
    // deno-lint-ignore no-explicit-any
    this.#app.layout(path, component as any, config);
    return this;
  }

  /**
   * Register a file-based route module at a given path.
   */
  // deno-lint-ignore no-explicit-any
  route(path: string, route: any, config?: RouteConfig): this {
    // deno-lint-ignore no-explicit-any
    this.#app.route(path, route as any, config);
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
   * Merge another App instance into this app at the given path.
   * Accepts a plain App<State> (not EffectApp) for compatibility.
   */
  mountApp(path: string, app: App<State>): this {
    this.#app.mountApp(path, app);
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
  // deno-lint-ignore no-explicit-any
  httpApi(prefix: string, api: any, ...groupLayers: any[]): this {
    // Build the complete API layer: HttpApiBuilder.layer(api) + group impls + infra services
    // deno-lint-ignore no-explicit-any
    const groupLayer = Layer.mergeAll(...(groupLayers as [any, ...any[]]));
    const apiLayer = HttpApiBuilder.layer(api).pipe(
      Layer.provide(groupLayer),
      Layer.provide(HttpServer.layerServices),
    );

    // Convert to a web handler. Share the app's memoMap so that service instances
    // built by the main ManagedRuntime can be reused in group implementations
    // (when the user explicitly composes AppLayer into their group layer).
    // deno-lint-ignore no-explicit-any
    const { handler, dispose } = HttpRouter.toWebHandler(apiLayer as any, {
      memoMap: this.#runtime.memoMap,
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
   * Returns `void` — called for its side effect, not for chaining.
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
  // deno-lint-ignore no-explicit-any
  rpc(options: {
    group: any;
    path: string;
    protocol: "http" | "websocket";
    handlerLayer: any;
  }): void {
    // Build the complete RPC server layer: RpcServer + handlers + serialization + infra
    // deno-lint-ignore no-explicit-any
    const serverLayer = (RpcServer.layerHttp({
      group: options.group,
      path: "/", // Routes are relative to the mount prefix; Fresh handles the outer path
      protocol: options.protocol,
    }) as any).pipe(
      Layer.provide(options.handlerLayer),
      Layer.provide(
        options.protocol === "http"
          ? RpcSerialization.layerJson
          : RpcSerialization.layerNdjson,
      ),
      Layer.provide(HttpServer.layerServices),
    );

    // Convert to a web handler. Share the app's memoMap so that service instances
    // built by the main ManagedRuntime can be reused in handler implementations
    // (when the user explicitly composes AppLayer into their handler layer).
    // deno-lint-ignore no-explicit-any
    const { handler, dispose } = HttpRouter.toWebHandler(serverLayer as any, {
      memoMap: this.#runtime.memoMap,
    });

    // Store disposer for cleanup
    this.#rpcDisposers.push(dispose);

    // Mount at path + "/*" with prefix stripping for HTTP sub-path requests.
    // Effect's RpcServer registers routes relative to path "/" (the inner root),
    // so we strip the outer mount prefix before forwarding.
    this.#app.all(options.path + "/*", async (ctx) => {
      const url = new URL(ctx.req.url);
      url.pathname = url.pathname.slice(options.path.length) || "/";
      const rewritten = new Request(url.toString(), ctx.req);
      // deno-lint-ignore no-explicit-any
      return await (handler as any)(rewritten);
    });

    // For WebSocket protocol, also mount at the EXACT path (no trailing /*).
    // The WS upgrade handshake arrives as a GET request at the exact path.
    // Fresh's path + "/*" glob does NOT match the exact path itself.
    // We rewrite the pathname to "/" to match the internal registration in Effect's
    // HttpRouter (which was given path: "/" above).
    if (options.protocol === "websocket") {
      this.#app.all(options.path, async (ctx) => {
        const url = new URL(ctx.req.url);
        url.pathname = "/";
        const rewritten = new Request(url.toString(), ctx.req);
        // deno-lint-ignore no-explicit-any
        return await (handler as any)(rewritten);
      });
    }
  }

  /**
   * Add Effect-aware middlewares for GET requests at the given path.
   */
  get(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.get(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for POST requests at the given path.
   */
  post(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.post(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for PATCH requests at the given path.
   */
  patch(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.patch(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for PUT requests at the given path.
   */
  put(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.put(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for DELETE requests at the given path.
   */
  delete(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.delete(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for HEAD requests at the given path.
   */
  head(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.head(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Add Effect-aware middlewares for all HTTP verbs at the given path.
   */
  all(path: string, ...middlewares: MaybeLazyEffectMiddleware<State, AppR>[]): this {
    // deno-lint-ignore no-explicit-any
    this.#app.all(path, ...middlewares as any[]);
    return this;
  }

  /**
   * Create a handler function for `Deno.serve` or for use in testing.
   * The EffectRunner was registered at createEffectApp() time, so Effects
   * in handlers will be dispatched correctly.
   */
  handler(): (request: Request, info?: Deno.ServeHandlerInfo) => Promise<Response> {
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
 * This is the primary entry point for the `@fresh/effect` v2 API. It:
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
 * import { createEffectApp } from "@fresh/effect";
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
  const runner: EffectRunner = (value, ctx) => resolver(value, ctx) as Promise<unknown>;
  // deno-lint-ignore no-explicit-any
  setEffectRunner(app as App<any>, runner);
  const effectApp = new EffectApp<State, AppR>(
    app,
    runtime as ManagedRuntime.ManagedRuntime<AppR, unknown>,
  );
  // Register signal disposal AFTER creating EffectApp so that SIGINT/SIGTERM
  // calls effectApp.dispose() — which disposes ALL resources (httpApi sub-handlers
  // + main runtime) rather than only the main runtime.
  const cleanupSignals = registerSignalDisposal(() => effectApp.dispose());
  effectApp._setCleanupSignals(cleanupSignals);
  return effectApp;
}
