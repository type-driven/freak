/**
 * @module
 * Fresh plugin for Effect v4 integration.
 *
 * Usage:
 * ```typescript
 * import { effectPlugin } from "@fresh/plugin-effect";
 * import { App } from "@fresh/core";
 * import { AppLayer } from "./layers.ts";
 *
 * const app = new App();
 * app.use(effectPlugin(app, { layer: AppLayer }));
 * // or zero-config:
 * app.use(effectPlugin(app));
 * ```
 */

import { Layer } from "effect";
import type { Layer as LayerType } from "effect";
import type { ManagedRuntime as ManagedRuntimeType } from "effect";
import type { App, Context } from "@fresh/core";
import { setAtomHydrationHook, setEffectRunner } from "@fresh/core/internal";
import type { EffectRunner } from "@fresh/core/internal";
import { makeRuntime, registerDisposal } from "./runtime.ts";
import { createResolver, type ResolverOptions } from "./resolver.ts";
import { initAtomHydrationMap, serializeAtomHydration } from "./hydration.ts";

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
 * 2. Registers the Effect runner on the given App instance via setEffectRunner()
 * 3. Returns a middleware that attaches the runtime to ctx.state.effectRuntime
 * 4. Registers disposal of the ManagedRuntime on Deno's unload event
 *
 * The ManagedRuntime is created ONCE at this call site. It is NOT created
 * per-request. Services from the Layer are cached after first use.
 *
 * The `app` argument is required to register the runner per-app, enabling
 * isolation between multiple App instances in the same process.
 *
 * @example Zero-config (no services)
 * ```typescript
 * app.use(effectPlugin(app));
 * ```
 *
 * @example With a service Layer
 * ```typescript
 * app.use(effectPlugin(app, { layer: AppLayer }));
 * ```
 *
 * @example With custom error mapping
 * ```typescript
 * app.use(effectPlugin(app, {
 *   layer: AppLayer,
 *   mapError: (cause) => new Response("Something went wrong", { status: 500 }),
 * }));
 * ```
 */
export function effectPlugin<R = never, E = never>(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  options: EffectPluginOptions<R, E> = {},
): (ctx: Context<unknown>) => Response | Promise<Response> {
  // 1. Create ManagedRuntime — singleton, called once here
  const layer = options.layer ?? Layer.empty;
  // deno-lint-ignore no-explicit-any
  const runtime = makeRuntime(layer as LayerType.Layer<any, any, never>);

  // 2. Build resolver options and runner
  const resolverOptions: ResolverOptions = {};
  if (options.mapError) {
    resolverOptions.mapError = options.mapError;
  }
  const resolver = createResolver(runtime, resolverOptions);

  // Wrap createResolver output as EffectRunner for setEffectRunner API.
  // The resolver already handles the isEffect check and runs through ManagedRuntime.
  const runner: EffectRunner = (value, ctx) => resolver(value, ctx) as Promise<unknown>;

  // 3. Register Effect runner per-app instance (enables per-app isolation)
  setEffectRunner(app, runner);

  // 4. Register atom hydration hook — called by FreshRuntimeScript to get
  //    the JSON for the __FRSH_ATOM_STATE script tag
  setAtomHydrationHook((ctx) => serializeAtomHydration(ctx));

  // 5. Register disposal on unload
  registerDisposal(
    runtime as ManagedRuntimeType.ManagedRuntime<unknown, unknown>,
  );

  // 6. Return middleware that attaches runtime to ctx.state and initializes
  //    the per-request atom hydration map before the handler runs
  return (ctx: Context<unknown>): Response | Promise<Response> => {
    (ctx.state as Record<string, unknown>).effectRuntime = runtime;
    initAtomHydrationMap(ctx);
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

// Atom hydration helpers
export { setAtom } from "./hydration.ts";
