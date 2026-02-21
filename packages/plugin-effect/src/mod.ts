/**
 * @module
 * Fresh plugin for Effect v4 integration.
 *
 * Usage:
 * ```typescript
 * import { effectPlugin } from "@fresh/plugin-effect";
 * import { AppLayer } from "./layers.ts";
 *
 * app.use(effectPlugin({ layer: AppLayer }));
 * // or zero-config:
 * app.use(effectPlugin());
 * ```
 */

import { Layer } from "effect";
import type { Layer as LayerType } from "effect";
import type { ManagedRuntime as ManagedRuntimeType } from "effect";
import type { Context } from "@fresh/core";
import { setEffectResolver } from "@fresh/core/internal";
import { makeRuntime, registerDisposal } from "./runtime.ts";
import { createResolver, type ResolverOptions } from "./resolver.ts";

/**
 * Configuration options for effectPlugin().
 *
 * @template R - The service requirements type from the Layer
 * @template E - The error type from Layer construction
 */
export interface EffectPluginOptions<R = never, E = never> {
  /**
   * The Effect Layer providing services to route handlers.
   * If omitted, Layer.empty is used (zero-config path).
   */
  layer?: LayerType.Layer<R, E, never>;

  /**
   * Optional error mapper. When an Effect handler fails, this function
   * receives the Cause and should return a Response. If omitted, the
   * failure cause is re-thrown as a standard error, which Fresh routes
   * to its error page (_error.tsx) or DEFAULT_ERROR_HANDLER.
   */
  mapError?: (cause: unknown) => Response;
}

/**
 * Create a Fresh middleware that integrates Effect v4.
 *
 * This function:
 * 1. Creates a ManagedRuntime singleton from the provided Layer (or Layer.empty)
 * 2. Registers the Effect resolver in Fresh core via setEffectResolver()
 * 3. Returns a middleware that attaches the runtime to ctx.state.effectRuntime
 * 4. Registers disposal of the ManagedRuntime on Deno's unload event
 *
 * The ManagedRuntime is created ONCE at this call site. It is NOT created
 * per-request. Services from the Layer are cached after first use.
 *
 * @example Zero-config (no services)
 * ```typescript
 * app.use(effectPlugin());
 * ```
 *
 * @example With a service Layer
 * ```typescript
 * app.use(effectPlugin({ layer: AppLayer }));
 * ```
 *
 * @example With custom error mapping
 * ```typescript
 * app.use(effectPlugin({
 *   layer: AppLayer,
 *   mapError: (cause) => new Response("Something went wrong", { status: 500 }),
 * }));
 * ```
 */
export function effectPlugin<R = never, E = never>(
  options: EffectPluginOptions<R, E> = {},
): (ctx: Context<unknown>) => Response | Promise<Response> {
  // 1. Create ManagedRuntime — singleton, called once here
  const layer = options.layer ?? Layer.empty;
  // deno-lint-ignore no-explicit-any
  const runtime = makeRuntime(layer as LayerType.Layer<any, any, never>);

  // 2. Register Effect resolver in Fresh core
  const resolverOptions: ResolverOptions = {};
  if (options.mapError) {
    resolverOptions.mapError = options.mapError;
  }
  const resolver = createResolver(runtime, resolverOptions);
  setEffectResolver(resolver);

  // 3. Register disposal on unload
  registerDisposal(
    runtime as ManagedRuntimeType.ManagedRuntime<unknown, unknown>,
  );

  // 4. Return middleware that attaches runtime to ctx.state
  return (ctx: Context<unknown>): Response | Promise<Response> => {
    (ctx.state as Record<string, unknown>).effectRuntime = runtime;
    return ctx.next();
  };
}

// createEffectDefine: typed define wrapper for Effect route handlers
export { createEffectDefine } from "./define.ts";
export type {
  CreateEffectDefineOptions,
  EffectDefine,
  EffectHandlerByMethod,
  EffectHandlerFn,
  EffectRouteHandler,
} from "./define.ts";

// Re-export utilities and types
export { isEffect } from "./resolver.ts";
export type { Layer, ManagedRuntime } from "./types.ts";
