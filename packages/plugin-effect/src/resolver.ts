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

    // Failure path — delegate to mapError or throw for Fresh error page
    if (options.mapError) {
      return options.mapError(exit.cause);
    }

    // Default: throw the cause. This propagates through Fresh's middleware
    // chain to segmentMiddleware's catch block, which renders _error.tsx
    // if one exists, or to DEFAULT_ERROR_HANDLER in app.ts.
    throw exit.cause;
  };
}
