# App settings contract fixtures

`v1.json` is the shared persisted-settings contract consumed by the TypeScript and Rust
test suites.

Compatibility policy:

- Missing and invalid fields fall back independently.
- Supported legacy fields are accepted as input and migrated into their current owners.
- Unknown fields are ignored so a future writer does not invalidate recognized neighboring
  settings.
- Keyboard commands are normalized independently before deterministic effective-binding conflicts
  are resolved.
- Serialization emits only the current schema.
- Current normalized settings round-trip without semantic changes.

Increment the fixture-corpus version only when the persisted contract changes intentionally.
