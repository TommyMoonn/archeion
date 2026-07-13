<p align="center">
  <img src="docs/assets/archeion-wordmark.png" alt="Archeion" width="256" />
</p>

<p align="center">
  A local-first Windows desktop app for organizing and reading EPUB libraries.
</p>

<p align="center">
  <a href="https://tommymoonn.github.io/archeion/">Website</a>
  ·
  <a href="https://github.com/TommyMoonn/archeion/releases/latest">Download</a>
  ·
  <a href="#features">Features</a>
  ·
  <a href="#local-first-by-design">Design</a>
  ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="docs/assets/archeion-preview.png" alt="Archeion library and reader preview" width="900" />
</p>

---

## About Archeion

Archeion turns a normal folder of EPUB files into a fast personal archive. It keeps
books on your computer, preserves your existing folder structure, and stores its
own reading data beside the archive instead of requiring an account or cloud
service.

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

## Local-first by design

Archeion has no account system, cloud sync, or telemetry. Your EPUB files remain
normal files that can be opened, copied, backed up, and organized outside the app.

Each archive may contain a hidden `.archeion` folder for local application data:

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
    settings.json
    covers/
    backups/
```

## Get Archeion

Download the latest Windows installers from the
[GitHub Releases page](https://github.com/TommyMoonn/archeion/releases/latest).

Archeion currently targets Windows 11. Other desktop platforms are not packaged
or supported yet.

## Project documentation

- [Development guide](docs/DEVELOPMENT.md)
- [Project scripts](scripts/README.md)
- [Changelog](CHANGELOG.md)

## License

Archeion is licensed under the [GNU General Public License v3.0 only](LICENSE).
