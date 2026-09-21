<p align="center">
  <img src="docs/assets/archeion-wordmark.png" alt="Archeion" width="256">
</p>

<p align="center">
  A local-first Windows desktop app for organizing and reading EPUB libraries.
</p>

<p align="center">
  <a href="https://tommymoonn.github.io/archeion/"><img src="https://img.shields.io/badge/Website-Visit-238636?style=flat" alt="Website"></a>
  <a href="https://github.com/TommyMoonn/archeion/releases/latest"><img src="https://img.shields.io/badge/Download-Windows-0969da?style=flat&logo=windows11&logoColor=white" alt="Download for Windows"></a>
  <a href="https://github.com/TommyMoonn/archeion/releases"><img src="https://img.shields.io/badge/Releases-GitHub-57606a?style=flat&logo=github&logoColor=white" alt="GitHub Releases"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/Changelog-History-b45309?style=flat&logo=git&logoColor=white" alt="Changelog"></a>
</p>

<p align="center">
  <img
    src="docs/assets/archeion-preview.png"
    alt="Archeion library and reader preview"
    width="900"
  >
</p>

---

## About Archeion

Archeion turns a normal folder of EPUB files into a fast personal archive. It keeps
books on your computer, preserves your existing folder structure, and stores archive-specific reading data beside the books while keeping application-wide preferences and resources in Archeion application data, without requiring an account or cloud service.

## Download Archeion

- **[Windows EXE installer](https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe)** (recommended)
- **[Windows MSI installer](https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-x64.msi)**

### Releases

Archeion currently targets Windows 11 on x64 systems. Other desktop platforms are not packaged or supported yet.

See the [latest release notes](https://github.com/TommyMoonn/archeion/releases/latest)
or browse [all releases](https://github.com/TommyMoonn/archeion/releases).

## Features

- **Real folder archives** - open an existing EPUB folder or create a new archive.
- **Library organization** - browse folders and series, search, sort, filter, select, and manage books in bulk.
- **Paged and continuous reading** - choose a page-turning or scrolling reading experience with persistent progress.
- **Bookmarks and highlights** - save important locations and highlighted passages locally.
- **Attached notes** - add notes to highlights and manage annotations from one reader panel.
- **EPUB metadata editing** - update book metadata and embedded covers with transactional writeback and rollback protection.
- **File management** - add, rename, move, export, reveal, and delete EPUBs and folders.
- **Quick Actions** - reach common library and reader commands from the keyboard.
- **Customizable appearance** - configure application appearance, library density, and reader typography.
- **Offline dictionaries and Define** - install local dictionaries and look up selected Reader text without a cloud dictionary service.
- **Standalone utility windows** - keep Settings, Theme Manager, and About open independently of the Library.

## Local-first by design

Archeion has no account system, cloud sync, or telemetry. Your EPUB files remain
normal files that can be opened, copied, backed up, and organized outside the app.

Each archive may contain a hidden `.archeion` folder for archive-specific metadata and recovery data:

```txt
Your Archive/
  Book.epub
  Series/
    Volume 01.epub
  .archeion/
    annotations.json
    library.json
    progress.json
    scanner-cache.json
    covers/
    backups/
      annotations/
      epub-writeback/
      library/
      progress/
      scanner-cache/
```

Active metadata stays directly under `.archeion`. Recovery copies are grouped under
`.archeion/backups/<category>/`, while retained EPUB writeback backups are stored under
`.archeion/backups/epub-writeback/`. Back up the complete archive folder, including the
hidden `.archeion` directory, so books and their archive-owned recovery data remain together. Application-wide preferences, installed dictionaries, and custom theme packages live separately in Archeion application data.

## Project documentation

- [Development guide](docs/DEVELOPMENT.md)
- [Project scripts](scripts/README.md)
- [Changelog](CHANGELOG.md)

## License

Archeion is licensed under the [GNU General Public License v3.0 only](LICENSE).
