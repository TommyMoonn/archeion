# Dictionary archive regression fixtures

These fixtures contain synthetic StarDict test data only. They do not contain production dictionary payloads.

- `stardict-tar-xz-shape.tar.xz` is a neutral package-shape fixture produced with standard tar, gzip, and XZ tooling. It contains one package directory with `.ifo`, gzip-compressed `.idx.gz`, `.dict`, and small notice files.
- `xz-128m-dictionary.tar.xz` is an 84-byte compressed fixture whose LZMA2 filter declares a 128 MiB history dictionary. It is used to verify decoder-memory rejection without constructing or allocating 128 MiB during the test.
