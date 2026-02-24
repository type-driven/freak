import { Builder } from "@fresh/core/dev";
import { tailwind } from "@fresh/plugin-tailwind";

const builder = new Builder({ target: "safari12" });
tailwind(builder);

if (Deno.args.includes("build")) {
  await builder.build();
} else {
  await builder.listen(() => import("./main.ts"));
}
