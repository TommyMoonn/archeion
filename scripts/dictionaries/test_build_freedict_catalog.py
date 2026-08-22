#!/usr/bin/env python3
"""Focused local-fixture tests for FreeDict catalog maintenance."""

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
from unittest.mock import patch

from build_freedict_catalog import (
    Candidate,
    build,
    build_candidate,
    catalog_sort_key,
    load_compatibility_exclusions,
    load_languages,
    read_package_metadata,
    validate,
    verify_candidate_completeness,
)


def package_bytes(
    description: str = "Licensed under the GNU General Public License ver. 2.0 and any later version",
) -> bytes:
    metadata = (
        "StarDict's dict ifo file\n"
        "version=2.4.2\n"
        "bookname=FreeDict Fixture\n"
        "wordcount=1\n"
        "idxfilesize=14\n"
        f"description={description}\n"
        "sametypesequence=m\n"
    ).encode()
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:") as archive:
        for name, data in [
            ("afr-eng/afr-eng.ifo", metadata),
            ("afr-eng/afr-eng.idx", b"word\0\0\0\0\0\0\0\0\x04"),
            ("afr-eng/afr-eng.dict", b"test"),
        ]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return lzma.compress(output.getvalue())


def release(name: str, data: bytes, version: str = "1.0") -> dict[str, object]:
    return {
        "URL": f"https://download.freedict.org/dictionaries/{name}/{version}/freedict-{name}-{version}.stardict.tar.xz",
        "checksum": hashlib.sha512(data).hexdigest(),
        "platform": "stardict",
        "size": str(len(data)),
        "version": version,
    }


def dictionary(name: str, data: bytes, version: str = "1.0") -> dict[str, object]:
    return {"name": name, "releases": [release(name, data, version)]}


def exclusion(name: str, current_release: dict[str, object]) -> dict[str, object]:
    return {
        "reason": "Known native compatibility failure.",
        "release": {
            "version": current_release["version"],
            "url": current_release["URL"],
            "compressedSizeBytes": int(current_release["size"]),
            "sha512": current_release["checksum"],
        },
    }


def build_args(
    root: Path,
    metadata: list[dict[str, object]],
    exclusions: dict[str, object] | None = None,
) -> Namespace:
    metadata_path = root / "metadata.json"
    compatibility_path = root / "compatibility.json"
    production_catalog = root / "production.json"
    metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
    compatibility_path.write_text(
        json.dumps({"schemaVersion": 1, "exclusions": exclusions or {}}),
        encoding="utf-8",
    )
    production_catalog.write_text(
        json.dumps({"schemaVersion": 1, "dictionaries": []}), encoding="utf-8"
    )
    return Namespace(
        metadata=metadata_path,
        languages=Path(__file__).with_name("freedict_languages.json"),
        compatibility_exclusions=compatibility_path,
        production_catalog=production_catalog,
        catalog=root / "candidate.json",
        cache_dir=root / "packages",
        exclusions=root / "build-report.json",
        receipt=root / "receipt.json",
        jobs=1,
    )


def fixture_candidate(metadata: dict[str, object], *_: object) -> Candidate:
    name = str(metadata["name"])
    source, target = name.split("-")
    return Candidate(
        {
            "id": f"freedict-{name}",
            "name": f"FreeDict {name}",
            "sourceLanguage": source,
            "targetLanguage": target,
        },
        f"freedict-{name}.tar.xz",
    )


class FreeDictCatalogTests(unittest.TestCase):
    def test_maintained_compatibility_exclusions_have_concrete_reasons(self) -> None:
        exclusions = load_compatibility_exclusions(
            Path(__file__).with_name("freedict_exclusions.json")
        )
        self.assertIn("bre-fra", exclusions)
        self.assertTrue(
            all(exclusion.reason.endswith(".") for exclusion in exclusions.values())
        )
        self.assertTrue(
            all(
                exclusion.release.url.startswith("https://")
                for exclusion in exclusions.values()
            )
        )

    def test_local_metadata_maps_direction_and_exact_release_facts(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            package = root / "freedict-afr-eng-1.0.stardict.tar.xz"
            package.write_bytes(data)
            dictionary = {
                "name": "afr-eng",
                "releases": [{
                    "URL": "https://download.freedict.org/freedict-afr-eng-1.0.stardict.tar.xz",
                    "checksum": hashlib.sha512(data).hexdigest(),
                    "platform": "stardict",
                    "size": str(len(data)),
                    "version": "1.0",
                }],
            }
            candidate = build_candidate(
                dictionary,
                load_languages(Path(__file__).with_name("freedict_languages.json")),
                root,
            )

        self.assertEqual(candidate.entry["id"], "freedict-afr-eng")
        self.assertEqual(candidate.entry["sourceLanguage"], "af")
        self.assertEqual(candidate.entry["targetLanguage"], "en")
        self.assertEqual(candidate.entry["packageVersion"], "1.0")
        self.assertEqual(candidate.entry["compressedSizeBytes"], len(data))
        self.assertEqual(candidate.entry["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual(candidate.entry["packageFormat"], "stardict-tar-xz")
        self.assertIn("GPL-2.0-or-later", candidate.entry["licenseName"])

    def test_sha512_failure_aborts_build_and_invalidates_receipt(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            metadata = dictionary("afr-eng", data)
            metadata["releases"][0]["checksum"] = "0" * 128
            args = build_args(root, [metadata])
            args.receipt.write_text("previous authorization", encoding="utf-8")

            with patch("urllib.request.urlopen", return_value=io.BytesIO(data)):
                with self.assertRaisesRegex(ValueError, "SHA-512 does not match"):
                    build(args)

            self.assertFalse(args.catalog.exists())
            self.assertFalse(args.receipt.exists())

    def test_unexpected_candidate_failure_aborts_instead_of_excluding(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes("No redistribution statement")
            args = build_args(root, [dictionary("afr-eng", data)])
            args.receipt.write_text("previous authorization", encoding="utf-8")

            with patch("urllib.request.urlopen", return_value=io.BytesIO(data)):
                with self.assertRaisesRegex(ValueError, "unrecognized redistribution licence"):
                    build(args)

            self.assertFalse(args.catalog.exists())
            self.assertFalse(args.receipt.exists())

    def test_matching_explicit_exclusion_is_the_only_omission(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            excluded = dictionary("bre-fra", data)
            args = build_args(
                root,
                [dictionary("afr-eng", data), excluded],
                {"bre-fra": exclusion("bre-fra", excluded["releases"][0])},
            )

            with patch(
                "build_freedict_catalog.build_candidate",
                side_effect=fixture_candidate,
            ) as candidate_builder:
                build(args)

            self.assertEqual(candidate_builder.call_count, 1)
            report = json.loads(args.exclusions.read_text(encoding="utf-8"))
            self.assertEqual(report["metadataNames"], ["afr-eng", "bre-fra"])
            self.assertEqual(
                [item["name"] for item in report["excluded"]], ["bre-fra"]
            )
            verify_candidate_completeness(args)

    def test_changed_release_makes_explicit_exclusion_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            excluded_v1 = dictionary("bre-fra", data, "1.0")
            excluded_v2 = dictionary("bre-fra", data, "2.0")
            args = build_args(
                root,
                [dictionary("afr-eng", data), excluded_v1],
                {"bre-fra": exclusion("bre-fra", excluded_v1["releases"][0])},
            )

            with patch(
                "build_freedict_catalog.build_candidate",
                side_effect=fixture_candidate,
            ):
                build(args)
                self.assertTrue(args.catalog.is_file())
                self.assertTrue(args.exclusions.is_file())
                args.receipt.write_text("previous authorization", encoding="utf-8")
                args.metadata.write_text(
                    json.dumps([dictionary("afr-eng", data), excluded_v2]),
                    encoding="utf-8",
                )
                with self.assertRaisesRegex(
                    ValueError, "does not match the current StarDict release"
                ):
                    build(args)

            self.assertFalse(args.catalog.exists())
            self.assertFalse(args.exclusions.exists())
            self.assertFalse(args.receipt.exists())
            with patch("subprocess.run") as native_validator:
                with self.assertRaises(FileNotFoundError):
                    validate(args)
            native_validator.assert_not_called()
            self.assertFalse(args.receipt.exists())

    def test_nameless_metadata_entry_invalidates_candidate_state(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            args = build_args(
                root,
                [dictionary("afr-eng", data), {"releases": []}],
            )
            for path in (args.catalog, args.exclusions, args.receipt):
                path.write_text("stale state", encoding="utf-8")

            with self.assertRaisesRegex(
                ValueError, "entry 1 must have a non-empty dictionary name"
            ):
                build(args)

            self.assertFalse(args.catalog.exists())
            self.assertFalse(args.exclusions.exists())
            self.assertFalse(args.receipt.exists())
            with self.assertRaises(FileNotFoundError):
                verify_candidate_completeness(args)

    def test_candidate_invalidation_cannot_target_production_catalog(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            args = build_args(root, [dictionary("afr-eng", data)])
            production_bytes = args.production_catalog.read_bytes()
            args.catalog = args.production_catalog

            with self.assertRaisesRegex(
                ValueError, "must not target the production catalog"
            ):
                build(args)

            self.assertEqual(args.production_catalog.read_bytes(), production_bytes)

    def test_invalid_dictionary_names_abort_before_candidate_construction(self) -> None:
        data = package_bytes()
        for invalid_name in (None, "", "   "):
            with self.subTest(name=invalid_name):
                with tempfile.TemporaryDirectory(
                    prefix="archeion-freedict-"
                ) as temporary:
                    root = Path(temporary)
                    args = build_args(
                        root,
                        [
                            dictionary("afr-eng", data),
                            {"name": invalid_name, "releases": []},
                        ],
                    )
                    with patch(
                        "build_freedict_catalog.build_candidate"
                    ) as candidate_builder:
                        with self.assertRaisesRegex(
                            ValueError,
                            "entry 1 must have a non-empty dictionary name",
                        ):
                            build(args)
                    candidate_builder.assert_not_called()
                    self.assertFalse(args.catalog.exists())
                    self.assertFalse(args.exclusions.exists())

    def test_official_software_envelope_is_not_a_dictionary_candidate(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            args = build_args(
                root,
                [dictionary("afr-eng", data), {"software": {"tools": {}}}],
            )
            with patch(
                "build_freedict_catalog.build_candidate",
                side_effect=fixture_candidate,
            ) as candidate_builder:
                build(args)

            self.assertEqual(candidate_builder.call_count, 1)
            report = json.loads(args.exclusions.read_text(encoding="utf-8"))
            self.assertEqual(report["metadataNames"], ["afr-eng"])

    def test_completeness_check_rejects_an_unapproved_omission(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            data = package_bytes()
            args = build_args(
                root,
                [dictionary("afr-eng", data), dictionary("eng-fra", data)],
            )
            with patch(
                "build_freedict_catalog.build_candidate",
                side_effect=fixture_candidate,
            ):
                build(args)
            catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
            catalog["dictionaries"] = catalog["dictionaries"][:1]
            args.catalog.write_text(json.dumps(catalog), encoding="utf-8")
            report = json.loads(args.exclusions.read_text(encoding="utf-8"))
            report["catalogSha256"] = hashlib.sha256(
                args.catalog.read_bytes()
            ).hexdigest()
            args.exclusions.write_text(json.dumps(report), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "does not cover every non-excluded"):
                verify_candidate_completeness(args)

    def test_unrecognized_package_licence_is_a_concrete_exclusion_reason(self) -> None:
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            package = Path(temporary) / "unknown.tar.xz"
            package.write_bytes(package_bytes("No redistribution statement"))
            with self.assertRaisesRegex(ValueError, "unrecognized redistribution licence"):
                read_package_metadata(package)

    def test_observed_freedict_licence_forms_are_normalized(self) -> None:
        descriptions = [
            "Available under the GNU General Public License ver. 3.0 or any later version",
            "Available under the GNU General Public License ver. 3 (or at your option any later version, published by the FSF)",
            "Available under the Creative Commons Attribution-Share Alike Licence (V3.0)",
            "GNU GENERAL PUBLIC LICENSE, version 2.0",
        ]
        with tempfile.TemporaryDirectory(prefix="archeion-freedict-") as temporary:
            root = Path(temporary)
            for index, description in enumerate(descriptions):
                package = root / f"license-{index}.tar.xz"
                package.write_bytes(package_bytes(description))
                with self.subTest(description=description):
                    self.assertTrue(read_package_metadata(package)[1])

    def test_catalog_order_keeps_english_monolingual_entries_first(self) -> None:
        entries = [
            {
                "id": "pair",
                "name": "A pair",
                "sourceLanguage": "af",
                "targetLanguage": "en",
            },
            {
                "id": "english-z",
                "name": "Z English",
                "sourceLanguage": "en",
                "targetLanguage": "en",
            },
            {
                "id": "english-a",
                "name": "A English",
                "sourceLanguage": "en",
                "targetLanguage": "en",
            },
        ]
        self.assertEqual(
            [entry["id"] for entry in sorted(entries, key=catalog_sort_key)],
            ["english-a", "english-z", "pair"],
        )


if __name__ == "__main__":
    unittest.main()
