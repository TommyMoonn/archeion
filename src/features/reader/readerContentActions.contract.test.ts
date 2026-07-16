import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("reader content action contract", () => {
  it("keeps content classification, resolution, session navigation, and presentation separate", () => {
    const session = read("src/features/reader/useEpubSession.ts");
    const registry = read("src/features/reader/readerContentDocumentRegistry.ts");
    const controller = read("src/features/reader/useEpubContentActionController.ts");
    const resolver = read("src/features/reader/epubFootnoteResolver.ts");
    const popover = read("src/features/reader/ReaderFootnotePopover.tsx");
    const illustrationInteraction = read("src/features/reader/readerIllustrationInteraction.ts");
    const illustrationInteractionHook = read(
      "src/features/reader/useReaderIllustrationInteraction.ts",
    );
    const illustrationViewer = read("src/features/reader/ReaderIllustrationViewer.tsx");
    const illustrationExport = read("src/features/reader/readerIllustrationExportFile.ts");
    const illustrationImages = read("src/features/reader/epubIllustrationImage.ts");
    const contentActions = read("src/features/reader/epubContentActions.ts");
    const footnoteResolver = read("src/features/reader/epubFootnoteResolver.ts");

    expect(session).not.toMatch(
      /classifyEpubLink|resolveEpubFootnote|ReaderFootnotePopover|ReaderIllustrationViewer/,
    );
    expect(registry).not.toMatch(/classifyEpubLink|resolveEpubFootnote|openExternalEpubLink/);
    expect(controller).toContain("navigateToTarget");
    expect(controller).toContain("footnoteRef.current?.anchor");
    expect(popover).not.toContain("event.currentTarget");
    expect(resolver).not.toMatch(/from ["']react["']|ReaderFootnotePopover/);
    expect(illustrationInteraction).not.toMatch(/from ["']react["']|HTMLCanvasElement|WebGL/);
    expect(illustrationViewer).toContain("useReaderIllustrationInteraction");
    expect(illustrationViewer).not.toContain("onWheelCapture");
    expect(illustrationInteractionHook).toContain('dialog.addEventListener("wheel"');
    expect(illustrationInteractionHook).toContain("capture: true, passive: false");
    expect(illustrationViewer).not.toMatch(
      /calculateIllustrationFitScale|preserveIllustrationFocalPoint|archive\.getBlob/,
    );
    expect(illustrationViewer).not.toMatch(/plugin-dialog|invoke\(|archive\.getBlob|arrayBuffer/);
    expect(illustrationExport).toContain("resource.blob.arrayBuffer()");
    expect(illustrationExport).not.toMatch(/fetch\(|createObjectURL|<a|download=/);
    expect(contentActions).toContain("epubIllustrationImageTypeForExtension");
    expect(footnoteResolver).toContain("epubIllustrationImageTypeForExtension");
    expect(illustrationImages).toContain("IMAGE_TYPE_BY_EXTENSION");
    expect(contentActions).not.toContain("ILLUSTRATION_EXTENSIONS");
    expect(footnoteResolver).not.toContain("SAFE_FOOTNOTE_IMAGE_EXTENSIONS");
  });

  it("uses semantic reader tokens and introduces no history or content plugin framework", () => {
    const css = read("src/styles/features/reader-content-actions.css");
    const production = [
      "src/features/reader/epubContentActions.ts",
      "src/features/reader/epubLocalDocumentResolver.ts",
      "src/features/reader/epubFootnoteResolver.ts",
      "src/features/reader/useEpubContentActionController.ts",
      "src/features/reader/ReaderFootnotePopover.tsx",
      "src/features/reader/ReaderExternalLinkDialog.tsx",
      "src/features/reader/ReaderIllustrationViewer.tsx",
      "src/features/reader/readerIllustrationInteraction.ts",
      "src/features/reader/useReaderIllustrationInteraction.ts",
    ]
      .map(read)
      .join("\n");

    expect(css).toMatch(/var\(--reader-(?:bg|surface|line|text|strong|muted|focus|danger)\)/);
    expect(css).toMatch(/\.reader-footnote[\s\S]*max-height:/);
    expect(css).toMatch(/\.reader-footnote__content[\s\S]*overflow: auto/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(/i);
    expect(production).not.toMatch(/navigationHistory|historyStack|readerPlugin|contentPlugin/);
    expect(production).not.toMatch(/window\.open|<iframe|createElement\(["']iframe["']\)/);
  });

  it("registers one narrowly validated native external URL command", () => {
    const classifier = read("src/features/reader/epubContentActions.ts");
    const command = read("src-tauri/src/commands/external.rs");
    const modules = read("src-tauri/src/commands/mod.rs");
    const handler = read("src-tauri/src/lib.rs");

    expect(classifier).toContain("hasAsciiControlCharacter(input.href)");
    expect(classifier).toContain("code <= 0x1f || code === 0x7f");
    expect(command).toContain('SUPPORTED_SCHEMES: [&str; 2] = ["http", "https"]');
    expect(command).toContain("has_explicit_network_authority");
    expect(command).toContain(".find(['/', '?', '#'])");
    expect(command).toContain("byte.is_ascii_control()");
    expect(command).toContain("url.host_str().is_none()");
    expect(command).toContain("url.username().is_empty()");
    expect(modules).toContain("pub mod external;");
    expect(handler).toContain("commands::external::open_external_url");
  });

  it("keeps illustration export binary, bounded, and explicitly save-capable", () => {
    const exportFile = read("src/features/reader/readerIllustrationExportFile.ts");
    const writer = read("src-tauri/src/commands/illustration_export.rs");
    const imageContract = read("shared/illustration-image-contract.json");
    const frontendImageContract = read("src/features/reader/epubIllustrationImage.ts");
    const handler = read("src-tauri/src/lib.rs");
    const capability = read("src-tauri/capabilities/default.json");

    expect(exportFile).toContain('dependencies.invoke("write_illustration_image_file", contents');
    expect(exportFile).toContain("resource.blob.arrayBuffer()");
    expect(writer).toContain("tauri::ipc::InvokeBody::Raw(contents)");
    expect(writer).toContain("tauri::async_runtime::spawn_blocking");
    expect(writer).toContain('include_str!("../../../shared/illustration-image-contract.json")');
    expect(frontendImageContract).toContain(
      'from "../../../shared/illustration-image-contract.json"',
    );
    expect(JSON.parse(imageContract)).toHaveProperty("maximumBytes", 33_554_432);
    expect(writer).not.toMatch(/enum IllustrationImageMediaType|32\s*\*\s*1024\s*\*\s*1024/);
    expect(handler).toContain("commands::illustration_export::write_illustration_image_file");
    expect(capability).toContain('"dialog:allow-save"');
  });
});
