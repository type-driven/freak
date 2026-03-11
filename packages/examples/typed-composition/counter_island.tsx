/** @jsxImportSource preact */

import type { VNode } from "preact";
import { useState } from "preact/hooks";
import { useAtom } from "@fresh/core/effect/island";
import { counterAtom, platformStatusAtom } from "./shared_atoms.ts";

/**
 * CounterIsland — reactive island backed by shared atoms.
 * Demonstrates plugin-local actions mutating cross-plugin shared state.
 */
export function CounterIsland(
  { apiBase }: { apiBase: string },
): VNode {
  const [count, setCount] = useAtom(counterAtom);
  const [platformStatus, setPlatformStatus] = useAtom(platformStatusAtom);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mutate(action: "increment" | "reset") {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const endpoint = action === "increment" ? "/increment" : "/reset";
      const res = await fetch(`${apiBase}${endpoint}`, { method: "POST" });
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      const body = await res.json() as { count: number };
      setCount(body.count);
      setPlatformStatus(`client:${action}:${body.count}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div class="counter-island" style="border: 1px solid #ddd; padding: 1rem;">
      <h3>Counter Sub-App</h3>
      <p>Count: {count}</p>
      <div style="display: flex; gap: 0.5rem;">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            mutate("increment")}
        >
          +1
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            mutate("reset")}
        >
          reset
        </button>
      </div>
      <p style="font-size: 0.875rem; color: #555; margin-top: 0.5rem;">
        Shared status: {platformStatus}
      </p>
      {error && <p style="color: #b00020;">{error}</p>}
    </div>
  );
}
