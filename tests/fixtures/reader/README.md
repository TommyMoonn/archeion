# Synthetic Reader EPUB fixtures

These six EPUBs contain original test prose and a locally authored SVG diagram. They use no private files, publisher media, downloaded fonts, publication scripts, or external resource requests. The code and content follow the repository's GPL-3.0-only license. Change the authored inputs in `readerFixtures.ts`, not generated archives.

| Fixture           | Artificial structure and purpose                                                                                  | Expected fixture output                                                                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `short-cover`     | Image-only cover, short next entry, longer continuation. Models the first-boundary height change in the audit.    | Three spine entries. Cover height changes from 1317 to 933 CSS px on request after display. At a 750px viewport the cover leaves about 183px of range.                                         |
| `reverse-prepend` | Four sections with sharply different heights. Previous sections exceed a viewport and have stable IDs.            | `previous-tall-image` can grow from 1600 to 2100px and shrink again after rendering. `current-anchor` identifies the intended passage independently of numeric scroll position.                |
| `image-only`      | `.center` markup intentionally misses the publisher's `#center` CSS selector.                                     | First section contains a 420 × 560px standalone illustration. A separate section contains float, grid, flex, figure/caption and image-map counterexamples whose composition must be preserved. |
| `nested-prose`    | Ordinary text/dialogue inside article/div/section wrappers with an offset publisher root and indented paragraphs. | Poetry, epigraph, scene break, RTL, ruby, list, blockquote, table, figure caption, linked image and bidirectional footnote links coexist without flattening.                                   |
| `long-spine`      | Forty-two small sections, with nontrivial media in section 21.                                                    | Each section has a distinct `section-NN-anchor`, searchable prose and paragraph IDs for later bookmark/highlight/remount tests.                                                                |
| `fixed-layout`    | Two composed pages with EPUB `rendition:layout=pre-paginated`, viewport metadata and absolute positioning.        | Real fixed-layout detection, deliberately offset artwork/text, and a working link to page two. No reflowable styling is applied by the load surface.                                           |

The image height mutations model delayed **sizing**, not delayed network delivery or decoder timing. They run from the parent test surface after `rendition.display()` and do not execute scripts inside the publication. The stock profile does not compensate scrolling, patch the manager, or force adjacent loading. Real boundary/anchor/input diagnostics are documented in [the browser harness guide](../../browser/reader-runtime.md). Windows WebView2 measurements remain separate work.

## Regenerate and verify

From the repository root, after `npm ci`:

```powershell
node --experimental-strip-types tests/fixtures/reader/generate.mjs
npm run test -- tests/fixtures/reader/readerFixtures.test.ts
npm run test:browser -- tests/browser/reader-epub-fixtures.pw.ts
```

The generator validates and writes six `.epub` files to ignored `.scratch/reader-fixtures/`. Node 22.13+ supports the explicit type-stripping flag. Browser tests regenerate the same inputs in memory using the existing Vite and Playwright conventions; checked-in binary copies are unnecessary.

Archives use fixed UTC timestamps, stable entry order, DOS ZIP metadata, and deterministic JSZip compression. `mimetype` is the first entry, stored uncompressed without extra fields. Repeated generation must match byte for byte, including across process runs with the locked dependency versions.

The chosen verification level checks ZIP headers/CRC, strict XML parsing, container/OPF, EPUB 3 namespaces and required metadata, unique manifest/spine links, extension/media-type agreement, local asset and fragment references, CSS URLs, TOC coverage and expected spine counts. Negative tests corrupt representative entries. This is fixture-level verification, not a claim of full EPUBCheck conformance.

## Inspect in the real renderer

Run `npm run dev -- --host 127.0.0.1`, then open:

```text
/tests/browser/fixtures/reader-epub.html?fixture=short-cover&flow=continuous
/tests/browser/fixtures/reader-epub.html?fixture=reverse-prepend&flow=continuous&section=2
/tests/browser/fixtures/reader-epub.html?fixture=image-only
/tests/browser/fixtures/reader-epub.html?fixture=fixed-layout
```

The default surface uses Paged mode with no spread. `flow=continuous` selects the stock continuous manager for reflowable books; fixed layout retains Paged mode. It renders actual ZIP bytes with the installed epub.js in managed iframes. The default stock profile applies no production Reader styling or manager overrides. Explicit `profile=archeion` applies the current production layout, content registry, Continuous stabilization and wheel forwarding for integration comparisons.

After the status shows loaded, `window.readerFixture.display(index)` displays a known spine section. `window.readerFixture.changeImageSize()` applies the recorded delayed size; an explicit height supports grow/shrink experiments. The corresponding image section must be mounted. These commands are fixture controls, not evidence that current Reader scrolling defects are fixed.
