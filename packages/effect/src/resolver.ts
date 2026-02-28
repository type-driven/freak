import { Effect, Exit, type ManagedRuntime } from "effect";
import { HttpError } from "@fresh/core";

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
 * Create the resolver callback that createEffectApp() wraps as an EffectRunner
 * and registers via setEffectRunner(). The resolver:
 * 1. Checks if the handler return value is an Effect (via isEffect)
 * 2. If not, returns the value unchanged (pass-through)
 * 3. If yes, runs it via runtime.runPromiseExit
 * 4. On success, returns the unwrapped value
 * 5. On failure, delegates to mapError or throws HttpError(500)
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

    // Cast is safe: isEffect confirmed the TypeId key exists
    const exit = await runtime.runPromiseExit(
      value as Effect.Effect<unknown, unknown, unknown>,
    );

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    // Failure path
    if (options.mapError) {
      return options.mapError(exit.cause);
    }

    // Default: throw HttpError(500) so Fresh's error handling chain
    // (_error.tsx / app.onError) renders a proper error page.
    // Raw Cause is intentionally omitted to avoid leaking sensitive internals.
    throw new HttpError(500, "Internal Server Error");
  };
}
