# App settings contract fixtures

`v4.json` is the shared persisted-settings contract consumed by the TypeScript and Rust
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

Version 3 adds independent application font roles. Legacy motion-only Appearance payloads
retain both default stacks. Family labels are bounded to 256 Unicode code points, trimmed,
and rejected if they contain control characters. Installed availability never changes storage.

Version 4 models Reader fonts as builtin or system selections. All five legacy strings migrate
to builtin IDs; unknown strings fall back to Book serif. Reader and application families share
validation and preserve unavailable labels independently of the installed catalog.
