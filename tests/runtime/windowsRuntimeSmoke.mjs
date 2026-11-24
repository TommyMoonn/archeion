import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { By } from "selenium-webdriver";
import { runFontPreferenceFlows } from "./windowsFontPreferences.mjs";

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

async function closeSecondaryWindow(driver, mainHandle) {
  // Closing only Edge's WebView leaves the native Tauri window owner alive.
  await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
  await driver.switchTo().window(mainHandle);
  await driver.wait(async () => (await driver.getAllWindowHandles()).length === 1, 10_000);
}

export async function runRuntimeFlows({
  startSession,
  closeSession,
  fixtureRoot,
  logStep,
  evidenceRoot,
  launchExternal,
  applicationCount,
}) {
  const sourcePath = path.join(fixtureRoot, "smoke.epub");
  const sourceBytes = await createEpubFixture(sourcePath);
  let driver = await startSession();
  let archiveRoot;
  let installedFamilies;

  await logStep("installed Windows font catalog through real IPC", async () => {
    await waitForIpc(driver);
    installedFamilies = await invoke(driver, "list_installed_font_families");
    assert.ok(Array.isArray(installedFamilies));
    assert.ok(installedFamilies.length > 0, "DirectWrite should return installed Windows families");
    assert.ok(
      installedFamilies.every(
        (family) =>
          typeof family === "string" &&
          family.length > 0 &&
          family === family.trim() &&
          !/[\u0000-\u001f\u007f-\u009f/\\]/u.test(family),
      ),
    );
    const keys = installedFamilies.map((family) => family.toLowerCase());
    assert.equal(new Set(keys).size, keys.length, "Family labels must be unique ignoring case");
    const repeats = await Promise.all([
      invoke(driver, "list_installed_font_families"),
      invoke(driver, "list_installed_font_families"),
    ]);
    for (const families of repeats) assert.deepEqual(families, installedFamilies);
    console.log(`Runtime font catalog: ${installedFamilies.length} families`);
  });

  await logStep("launch and archive resolution", async () => {
    await waitForIpc(driver);
    const registry = await invoke(driver, "create_empty_archive", {
      parentPath: fixtureRoot,
      archiveName: "Smoke Archive",
    });
    assert.equal(registry.archives.length, 1);
    archiveRoot = registry.archives[0].rootPath;
    assert.equal(path.resolve(archiveRoot), path.join(fixtureRoot, "Smoke Archive"));
    const selection = await invoke(driver, "reserve_archive_open");
    const reopened = await invoke(driver, "open_archive", { path: archiveRoot, selection });
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
    const { revision } = await invoke(driver, "load_annotations_metadata", {
      rootPath: archiveRoot,
    });
    await invoke(driver, "save_annotations_metadata", {
      rootPath: archiveRoot,
      metadata,
      expectedRevision: revision,
    });
    assert.deepEqual(
      (await invoke(driver, "load_annotations_metadata", { rootPath: archiveRoot })).metadata,
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
    const registry = await invoke(driver, "load_archive_registry");
    const archiveId = registry.lastOpenedArchiveId;
    const { activationRevision } = await invoke(driver, "load_archive_annotation_snapshot", {
      archiveId,
      rootPath: archiveRoot,
    });
    const importedDocument = await driver.executeAsyncScript(
      `const done = arguments[arguments.length - 1];
         window.__TAURI__.core.invoke("read_annotation_import_file", arguments[0])
           .then(bytes => done(JSON.parse(new TextDecoder().decode(bytes))))
           .catch(error => done({ error: String(error) }));`,
      { path: exportPath, archiveScope: { archiveId, rootPath: archiveRoot, activationRevision } },
    );
    assert.deepEqual(importedDocument, exportDocument);
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
    await waitForIpc(driver);
    assert.deepEqual(await invoke(driver, "list_installed_font_families"), installedFamilies);
    await closeSecondaryWindow(driver, main.handle);
    await driver.wait(
      () => driver.executeScript("return document.body.innerText.includes('Smoke Archive')"),
      20_000,
      "The main frontend did not render the archive after Archive Manager closed",
    );
  });

  await logStep("Settings archive diagnostics route and focus the main Library", async () => {
    const mainHandle = await driver.getWindowHandle();
    for (const [label, destination, resultText] of [
      ["Find duplicates", "duplicates", "No duplicate groups"],
      ["Check EPUB issues", "epub-issues", "No EPUB issues"],
    ]) {
      let previousRequest = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await invoke(driver, "open_settings_window");
        await driver.wait(
          async () => {
            for (const handle of await driver.getAllWindowHandles()) {
              await driver.switchTo().window(handle);
              if ((await driver.executeScript("return location.href")).includes("window=settings"))
                return true;
            }
            return false;
          },
          20_000,
          "Settings WebView did not load",
        );
        await waitForIpc(driver);
        const settingsHandle = await driver.getWindowHandle();
        const storage = await driver.wait(
          async () =>
            (await driver.findElements(By.xpath("//button[normalize-space(.)='Storage']")))[0] ||
            false,
          20_000,
        );
        await storage.click();
        const action = await driver.wait(
          async () =>
            (await driver.findElements(By.xpath(`//button[normalize-space(.)='${label}']`)))[0] ||
            false,
          20_000,
        );
        await driver.wait(
          () =>
            driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        window.__TAURI__.window.getCurrentWindow().isFocused().then(done);
      `),
          10_000,
          "Settings did not finish its native reveal",
        );
        if (destination === "duplicates") {
          await driver.executeAsyncScript(`
          const done = arguments[arguments.length - 1];
          window.__TAURI__.window.Window.getByLabel('main').then(main => main.minimize()).then(done);
        `);
        }
        await action.click();
        await driver.wait(
          () =>
            driver.executeAsyncScript(`
        const done = arguments[arguments.length - 1];
        (async () => {
          const main = await window.__TAURI__.window.Window.getByLabel('main');
          return await main.isFocused() && !await main.isMinimized();
        })().then(done);
      `),
          10_000,
          "Main Library did not restore and receive native focus",
        );
        await driver.switchTo().window(mainHandle);
        previousRequest = await driver.wait(
          async () => {
            const state = await driver.executeScript(`return {
          view: new URLSearchParams(location.search).get('view'),
          request: new URLSearchParams(location.search).get('integrityRequest'),
          text: document.body.innerText,
        }`);
            return state.view === destination &&
              state.request &&
              state.request !== previousRequest &&
              state.text.includes(resultText)
              ? state.request
              : false;
          },
          20_000,
          `${label} did not analyze the active archive`,
        );
        await driver.switchTo().window(settingsHandle);
        await closeSecondaryWindow(driver, mainHandle);
      }
    }
  });

  driver = await runFontPreferenceFlows({
    driver,
    invoke,
    startSession,
    closeSession,
    waitForIpc,
    closeSecondaryWindow,
    logStep,
    installedFamilies,
    evidenceRoot,
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

  if (process.env.ARCHEION_UI_STABILITY_NATIVE === "1") {
    await logStep("opt-in UI stability baseline in the disposable archive", async () => {
      const { runWindowsUIStability } = await import("./windowsUIStability.mjs");
      await runWindowsUIStability({
        driver,
        archiveRoot,
        fixtureRoot,
        sourcePath,
        evidenceRoot,
      });
    });
  }

  const externalPath = path.join(fixtureRoot, "Standalone 日本語.epub");
  await createEpubFixture(externalPath);
  const trackedPath = path.join(archiveRoot, "smoke.epub");
  async function waitForReader(name, managed) {
    await waitForIpc(driver);
    const request = await driver.wait(
      async () => {
        const value = await invoke(driver, "cold_start_epub");
        return value?.fileName === name ? value : false;
      },
      20_000,
      `Unexpected Reader request: ${name}`,
    );
    const match = await invoke(driver, "standalone_reader_archive_match", { token: request.token });
    assert.equal(Boolean(match), managed);
    await driver.wait(
      async () =>
        driver.executeScript(
          `return Boolean(
      document.querySelector('.epub-container iframe') &&
      document.querySelector('[aria-label="Close Reader"]') &&
      Boolean(document.querySelector('[aria-label="Annotations"]')) === arguments[0])`,
          managed,
        ),
      20_000,
      `Reader did not render ${name} in the expected mode`,
    );
  }
  await logStep("warm standalone EPUB handoff, deduplication, and independent close", async () => {
    const mainHandle = await driver.getWindowHandle();
    const originalUrl = await driver.getCurrentUrl();
    const metadata = await invoke(driver, "load_archive_metadata", { rootPath: archiveRoot });
    assert.ok(
      Object.values(metadata.library.books).some((book) => book.relativePath === "smoke.epub"),
      "Imported EPUB must have a managed record",
    );
    await Promise.all([launchExternal(externalPath), launchExternal(trackedPath)]);
    const readers = await driver.wait(
      async () => {
        const handles = await driver.getAllWindowHandles();
        return handles.length === 3 ? handles.filter((handle) => handle !== mainHandle) : false;
      },
      20_000,
      "Expected two standalone Readers and the Library",
    );
    const readerHandles = new Map();
    for (const handle of readers) {
      await driver.switchTo().window(handle);
      await waitForIpc(driver);
      const request = await invoke(driver, "cold_start_epub");
      assert.ok(request);
      readerHandles.set(request.fileName, handle);
      await waitForReader(request.fileName, request.fileName === "smoke.epub");
    }
    assert.deepEqual(
      new Set(readerHandles.keys()),
      new Set(["Standalone 日本語.epub", "smoke.epub"]),
    );
    await launchExternal(externalPath);
    assert.deepEqual(
      new Set(await driver.getAllWindowHandles()),
      new Set([mainHandle, ...readers]),
    );
    assert.equal(await applicationCount(), 1);
    const trackedReader = readerHandles.get("smoke.epub");
    const temporaryReader = readerHandles.get("Standalone 日本語.epub");
    await driver.switchTo().window(trackedReader);
    await driver.executeScript(`document.querySelector('[aria-label="Close Reader"]').click()`);
    await driver.switchTo().window(mainHandle);
    await driver.wait(
      async () => {
        const handles = await driver.getAllWindowHandles();
        return (
          handles.length === 2 && handles.includes(mainHandle) && handles.includes(temporaryReader)
        );
      },
      20_000,
      "Managed Reader Close button did not close its own window",
    );
    assert.equal(await driver.getCurrentUrl(), originalUrl);

    await launchExternal(trackedPath);
    const reopenedReader = await driver.wait(
      async () => {
        const handles = await driver.getAllWindowHandles();
        return (
          handles.length === 3 &&
          handles.find((handle) => handle !== mainHandle && handle !== temporaryReader)
        );
      },
      20_000,
      "Closed managed EPUB could not be reopened",
    );
    await driver.switchTo().window(reopenedReader);
    await waitForReader("smoke.epub", true);

    await driver.switchTo().window(temporaryReader);
    await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
    await driver.switchTo().window(mainHandle);
    await driver.wait(
      async () => {
        const handles = await driver.getAllWindowHandles();
        return (
          handles.length === 2 && handles.includes(mainHandle) && handles.includes(reopenedReader)
        );
      },
      20_000,
      "Temporary Reader native close did not close its own window",
    );

    await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
    await driver.switchTo().window(reopenedReader);
    await driver.wait(
      async () => {
        const handles = await driver.getAllWindowHandles();
        return handles.length === 1 && handles[0] === reopenedReader;
      },
      20_000,
      "Closing the Library did not leave the managed Reader independent",
    );
    await driver.wait(
      () =>
        driver.executeScript(`return Boolean(document.querySelector('.epub-container iframe'))`),
      20_000,
      "Remaining Reader lost its publication when the Library closed",
    );
    await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
    await driver.wait(
      async () => (await applicationCount()) === 0,
      20_000,
      "Last warm Reader did not exit the application",
    );
    await closeSession(driver, { exited: true });
  });

  await logStep("cold standalone Reader and last-window process exit", async () => {
    driver = await startSession([externalPath]);
    await waitForReader("Standalone 日本語.epub", false);
    assert.equal((await driver.getAllWindowHandles()).length, 1);
    assert.equal(await applicationCount(), 1);
    await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
    await driver.wait(
      async () => (await applicationCount()) === 0,
      20_000,
      "Last Reader did not exit the application",
    );
    await closeSession(driver, { exited: true });
  });
}
