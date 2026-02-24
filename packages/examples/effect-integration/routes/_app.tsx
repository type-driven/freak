import { asset } from "@fresh/core/runtime";
import type { PageProps } from "@fresh/core";

export default function App({ Component }: PageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Fresh + Effect v4 Example</title>
        <link rel="stylesheet" href={asset("/styles.css")} />
      </head>
      <body class="bg-gray-50 min-h-screen">
        <Component />
      </body>
    </html>
  );
}
