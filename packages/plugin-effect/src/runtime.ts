import { Layer, ManagedRuntime } from "effect";

/**
 * Create a ManagedRuntime from a Layer. Called once at effectPlugin() setup
 * time — NOT per-request. The ManagedRuntime caches built services via its
 * internal memo map.
 */
export function makeRuntime<R, E>(
  layer: Layer.Layer<R, E, never>,
): ManagedRuntime.ManagedRuntime<R, E> {
  return ManagedRuntime.make(layer);
}

/**
 * Register ManagedRuntime disposal on Deno's unload event.
 * Fresh has no app lifecycle hooks, so this is the only cleanup mechanism.
 * dispose() returns Promise<void> — fire-and-forget in unload handler.
 */
export function registerDisposal(
  runtime: ManagedRuntime.ManagedRuntime<unknown, unknown>,
): void {
  globalThis.addEventListener("unload", () => {
    runtime.dispose().catch(() => {});
  });
}
