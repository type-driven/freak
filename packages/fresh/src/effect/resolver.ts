import { Effect, Exit, type ManagedRuntime } from "effect";
import { HttpError } from "../error.ts";

/**
 * Check whether a value is an Effect, using the official Effect.isEffect guard.
 */
export function isEffect(value: unknown): boolean {
  return Effect.isEffect(value);
}

export interface ResolverOptions {
  /**
   * Custom error mapper for Effect failures. Receives `exit.cause` which is
   * an Effect `Cause<E>` value — a structured wrapper around the failure, NOT
   * a plain Error. Use `Cause.squash(cause)` or pattern-match on the Cause
   * variants (Fail, Die, Interrupt) to extract the underlying error.
   *
   * The default behavior throws `HttpError(500)` without exposing the Effect
   * Cause. Provide `mapError` to log or transform the cause.
   *
   * The callback may also throw (e.g., `throw new HttpError(404)`) to
   * enter Fresh's error handling chain with a specific status code.
   */
  mapError?: (cause: unknown) => Response;
}

/**
 * Create the resolver callback that createEffectApp() wraps as an EffectRunner.
 */
export function createResolver(
  // deno-lint-ignore no-explicit-any
  runtime: ManagedRuntime.ManagedRuntime<any, any>,
  options: ResolverOptions = {},
): (value: unknown, ctx: unknown) => Promise<unknown> {
  return async (value: unknown, _ctx: unknown): Promise<unknown> => {
    if (!isEffect(value)) {
      return value;
    }

    const exit = await runtime.runPromiseExit(
      value as Effect.Effect<unknown, unknown, unknown>,
    );

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    if (options.mapError) {
      return options.mapError(exit.cause);
    }

    throw new HttpError(500, "Internal Server Error");
  };
}
