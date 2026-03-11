import { useAtom } from "@fresh/core/effect/island-atoms";
import { counterAtom } from "../atoms.ts";

export default function Counter() {
  const [count, setCount] = useAtom(counterAtom);
  return (
    <div>
      <p>Count: {count}</p>
      <button type="button" onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
