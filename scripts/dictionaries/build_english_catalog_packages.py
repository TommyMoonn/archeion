#!/usr/bin/env python3
"""Build deterministic StarDict packages for Archeion's English catalog sources."""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import lzma
import os
import re
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zipfile
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Iterable, Mapping, Sequence

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG = Path(__file__).with_name("english_catalog_sources.json")
DEFAULT_CATALOG = ROOT / "docs/dictionaries/catalog-v1.json"
DEFAULT_OUTPUT = ROOT / "docs/dictionaries/packages"
DEFAULT_CANDIDATE_ROOT = ROOT / ".project/dictionaries/english-catalog-candidate"
DEFAULT_CANDIDATE_CATALOG = DEFAULT_CANDIDATE_ROOT / "catalog-v1.json"
DEFAULT_CANDIDATE_OUTPUT = DEFAULT_CANDIDATE_ROOT / "packages"
DEFAULT_VALIDATION_RECEIPT = DEFAULT_CANDIDATE_ROOT / "validation-receipt-v1.json"
DEFAULT_CARGO_MANIFEST = ROOT / "src-tauri/Cargo.toml"
FIXTURE_SOURCE_ROOT = Path(__file__).with_name("fixtures")
FIXTURE_OUTPUT_ROOT = (
    ROOT / "src-tauri/src/commands/fixtures/dictionary/english_catalog"
)

DOWNLOAD_BASE = "https://tommymoonn.github.io/archeion/dictionaries/packages"
ARCHEION_REPOSITORY = "https://github.com/TommyMoonn/archeion"
STARDICT_VERSION = "2.4.2"


@dataclass(frozen=True)
class SourceSpec:
    id: str
    name: str
    source_language: str
    target_language: str
    source_attribution: str
    source_url: str
    license_name: str
    license_url: str
    license_notice_path: Path | None
    license_notice_url: str | None
    license_notice_sha256: str | None
    source_archive_name: str
    source_archive_url: str
    source_archive_size_bytes: int
    source_archive_sha256: str
    source_format: str
    package_version: str
    package_file_name: str


@dataclass(frozen=True)
class DictionaryEntry:
    headword: str
    definition: str


@dataclass(frozen=True)
class DictionaryAlias:
    headword: str
    target_headword: str


@dataclass(frozen=True)
class BuiltPackage:
    bytes: bytes
    installed_size_bytes: int
    entry_count: int


@dataclass
class GcideLexicalEntry:
    headwords: list[str] = field(default_factory=list)
    definitions: list[str] = field(default_factory=list)


class SourceArchive:
    def __init__(self, path: Path):
        self.path = path
        self._zip: zipfile.ZipFile | None = None
        self._tar: tarfile.TarFile | None = None
        if zipfile.is_zipfile(path):
            self._zip = zipfile.ZipFile(path)
        else:
            self._tar = tarfile.open(path, mode="r:*")

    def close(self) -> None:
        if self._zip is not None:
            self._zip.close()
        if self._tar is not None:
            self._tar.close()

    def __enter__(self) -> "SourceArchive":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def names(self) -> list[str]:
        if self._zip is not None:
            return [info.filename for info in self._zip.infolist() if not info.is_dir()]
        assert self._tar is not None
        return [member.name for member in self._tar.getmembers() if member.isfile()]

    def read(self, name: str) -> bytes:
        if self._zip is not None:
            return self._zip.read(name)
        assert self._tar is not None
        member = self._tar.getmember(name)
        stream = self._tar.extractfile(member)
        if stream is None:
            raise ValueError(f"Archive member is not a regular file: {name}")
        return stream.read()


class DirectorySource:
    def __init__(self, path: Path):
        self.path = path

    def __enter__(self) -> "DirectorySource":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def names(self) -> list[str]:
        return [
            file.relative_to(self.path).as_posix()
            for file in sorted(self.path.rglob("*"))
            if file.is_file()
        ]

    def read(self, name: str) -> bytes:
        return (self.path / PurePosixPath(name)).read_bytes()


def load_specs(path: Path) -> list[SourceSpec]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ValueError("Unsupported English dictionary source configuration schema.")
    result = []
    for item in raw["sources"]:
        result.append(
            SourceSpec(
                id=item["id"],
                name=item["name"],
                source_language=item["sourceLanguage"],
                target_language=item["targetLanguage"],
                source_attribution=item["sourceAttribution"],
                source_url=item["sourceUrl"],
                license_name=item["licenseName"],
                license_url=item["licenseUrl"],
                license_notice_path=(
                    (path.parent / item["licenseNoticeFile"]).resolve()
                    if item.get("licenseNoticeFile")
                    else None
                ),
                license_notice_url=item.get("licenseNoticeUrl"),
                license_notice_sha256=(
                    str(item["licenseNoticeSha256"]).lower()
                    if item.get("licenseNoticeSha256")
                    else None
                ),
                source_archive_name=item["sourceArchiveName"],
                source_archive_url=item["sourceArchiveUrl"],
                source_archive_size_bytes=int(item["sourceArchiveSizeBytes"]),
                source_archive_sha256=item["sourceArchiveSha256"].lower(),
                source_format=item["sourceFormat"],
                package_version=item["packageVersion"],
                package_file_name=item["packageFileName"],
            )
        )
    validate_specs(result)
    return result


def validate_specs(specs: Sequence[SourceSpec]) -> None:
    expected_ids = [
        "princeton-wordnet-3-0",
        "open-english-wordnet-2025-plus",
        "gcide-0-54",
    ]
    ids = [spec.id for spec in specs]
    if ids != expected_ids:
        raise ValueError(f"English source configuration must contain {expected_ids!r} in order.")
    if len(set(ids)) != len(ids):
        raise ValueError("English dictionary source ids must be unique.")
    for spec in specs:
        if spec.source_language != "en" or spec.target_language != "en":
            raise ValueError(f"{spec.id}: Phase 1.3.0.23 sources must be English monolingual.")
        if not spec.source_url.startswith("https://"):
            raise ValueError(f"{spec.id}: source URL must use HTTPS.")
        if not spec.source_archive_url.startswith("https://"):
            raise ValueError(f"{spec.id}: source archive URL must use HTTPS.")
        if spec.source_archive_size_bytes <= 0:
            raise ValueError(f"{spec.id}: source archive size must be positive.")
        if not re.fullmatch(r"[0-9a-f]{64}", spec.source_archive_sha256):
            raise ValueError(f"{spec.id}: source archive SHA-256 must be lowercase hexadecimal.")
        notice_fields = (
            spec.license_notice_path,
            spec.license_notice_url,
            spec.license_notice_sha256,
        )
        if any(value is not None for value in notice_fields) and not all(
            value is not None for value in notice_fields
        ):
            raise ValueError(f"{spec.id}: pinned license notice metadata must be complete.")
        if spec.license_notice_path is not None:
            config_root = DEFAULT_CONFIG.parent.resolve()
            if not spec.license_notice_path.is_relative_to(config_root):
                raise ValueError(f"{spec.id}: pinned license notice must stay under the maintenance root.")
            if not str(spec.license_notice_url).startswith("https://"):
                raise ValueError(f"{spec.id}: pinned license notice URL must use HTTPS.")
            if not re.fullmatch(r"[0-9a-f]{64}", str(spec.license_notice_sha256)):
                raise ValueError(
                    f"{spec.id}: pinned license notice SHA-256 must be lowercase hexadecimal."
                )
        if not spec.package_file_name.endswith(".tar.xz"):
            raise ValueError(f"{spec.id}: production package must use the supported tar.xz format.")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_source_archive(path: Path, spec: SourceSpec) -> None:
    if not path.is_file():
        raise ValueError(f"{spec.name}: source archive does not exist: {path}")
    if path.name != spec.source_archive_name:
        raise ValueError(
            f"{spec.name}: expected source archive {spec.source_archive_name!r}, "
            f"got {path.name!r}."
        )
    size = path.stat().st_size
    if size != spec.source_archive_size_bytes:
        raise ValueError(
            f"{spec.name}: source archive size mismatch: expected "
            f"{spec.source_archive_size_bytes}, got {size}."
        )
    digest = sha256_file(path)
    if digest != spec.source_archive_sha256:
        raise ValueError(
            f"{spec.name}: source archive SHA-256 mismatch: expected "
            f"{spec.source_archive_sha256}, got {digest}."
        )


def load_pinned_license_notice(spec: SourceSpec) -> bytes | None:
    if spec.license_notice_path is None:
        return None
    if not spec.license_notice_path.is_file():
        raise ValueError(
            f"{spec.name}: pinned license notice is missing: {spec.license_notice_path}"
        )
    data = spec.license_notice_path.read_bytes()
    digest = sha256_bytes(data)
    if digest != spec.license_notice_sha256:
        raise ValueError(
            f"{spec.name}: pinned license notice SHA-256 mismatch: expected "
            f"{spec.license_notice_sha256}, got {digest}."
        )
    return data


def find_unique_basename(names: Sequence[str], basename: str) -> str:
    matches = [name for name in names if PurePosixPath(name).name == basename]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one {basename!r}; found {len(matches)}.")
    return matches[0]


def find_optional_notice(names: Sequence[str]) -> str | None:
    preferred = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.txt"]
    by_basename: dict[str, list[str]] = {}
    for name in names:
        by_basename.setdefault(PurePosixPath(name).name, []).append(name)
    for basename in preferred:
        matches = by_basename.get(basename, [])
        if len(matches) == 1:
            return matches[0]
    return None


def ascii_casefold_key(value: str) -> tuple[bytes, bytes]:
    raw = value.encode("utf-8")
    folded = bytes((byte + 32) if 65 <= byte <= 90 else byte for byte in raw)
    return folded, raw


def parse_wndb_data(data: bytes) -> list[DictionaryEntry]:
    entries: list[DictionaryEntry] = []
    for raw_line in data.decode("utf-8", errors="strict").splitlines():
        if " | " not in raw_line or raw_line.startswith("  "):
            continue
        fields_text, gloss = raw_line.split(" | ", 1)
        fields = fields_text.split()
        if len(fields) < 5 or not fields[0].isdigit():
            continue
        try:
            word_count = int(fields[3], 16)
        except ValueError as error:
            raise ValueError(f"Malformed WNDB word count in line: {raw_line[:80]!r}") from error
        cursor = 4
        lemmas: list[str] = []
        for _ in range(word_count):
            if cursor + 1 >= len(fields):
                raise ValueError("Malformed WNDB synset word list.")
            lemma = fields[cursor].replace("_", " ")
            lemmas.append(lemma)
            cursor += 2
        if not lemmas:
            continue
        definition = gloss.strip()
        synonyms = list(dict.fromkeys(lemmas))
        synonym_text = ", ".join(synonyms)
        if len(synonyms) > 1:
            definition = f"{definition}\n\nSynonyms: {synonym_text}"
        for lemma in synonyms:
            entries.append(DictionaryEntry(lemma, definition))
    return entries


def parse_wordnet_exceptions(data: bytes) -> list[DictionaryAlias]:
    aliases: list[DictionaryAlias] = []
    for line_number, raw_line in enumerate(
        data.decode("utf-8", errors="strict").splitlines(), start=1
    ):
        fields = raw_line.split()
        if not fields:
            continue
        if len(fields) < 2:
            raise ValueError(
                f"Malformed WordNet exception mapping on line {line_number}."
            )
        alias = fields[0].replace("_", " ")
        for lemma in fields[1:]:
            aliases.append(DictionaryAlias(alias, lemma.replace("_", " ")))
    return aliases


def read_wordnet_entries(
    source: SourceArchive | DirectorySource,
) -> tuple[list[DictionaryEntry], list[DictionaryAlias], bytes | None]:
    names = source.names()
    data_names: list[str] = []
    for basename in ["data.noun", "data.verb", "data.adj", "data.adv"]:
        matches = [name for name in names if PurePosixPath(name).name == basename]
        if len(matches) > 1:
            raise ValueError(f"Expected at most one {basename!r}; found {len(matches)}.")
        if matches:
            data_names.append(matches[0])
    if not data_names:
        raise ValueError("No WNDB data.* files were found.")
    entries: list[DictionaryEntry] = []
    for name in data_names:
        entries.extend(parse_wndb_data(source.read(name)))
    aliases: list[DictionaryAlias] = []
    for basename in ["noun.exc", "verb.exc", "adj.exc", "adv.exc"]:
        matches = [name for name in names if PurePosixPath(name).name == basename]
        if len(matches) > 1:
            raise ValueError(f"Expected at most one {basename!r}; found {len(matches)}.")
        if matches:
            aliases.extend(parse_wordnet_exceptions(source.read(matches[0])))
    indexed_headwords = {entry.headword for entry in entries}
    # Official exception files can retain mappings for lemmas no longer
    # present in the matching WNDB data files. Only mappings with an indexed
    # target can become valid StarDict aliases; build_stardict_resources still
    # rejects any unsupported alias supplied after this conversion boundary.
    aliases = [alias for alias in aliases if alias.target_headword in indexed_headwords]
    notice_name = find_optional_notice(names)
    notice = source.read(notice_name) if notice_name is not None else None
    return entries, aliases, notice


GCIDE_ENTRY_BOUNDARY_RE = re.compile(
    r"<(?P<closing>/)?entry\b(?P<attrs>[^>]*)>", re.IGNORECASE
)
GCIDE_MAIN_WORD_ATTR_RE = re.compile(
    r"\bmain-word\s*=\s*(?P<quote>[\"'])(?P<value>.*?)(?P=quote)",
    re.IGNORECASE | re.DOTALL,
)
GCIDE_PARAGRAPH_BOUNDARY_RE = re.compile(r"</?p(?:\s[^>]*)?>", re.IGNORECASE)
GCIDE_CONTENT_TAG_RE = re.compile(
    r"<(?P<tag>ent|altname|asp|syn|def|cd)\b[^>]*>"
    r"(?P<body>.*?)</(?P=tag)>",
    re.IGNORECASE | re.DOTALL,
)
GCIDE_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>")
GCIDE_SPECIAL_TOKEN_RE = re.compile(r"<([^<>\s]+?)/")
WHITESPACE_RE = re.compile(r"\s+")

SPECIAL_GCIDE_TOKENS: Mapping[str, str] = {
    "AE": "AE",
    "ae": "ae",
    "OE": "OE",
    "oe": "oe",
    "alpha": "alpha",
    "beta": "beta",
    "gamma": "gamma",
    "sharp": "#",
    "flat": "b",
    "sect": "§",
}

GCIDE_DIACRITIC_TOKEN_RE = re.compile(
    r"([AEIOUYaeiouy])(?:acute|grave|circ|tilde|uml|diaer|ring)$"
)


def gcide_special_token(match: re.Match[str]) -> str:
    token = match.group(1)
    if token.startswith("frac:"):
        return token.removeprefix("frac:").replace("_", "/")
    if token in SPECIAL_GCIDE_TOKENS:
        return SPECIAL_GCIDE_TOKENS[token]
    diacritic = GCIDE_DIACRITIC_TOKEN_RE.fullmatch(token)
    if diacritic is not None:
        return diacritic.group(1)
    return ""


def clean_gcide_text(value: str) -> str:
    value = GCIDE_SPECIAL_TOKEN_RE.sub(gcide_special_token, value)
    value = GCIDE_TAG_RE.sub("", value)
    value = html.unescape(value)
    return WHITESPACE_RE.sub(" ", value).strip(" .\t\r\n")


def iter_gcide_paragraphs(text: str) -> Iterable[str]:
    paragraph_start: int | None = None
    for match in GCIDE_PARAGRAPH_BOUNDARY_RE.finditer(text):
        is_closing = text[match.start() : match.end()].lstrip().startswith("</")
        if not is_closing:
            if paragraph_start is not None:
                yield text[paragraph_start : match.start()]
            paragraph_start = match.end()
            continue
        if paragraph_start is not None:
            yield text[paragraph_start : match.start()]
            paragraph_start = None
    if paragraph_start is not None:
        yield text[paragraph_start:]


GCIDE_LEADING_BOLD_RE = re.compile(
    r"^\s*<b\b[^>]*>(?P<label>.*?)</b>\s*(?P<remainder>.*)$",
    re.IGNORECASE | re.DOTALL,
)
GCIDE_SYNONYM_MARKER_RE = re.compile(
    r"^(?:Synonyms?|Syn\.?)\s*(?:>?\s*(?:--|-|:)\s*)*",
    re.IGNORECASE,
)
GCIDE_SYNONYM_DELIMITER_RE = re.compile(r"\s+--(?:\s+|$)")
GCIDE_TRAILING_QUALIFIER_RE = re.compile(r"\s*(?:\[[^\[\]]*\]|\([^()]*\))\s*$")


def gcide_synonym_list_markup(value: str) -> str:
    """Return the source-marked lexical-list prefix from one GCIDE synonym block."""
    markup = value.strip()
    bold = GCIDE_LEADING_BOLD_RE.match(markup)
    if bold is not None:
        label = clean_gcide_text(bold.group("label"))
        marker = GCIDE_SYNONYM_MARKER_RE.match(label)
        if marker is not None:
            embedded_value = label[marker.end() :].strip()
            markup = " ".join(
                part for part in (embedded_value, bold.group("remainder").strip()) if part
            )
    else:
        marker = GCIDE_SYNONYM_MARKER_RE.match(markup)
        if marker is not None:
            markup = markup[marker.end() :]

    markup = re.sub(r"^\s*(?:>?\s*(?:--|-|:)\s*)+", "", markup)
    delimiter = GCIDE_SYNONYM_DELIMITER_RE.search(markup)
    if delimiter is not None:
        markup = markup[: delimiter.start()]

    square_depth = 0
    parenthesis_depth = 0
    inside_tag = False
    for index, character in enumerate(markup):
        if character == "<":
            inside_tag = True
            continue
        if inside_tag:
            if character == ">":
                inside_tag = False
            continue
        if character == "[":
            square_depth += 1
            continue
        if character == "]" and square_depth:
            square_depth -= 1
            continue
        if character == "(":
            parenthesis_depth += 1
            continue
        if character == ")" and parenthesis_depth:
            parenthesis_depth -= 1
            continue
        if character != "." or square_depth or parenthesis_depth:
            continue
        following = markup[index + 1 :]
        if following and not following[0].isspace():
            continue
        next_character = following.lstrip()[:1]
        preceding_word = re.search(r"([A-Za-z]+)$", markup[:index])
        if (
            preceding_word is not None
            and len(preceding_word.group(1)) <= 3
            and next_character.isupper()
        ):
            continue
        return markup[:index]
    return markup


def split_gcide_synonym_list(value: str) -> list[str]:
    values: list[str] = []
    start = 0
    square_depth = 0
    parenthesis_depth = 0
    for index, character in enumerate(value):
        if character == "[":
            square_depth += 1
            continue
        if character == "]" and square_depth:
            square_depth -= 1
            continue
        if character == "(":
            parenthesis_depth += 1
            continue
        if character == ")" and parenthesis_depth:
            parenthesis_depth -= 1
            continue
        if character not in {",", ";"} or square_depth or parenthesis_depth:
            continue
        if (
            character == ","
            and index > 0
            and index + 1 < len(value)
            and value[index - 1].isdigit()
            and value[index + 1].isdigit()
        ):
            continue
        values.append(value[start:index])
        start = index + 1
    values.append(value[start:])
    return values


def gcide_synonym_values(value: str) -> list[str]:
    lexical_markup = gcide_synonym_list_markup(value)
    # GCIDE uses <xex> for comparative usage prose inside <syn>. A source
    # segment that reaches that markup before a list boundary is commentary,
    # not a sequence of aliases.
    if re.search(r"<xex\b", lexical_markup, re.IGNORECASE):
        return []

    cleaned = clean_gcide_text(lexical_markup)
    synonyms: list[str] = []
    for raw in split_gcide_synonym_list(cleaned):
        synonym = raw.strip(" .\t\r\n")
        while GCIDE_TRAILING_QUALIFIER_RE.search(synonym):
            synonym = GCIDE_TRAILING_QUALIFIER_RE.sub("", synonym)
        synonym = re.sub(r"^(?:>?\s*(?:--|-|:)\s*)+", "", synonym)
        synonym = re.sub(r"(?:\s*(?:--|-|:)\s*)+$", "", synonym)
        synonym = re.sub(r"^To\s+", "", synonym, flags=re.IGNORECASE).strip()
        if synonym:
            synonyms.append(synonym)
    return synonyms


def finish_gcide_entry(state: GcideLexicalEntry, output: list[DictionaryEntry]) -> None:
    headwords = list(dict.fromkeys(value for value in state.headwords if value))
    definitions = [value for value in state.definitions if value]
    if not headwords or not definitions:
        return
    definition = "\n\n".join(definitions)
    output.extend(DictionaryEntry(headword, definition) for headword in headwords)


def populate_gcide_entry(state: GcideLexicalEntry, body: str) -> None:
    """Collect supported definition and alias content inside one lexical owner."""
    for match in GCIDE_CONTENT_TAG_RE.finditer(body):
        tag = match.group("tag").lower()
        content = match.group("body")
        if tag == "ent":
            # Within <entry main-word>, the wrapper owns lexical identity.  <ent>
            # remains meaningful only in the legacy paragraph compatibility path.
            continue
        if tag in {"def", "cd"}:
            definition = clean_gcide_text(content)
            if definition:
                state.definitions.append(definition)
            continue
        if tag in {"altname", "asp"}:
            alias = clean_gcide_text(content)
            if alias:
                state.headwords.append(alias)
            continue
        if tag == "syn":
            state.headwords.extend(gcide_synonym_values(content))


def gcide_main_word(attrs: str) -> str | None:
    match = GCIDE_MAIN_WORD_ATTR_RE.search(attrs)
    if match is None:
        return None
    value = clean_gcide_text(match.group("value"))
    return value or None


def parse_gcide_wrapped_entry(attrs: str, body: str) -> list[DictionaryEntry]:
    """Parse one later-GCIDE <entry main-word> lexical owner."""
    main_word = gcide_main_word(attrs)
    if main_word is None:
        return []
    state = GcideLexicalEntry(headwords=[main_word])
    populate_gcide_entry(state, body)
    entries: list[DictionaryEntry] = []
    finish_gcide_entry(state, entries)
    return entries


def parse_gcide_legacy_paragraphs(text: str) -> list[DictionaryEntry]:
    """Compatibility parser for older paragraph streams where <ent> owns entries."""
    entries: list[DictionaryEntry] = []
    current = GcideLexicalEntry()

    for paragraph in iter_gcide_paragraphs(text):
        events = [
            (match.group("tag").lower(), match.group("body"))
            for match in GCIDE_CONTENT_TAG_RE.finditer(paragraph)
        ]
        paragraph_entries = [
            clean_gcide_text(body) for tag, body in events if tag == "ent"
        ]
        paragraph_entries = [value for value in paragraph_entries if value]

        if paragraph_entries:
            finish_gcide_entry(current, entries)
            current = GcideLexicalEntry(headwords=paragraph_entries)
        elif not current.headwords:
            continue

        for tag, body in events:
            if tag == "ent":
                continue
            if tag in {"def", "cd"}:
                definition = clean_gcide_text(body)
                if definition:
                    current.definitions.append(definition)
                continue
            if tag in {"altname", "asp"}:
                alias = clean_gcide_text(body)
                if alias:
                    current.headwords.append(alias)
                continue
            if tag == "syn":
                current.headwords.extend(gcide_synonym_values(body))

    finish_gcide_entry(current, entries)
    return entries


def parse_gcide_data(data: bytes) -> list[DictionaryEntry]:
    """Parse supported GCIDE lexical boundaries without merging adjacent entries."""
    text = data.decode("iso-8859-1", errors="strict")
    entries: list[DictionaryEntry] = []
    outside_start = 0
    active_attrs: str | None = None
    active_body_start: int | None = None

    for boundary in GCIDE_ENTRY_BOUNDARY_RE.finditer(text):
        is_closing = boundary.group("closing") is not None
        if not is_closing:
            if active_body_start is None:
                entries.extend(parse_gcide_legacy_paragraphs(text[outside_start : boundary.start()]))
            else:
                # A new wrapper before the previous close is a lexical boundary,
                # not permission to merge two entries.  Parse the bounded body and
                # continue from the new owner.
                assert active_attrs is not None
                entries.extend(
                    parse_gcide_wrapped_entry(
                        active_attrs, text[active_body_start : boundary.start()]
                    )
                )
            active_attrs = boundary.group("attrs")
            active_body_start = boundary.end()
            continue

        if active_body_start is None:
            entries.extend(parse_gcide_legacy_paragraphs(text[outside_start : boundary.start()]))
            outside_start = boundary.end()
            continue

        assert active_attrs is not None
        entries.extend(
            parse_gcide_wrapped_entry(active_attrs, text[active_body_start : boundary.start()])
        )
        active_attrs = None
        active_body_start = None
        outside_start = boundary.end()

    if active_body_start is not None:
        assert active_attrs is not None
        entries.extend(parse_gcide_wrapped_entry(active_attrs, text[active_body_start:]))
    else:
        entries.extend(parse_gcide_legacy_paragraphs(text[outside_start:]))
    return entries


def read_gcide_entries(
    source: SourceArchive | DirectorySource, *, require_complete_alphabet: bool
) -> tuple[list[DictionaryEntry], bytes | None]:
    names = source.names()
    cide_names = [
        name
        for name in names
        if re.fullmatch(r"CIDE\.[A-Z]", PurePosixPath(name).name, re.IGNORECASE)
    ]
    if require_complete_alphabet and len(cide_names) != 26:
        raise ValueError(f"Expected 26 GCIDE CIDE.A-Z files; found {len(cide_names)}.")
    if not cide_names:
        raise ValueError("No GCIDE CIDE.A-Z source files were found.")
    entries: list[DictionaryEntry] = []
    for name in sorted(cide_names, key=lambda item: PurePosixPath(item).name.upper()):
        entries.extend(parse_gcide_data(source.read(name)))
    if not entries:
        raise ValueError("GCIDE source set produced no valid dictionary entries.")
    notice_name = find_optional_notice(names)
    notice = source.read(notice_name) if notice_name is not None else None
    return entries, notice


def build_stardict_resources(
    package_name: str,
    book_name: str,
    entries: Iterable[DictionaryEntry],
    source_url: str,
    aliases: Iterable[DictionaryAlias] = (),
) -> dict[str, bytes]:
    ordered = sorted(
        (entry for entry in entries if entry.definition),
        key=lambda entry: ascii_casefold_key(entry.headword),
    )
    if not ordered:
        raise ValueError(f"{book_name}: conversion produced no dictionary entries.")
    definition_bytes = bytearray()
    index_bytes = bytearray()
    headword_indices: dict[str, list[int]] = {}
    for index, entry in enumerate(ordered):
        encoded_definition = entry.definition.encode("utf-8")
        offset = len(definition_bytes)
        if offset > 0xFFFF_FFFF:
            raise ValueError(f"{book_name}: definition data exceeds StarDict 32-bit offsets.")
        if len(encoded_definition) > 0xFFFF_FFFF:
            raise ValueError(f"{book_name}: one definition is too large for StarDict.")
        definition_bytes.extend(encoded_definition)
        index_bytes.extend(entry.headword.encode("utf-8"))
        index_bytes.append(0)
        index_bytes.extend(struct.pack(">II", offset, len(encoded_definition)))
        headword_indices.setdefault(entry.headword, []).append(index)
    synonym_entries = set()
    for alias in aliases:
        targets = headword_indices.get(alias.target_headword)
        if not targets:
            raise ValueError(
                f"{book_name}: exception alias {alias.headword!r} references missing "
                f"lemma {alias.target_headword!r}."
            )
        for target in targets:
            synonym_entries.add((alias.headword, target))
    ordered_synonyms = sorted(
        synonym_entries,
        key=lambda item: (ascii_casefold_key(item[0]), item[1]),
    )
    synonym_bytes = bytearray()
    for alias, target in ordered_synonyms:
        synonym_bytes.extend(alias.encode("utf-8"))
        synonym_bytes.append(0)
        synonym_bytes.extend(struct.pack(">I", target))
    synonym_metadata = (
        f"synwordcount={len(ordered_synonyms)}\n" if ordered_synonyms else ""
    )
    ifo = (
        "StarDict's dict ifo file\n"
        f"version={STARDICT_VERSION}\n"
        f"bookname={book_name}\n"
        f"wordcount={len(ordered)}\n"
        f"idxfilesize={len(index_bytes)}\n"
        f"{synonym_metadata}"
        "sametypesequence=m\n"
        f"website={source_url}\n"
    ).encode("utf-8")
    resources = {
        f"{package_name}.ifo": ifo,
        f"{package_name}.idx": bytes(index_bytes),
        f"{package_name}.dict": bytes(definition_bytes),
    }
    if synonym_bytes:
        resources[f"{package_name}.syn"] = bytes(synonym_bytes)
    return resources


def deterministic_tar(resources: Mapping[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        roots = sorted({PurePosixPath(name).parts[0] for name in resources})
        for root in roots:
            info = tarfile.TarInfo(root)
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            archive.addfile(info)
        for name in sorted(resources):
            data = resources[name]
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            info.mtime = 0
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def build_package(
    spec: SourceSpec,
    entries: Sequence[DictionaryEntry],
    notice: bytes | None,
    *,
    aliases: Sequence[DictionaryAlias] = (),
    package_stem: str | None = None,
    fixture: bool = False,
) -> BuiltPackage:
    stem = package_stem or spec.id
    if notice is None:
        raise ValueError(f"{spec.name}: source does not contain a redistributable license notice.")
    resources = build_stardict_resources(
        stem, spec.name, entries, spec.source_url, aliases
    )
    package_root = stem
    tar_resources = {f"{package_root}/{name}": data for name, data in resources.items()}
    provenance = [
        spec.name,
        "",
        f"Dictionary source: {spec.source_url}",
        f"License: {spec.license_name}",
        f"License URL: {spec.license_url}",
        f"Conversion repository: {ARCHEION_REPOSITORY}",
        "Conversion script: scripts/dictionaries/build_english_catalog_packages.py",
        f"Conversion script SHA-256: {sha256_file(Path(__file__).resolve())}",
        "Conversion configuration: scripts/dictionaries/english_catalog_sources.json",
        f"Conversion configuration SHA-256: {sha256_file(DEFAULT_CONFIG)}",
        "Conversion: deterministic Archeion maintenance tooling into StarDict 2.4.2.",
    ]
    if fixture:
        provenance.extend(
            [
                "Representative fixture: yes; this package is test data, not a production source conversion.",
            ]
        )
    else:
        if spec.license_notice_path is not None:
            provenance.extend(
                [
                    f"License notice source: {spec.license_notice_url}",
                    f"License notice SHA-256: {spec.license_notice_sha256}",
                ]
            )
        provenance.extend(
            [
                f"Source archive file: {spec.source_archive_name}",
                f"Source archive URL: {spec.source_archive_url}",
                f"Source archive size bytes: {spec.source_archive_size_bytes}",
                f"Source archive SHA-256: {spec.source_archive_sha256}",
                "Representation: this StarDict package is a converted form, not the original source representation.",
            ]
        )
    readme = ("\n".join(provenance) + "\n").encode("utf-8")
    tar_resources[f"{package_root}/README"] = readme
    notice_name = "COPYING" if spec.source_format == "gcide" else "LICENSE"
    tar_resources[f"{package_root}/{notice_name}"] = notice
    tar_bytes = deterministic_tar(tar_resources)
    package_bytes = lzma.compress(
        tar_bytes, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=6
    )
    installed_size = sum(len(value) for value in resources.values())
    return BuiltPackage(package_bytes, installed_size, len(entries))


def convert_source(
    spec: SourceSpec,
    source: SourceArchive | DirectorySource,
    *,
    fixture: bool = False,
) -> tuple[list[DictionaryEntry], list[DictionaryAlias], bytes | None]:
    if spec.source_format == "wndb":
        entries, aliases, notice = read_wordnet_entries(source)
        if notice is None:
            notice = load_pinned_license_notice(spec)
        return entries, aliases, notice
    if spec.source_format == "gcide":
        entries, notice = read_gcide_entries(
            source, require_complete_alphabet=not fixture
        )
        return entries, [], notice
    raise ValueError(f"Unsupported source format: {spec.source_format}")


def catalog_entry(spec: SourceSpec, built: BuiltPackage) -> dict[str, object]:
    return {
        "id": spec.id,
        "name": spec.name,
        "sourceLanguage": spec.source_language,
        "targetLanguage": spec.target_language,
        "sourceAttribution": spec.source_attribution,
        "sourceUrl": spec.source_url,
        "licenseName": spec.license_name,
        "licenseUrl": spec.license_url,
        "packageVersion": spec.package_version,
        "compressedSizeBytes": len(built.bytes),
        "installedSizeEstimateBytes": built.installed_size_bytes,
        "downloadUrl": f"{DOWNLOAD_BASE}/{spec.package_file_name}",
        "packageFormat": "stardict-tar-xz",
        "sha256": sha256_bytes(built.bytes),
    }


def build_candidates(args: argparse.Namespace) -> None:
    args.receipt.unlink(missing_ok=True)
    specs = load_specs(DEFAULT_CONFIG)
    supplied = {
        "princeton-wordnet-3-0": args.princeton,
        "open-english-wordnet-2025-plus": args.oewn,
        "gcide-0-54": args.gcide,
    }
    built_packages: list[tuple[SourceSpec, BuiltPackage]] = []
    entries = []
    for spec in specs:
        source_path = supplied[spec.id]
        verify_source_archive(source_path, spec)
        with SourceArchive(source_path) as source:
            converted, aliases, notice = convert_source(spec, source)
        built = build_package(spec, converted, notice, aliases=aliases)
        built_packages.append((spec, built))
        entries.append(catalog_entry(spec, built))
        print(
            f"{spec.id}: {len(converted)} entries, {len(built.bytes)} compressed bytes, "
            f"sha256={sha256_bytes(built.bytes)}"
        )

    catalog_bytes = (
        json.dumps({"schemaVersion": 1, "dictionaries": entries}, indent=2) + "\n"
    ).encode("utf-8")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.catalog.parent.mkdir(parents=True, exist_ok=True)
    for spec, built in built_packages:
        replace_file_atomically(args.output_dir / spec.package_file_name, built.bytes)
    replace_file_atomically(args.catalog, catalog_bytes)

    print(
        "candidate set built; native validation is required before publication: "
        f"{args.catalog}"
    )


def package_file_name_from_entry(entry: Mapping[str, object]) -> str:
    download_url = str(entry["downloadUrl"])
    name = download_url.rsplit("/", 1)[-1]
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise ValueError(f"Invalid package filename in download URL: {download_url}")
    return name


def load_candidate_manifest(path: Path) -> tuple[bytes, list[dict[str, object]]]:
    catalog_bytes = path.read_bytes()
    raw = json.loads(catalog_bytes)
    if raw.get("schemaVersion") != 1 or not isinstance(raw.get("dictionaries"), list):
        raise ValueError("Candidate catalog must use dictionary catalog schema version 1.")
    entries = raw["dictionaries"]
    if not all(isinstance(entry, dict) for entry in entries):
        raise ValueError("Candidate catalog dictionaries must be objects.")
    return catalog_bytes, entries


def candidate_metadata(
    candidate_dir: Path, catalog_path: Path
) -> tuple[bytes, list[dict[str, object]], list[dict[str, object]]]:
    catalog_bytes, entries = load_candidate_manifest(catalog_path)
    for entry in entries:
        if "description" in entry:
            raise ValueError(
                "English candidate catalog entries must not contain the retired description field."
            )
    expected_ids = [spec.id for spec in load_specs(DEFAULT_CONFIG)]
    actual_ids = [str(entry.get("id", "")) for entry in entries]
    if actual_ids != expected_ids:
        raise ValueError(
            f"English candidate catalog must contain {expected_ids!r} in configured order; "
            f"got {actual_ids!r}."
        )

    packages: list[dict[str, object]] = []
    specs_by_id = {spec.id: spec for spec in load_specs(DEFAULT_CONFIG)}
    for entry in entries:
        spec = specs_by_id[str(entry["id"])]
        expected_metadata: dict[str, object] = {
            "name": spec.name,
            "sourceLanguage": spec.source_language,
            "targetLanguage": spec.target_language,
            "sourceAttribution": spec.source_attribution,
            "sourceUrl": spec.source_url,
            "licenseName": spec.license_name,
            "licenseUrl": spec.license_url,
            "packageVersion": spec.package_version,
            "downloadUrl": f"{DOWNLOAD_BASE}/{spec.package_file_name}",
            "packageFormat": "stardict-tar-xz",
        }
        for field, expected in expected_metadata.items():
            if entry.get(field) != expected:
                raise ValueError(
                    f"{spec.id}: candidate {field} does not match the pinned source configuration."
                )
        installed_size = entry.get("installedSizeEstimateBytes")
        if not isinstance(installed_size, int) or installed_size <= 0:
            raise ValueError(f"{spec.id}: candidate installed-size estimate must be positive.")
        file_name = package_file_name_from_entry(entry)
        package_path = candidate_dir / file_name
        if not package_path.is_file():
            raise ValueError(f"Candidate package is missing: {package_path}")
        size = package_path.stat().st_size
        digest = sha256_file(package_path)
        if size != int(entry.get("compressedSizeBytes", 0)):
            raise ValueError(
                f"{spec.id}: candidate compressed size does not match package bytes."
            )
        if digest != str(entry.get("sha256", "")).lower():
            raise ValueError(f"{spec.id}: candidate SHA-256 does not match package bytes.")
        packages.append(
            {
                "id": entry["id"],
                "fileName": file_name,
                "compressedSizeBytes": size,
                "sha256": digest,
            }
        )
    return catalog_bytes, entries, packages


def validation_environment(
    candidate_dir: Path, catalog: Path, receipt: Path
) -> dict[str, str]:
    environment = os.environ.copy()
    environment["ARCHEION_ENGLISH_CANDIDATE_DIR"] = str(candidate_dir.resolve())
    environment["ARCHEION_ENGLISH_CANDIDATE_CATALOG"] = str(catalog.resolve())
    environment["ARCHEION_ENGLISH_VALIDATION_RECEIPT"] = str(receipt.resolve())
    return environment


def cargo_test_command(cargo: str, manifest_path: Path, test_filter: str) -> list[str]:
    return [
        cargo,
        "test",
        "--manifest-path",
        str(manifest_path),
        "--locked",
        "--lib",
        test_filter,
        "--",
        "--ignored",
    ]


def validate_receipt(candidate_dir: Path, catalog: Path, receipt: Path) -> None:
    catalog_bytes, _, packages = candidate_metadata(candidate_dir, catalog)
    raw = json.loads(receipt.read_text(encoding="utf-8"))
    if raw.get("schemaVersion") != 1:
        raise ValueError("Unsupported English candidate validation receipt schema.")
    if raw.get("catalogSha256") != sha256_bytes(catalog_bytes):
        raise ValueError("Validation receipt does not match the current candidate catalog bytes.")
    if raw.get("packages") != packages:
        raise ValueError("Validation receipt does not match the current candidate package bytes.")


def validate_candidates(args: argparse.Namespace) -> None:
    candidate_metadata(args.candidate_dir, args.catalog)
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.unlink(missing_ok=True)
    command = cargo_test_command(
        args.cargo,
        args.manifest_path,
        "generated_english_candidates_install_index_activate_and_lookup",
    )
    subprocess.run(
        command,
        cwd=ROOT,
        env=validation_environment(args.candidate_dir, args.catalog, args.receipt),
        check=True,
    )
    if not args.receipt.is_file():
        raise ValueError("Native candidate validation completed without producing a receipt.")
    validate_receipt(args.candidate_dir, args.catalog, args.receipt)
    print(f"validated candidate set: {args.receipt}")


def replace_file_atomically(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False
    ) as stream:
        temporary = Path(stream.name)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def publish_candidates(args: argparse.Namespace) -> None:
    validate_receipt(args.candidate_dir, args.candidate_catalog, args.receipt)
    catalog_bytes, _, packages = candidate_metadata(args.candidate_dir, args.candidate_catalog)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for package in packages:
        source = args.candidate_dir / str(package["fileName"])
        destination = args.output_dir / str(package["fileName"])
        if destination.exists():
            if (
                destination.stat().st_size != int(package["compressedSizeBytes"])
                or sha256_file(destination) != package["sha256"]
            ):
                raise ValueError(
                    f"Published package path already contains different bytes: {destination}"
                )
            continue
        with tempfile.NamedTemporaryFile(
            dir=args.output_dir,
            prefix=f".{destination.name}.",
            suffix=".tmp",
            delete=False,
        ) as stream:
            temporary = Path(stream.name)
            with source.open("rb") as source_stream:
                shutil.copyfileobj(source_stream, stream)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)

    for package in packages:
        destination = args.output_dir / str(package["fileName"])
        if not destination.is_file():
            raise ValueError(f"Published package is missing: {destination}")
        if (
            destination.stat().st_size != int(package["compressedSizeBytes"])
            or sha256_file(destination) != package["sha256"]
        ):
            raise ValueError(f"Published package bytes do not match the candidate: {destination}")

    previous_catalog = args.catalog.read_bytes() if args.catalog.exists() else None
    replace_file_atomically(args.catalog, catalog_bytes)
    if args.catalog.resolve() == DEFAULT_CATALOG.resolve():
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
            if previous_catalog is None:
                args.catalog.unlink(missing_ok=True)
            else:
                replace_file_atomically(args.catalog, previous_catalog)
            raise
    print(f"published English dictionary catalog: {args.catalog}")


def fixture_specs() -> list[SourceSpec]:
    production = {spec.id: spec for spec in load_specs(DEFAULT_CONFIG)}
    return [
        production["princeton-wordnet-3-0"],
        production["open-english-wordnet-2025-plus"],
        production["gcide-0-54"],
    ]


def fixture_source_dir(spec: SourceSpec) -> Path:
    return FIXTURE_SOURCE_ROOT / {
        "princeton-wordnet-3-0": "princeton",
        "open-english-wordnet-2025-plus": "oewn",
        "gcide-0-54": "gcide",
    }[spec.id]


def fixture_package_name(spec: SourceSpec) -> str:
    return {
        "princeton-wordnet-3-0": "princeton-wordnet-representative.stardict.tar.xz",
        "open-english-wordnet-2025-plus": "open-english-wordnet-representative.stardict.tar.xz",
        "gcide-0-54": "gcide-representative.stardict.tar.xz",
    }[spec.id]


def build_fixture_bytes(spec: SourceSpec) -> bytes:
    with DirectorySource(fixture_source_dir(spec)) as source:
        converted, aliases, notice = convert_source(spec, source, fixture=True)
    stem = fixture_package_name(spec).removesuffix(".stardict.tar.xz")
    return build_package(
        spec,
        converted,
        notice,
        aliases=aliases,
        package_stem=stem,
        fixture=True,
    ).bytes


def write_fixtures(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for spec in fixture_specs():
        output = output_dir / fixture_package_name(spec)
        data = build_fixture_bytes(spec)
        output.write_bytes(data)
        print(f"wrote {output.relative_to(ROOT)} ({len(data)} bytes, sha256={sha256_bytes(data)})")


def verify_fixtures(output_dir: Path) -> None:
    for spec in fixture_specs():
        path = output_dir / fixture_package_name(spec)
        expected = path.read_bytes()
        actual = build_fixture_bytes(spec)
        if actual != expected:
            raise SystemExit(
                f"Fixture drift: {path.relative_to(ROOT)}. Regenerate with write-fixtures."
            )
        print(f"verified {path.relative_to(ROOT)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser(
        "build", help="build all production English packages into a candidate set"
    )
    build.add_argument("--princeton", type=Path, required=True)
    build.add_argument("--oewn", type=Path, required=True)
    build.add_argument("--gcide", type=Path, required=True)
    build.add_argument("--output-dir", type=Path, default=DEFAULT_CANDIDATE_OUTPUT)
    build.add_argument("--catalog", type=Path, default=DEFAULT_CANDIDATE_CATALOG)
    build.add_argument("--receipt", type=Path, default=DEFAULT_VALIDATION_RECEIPT)

    validate = subparsers.add_parser(
        "validate", help="validate exact candidate packages through native dictionary owners"
    )
    validate.add_argument("--candidate-dir", type=Path, default=DEFAULT_CANDIDATE_OUTPUT)
    validate.add_argument("--catalog", type=Path, default=DEFAULT_CANDIDATE_CATALOG)
    validate.add_argument("--receipt", type=Path, default=DEFAULT_VALIDATION_RECEIPT)
    validate.add_argument("--cargo", default="cargo")
    validate.add_argument("--manifest-path", type=Path, default=DEFAULT_CARGO_MANIFEST)

    publish = subparsers.add_parser(
        "publish", help="publish a natively validated English candidate set"
    )
    publish.add_argument("--candidate-dir", type=Path, default=DEFAULT_CANDIDATE_OUTPUT)
    publish.add_argument("--candidate-catalog", type=Path, default=DEFAULT_CANDIDATE_CATALOG)
    publish.add_argument("--receipt", type=Path, default=DEFAULT_VALIDATION_RECEIPT)
    publish.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    publish.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    publish.add_argument("--cargo", default="cargo")
    publish.add_argument("--manifest-path", type=Path, default=DEFAULT_CARGO_MANIFEST)

    write = subparsers.add_parser("write-fixtures", help="regenerate representative packages")
    write.add_argument("--output-dir", type=Path, default=FIXTURE_OUTPUT_ROOT)

    verify = subparsers.add_parser("verify-fixtures", help="verify deterministic fixture bytes")
    verify.add_argument("--output-dir", type=Path, default=FIXTURE_OUTPUT_ROOT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        if args.command == "build":
            build_candidates(args)
        elif args.command == "validate":
            validate_candidates(args)
        elif args.command == "publish":
            publish_candidates(args)
        elif args.command == "write-fixtures":
            write_fixtures(args.output_dir)
        else:
            verify_fixtures(args.output_dir)
    except (
        OSError,
        ValueError,
        json.JSONDecodeError,
        subprocess.CalledProcessError,
        tarfile.TarError,
        zipfile.BadZipFile,
        lzma.LZMAError,
    ) as error:
        raise SystemExit(f"dictionary package build failed: {error}") from error


if __name__ == "__main__":
    main()
