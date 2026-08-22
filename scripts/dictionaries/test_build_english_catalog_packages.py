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
from dataclasses import replace
from pathlib import Path

from build_english_catalog_packages import (
    DEFAULT_CONFIG,
    DOWNLOAD_BASE,
    DirectorySource,
    DictionaryAlias,
    build_candidates,
    build_package,
    candidate_metadata,
    fixture_source_dir,
    fixture_specs,
    load_specs,
    load_pinned_license_notice,
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

    def test_tag_bound_license_notice_is_hash_verified(self) -> None:
        spec = next(
            spec
            for spec in load_specs(DEFAULT_CONFIG)
            if spec.id == "open-english-wordnet-2025-plus"
        )
        notice = load_pinned_license_notice(spec)
        self.assertIsNotNone(notice)
        self.assertIn(b"Creative Commons Attribution 4.0", notice or b"")

        with self.assertRaisesRegex(ValueError, "license notice SHA-256 mismatch"):
            load_pinned_license_notice(
                replace(spec, license_notice_sha256="0" * 64)
            )

    def test_exception_mappings_without_indexed_targets_are_not_emitted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            source_root = Path(temporary)
            (source_root / "data.noun").write_text(
                "00000001 03 n 01 gas 0 000 | a gaseous substance\n",
                encoding="utf-8",
            )
            (source_root / "noun.exc").write_text(
                "gasses gas\naboideaux aboideau\n",
                encoding="utf-8",
            )
            (source_root / "LICENSE").write_text("fixture license\n", encoding="utf-8")

            with DirectorySource(source_root) as source:
                _, aliases, _ = read_wordnet_entries(source)

        self.assertEqual(aliases, [DictionaryAlias("gasses", "gas")])

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

    def test_gcide_source_uses_its_latin1_text_encoding(self) -> None:
        source = b'<entry main-word="Facade"><p><def>A fa\xe7ade.</def></p></entry>'
        entries = parse_gcide_data(source)
        self.assertEqual(entries[0].definition, "A façade")

    def test_gcide_synonym_grammar_emits_only_lexical_aliases(self) -> None:
        source = b"""\
<entry main-word="Animosity"><p><def>Active enmity.</def>
<syn><b>Syn.</b> -- Enmity; hatred; opposition. --
<er>Animosity</er> is active enmity, inflamed by collision between parties.</syn></p></entry>
<entry main-word="Indecorum"><p><def>A lack of decorum.</def>
<syn><b>Syn.</b> -- <xex>Indecorum</xex> is sometimes synonymous with
<xex>indecency</xex>; but <xex>indecency</xex>, more frequently than
<xex>indecorum</xex>, is applied to words or actions which refer to what
nature and propriety require to be concealed or suppressed.</syn></p></entry>
<entry main-word="Fault"><p><def>A defect.</def>
<syn><b>Syn.</b> -- -- Error; blemish; defect.</syn></p></entry>
<entry main-word="Leave"><p><def>To depart.</def>
<syn>Syn>- To quit; depart from; forsake. See <er>Quit</er>.</syn></p></entry>
<entry main-word="Rubiaceae"><p><def>The madder family.</def>
<syn>Rubiaceae, family Rubiaceae, madder family --</syn></p></entry>
<entry main-word="Pecker"><p><def>A bird that pecks.</def>
<syn><b>Syn. --</b> penis, shaft [all but the first considered obscene].</syn></p></entry>
<entry main-word="Hairpin"><p><def>A pin for the hair.</def>
<syn><b>Syn. --</b> bobby pin; hair grip; kirby grip [British].</syn></p></entry>
<entry main-word="Discussion"><p><def>Consideration in discourse.</def>
<syn><b>Syn.</b> -- To <er>Discuss</er>, <er>Examine</er>, <er>Debate</er>.
We speak of examining a subject when we ponder it with care.</syn></p></entry>
<entry main-word="Bridal wreath"><p><def>A flowering shrub.</def>
<syn><b>Syn. --</b> Saint Peter's wreath, St. Peter's wreath.</syn></p></entry>
<entry main-word="Dyke"><p><def>A lexical fixture.</def>
<syn><b>Syn. --</b> dyke[vulgar, deprecatory].</syn></p></entry>
<entry main-word="Adrenaline"><p><def>A hormone.</def>
<syn><b>Syn. --</b> epinephrine; 3,4-dihydroxy-1-[1-hydroxy-2-(methylamino)-ethyl]benzene.</syn></p></entry>
"""
        entries = parse_gcide_data(source)
        by_owner = {}
        for entry in entries:
            by_owner.setdefault(entry.definition, []).append(entry.headword)

        self.assertEqual(
            by_owner["Active enmity"],
            ["Animosity", "Enmity", "hatred", "opposition"],
        )
        self.assertEqual(by_owner["A lack of decorum"], ["Indecorum"])
        self.assertEqual(by_owner["A defect"], ["Fault", "Error", "blemish", "defect"])
        self.assertEqual(
            by_owner["To depart"],
            ["Leave", "quit", "depart from", "forsake"],
        )
        self.assertEqual(
            by_owner["The madder family"],
            ["Rubiaceae", "family Rubiaceae", "madder family"],
        )
        self.assertEqual(by_owner["A bird that pecks"], ["Pecker", "penis", "shaft"])
        self.assertEqual(
            by_owner["A pin for the hair"],
            ["Hairpin", "bobby pin", "hair grip", "kirby grip"],
        )
        self.assertEqual(
            by_owner["Consideration in discourse"],
            ["Discussion", "Discuss", "Examine", "Debate"],
        )
        self.assertEqual(
            by_owner["A flowering shrub"],
            ["Bridal wreath", "Saint Peter's wreath", "St. Peter's wreath"],
        )
        self.assertEqual(by_owner["A lexical fixture"], ["Dyke", "dyke"])
        self.assertEqual(
            by_owner["A hormone"],
            [
                "Adrenaline",
                "epinephrine",
                "3,4-dihydroxy-1-[1-hydroxy-2-(methylamino)-ethyl]benzene",
            ],
        )

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
    def test_starting_a_build_invalidates_the_previous_native_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receipt = root / "validation-receipt.json"
            receipt.write_text("stale", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "source archive does not exist"):
                build_candidates(
                    Namespace(
                        princeton=root / "missing-princeton.tar.bz2",
                        oewn=root / "missing-oewn.zip",
                        gcide=root / "missing-gcide.tar.xz",
                        output_dir=root / "candidate-packages",
                        catalog=root / "candidate-catalog.json",
                        receipt=receipt,
                    )
                )

            self.assertFalse(receipt.exists())

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
