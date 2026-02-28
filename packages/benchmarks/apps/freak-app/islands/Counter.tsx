import { useAtom } from "@fresh/effect/island";
import { counterAtom } from "../atoms.ts";

export default function Counter() {
  const [count, setCount] = useAtom(counterAtom);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Increment</button>
    </div>
  );
}
