/**
 * @module
 * Typed define wrapper for Effect route handlers.
 *
 * `createEffectDefine<State, R>()` mirrors Fresh's `createDefine<State>()` but
 * adds an `R` type parameter that constrains handler Effect return types to only
 * use services provided by the declared Layer.
 *
 * Usage:
 * ```typescript
 * import { createEffectDefine } from "@fresh/plugin-effect";
 * import { DbLayer } from "./layers.ts";
 *
 * const define = createEffectDefine<AppState, typeof DbService>({ layer: DbLayer });
 *
 * export const handler = define.handlers({
 *   GET: (ctx) => Effect.gen(function* () {
 *     const db = yield* DbService;
 *     return new Response(await db.query("SELECT 1"));
 *   }),
 * });
 * ```
 */

import type { Context } from "@fresh/core";
import type { Method } from "@fresh/core";
import type { PageResponse } from "@fresh/core";
import type { Effect } from "effect";
import type { Layer as LayerType } from "effect";
import { setEffectResolver } from "@fresh/core/internal";
import { makeRuntime, registerDisposal } from "./runtime.ts";
import { createResolver } from "./resolver.ts";

/**
 * A handler function that returns an Effect with the given service requirements R.
 * E is fixed to `unknown` — not a generic parameter.
 */
export interface EffectHandlerFn<Data, State, R> {
  (ctx: Context<State>): Effect.Effect<Response | PageResponse<Data>, unknown, R>;
}

/**
 * A map of HTTP method names to Effect handler functions.
 * Uses the `Method` type from `@fresh/core` to constrain keys.
 */
export type EffectHandlerByMethod<Data, State, R> = {
  [M in Method]?: EffectHandlerFn<Data, State, R>;
};

/**
 * A route handler that can be either a single function or a map of method handlers.
 */
export type EffectRouteHandler<Data, State, R> =
  | EffectHandlerFn<Data, State, R>
  | EffectHandlerByMethod<Data, State, R>;

/**
 * The define object returned by `createEffectDefine`.
 * Mirrors `Define<State>` from Fresh but adds the R constraint.
 */
export interface EffectDefine<State, R> {
  handlers<
    Data,
    Handlers extends EffectRouteHandler<Data, State, R> = EffectRouteHandler<Data, State, R>,
  >(handlers: Handlers): typeof handlers;
}

/**
 * Configuration options for `createEffectDefine`.
 */
export interface CreateEffectDefineOptions<R> {
  layer?: LayerType.Layer<R, unknown, never>;
}

/**
 * Create a typed define wrapper for Effect route handlers.
 *
 * When `options.layer` is provided (standalone path), this function:
 * 1. Creates a ManagedRuntime from the Layer
 * 2. Registers the Effect resolver in Fresh core via setEffectResolver()
 * 3. Registers disposal of the ManagedRuntime on Deno's unload event
 *
 * When no `layer` is provided (type-parameter-only path), the runtime setup is
 * skipped. A runtime must already be registered (e.g. via effectPlugin()).
 *
 * The `handlers()` method is an identity function — all type enforcement is
 * at compile time via the R type parameter.
 *
 * @typeParam State The type of the Fresh context state object
 * @typeParam R The service requirements — must match what the Layer provides
 *
 * @example Standalone path (with Layer)
 * ```typescript
 * const define = createEffectDefine<AppState, typeof DbService>({ layer: DbLayer });
 * ```
 *
 * @example Type-parameter-only path (no Layer, relies on effectPlugin)
 * ```typescript
 * const define = createEffectDefine<AppState, typeof DbService>();
 * ```
 */
export function createEffectDefine<State = unknown, R = never>(
  options: CreateEffectDefineOptions<R> = {},
): EffectDefine<State, R> {
  if (options.layer !== undefined) {
    // deno-lint-ignore no-explicit-any
    const runtime = makeRuntime(options.layer as LayerType.Layer<any, any, never>);
    const resolver = createResolver(runtime);
    setEffectResolver(resolver);
    registerDisposal(
      runtime as import("effect").ManagedRuntime.ManagedRuntime<unknown, unknown>,
    );
  }

  return {
    handlers(handlers) {
      return handlers;
    },
  };
}
