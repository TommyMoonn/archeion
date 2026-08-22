#!/usr/bin/env python3
"""Build and publish a verified FreeDict catalog candidate."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import html
import json
import os
import re
import subprocess
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_LANGUAGES = Path(__file__).with_name("freedict_languages.json")
DEFAULT_COMPATIBILITY_EXCLUSIONS = Path(__file__).with_name("freedict_exclusions.json")
DEFAULT_PRODUCTION_CATALOG = ROOT / "docs/dictionaries/catalog-v1.json"
DEFAULT_CANDIDATE_ROOT = ROOT / ".project/dictionaries/freedict-catalog-candidate"
DEFAULT_CANDIDATE_CATALOG = DEFAULT_CANDIDATE_ROOT / "catalog-v1.json"
DEFAULT_CACHE = DEFAULT_CANDIDATE_ROOT / "packages"
DEFAULT_EXCLUSIONS = DEFAULT_CANDIDATE_ROOT / "exclusions.json"
DEFAULT_RECEIPT = DEFAULT_CANDIDATE_ROOT / "validation-receipt-v1.json"
DEFAULT_CARGO_MANIFEST = ROOT / "src-tauri/Cargo.toml"

LICENSES = (
    (
        re.compile(r"general public license, version 3 \(gplv3\).*affero general public license, version 3 \(agplv3\)", re.I),
        "GNU GPL v3 and GNU AGPL v3",
        "https://www.gnu.org/licenses/",
    ),
    (
        re.compile(r"general public license.*version 3\.0 or any later version.*free documentation license.*1\.2 or any later version", re.I),
        "GNU GPL v3 or later and GNU FDL v1.2 or later",
        "https://www.gnu.org/licenses/",
    ),
    (
        re.compile(r"free documentation license,? ver\. 1\.1 and later.*general public license, version 3\.0 or any later version", re.I),
        "GNU FDL v1.1 or later and GNU GPL v3 or later",
        "https://www.gnu.org/licenses/",
    ),
    (
        re.compile(r"creative commons attribution-share\s*alike (?:license|licence)?\s*\(?v?(?:ersion )?3\.0", re.I),
        "Creative Commons Attribution-ShareAlike 3.0 Unported (CC BY-SA 3.0)",
        "https://creativecommons.org/licenses/by-sa/3.0/",
    ),
    (
        re.compile(r"creative commons attribution-sharealike 4\.0", re.I),
        "Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)",
        "https://creativecommons.org/licenses/by-sa/4.0/",
    ),
    (
        re.compile(r"creative commons attribution 3\.0", re.I),
        "Creative Commons Attribution 3.0 Unported (CC BY 3.0)",
        "https://creativecommons.org/licenses/by/3.0/",
    ),
    (
        re.compile(r"creative commons attribution 4\.0", re.I),
        "Creative Commons Attribution 4.0 International (CC BY 4.0)",
        "https://creativecommons.org/licenses/by/4.0/",
    ),
    (
        re.compile(r"general public license(?:,)?(?: ver\.| version)?\s*3(?:\.0)?\s*(?:\([^)]*)?(?:and|or)(?: at your option)? any later version", re.I),
        "GNU General Public License v3 or later (GPL-3.0-or-later)",
        "https://www.gnu.org/licenses/gpl-3.0.html",
    ),
    (
        re.compile(r"general public license(?:,)?(?: ver\.| version)?\s*2(?:\.0)?\s*(?:\([^)]*)?(?:and|or)(?: at your option)? any later version", re.I),
        "GNU General Public License v2 or later (GPL-2.0-or-later)",
        "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
    ),
    (
        re.compile(r"general public license,?\s*(?:ver\.|version)?\s*2(?:\.0)?\b", re.I),
        "GNU General Public License v2 (GPL-2.0-only)",
        "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html",
    ),
)

TAG_RE = re.compile(r"<[^>]+>")
BREAK_RE = re.compile(r"<br\s*/?>", re.I)


@dataclass(frozen=True)
class Language:
    tag: str
    name: str


@dataclass(frozen=True)
class Candidate:
    entry: dict[str, Any]
    file_name: str


@dataclass(frozen=True)
class ReleaseIdentity:
    version: str
    url: str
    compressed_size_bytes: int
    sha512: str

    def as_json(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "url": self.url,
            "compressedSizeBytes": self.compressed_size_bytes,
            "sha512": self.sha512,
        }


@dataclass(frozen=True)
class CompatibilityExclusion:
    reason: str
    release: ReleaseIdentity


def load_languages(path: Path) -> dict[str, Language]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ValueError("Unsupported FreeDict language-map schema.")
    return {code: Language(*value) for code, value in raw["languages"].items()}


def load_metadata(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("FreeDict metadata must be a JSON array.")
    return raw


def release_identity_from_json(raw: Any) -> ReleaseIdentity:
    if not isinstance(raw, dict):
        raise ValueError("FreeDict release identity must be an object.")
    version = raw.get("version")
    url = raw.get("url")
    size = raw.get("compressedSizeBytes")
    checksum = raw.get("sha512")
    if not isinstance(version, str) or not version.strip():
        raise ValueError("FreeDict release identity has an invalid version.")
    if not isinstance(url, str) or not url.startswith("https://"):
        raise ValueError("FreeDict release identity has a non-HTTPS URL.")
    if not isinstance(size, int) or isinstance(size, bool) or size < 1:
        raise ValueError("FreeDict release identity has an invalid byte size.")
    if not isinstance(checksum, str) or not re.fullmatch(r"[0-9a-f]{128}", checksum):
        raise ValueError("FreeDict release identity has an invalid SHA-512.")
    return ReleaseIdentity(version, url, size, checksum)


def load_compatibility_exclusions(path: Path) -> dict[str, CompatibilityExclusion]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ValueError("Unsupported FreeDict compatibility-exclusion schema.")
    exclusions = raw.get("exclusions")
    if not isinstance(exclusions, dict):
        raise ValueError("FreeDict compatibility exclusions must be an object.")
    parsed = {}
    for name, exclusion in exclusions.items():
        if not isinstance(name, str) or not isinstance(exclusion, dict):
            raise ValueError("FreeDict compatibility exclusions must use dictionary names.")
        reason = exclusion.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("FreeDict compatibility exclusions require concrete reasons.")
        parsed[name] = CompatibilityExclusion(
            reason=reason,
            release=release_identity_from_json(exclusion.get("release")),
        )
    return parsed


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha512_file(path: Path) -> str:
    digest = hashlib.sha512()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_verified(url: str, destination: Path, size: int, sha512: str) -> None:
    if not url.startswith("https://"):
        raise ValueError("release URL is not HTTPS")
    if (
        destination.is_file()
        and destination.stat().st_size == size
        and sha512_file(destination) == sha512
    ):
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent, suffix=".download", delete=False
        ) as stream:
            temporary = Path(stream.name)
            with urllib.request.urlopen(url, timeout=60) as response:
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
                    if stream.tell() > size:
                        raise ValueError("download exceeded the declared byte size")
            stream.flush()
            os.fsync(stream.fileno())
        if temporary.stat().st_size != size:
            raise ValueError("download byte size does not match FreeDict metadata")
        if sha512_file(temporary) != sha512.lower():
            raise ValueError("download SHA-512 does not match FreeDict metadata")
        temporary.replace(destination)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def stardict_release(dictionary: dict[str, Any]) -> dict[str, Any]:
    releases = [
        release
        for release in dictionary.get("releases", [])
        if release.get("platform") == "stardict"
    ]
    if len(releases) != 1:
        raise ValueError(f"expected one current StarDict release, found {len(releases)}")
    return releases[0]


def current_release_identity(dictionary: dict[str, Any]) -> ReleaseIdentity:
    release = stardict_release(dictionary)
    try:
        size = int(release["size"])
        raw = {
            "version": release["version"],
            "url": release["URL"],
            "compressedSizeBytes": size,
            "sha512": str(release["checksum"]).lower(),
        }
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("current StarDict release metadata is incomplete") from error
    return release_identity_from_json(raw)


def read_package_metadata(path: Path) -> tuple[str, str, str, int]:
    with tarfile.open(path, mode="r:xz") as archive:
        members = archive.getmembers()
        if any(not member.isfile() and not member.isdir() for member in members):
            raise ValueError("archive contains a link or special entry")
        files = [member for member in members if member.isfile()]
        ifo = [
            member
            for member in files
            if PurePosixPath(member.name).suffix == ".ifo"
        ]
        if len(ifo) != 1:
            raise ValueError(f"expected one StarDict .ifo file, found {len(ifo)}")
        stream = archive.extractfile(ifo[0])
        if stream is None:
            raise ValueError("StarDict metadata is unreadable")
        metadata = stream.read(1024 * 1024).decode("utf-8", errors="strict")
        installed_size = sum(member.size for member in files)
    fields = {}
    for line in metadata.splitlines()[1:]:
        if "=" in line:
            key, value = line.split("=", 1)
            fields[key.strip()] = value.strip()
    book_name = fields.get("bookname", "").strip()
    description = fields.get("description", "")
    if not book_name or not description:
        raise ValueError("StarDict metadata lacks bookname or licence-bearing description")
    plain_description = html.unescape(TAG_RE.sub(" ", BREAK_RE.sub("\n", description)))
    plain_description = " ".join(plain_description.split())
    license_match = next(
        (item for item in LICENSES if item[0].search(plain_description)), None
    )
    if license_match is None:
        raise ValueError("StarDict description has an unrecognized redistribution licence")
    return book_name, license_match[1], license_match[2], installed_size


def language_pair(name: str, languages: dict[str, Language]) -> tuple[Language, Language]:
    parts = name.split("-")
    if len(parts) != 2 or any(part not in languages for part in parts):
        raise ValueError("dictionary name does not map to the maintained language contract")
    return languages[parts[0]], languages[parts[1]]


def build_candidate(
    dictionary: dict[str, Any], languages: dict[str, Language], cache: Path
) -> Candidate:
    release = current_release_identity(dictionary)
    source, target = language_pair(str(dictionary["name"]), languages)
    url = release.url
    file_name = PurePosixPath(url).name
    size = release.compressed_size_bytes
    package = cache / file_name
    download_verified(url, package, size, release.sha512)
    book_name, license_name, license_url, installed_size = read_package_metadata(package)
    pair_name = f"{source.name} to {target.name}"
    entry = {
        "id": f"freedict-{dictionary['name']}",
        "name": f"FreeDict {pair_name}",
        "sourceLanguage": source.tag,
        "targetLanguage": target.tag,
        "sourceAttribution": book_name,
        "sourceUrl": url.rsplit("/", 1)[0] + "/",
        "licenseName": license_name,
        "licenseUrl": license_url,
        "packageVersion": release.version,
        "compressedSizeBytes": size,
        "installedSizeEstimateBytes": installed_size,
        "downloadUrl": url,
        "packageFormat": "stardict-tar-xz",
        "sha256": sha256_file(package),
    }
    return Candidate(entry, file_name)


def catalog_sort_key(entry: dict[str, Any]) -> tuple[Any, ...]:
    english_monolingual = (
        entry["sourceLanguage"] == "en" and entry["targetLanguage"] == "en"
    )
    return (
        not english_monolingual,
        entry["sourceLanguage"],
        entry["targetLanguage"],
        entry["name"].casefold(),
        entry["id"],
    )


def write_json(path: Path, value: Any) -> None:
    write_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def existing_non_freedict_entries(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [entry for entry in raw["dictionaries"] if not entry["id"].startswith("freedict-")]


def exclusion_report_entry(
    name: str, exclusion: CompatibilityExclusion
) -> dict[str, Any]:
    return {
        "name": name,
        "reason": exclusion.reason,
        "release": exclusion.release.as_json(),
    }


def verify_candidate_completeness(args: argparse.Namespace) -> None:
    catalog_bytes = args.catalog.read_bytes()
    catalog = json.loads(catalog_bytes)
    entries = catalog.get("dictionaries")
    if not isinstance(entries, list) or not all(
        isinstance(entry, dict) for entry in entries
    ):
        raise ValueError("FreeDict candidate catalog dictionaries must be objects")
    if any("description" in entry for entry in entries):
        raise ValueError(
            "FreeDict candidate catalog entries must not contain the retired description field"
        )
    report = json.loads(args.exclusions.read_text(encoding="utf-8"))
    compatibility_exclusions = load_compatibility_exclusions(
        args.compatibility_exclusions
    )
    if report.get("schemaVersion") != 1:
        raise ValueError("Unsupported FreeDict build-report schema.")
    if report.get("catalogSha256") != hashlib.sha256(catalog_bytes).hexdigest():
        raise ValueError("FreeDict build report does not match the candidate catalog")
    metadata_names = report.get("metadataNames")
    if (
        not isinstance(metadata_names, list)
        or any(not isinstance(name, str) for name in metadata_names)
        or metadata_names != sorted(set(metadata_names))
    ):
        raise ValueError("FreeDict build report has invalid metadata names")
    candidate_names = [
        entry["id"].removeprefix("freedict-")
        for entry in entries
        if entry.get("id", "").startswith("freedict-")
    ]
    if len(candidate_names) != len(set(candidate_names)):
        raise ValueError("FreeDict candidate catalog contains duplicate dictionary ids")
    expected_exclusions = [
        exclusion_report_entry(name, compatibility_exclusions[name])
        for name in sorted(compatibility_exclusions)
    ]
    if report.get("excluded") != expected_exclusions:
        raise ValueError("FreeDict build report does not match explicit exclusions")
    expected_candidates = set(metadata_names) - set(compatibility_exclusions)
    if set(candidate_names) != expected_candidates:
        raise ValueError(
            "FreeDict candidate catalog does not cover every non-excluded metadata entry"
        )


def dictionary_metadata_entries(path: Path) -> list[dict[str, Any]]:
    dictionaries = []
    for index, item in enumerate(load_metadata(path)):
        if not isinstance(item, dict):
            raise ValueError(f"FreeDict metadata entry {index} must be an object")
        if set(item) == {"software"} and isinstance(item["software"], dict):
            continue
        name = item.get("name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(
                f"FreeDict metadata entry {index} must have a non-empty dictionary name"
            )
        dictionaries.append(item)
    return dictionaries


def invalidate_candidate_state(args: argparse.Namespace) -> None:
    state_paths = (args.exclusions, args.catalog, args.receipt)
    production_catalog = args.production_catalog.resolve()
    if any(path.resolve() == production_catalog for path in state_paths):
        raise ValueError("candidate state paths must not target the production catalog")
    for path in state_paths:
        path.unlink(missing_ok=True)


def build(args: argparse.Namespace) -> None:
    invalidate_candidate_state(args)
    languages = load_languages(args.languages)
    compatibility_exclusions = load_compatibility_exclusions(args.compatibility_exclusions)
    candidates = []
    exclusions = []
    dictionaries = sorted(
        dictionary_metadata_entries(args.metadata),
        key=lambda item: item["name"],
    )
    current_names = [str(dictionary["name"]) for dictionary in dictionaries]
    if current_names != sorted(set(current_names)):
        raise ValueError("FreeDict metadata contains duplicate dictionary names")
    stale_exclusions = sorted(set(compatibility_exclusions) - set(current_names))
    if stale_exclusions:
        raise ValueError(f"compatibility exclusions are stale: {stale_exclusions}")

    def process(
        dictionary: dict[str, Any],
    ) -> tuple[dict[str, Any], Candidate | None, CompatibilityExclusion | None]:
        name = str(dictionary["name"])
        exclusion = compatibility_exclusions.get(name)
        if exclusion is not None:
            current_release = current_release_identity(dictionary)
            if current_release != exclusion.release:
                raise ValueError(
                    f"compatibility exclusion {name} does not match the current StarDict release"
                )
            return dictionary, None, exclusion
        return dictionary, build_candidate(dictionary, languages, args.cache_dir), None

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as executor:
        for dictionary, candidate, exclusion in executor.map(process, dictionaries):
            name = dictionary.get("name", "<unknown>")
            if candidate is not None:
                candidates.append(candidate)
                print(f"admitted {name}", flush=True)
            else:
                if exclusion is None:
                    raise RuntimeError("FreeDict build worker returned no result")
                exclusions.append(exclusion_report_entry(str(name), exclusion))
                print(f"excluded {name}: {exclusion.reason}", flush=True)
    if not candidates:
        raise ValueError("FreeDict metadata produced no admissible candidates")
    entries = existing_non_freedict_entries(args.production_catalog)
    entries.extend(candidate.entry for candidate in candidates)
    entries.sort(key=catalog_sort_key)
    write_json(args.catalog, {"schemaVersion": 1, "dictionaries": entries})
    write_json(
        args.exclusions,
        {
            "schemaVersion": 1,
            "catalogSha256": sha256_file(args.catalog),
            "metadataNames": current_names,
            "excluded": exclusions,
        },
    )
    verify_candidate_completeness(args)
    print(f"built {len(candidates)} FreeDict entries; excluded {len(exclusions)}")


def validation_environment(args: argparse.Namespace) -> dict[str, str]:
    environment = os.environ.copy()
    environment["ARCHEION_FREEDICT_CANDIDATE_DIR"] = str(args.cache_dir.resolve())
    environment["ARCHEION_FREEDICT_CANDIDATE_CATALOG"] = str(args.catalog.resolve())
    environment["ARCHEION_FREEDICT_VALIDATION_RECEIPT"] = str(args.receipt.resolve())
    return environment


def validate(args: argparse.Namespace) -> None:
    args.receipt.unlink(missing_ok=True)
    verify_candidate_completeness(args)
    subprocess.run(
        [
            args.cargo,
            "test",
            "--manifest-path",
            str(args.manifest_path),
            "--locked",
            "--lib",
            "generated_freedict_candidates_pass_current_package_validator",
            "--",
            "--ignored",
        ],
        cwd=ROOT,
        env=validation_environment(args),
        check=True,
    )
    if not args.receipt.is_file():
        raise ValueError("native validation did not produce a receipt")


def publish(args: argparse.Namespace) -> None:
    verify_candidate_completeness(args)
    catalog_bytes = args.catalog.read_bytes()
    catalog = json.loads(catalog_bytes)
    receipt = json.loads(args.receipt.read_text(encoding="utf-8"))
    if receipt.get("catalogSha256") != hashlib.sha256(catalog_bytes).hexdigest():
        raise ValueError("validation receipt does not match the candidate catalog")
    if receipt.get("failures") != []:
        raise ValueError("validation receipt contains package failures")
    catalog_ids = {
        entry["id"]
        for entry in catalog["dictionaries"]
        if entry["id"].startswith("freedict-")
    }
    receipt_ids = {package.get("id") for package in receipt.get("packages", [])}
    if receipt_ids != catalog_ids:
        raise ValueError("validation receipt does not cover every FreeDict package")
    previous = args.production_catalog.read_bytes()
    write_bytes(args.production_catalog, catalog_bytes)
    try:
        subprocess.run(
            [
                args.cargo,
                "test",
                "--manifest-path",
                str(args.manifest_path),
                "--locked",
                "--lib",
                "committed_production_catalog_is_valid_and_non_empty",
            ],
            cwd=ROOT,
            check=True,
        )
    except BaseException:
        write_bytes(args.production_catalog, previous)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--catalog", type=Path, default=DEFAULT_CANDIDATE_CATALOG)
    common.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    common.add_argument("--receipt", type=Path, default=DEFAULT_RECEIPT)
    common.add_argument("--exclusions", type=Path, default=DEFAULT_EXCLUSIONS)
    common.add_argument(
        "--compatibility-exclusions",
        type=Path,
        default=DEFAULT_COMPATIBILITY_EXCLUSIONS,
    )
    build_parser = subparsers.add_parser("build", parents=[common])
    build_parser.add_argument("--metadata", type=Path, required=True)
    build_parser.add_argument("--languages", type=Path, default=DEFAULT_LANGUAGES)
    build_parser.add_argument(
        "--production-catalog", type=Path, default=DEFAULT_PRODUCTION_CATALOG
    )
    build_parser.add_argument("--jobs", type=int, default=8)
    for command in ("validate", "publish"):
        subparser = subparsers.add_parser(command, parents=[common])
        subparser.add_argument("--cargo", default="cargo")
        subparser.add_argument("--manifest-path", type=Path, default=DEFAULT_CARGO_MANIFEST)
        if command == "publish":
            subparser.add_argument("--production-catalog", type=Path, default=DEFAULT_PRODUCTION_CATALOG)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        if args.command == "build" and args.jobs < 1:
            raise ValueError("--jobs must be at least 1")
        if args.command == "build":
            build(args)
        elif args.command == "validate":
            validate(args)
        else:
            publish(args)
    except (OSError, ValueError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"FreeDict catalog maintenance failed: {error}") from error


if __name__ == "__main__":
    main()
