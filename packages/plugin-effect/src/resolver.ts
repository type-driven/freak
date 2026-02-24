import { Exit, type ManagedRuntime, type Effect } from "effect";

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
   * If omitted, the resolver throws a standard Error with the Cause preserved
   * in `error.cause`, which Fresh routes to its error page (_error.tsx) or
   * DEFAULT_ERROR_HANDLER (returns 500).
   */
  mapError?: (cause: unknown) => Response;
}

/**
 * Create the resolver callback that effectPlugin() registers via
 * setEffectResolver(). The resolver:
 * 1. Checks if the handler return value is an Effect (via isEffect)
 * 2. If not, returns the value unchanged (pass-through)
 * 3. If yes, runs it via runtime.runPromiseExit
 * 4. On success, returns the unwrapped value
 * 5. On failure, delegates to mapError or re-throws for Fresh error page
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

    // Default: throw a generic Error with Cause preserved in error.cause.
    // The message is intentionally generic — Cause details must not leak
    // to the browser (e.g., via Fresh's dev error overlay). Server-side
    // code (_error.tsx) can inspect error.cause for structured logging.
    const error = new Error("Effect handler failure");
    error.cause = exit.cause;
    throw error;
  };
}
