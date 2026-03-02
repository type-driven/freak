/** @jsxImportSource preact */

import type { VNode } from "preact";

/**
 * GreetIsland — static SSR component registered via app.islands().
 *
 * Kept in its own file (separate from greeting_plugin.tsx) so the Fresh bundler
 * does NOT pull effect/Schema into the client bundle. Schema is only needed
 * server-side (for Atom.serializable in greeting_plugin.tsx).
 */
export function GreetIsland({ message }: { message: string }): VNode {
  return (
    <div class="greet-island">
      <p>{message}</p>
    </div>
  );
}
