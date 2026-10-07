# App settings mutation contract

`v3.json` is the shared wire-mutation corpus for the TypeScript and Rust test suites. Its
`vocabulary` lists every supported top-level area and nested field. Add a new variant there and
add a representative case when its behavior differs from existing cases. The static contract
check compares this vocabulary with both language definitions and checks that valid JSON
mutations typecheck while invalid JSON mutations do not.

Each valid sequence starts at revision 0 with the shared normalized defaults in
`../app-settings/v4.json`. Every step is a serialized mutation and an expected post-mutation
snapshot. `preferencesPatch` is applied to those defaults to make the full expected preferences.
`emittedByFrontend: false` marks a wire mutation that TypeScript would normalize away before
emitting but Rust still accepts and commits. Invalid cases must be rejected by Rust deserialization
and TypeScript's mutation type without advancing the native revision.

Increment this corpus version only for an intentional mutation wire-contract change. Do not
change the persisted-settings corpus version merely because a mutation case was added.

Version 2 extends the existing whole-Appearance value with both font selections. Native
deserialization still accepts legacy motion-only values and normalization supplies defaults.

Version 3 changes the Reader font leaf to structured selections. Native mutation deserialization
still accepts legacy font strings, but the frontend emits only the structured model.
frontendTypechecks: false identifies those accepted legacy wires, which must fail the current
frontend typecheck. Malformed structured selections are rejected in both languages.
