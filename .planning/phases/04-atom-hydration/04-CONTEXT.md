# Phase 4: Atom Hydration - Context

**Gathered:** 2026-02-23 **Status:** Ready for planning

<domain>
## Phase Boundary

Server-to-client atom serialization. An atom value set server-side inside an
Effect handler is serialized into the island's initial props and available
synchronously when the island boots on the client — no loading flash. Atoms have
stable string identifiers for cross-boundary identity.

</domain>

<decisions>
## Implementation Decisions

### Atom identity

- Duplicate atom keys (two different atoms with the same string key) must be a
  **hard error** at registration time
- Claude's discretion: key assignment mechanism (developer-assigned vs
  auto-derived), global vs per-island scoping, whether all atoms or only
  hydrated atoms need keys

### Serialization boundary

- **Extensible serializer registry** — start with JSON primitives, allow plugins
  to register custom serializers (e.g. Effect Schema types)
- Non-serializable atom values produce a **hard error at serialize time** — no
  silent omission
- Claude's discretion: whether the registry lives in Fresh core or
  plugin-effect, and how hydration data is embedded in HTML (follow Fresh's
  existing island props pattern)

### Developer ergonomics

- **Automatic hydration pickup** — if a hydrated atom matches a key used by
  `useAtom()` / `useAtomValue()`, it gets the server value. Zero boilerplate on
  the island side.
- **Same hooks** from Phase 3 — `useAtom()`, `useAtomValue()`, `useAtomSet()`
  transparently support hydration. No new hydration-aware hooks.
- **Type-safe** across the boundary — compile error if handler sets a value type
  that doesn't match the atom's type definition
- Claude's discretion: handler-side API for setting atom values (explicit
  `ctx.setAtom()` vs return-based vs other pattern)

### Hydration mismatch

- **Server wins silently** — server-hydrated value always overrides the atom's
  client-side default. No warning needed.
- **Dev warning for orphaned keys** — `console.warn` if client receives
  hydration data for an atom key that no island consumes
- Claude's discretion: hydration timing relative to first render (must prevent
  flash of default content), resilience strategy for malformed hydration data

### Claude's Discretion

- Atom key assignment mechanism (developer-assigned name, auto-generated, or
  hybrid)
- Global vs per-island atom key namespace
- Whether client-only atoms need keys or only hydrated atoms
- Serializer registry location (Fresh core vs plugin-effect)
- HTML embedding format for hydration data
- Handler-side API for setting atom values
- Hydration timing relative to island boot
- Malformed hydration data handling strategy

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow Fresh's existing
patterns for island props serialization where applicable.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

_Phase: 04-atom-hydration_ _Context gathered: 2026-02-23_
