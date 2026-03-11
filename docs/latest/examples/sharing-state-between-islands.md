---
description: |
  When you need to have state shared between islands, this page provides a few recipes.
---

Each island is a separate Preact render root — they don't share a component
tree. These recipes cover the main patterns for coordinating state between them.

## Independent Islands with Local State

For state that belongs to a single island, use `useState` from `preact/hooks`.
Each instance manages its own independent value:

```tsx islands/Counter.tsx
import { useState } from "preact/hooks";

interface CounterProps {
  start: number;
}

export default function Counter(props: CounterProps) {
  const [count, setCount] = useState(props.start);
  return (
    <div class="flex gap-2 items-center w-full">
      <p class="flex-grow-1 font-bold text-xl">{count}</p>
      <button onClick={() => setCount(count - 1)}>-1</button>
      <button onClick={() => setCount(count + 1)}>+1</button>
    </div>
  );
}
```

Instantiating several counters gives each its own state:

```tsx routes/index.tsx
<Counter start={3} />
<Counter start={4} />
```

## Shared State Between Islands

When multiple islands need to react to the same value, define a module-level
atom and import it in each island. Because atoms live at module scope, all
islands on the page share the same instance.

```ts atoms/slider.ts
import { Atom } from "effect/unstable/reactivity";

export const sliderAtom = Atom.make(50);
```

```tsx islands/SynchronizedSlider.tsx
import { useAtom } from "@fresh/core/effect/island";
import { sliderAtom } from "../atoms/slider.ts";

export default function SynchronizedSlider() {
  const [value, setValue] = useAtom(sliderAtom);
  return (
    <input
      class="w-full"
      type="range"
      min={1}
      max={100}
      value={value}
      onInput={(e) => setValue(Number(e.currentTarget.value))}
    />
  );
}
```

Rendering several instances automatically keeps them in sync — they all read and
write the same atom:

```tsx routes/index.tsx
<SynchronizedSlider />
<SynchronizedSlider />
<SynchronizedSlider />
```

## Shared State Across Unrelated Islands

The same pattern scales to islands that are far apart in the tree. Define the
atom in a shared file and import it wherever needed:

```ts atoms/cart.ts
import { Atom } from "effect/unstable/reactivity";
import { Schema } from "effect";

// Serializable atom — supports SSR hydration if needed.
// Use Atom.make([]) if you don't need server-side seeding.
export const cartAtom = Atom.serializable({
  key: "cart",
  schema: Schema.Array(Schema.String),
})([]);
```

```tsx islands/AddToCart.tsx
import { useAtom } from "@fresh/core/effect/island";
import { cartAtom } from "../atoms/cart.ts";

export default function AddToCart(props: { product: string }) {
  const [cart, setCart] = useAtom(cartAtom);
  return (
    <button onClick={() => setCart([...cart, props.product])}>
      Add{cart.includes(props.product) ? " another" : ""}{" "}
      "{props.product}" to cart
    </button>
  );
}
```

```tsx islands/Cart.tsx
import { useAtomSet, useAtomValue } from "@fresh/core/effect/island";
import { cartAtom } from "../atoms/cart.ts";

export default function Cart() {
  const cart = useAtomValue(cartAtom);
  const setCart = useAtomSet(cartAtom);

  const remove = (index: number) => {
    setCart(cart.filter((_, i) => i !== index));
  };

  return (
    <ul>
      {cart.length === 0 && <li>Your cart is empty.</li>}
      {cart.map((product, i) => (
        <li key={i}>
          {product}
          <button onClick={() => remove(i)}>✕</button>
        </li>
      ))}
    </ul>
  );
}
```

```tsx routes/cart.tsx
<AddToCart product="Lemon" />
<AddToCart product="Lime" />
<Cart />
```

Changes in either `AddToCart` island immediately reflect in the `Cart` island
because they all subscribe to the same `cartAtom`.

## SSR Hydration

If you want an island's initial state to come from the server (e.g. a pre-filled
cart from a database), use `Atom.serializable` and call `setAtom` in your route
handler:

```tsx routes/cart.tsx
import { page } from "@fresh/core";
import { setAtom } from "@fresh/core/effect";
import { define } from "@/utils.ts";
import { Effect } from "effect";
import { CartService } from "@/services/CartService.ts";
import { cartAtom } from "@/atoms/cart.ts";
import Cart from "@/islands/Cart.tsx";
import AddToCart from "@/islands/AddToCart.tsx";

export const handlers = define.handlers({
  GET: (ctx) =>
    Effect.gen(function* () {
      const svc = yield* CartService;
      const items = yield* svc.getCart(ctx.state.userId);
      setAtom(ctx, cartAtom, items); // serialized into HTML, hydrates islands instantly
      return page();
    }),
});

export default define.page(() => (
  <>
    <AddToCart product="Lemon" />
    <AddToCart product="Lime" />
    <Cart />
  </>
));
```

The atom value is embedded in a `<script>` tag and read by the island module
before first render — no loading state, no flash of empty content.
