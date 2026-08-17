#!/usr/bin/env python3
"""Focused regression tests for Archeion's English dictionary package builder."""

from __future__ import annotations

import io
import lzma
import tarfile
import tempfile
import unittest
from pathlib import Path

from build_english_catalog_packages import (
    DirectorySource,
    build_package,
    fixture_source_dir,
    fixture_specs,
    parse_gcide_data,
    read_gcide_entries,
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


if __name__ == "__main__":
    unittest.main()
