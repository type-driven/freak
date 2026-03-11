/**
 * Typed define wrapper for Effect route handlers.
 *
 * `createEffectDefine<State, R>()` mirrors `createDefine<State>()` but adds an
 * `R` type parameter that constrains handler Effect return types.
 */

import type { Context } from "../context.ts";
import type { Method } from "../router.ts";
import type { PageResponse } from "../handlers.ts";
import type { Effect } from "effect";

/**
 * A handler function that returns an Effect with the given service requirements R.
 */
export interface EffectHandlerFn<Data, State, R> {
  (
    ctx: Context<State>,
  ): Effect.Effect<Response | PageResponse<Data>, unknown, R>;
}

/**
 * A map of HTTP method names to Effect handler functions.
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
