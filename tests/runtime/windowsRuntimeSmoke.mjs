import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";

async function createEpubFixture(destination, chapterText = "Temporary test fixture.") {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    "OEBPS/content.opf",
    '<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:archeion:runtime-smoke</dc:identifier><dc:title>Runtime Smoke</dc:title><dc:language>en</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
  );
  zip.file(
    "OEBPS/chapter.xhtml",
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Runtime Smoke</h1><p>${chapterText}</p></body></html>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Contents</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="chapter.xhtml">Chapter</a></li></ol></nav></body></html>',
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(destination, buffer);
  return buffer;
}

async function invoke(driver, command, args = {}) {
  const result = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.__TAURI__.core.invoke(arguments[0], arguments[1])
       .then(value => done({ ok: true, value }))
       .catch(error => done({ ok: false, error: String(error) }));`,
    command,
    args,
  );
  assert.equal(result?.ok, true, `${command}: ${result?.error ?? "no IPC response"}`);
  return result.value;
}

async function waitForIpc(driver) {
  await driver.wait(
    () => driver.executeScript("return Boolean(window.__TAURI__?.core?.invoke)"),
    20_000,
    "Tauri IPC was not available in the real WebView",
  );
}

export async function runRuntimeFlows({ startSession, closeSession, fixtureRoot, logStep }) {
  const sourcePath = path.join(fixtureRoot, "smoke.epub");
  const sourceBytes = await createEpubFixture(sourcePath);
  let driver = await startSession();
  let archiveRoot;

  await logStep("launch and archive resolution", async () => {
    await waitForIpc(driver);
    const registry = await invoke(driver, "create_empty_archive", {
      parentPath: fixtureRoot,
      archiveName: "Smoke Archive",
    });
    assert.equal(registry.archives.length, 1);
    archiveRoot = registry.archives[0].rootPath;
    assert.equal(path.resolve(archiveRoot), path.join(fixtureRoot, "Smoke Archive"));
    const reopened = await invoke(driver, "open_archive", { path: archiveRoot });
    assert.equal(reopened.lastOpenedArchiveId, registry.archives[0].id);
  });

  await logStep("EPUB import and real IPC read", async () => {
    const imported = await invoke(driver, "add_epub_files_to_archive", {
      rootPath: archiveRoot,
      sourcePaths: [sourcePath],
      conflictAction: "keepBoth",
      mode: "copy",
    });
    assert.equal(imported.results.length, 1);
    assert.equal(imported.results[0].status, "imported");
    assert.equal(imported.results[0].relativePath, "smoke.epub");
    const result = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
         window.__TAURI__.core.invoke("read_epub_file", arguments[0])
           .then(bytes => {
             const data = new Uint8Array(bytes);
             done({ length: data.byteLength, signature: Array.from(data.slice(0, 4)) });
           })
           .catch(error => done({ error: String(error) }));`,
      { rootPath: archiveRoot, relativePath: "smoke.epub" },
    );
    assert.equal(result.error, undefined, result.error);
    assert.equal(result.length, sourceBytes.length);
    assert.deepEqual(result.signature, [0x50, 0x4b, 0x03, 0x04]);
  });

  await logStep("structured annotation IPC and export", async () => {
    const annotation = {
      type: "bookmark",
      id: "runtime-smoke-bookmark",
      chapterHref: "OEBPS/chapter.xhtml",
      cfiRange: "epubcfi(/6/2!/4/2)",
      label: "Runtime smoke bookmark",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const metadata = {
      version: 1,
      books: { "runtime-smoke-book": { annotations: [annotation] } },
    };
    await invoke(driver, "save_annotations_metadata", { rootPath: archiveRoot, metadata });
    assert.deepEqual(
      await invoke(driver, "load_annotations_metadata", { rootPath: archiveRoot }),
      metadata,
    );
    const exportDocument = {
      schema: "archeion.annotation-export",
      version: 1,
      exportedAt: "2026-01-01T00:00:00.000Z",
      books: [
        {
          id: "runtime-smoke-book",
          title: "Runtime Smoke",
          annotations: [{ annotation, chapterLabel: "Chapter" }],
        },
      ],
    };
    const exportPath = path.join(fixtureRoot, "annotations.json");
    await invoke(driver, "write_annotation_export_file", {
      path: exportPath,
      contents: JSON.stringify(exportDocument),
      format: "json",
    });
    assert.deepEqual(JSON.parse(await readFile(exportPath, "utf8")), exportDocument);
  });

  await logStep("persist setting across application restart", async () => {
    const before = await invoke(driver, "load_app_settings_snapshot");
    const changed = await invoke(driver, "update_app_settings", {
      mutation: { area: "readerField", value: { field: "fontSize", value: 21 } },
    });
    assert.equal(changed.preferences.reader.fontSize, 21);
    assert.ok(changed.revision > before.revision);
    await closeSession(driver);
    driver = await startSession();
    await waitForIpc(driver);
    const persisted = await invoke(driver, "load_app_settings_snapshot");
    assert.equal(persisted.preferences.reader.fontSize, 21);
    const registry = await invoke(driver, "load_archive_registry");
    assert.equal(registry.archives[0].rootPath, archiveRoot);
  });

  await logStep("secondary-window lifecycle", async () => {
    await invoke(driver, "open_archive_manager_window");
    let windows = [];
    const secondary = await driver
      .wait(async () => {
        windows = [];
        for (const handle of await driver.getAllWindowHandles()) {
          await driver.switchTo().window(handle);
          windows.push({
            handle,
            state: await driver.executeScript(
              "return { href: location.href, title: document.title }",
            ),
          });
        }
        return windows.find((window) => window.state.href.includes("window=archive-manager"));
      }, 20_000)
      .catch((error) => {
        throw new Error(`Archive Manager WebView did not load: ${JSON.stringify(windows)}`, {
          cause: error,
        });
      });
    const main = windows.find((window) => !window.state.href.includes("window=archive-manager"));
    assert.ok(main, `Main WebView missing: ${JSON.stringify(windows)}`);
    await driver.switchTo().window(secondary.handle);
    await driver.close();
    await driver.switchTo().window(main.handle);
    await driver.wait(async () => (await driver.getAllWindowHandles()).length === 1, 10_000);
    await driver.wait(
      () => driver.executeScript("return document.body.innerText.includes('Smoke Archive')"),
      20_000,
      "The main frontend did not render the archive after Archive Manager closed",
    );
  });

  await logStep("replace an EPUB only inside the disposable archive", async () => {
    const replacementDir = path.join(fixtureRoot, "replacement");
    await mkdir(replacementDir);
    const replacementPath = path.join(replacementDir, "smoke.epub");
    const replacementBytes = await createEpubFixture(replacementPath, "Replacement fixture.");
    assert.notDeepEqual(replacementBytes, sourceBytes);
    const replaced = await invoke(driver, "add_epub_files_to_archive", {
      rootPath: archiveRoot,
      sourcePaths: [replacementPath],
      conflictAction: "replace",
      mode: "copy",
    });
    assert.equal(replaced.results.length, 1);
    assert.equal(replaced.results[0].status, "imported");
    assert.equal(replaced.results[0].replacedExisting, true);
    assert.deepEqual(await readFile(path.join(archiveRoot, "smoke.epub")), replacementBytes);
    assert.deepEqual(await readFile(sourcePath), sourceBytes);
  });
}
