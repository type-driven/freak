import { type Layer, ManagedRuntime } from "effect";

/**
 * Create a ManagedRuntime from a Layer. Called once at createEffectApp() setup
 * time — NOT per-request. The ManagedRuntime caches built services via its
 * internal memo map.
 */
export function makeRuntime<R, E>(
  layer: Layer.Layer<R, E, never>,
): ManagedRuntime.ManagedRuntime<R, E> {
  return ManagedRuntime.make(layer);
}

/**
 * Register a dispose function to run on SIGINT and SIGTERM signals.
 * Returns a cleanup function that removes the signal listeners (for testing).
 *
 * Uses signal handlers instead of the `unload` event — signals fire reliably
 * on Deno.serve shutdown and are the idiomatic lifecycle mechanism for v2.
 */
export function registerSignalDisposal(
  disposeFn: () => Promise<void>,
): () => void {
  function onSignal(): void {
    Deno.removeSignalListener("SIGINT", onSignal);
    if (Deno.build.os !== "windows") {
      Deno.removeSignalListener("SIGTERM", onSignal);
    }
    void (async () => {
      try {
        await disposeFn();
      } catch (_) {
        // best-effort
      } finally {
        Deno.exit(0);
      }
    })();
  }

  Deno.addSignalListener("SIGINT", onSignal);
  if (Deno.build.os !== "windows") {
    Deno.addSignalListener("SIGTERM", onSignal);
  }

  return () => {
    Deno.removeSignalListener("SIGINT", onSignal);
    if (Deno.build.os !== "windows") {
      Deno.removeSignalListener("SIGTERM", onSignal);
    }
  };
}
