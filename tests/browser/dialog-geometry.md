# Dialog geometry contract

Phase `1.8.0.12` owns findings UX-06, UX-07 and UX-25. The implementation starts from
`574a0b5b2034903b4d33ed0ff6e4a188a540e5ac` on `fix/library-visual-stability`, with a clean
worktree, and continues on `refactor/dialog-feedback-lifecycle`.

## Layout ownership

`Dialog` owns the title, primary scrolling body, optional bounded feedback slot and persistent
actions. `useModalDialogLifecycle` continues to own native `showModal()`, Escape, backdrop dismissal
and focus return. Feature components retain their existing validation, requests and writeback rules.

| Content                                             | Sizing and feedback                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add EPUB, Move, Rename, folder forms, bulk metadata | Content-sized shell capped by the viewport. Feedback shares the action row at ordinary text sizes, then stacks above actions when the container cannot accommodate both. |
| Metadata and cover editors                          | Shared viewport-bounded workspace. Pending changes and writeback messages scroll in a reserved feedback area independently of the primary form.                          |

Descriptions belong to the scrolling body so explanatory text cannot consume the fixed title and
action areas. The shared slots replace the feature-specific panel grids and nested scrolling
wrappers. Native textareas and select popovers retain their own content-specific behavior.

Folder forms use the example placeholder `e.g. Fiction`. Filename and folder inputs retain native
`required` semantics, submit validation, `aria-invalid` and linked error text without a visible
`Required` suffix.

## Reproduction and coverage

Build the fixture, then run its scoped browser suite:

```powershell
npx vite build --config tests/browser/dialog-geometry-build.config.ts
npx playwright test --config tests/browser/dialog-geometry.config.ts
```

The fixture uses production dialog components and CSS, synthetic books, a valid generated image
preview, a mocked image picker and explicitly released operation promises. It performs no real EPUB
or archive mutation. The built fixture stays under ignored `.scratch/dialog-geometry-build`.

The browser checks cover:

- Metadata pending changes at 0, 1 and many fields; long descriptions and multilingual titles;
  pending, failed, retried and successful writes at 1100 x 900 and 480 x 520, with 100% and 200%
  root text size.
- Add EPUB, Move, Rename, folder and bulk-edit failures and retries; cover preparation and write
  failures, recovery, successful write and cache warnings.
- Stable outer rectangles and header/action-row Y and height. Busy-label width is deferred to
  phase `1.8.0.14`, rather than being concealed by a fixed button width here.
- Keyboard access to the body and feedback scrollbars, native modal containment, associated
  validation, focus return, Cancel, Escape and backdrop dismissal.
- App motion on/off and system reduced motion. Existing entrance motion remains unchanged.
- Desktop compactness for empty Add EPUB, Create/Rename folder, Rename file, Move and small bulk
  edits. The final short-form action gap is bounded by ordinary control spacing, not a blank
  editor viewport. The Create folder check also exercises validation without a geometry change.

Chromium may let Tab reach browser chrome, where `document.hasFocus()` becomes false. The test
allows that native behavior while rejecting focus on background document controls.

In restricted environments that cannot stop Playwright's server child process reliably, start the
preview server separately and run with the existing external-server convention:

```powershell
node node_modules/vite/bin/vite.js preview --config tests/browser/dialog-geometry-build.config.ts --host 127.0.0.1 --port 4282 --strictPort
# In a second terminal:
$env:ARCHEION_UI_EXTERNAL_SERVER = '1'
npx playwright test --config tests/browser/dialog-geometry.config.ts
```

## Baseline evidence and limits

Before production edits, the browser probe reproduced a metadata action-row jump from Y=392 to
Y=441 at 480 x 520 and 200% text size. A synthetic long Add EPUB failure grew the baseline outer
height from 433.75 to 500 pixels and moved the action row from Y=415.875 to Y=689.25, outside the
visible dialog.

The initial implementation reserved too much empty space. User screenshots prompted a correction:
short forms now size to content and share the bottom row with feedback. The final desktop Create
folder capture measured approximately 227 pixels tall with a 22-pixel input-to-action gap. The
compactness checks guard this separately from geometry stability, since a stable oversized dialog
is not an acceptable result.

The shared body introduces another keyboard-scroll target. The keyboard-shortcut component test
now selects its actual capture control instead of assuming the first `tabindex=0` element in any
dialog is the chord capture target.

These are browser DOM and component results. Packaged Windows/WebView2, physical DPI/input,
screen-reader announcement quality, real file operations and integrated release acceptance were
not exercised by this fixture. Native verification remains with phase `1.8.0.20`.

Cover acknowledgement removal, shared busy feedback, lazy-surface mounting, exit lifetime,
backdrop treatment and radius-token changes remain deferred to their planned phases. No application
version, backend, storage schema, writeback safety or remote branch state is changed here.
