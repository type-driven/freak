import { Exit, type ManagedRuntime, type Effect } from "effect";
import { HttpError } from "@fresh/core";

/**
 * Effect v4 TypeId — verified from effect@4.0.0-beta.0 dist/internal/core.js.
 * This is a string literal in v4 (NOT Symbol.for() as in v3).
 * Re-verify this value on every effect version bump.
 */
const EFFECT_TYPE_ID = "~effect/Effect";

/**
 * Duck-type check for Effect v4 values. Uses the string key presence
 * check — no Effect import required at the call site.
 */
export function isEffect(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    EFFECT_TYPE_ID in (value as object)
  );
}

export interface ResolverOptions {
  /**
   * Custom error mapper for Effect failures. Receives `exit.cause` which is
   * an Effect `Cause<E>` value — a structured wrapper around the failure, NOT
   * a plain Error. Use `Cause.squash(cause)` or pattern-match on the Cause
   * variants (Fail, Die, Interrupt) to extract the underlying error.
   *
   * If omitted, the resolver throws `HttpError(500)` which Fresh routes
   * to its error page (`_error.tsx`). The Cause is preserved in
   * `error.cause` for server-side logging.
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
    // Cause is preserved in error.cause for server-side inspection.
    throw new HttpError(500, "Internal Server Error", { cause: exit.cause });
  };
}
