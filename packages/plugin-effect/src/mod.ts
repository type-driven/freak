/**
 * @module
 * Fresh plugin for Effect v4 integration.
 *
 * This module re-exports hydration helpers from @fresh/effect for backward
 * compatibility. Prefer importing from @fresh/effect directly.
 *
 * The effectPlugin() function remains here as a standalone legacy API.
 * For new projects, use createEffectApp() from @fresh/effect instead.
 */

import { Layer } from "effect";
import type { Layer as LayerType } from "effect";
import type { ManagedRuntime as ManagedRuntimeType } from "effect";
import type { App, Context } from "@fresh/core";
import { setAtomHydrationHook, setEffectRunner } from "@fresh/core/internal";
import type { EffectRunner } from "@fresh/core/internal";
import { makeRuntime, registerDisposal } from "./runtime.ts";
import { createResolver, type ResolverOptions } from "./resolver.ts";
import {
  initAtomHydrationMap as _initAtomHydrationMap,
  serializeAtomHydration as _serializeAtomHydration,
} from "./hydration.ts";

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
 * @deprecated Use `createEffectApp()` from `@fresh/effect` instead.
 */
export function effectPlugin<R = never, E = never>(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  options: EffectPluginOptions<R, E> = {},
): (ctx: Context<unknown>) => Response | Promise<Response> {
  const layer = options.layer ?? Layer.empty;
  // deno-lint-ignore no-explicit-any
  const runtime = makeRuntime(layer as LayerType.Layer<any, any, never>);

  const resolverOptions: ResolverOptions = {};
  if (options.mapError) {
    resolverOptions.mapError = options.mapError;
  }
  const resolver = createResolver(runtime, resolverOptions);

  const runner: EffectRunner = (value, ctx) => resolver(value, ctx) as Promise<unknown>;
  setEffectRunner(app, runner);
  setAtomHydrationHook((ctx) => _serializeAtomHydration(ctx));

  registerDisposal(
    runtime as ManagedRuntimeType.ManagedRuntime<unknown, unknown>,
  );

  return (ctx: Context<unknown>): Response | Promise<Response> => {
    (ctx.state as Record<string, unknown>).effectRuntime = runtime;
    _initAtomHydrationMap(ctx);
    return ctx.next();
  };
}

// createEffectDefine: typed define wrapper for Effect route handlers
// (plugin-effect version has its own signature with App + layer options)
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

// Atom hydration helpers — re-exported from @fresh/effect
export { setAtom, initAtomHydrationMap, serializeAtomHydration } from "@fresh/effect";
