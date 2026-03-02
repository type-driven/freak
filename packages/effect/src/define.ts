/**
 * @module
 * Typed define wrapper for Effect route handlers.
 *
 * `createEffectDefine<State, R>()` mirrors Fresh's `createDefine<State>()` but
 * adds an `R` type parameter that constrains handler Effect return types to only
 * use services provided by the declared Layer.
 *
 * In `@fresh/effect`, `createEffectDefine` is type-only — it does NOT accept
 * `app` or `layer` arguments. Runtime management is `EffectApp`'s job.
 *
 * Usage:
 * ```typescript
 * import { createEffectApp, createEffectDefine } from "@fresh/effect";
 * import { DbLayer } from "./layers.ts";
 *
 * const app = createEffectApp<AppState, typeof DbService>({ layer: DbLayer });
 * const define = createEffectDefine<AppState, typeof DbService>();
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

/**
 * A handler function that returns an Effect with the given service requirements R.
 * E is fixed to `unknown` — not a generic parameter.
 */
export interface EffectHandlerFn<Data, State, R> {
  (
    ctx: Context<State>,
  ): Effect.Effect<Response | PageResponse<Data>, unknown, R>;
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
    Handlers extends EffectRouteHandler<Data, State, R> = EffectRouteHandler<
      Data,
      State,
      R
    >,
  >(handlers: Handlers): typeof handlers;
}

/**
 * Create a typed define wrapper for Effect route handlers.
 *
 * This is type-only — no runtime setup is performed. The ManagedRuntime is
 * managed by `EffectApp` (created via `createEffectApp`). Use `createEffectDefine`
 * to constrain route handler types to only use services provided by the Layer
 * passed to `createEffectApp`.
 *
 * The `handlers()` method is an identity function — all type enforcement is
 * at compile time via the R type parameter.
 *
 * @typeParam State The type of the Fresh context state object
 * @typeParam R The service requirements — must match what the Layer provides
 *
 * @example
 * ```typescript
 * const define = createEffectDefine<AppState, typeof DbService>();
 * ```
 */
export function createEffectDefine<State = unknown, R = never>(): EffectDefine<
  State,
  R
> {
  return {
    handlers(handlers) {
      return handlers;
    },
  };
}
