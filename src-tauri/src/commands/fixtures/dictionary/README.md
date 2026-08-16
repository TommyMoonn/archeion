# Dictionary archive regression fixtures

These fixtures contain synthetic StarDict test data only. They do not contain FreeDict dictionary entries or other production dictionary payloads.

- `freedict-stardict-shape.tar.xz` was produced with standard GNU `tar`, `gzip`, and XZ tooling. It mirrors the current FreeDict StarDict release shape used by the archive owner: one package directory containing `.ifo`, gzip-compressed `.idx.gz`, `.dict`, and small notice files.
- `xz-128m-dictionary.tar.xz` is an 84-byte compressed fixture whose LZMA2 filter declares a 128 MiB history dictionary. It is used to verify decoder-memory rejection without constructing or allocating 128 MiB during the test.
