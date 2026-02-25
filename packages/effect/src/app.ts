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
  #cleanupSignals: () => void;

  constructor(
    app: App<State>,
    runtime: ManagedRuntime.ManagedRuntime<AppR, unknown>,
    cleanupSignals: () => void,
  ) {
    this.#app = app;
    this.#runtime = runtime;
    this.#cleanupSignals = cleanupSignals;
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
   * Dispose the ManagedRuntime and remove signal listeners.
   * Call this if you want to tear down the app programmatically
   * (e.g., in tests) rather than relying on signal handlers.
   */
  async dispose(): Promise<void> {
    this.#cleanupSignals();
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
  const cleanupSignals = registerSignalDisposal(
    runtime as ManagedRuntime.ManagedRuntime<unknown, unknown>,
  );
  return new EffectApp<State, AppR>(
    app,
    runtime as ManagedRuntime.ManagedRuntime<AppR, unknown>,
    cleanupSignals,
  );
}
