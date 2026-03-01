/** @jsxImportSource preact */

export default function IndexPage() {
  return (
    <html>
      <head>
        <title>Typed Composition Demo</title>
      </head>
      <body>
        <h1>Typed Composition Demo</h1>
        <p>Two plugins mounted on one EffectApp with typed AuthState.</p>
        <ul>
          <li><a href="/counter/count">GET /counter/count</a> — CounterPlugin JSON</li>
          <li><a href="/greeting/greet">GET /greeting/greet</a> — GreetingPlugin JSON</li>
        </ul>
      </body>
    </html>
  );
}
