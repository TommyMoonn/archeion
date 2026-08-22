#!/usr/bin/env python3
"""Focused regression tests for Archeion's English dictionary package builder."""

from __future__ import annotations

import hashlib
import io
import json
import lzma
import tarfile
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

from build_english_catalog_packages import (
    DEFAULT_CONFIG,
    DOWNLOAD_BASE,
    DirectorySource,
    DictionaryAlias,
    build_package,
    candidate_metadata,
    fixture_source_dir,
    fixture_specs,
    load_specs,
    parse_gcide_data,
    parse_wordnet_exceptions,
    publish_candidates,
    read_gcide_entries,
    read_wordnet_entries,
)


class WordNetConverterTests(unittest.TestCase):
    def test_exception_files_become_deterministic_stardict_aliases(self) -> None:
        spec = next(
            spec
            for spec in fixture_specs()
            if spec.id == "open-english-wordnet-2025-plus"
        )
        with DirectorySource(fixture_source_dir(spec)) as source:
            entries, aliases, notice = read_wordnet_entries(source)

        self.assertEqual(
            aliases, [DictionaryAlias("public houses", "public house")]
        )
        self.assertIn("pub", [entry.headword for entry in entries])
        first = build_package(
            spec,
            entries,
            notice,
            aliases=aliases,
            package_stem="wordnet-exceptions-test",
        )
        second = build_package(
            spec,
            entries,
            notice,
            aliases=aliases,
            package_stem="wordnet-exceptions-test",
        )
        self.assertEqual(first.bytes, second.bytes)

        with tarfile.open(
            fileobj=io.BytesIO(lzma.decompress(first.bytes)), mode="r:"
        ) as archive:
            synonym = archive.extractfile(
                "wordnet-exceptions-test/wordnet-exceptions-test.syn"
            )
            metadata = archive.extractfile(
                "wordnet-exceptions-test/wordnet-exceptions-test.ifo"
            )
            self.assertIsNotNone(synonym)
            self.assertIsNotNone(metadata)
            if synonym is None or metadata is None:
                self.fail("generated WordNet package is missing alias resources")
            self.assertIn(b"public houses\0", synonym.read())
            self.assertIn("synwordcount=", metadata.read().decode("utf-8"))

    def test_exception_parser_rejects_incomplete_mappings(self) -> None:
        with self.assertRaisesRegex(ValueError, "Malformed WordNet exception mapping"):
            parse_wordnet_exceptions(b"orphan\n")

    def test_source_exception_mappings_are_the_only_inflection_aliases(self) -> None:
        spec = next(
            spec for spec in fixture_specs() if spec.id == "princeton-wordnet-3-0"
        )
        with DirectorySource(fixture_source_dir(spec)) as source:
            entries, aliases, notice = read_wordnet_entries(source)

        self.assertEqual(
            set(aliases),
            {
                DictionaryAlias("entities", "entity"),
                DictionaryAlias("knives", "knife"),
                DictionaryAlias("leaves", "leaf"),
                DictionaryAlias("wolves", "wolf"),
                DictionaryAlias("gassed", "gas"),
                DictionaryAlias("gasses", "gas"),
                DictionaryAlias("gassing", "gas"),
                DictionaryAlias("leaves", "leave"),
            },
        )
        for fabricated in [
            "goed",
            "maked",
            "runned",
            "buss",
            "quizes",
            "controled",
            "controling",
        ]:
            self.assertFalse(any(alias.headword == fabricated for alias in aliases))
        built = build_package(
            spec,
            entries,
            notice,
            aliases=aliases,
            package_stem="wordnet-lexical-inflection-test",
        )
        with tarfile.open(
            fileobj=io.BytesIO(lzma.decompress(built.bytes)), mode="r:"
        ) as archive:
            synonym = archive.extractfile(
                "wordnet-lexical-inflection-test/wordnet-lexical-inflection-test.syn"
            )
            self.assertIsNotNone(synonym)
            if synonym is None:
                self.fail("generated WordNet package is missing lexical aliases")
            synonym_bytes = synonym.read()
            self.assertIn(b"gassed\0", synonym_bytes)
            self.assertEqual(synonym_bytes.count(b"leaves\0"), 2)
            for fabricated in [
                b"goed\0",
                b"maked\0",
                b"runned\0",
                b"buss\0",
                b"quizes\0",
                b"controled\0",
                b"controling\0",
            ]:
                self.assertNotIn(fabricated, synonym_bytes)

    def test_exception_alias_must_reference_a_generated_lemma(self) -> None:
        spec = next(
            spec
            for spec in fixture_specs()
            if spec.id == "princeton-wordnet-3-0"
        )
        with DirectorySource(fixture_source_dir(spec)) as source:
            entries, _, notice = read_wordnet_entries(source)
        with self.assertRaisesRegex(ValueError, "references missing lemma"):
            build_package(
                spec,
                entries,
                notice,
                aliases=[DictionaryAlias("missing forms", "missing lemma")],
                package_stem="wordnet-invalid-alias-test",
            )


class GcideConverterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.spec = next(spec for spec in fixture_specs() if spec.id == "gcide-0-54")
        cls.fixture_dir = fixture_source_dir(cls.spec)

    def test_entry_main_word_owns_canonical_headword_aliases_and_all_senses(self) -> None:
        with DirectorySource(self.fixture_dir) as source:
            entries, notice = read_gcide_entries(source, require_complete_alphabet=False)

        self.assertIsNotNone(notice)
        by_headword = {entry.headword: entry.definition for entry in entries}
        self.assertIn("Aard-vark", by_headword)
        self.assertIn("Aardvark", by_headword)
        self.assertIn("ant bear", by_headword)
        self.assertIn("anteater", by_headword)
        self.assertIn("Aard-wolf", by_headword)
        self.assertIn("Aardwolf", by_headword)
        self.assertIn("earth-wolf", by_headword)
        self.assertIn("maanhaar", by_headword)
        self.assertNotIn('Aard"-vark`', by_headword)
        self.assertNotIn('Aard"-wolf`', by_headword)

        aard_vark = by_headword["Aard-vark"]
        self.assertIn("A burrowing African mammal", aard_vark)
        self.assertIn("A second historical sense retained under the same lexical entry", aard_vark)
        self.assertEqual(by_headword["Aardvark"], aard_vark)
        self.assertEqual(by_headword["ant bear"], aard_vark)

        aard_wolf = by_headword["Aard-wolf"]
        self.assertIn("A carnivorous, striped, quadruped mammal", aard_wolf)
        self.assertEqual(by_headword["Aardwolf"], aard_wolf)
        self.assertEqual(by_headword["maanhaar"], aard_wolf)

    def test_entry_main_word_is_not_overridden_by_nested_legacy_ent(self) -> None:
        source = b"""\
<entry main-word="Canonical"><p><ent>Legacy-looking body word</ent><def>Owned definition.</def></p></entry>
"""
        by_headword = {entry.headword: entry.definition for entry in parse_gcide_data(source)}
        self.assertEqual(by_headword, {"Canonical": "Owned definition"})

    def test_adjacent_entry_wrappers_do_not_leak_content(self) -> None:
        source = b"""\
<entry main-word="First"><p><def>First definition.</def><asp>First alias</asp></p></entry>
<entry main-word="Second"><p><def>Second definition.</def><syn><b>Syn.</b> -- second alias.</syn></p></entry>
"""
        entries = parse_gcide_data(source)
        by_headword = {entry.headword: entry.definition for entry in entries}

        self.assertEqual(by_headword["First"], "First definition")
        self.assertEqual(by_headword["First alias"], "First definition")
        self.assertEqual(by_headword["Second"], "Second definition")
        self.assertEqual(by_headword["second alias"], "Second definition")
        self.assertNotIn("Second definition", by_headword["First"])
        self.assertNotIn("First definition", by_headword["Second"])

    def test_duplicate_main_word_wrappers_preserve_independent_senses(self) -> None:
        source = b"""\
<entry main-word="Repeat"><p><def>First independent sense.</def></p></entry>
<entry main-word="Repeat"><p><def>Second independent sense.</def></p></entry>
"""
        repeat_entries = [entry for entry in parse_gcide_data(source) if entry.headword == "Repeat"]
        self.assertEqual(
            [entry.definition for entry in repeat_entries],
            ["First independent sense", "Second independent sense"],
        )

    def test_legacy_ent_paragraph_grammar_remains_a_compatibility_path(self) -> None:
        legacy = b"""\
<p><ent>Legacy word</ent><def>Legacy definition.</def><asp>Legacy alias</asp></p>
<p><cd>Legacy continuation sense.</cd></p>
"""
        by_headword = {entry.headword: entry.definition for entry in parse_gcide_data(legacy)}
        self.assertEqual(
            by_headword["Legacy word"],
            "Legacy definition\n\nLegacy continuation sense",
        )
        self.assertEqual(by_headword["Legacy alias"], by_headword["Legacy word"])

    def test_source_set_without_recognized_gcide_entries_fails_clearly(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-gcide-test-") as temporary:
            root = Path(temporary)
            (root / "CIDE.A").write_text(
                '<p><hw>Presentation only</hw><def>Not a lexical owner.</def></p>',
                encoding="utf-8",
            )
            (root / "COPYING").write_text("fixture license", encoding="utf-8")
            with DirectorySource(root) as source:
                with self.assertRaisesRegex(
                    ValueError, "GCIDE source set produced no valid dictionary entries"
                ):
                    read_gcide_entries(source, require_complete_alphabet=False)

    def test_gcide_package_readme_records_corresponding_source_and_converter_revision(self) -> None:
        with DirectorySource(self.fixture_dir) as source:
            entries, notice = read_gcide_entries(source, require_complete_alphabet=False)
        built = build_package(self.spec, entries, notice, package_stem="gcide-provenance-test")

        tar_bytes = lzma.decompress(built.bytes)
        with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:") as archive:
            readme = archive.extractfile("gcide-provenance-test/README")
            self.assertIsNotNone(readme)
            if readme is None:
                self.fail("generated package is missing README")
            text = readme.read().decode("utf-8")

        self.assertIn("Source archive file: gcide-0.54.tar.xz", text)
        self.assertIn("Source archive size bytes: 14803080", text)
        self.assertIn(
            "Source archive SHA-256: "
            "22416f6f36175b160dc388b7547512514d464473cf7d7c898d738efb26c51d42",
            text,
        )
        self.assertIn("Conversion script SHA-256:", text)
        self.assertIn("Conversion configuration SHA-256:", text)
        self.assertIn("converted form, not the original source representation", text)


class EnglishCatalogPublicationTests(unittest.TestCase):
    def test_description_bearing_candidate_cannot_be_published(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-english-publish-") as temporary:
            root = Path(temporary)
            candidate_dir = root / "candidate-packages"
            candidate_dir.mkdir()
            entries = []
            for spec in load_specs(DEFAULT_CONFIG):
                package_bytes = f"fixture package for {spec.id}".encode()
                (candidate_dir / spec.package_file_name).write_bytes(package_bytes)
                entry = {
                    "id": spec.id,
                    "name": spec.name,
                    "sourceLanguage": spec.source_language,
                    "targetLanguage": spec.target_language,
                    "sourceAttribution": spec.source_attribution,
                    "sourceUrl": spec.source_url,
                    "licenseName": spec.license_name,
                    "licenseUrl": spec.license_url,
                    "packageVersion": spec.package_version,
                    "compressedSizeBytes": len(package_bytes),
                    "installedSizeEstimateBytes": 1,
                    "downloadUrl": f"{DOWNLOAD_BASE}/{spec.package_file_name}",
                    "packageFormat": "stardict-tar-xz",
                    "sha256": hashlib.sha256(package_bytes).hexdigest(),
                }
                entries.append(entry)

            candidate_catalog = root / "candidate.json"
            candidate_catalog.write_text(
                json.dumps({"schemaVersion": 1, "dictionaries": entries}),
                encoding="utf-8",
            )
            candidate_metadata(candidate_dir, candidate_catalog)
            entries[0]["description"] = "Retired candidate metadata."
            candidate_catalog.write_text(
                json.dumps({"schemaVersion": 1, "dictionaries": entries}),
                encoding="utf-8",
            )
            receipt = root / "receipt.json"
            receipt.write_text("{}", encoding="utf-8")
            published_catalog = root / "published.json"

            with self.assertRaisesRegex(ValueError, "retired description field"):
                publish_candidates(
                    Namespace(
                        candidate_dir=candidate_dir,
                        candidate_catalog=candidate_catalog,
                        receipt=receipt,
                        output_dir=root / "published-packages",
                        catalog=published_catalog,
                    )
                )

            self.assertFalse(published_catalog.exists())


if __name__ == "__main__":
    unittest.main()
