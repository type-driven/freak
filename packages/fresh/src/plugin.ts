import type { App } from "./app.ts";

/**
 * A typed plugin that provides routes (as App<S>), documents Effect service
 * requirements (R), and declares the host state shape it requires (S).
 *
 * R is a phantom type parameter — it exists only in the type system to
 * document what Effect services the plugin's handlers require. @fresh/core
 * never imports Effect, so R is unconstrained.
 */
export interface Plugin<Config = unknown, S = unknown, R = never> {
  readonly config: Config;
  readonly app: App<S>;
  /** Phantom type — R appears in the type system only, never at runtime. */
  readonly _phantom?: R;
}

/**
 * Create a typed plugin from a configuration object and a factory function
 * that builds an App<S>.
 *
 * @param config Plugin configuration passed to the factory
 * @param factory Function that receives config and returns an App<S>
 * @returns A Plugin<Config, S, R> that can be mounted via host.mountApp()
 */
export function createPlugin<Config, S, R = never>(
  config: Config,
  factory: (config: Config) => App<S>,
): Plugin<Config, S, R> {
  return { config, app: factory(config) };
}
