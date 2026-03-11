/** @jsxImportSource preact */

import type { VNode } from "preact";
import { useState } from "preact/hooks";
import { useAtom } from "@fresh/core/effect/island";
import { greetingAtom, platformStatusAtom } from "./shared_atoms.ts";

/**
 * GreetIsland — reactive island that shares state with CounterIsland.
 */
export function GreetIsland(
  { apiBase }: { apiBase: string },
): VNode {
  const [greeting, setGreeting] = useAtom(greetingAtom);
  const [platformStatus, setPlatformStatus] = useAtom(platformStatusAtom);
  const [name, setName] = useState("World");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshGreeting() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const query = new URLSearchParams({ name }).toString();
      const res = await fetch(`${apiBase}/greet?${query}`);
      if (!res.ok) {
        setError(`Request failed (${res.status})`);
        return;
      }
      const body = await res.json() as {
        greeting: string;
        name: string;
        requestId: string;
      };
      setGreeting(body.greeting);
      setPlatformStatus(`client:greeting:${body.name}:${body.requestId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div class="greet-island" style="border: 1px solid #ddd; padding: 1rem;">
      <h3>Greeting Sub-App</h3>
      <p>{greeting || "No greeting yet"}</p>
      <div style="display: flex; gap: 0.5rem; align-items: center;">
        <input
          type="text"
          value={name}
          onInput={(e) =>
            setName((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="button" disabled={pending} onClick={refreshGreeting}>
          refresh
        </button>
      </div>
      <p style="font-size: 0.875rem; color: #555; margin-top: 0.5rem;">
        Shared status: {platformStatus}
      </p>
      {error && <p style="color: #b00020;">{error}</p>}
    </div>
  );
}
