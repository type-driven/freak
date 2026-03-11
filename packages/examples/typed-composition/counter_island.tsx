/** @jsxImportSource preact */

import type { VNode } from "preact";

/**
 * CounterIsland — static SSR component registered via app.islands().
 *
 * Kept in its own file (separate from counter_plugin.tsx) so the Fresh bundler
 * does NOT pull effect/Schema into the client bundle. Schema is only needed
 * server-side (for Atom.serializable in counter_plugin.tsx).
 *
 * This component receives its initial value as a prop from the server — it does
 * not call useAtom() client-side. For client-side reactivity, move the atom
 * import here and use useAtom from "@fresh/core/effect/island".
 */
export function CounterIsland({ initial }: { initial: number }): VNode {
  return (
    <div class="counter-island">
      <p>Count: {initial}</p>
    </div>
  );
}
