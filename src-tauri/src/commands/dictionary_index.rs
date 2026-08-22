use std::{
    collections::{BTreeSet, HashSet},
    fs,
    path::Path,
};

use rusqlite::{params, params_from_iter, types::Value, Connection, Transaction};

use super::{
    dictionary_store::{DictionaryIndexState, DictionaryStore, DictionaryStoreError},
    stardict_validation::{self, ValidatedStarDictPackage},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DictionaryLookupEntry {
    pub dictionary_id: String,
    pub dictionary_name: String,
    pub source_attribution: String,
    pub source_ordinal: u32,
    pub display_headword: String,
    pub definition_offset: u64,
    pub definition_length: u32,
}

pub(crate) fn normalize_dictionary_term(term: &str) -> String {
    let collapsed = term.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut normalized = collapsed.as_str();
    loop {
        let stripped = normalized
            .trim()
            .trim_matches(is_surrounding_punctuation)
            .trim();
        if stripped.len() == normalized.len() {
            break;
        }
        normalized = stripped;
    }
    normalized.chars().flat_map(char::to_lowercase).collect()
}

fn is_surrounding_punctuation(character: char) -> bool {
    matches!(
        character,
        '.' | ','
            | ';'
            | ':'
            | '!'
            | '?'
            | '¡'
            | '¿'
            | '"'
            | '\''
            | '“'
            | '”'
            | '‘'
            | '’'
            | '('
            | ')'
            | '['
            | ']'
            | '{'
            | '}'
            | '<'
            | '>'
    )
}

pub(crate) fn replace_dictionary_index_in_transaction(
    transaction: &Transaction<'_>,
    dictionary_id: &str,
    package: &ValidatedStarDictPackage,
    installed_definition_bytes: u64,
) -> Result<(), DictionaryStoreError> {
    validate_package_bounds(package, installed_definition_bytes)?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM installed_dictionaries WHERE dictionary_id = ?1)",
        [dictionary_id],
        |row| row.get(0),
    )?;
    if !exists {
        return Err(DictionaryStoreError::InvalidDictionaryId);
    }

    transaction.execute(
        "DELETE FROM dictionary_entries WHERE dictionary_id = ?1",
        [dictionary_id],
    )?;
    {
        let mut insert_entry = transaction.prepare(
            "INSERT INTO dictionary_entries (
                dictionary_id, source_ordinal, normalized_headword, display_headword,
                definition_offset, definition_length
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (ordinal, entry) in package.entries.iter().enumerate() {
            let normalized = normalize_dictionary_term(&entry.word);
            if normalized.is_empty() {
                return Err(DictionaryStoreError::InvalidIndex(
                    "Dictionary index contains an empty normalized headword.".to_string(),
                ));
            }
            insert_entry.execute(params![
                dictionary_id,
                to_sql_integer(ordinal as u64, "source ordinal")?,
                normalized,
                entry.word,
                to_sql_integer(entry.definition_offset, "definition offset")?,
                i64::from(entry.definition_size),
            ])?;
        }
    }
    {
        let mut inserted_aliases = HashSet::new();
        let mut insert_alias = transaction.prepare(
            "INSERT INTO dictionary_aliases (
                dictionary_id, normalized_alias, source_ordinal
             ) VALUES (?1, ?2, ?3)",
        )?;
        for synonym in &package.synonyms {
            let normalized = normalize_dictionary_term(&synonym.word);
            if normalized.is_empty() {
                return Err(DictionaryStoreError::InvalidIndex(
                    "Dictionary index contains an empty normalized synonym.".to_string(),
                ));
            }
            if inserted_aliases.insert((normalized.clone(), synonym.target_index)) {
                insert_alias.execute(params![
                    dictionary_id,
                    normalized,
                    i64::from(synonym.target_index),
                ])?;
            }
        }
    }
    transaction.execute(
        "UPDATE installed_dictionaries
         SET entry_count = ?1, index_state = ?2
         WHERE dictionary_id = ?3",
        params![
            to_sql_integer(package.entries.len() as u64, "entry count")?,
            DictionaryIndexState::Ready.as_database_value(),
            dictionary_id,
        ],
    )?;
    Ok(())
}

pub(crate) fn dictionary_index_is_current(
    connection: &Connection,
    dictionary_id: &str,
    package: &ValidatedStarDictPackage,
) -> Result<bool, DictionaryStoreError> {
    let mut statement = connection.prepare(
        "SELECT source_ordinal, normalized_headword, display_headword,
                definition_offset, definition_length
         FROM dictionary_entries
         WHERE dictionary_id = ?1
         ORDER BY source_ordinal",
    )?;
    let mut rows = statement.query([dictionary_id])?;
    for (expected_ordinal, expected) in package.entries.iter().enumerate() {
        let Some(row) = rows.next()? else {
            return Ok(false);
        };
        let ordinal: i64 = row.get(0)?;
        let definition_offset: i64 = row.get(3)?;
        let definition_length: i64 = row.get(4)?;
        if ordinal != to_sql_integer(expected_ordinal as u64, "source ordinal")?
            || row.get::<_, String>(1)? != normalize_dictionary_term(&expected.word)
            || row.get::<_, String>(2)? != expected.word
            || definition_offset != to_sql_integer(expected.definition_offset, "definition offset")?
            || definition_length != i64::from(expected.definition_size)
        {
            return Ok(false);
        }
    }
    if rows.next()?.is_some() {
        return Ok(false);
    }

    let expected_aliases = package
        .synonyms
        .iter()
        .map(|synonym| {
            (
                normalize_dictionary_term(&synonym.word),
                synonym.target_index,
            )
        })
        .collect::<BTreeSet<_>>();
    let mut statement = connection.prepare(
        "SELECT normalized_alias, source_ordinal
         FROM dictionary_aliases
         WHERE dictionary_id = ?1
         ORDER BY normalized_alias, source_ordinal",
    )?;
    let actual_aliases = statement
        .query_map([dictionary_id], |row| {
            let ordinal: i64 = row.get(1)?;
            Ok((
                row.get::<_, String>(0)?,
                u32::try_from(ordinal).map_err(|_| conversion_error())?,
            ))
        })?
        .collect::<Result<BTreeSet<_>, _>>()?;
    Ok(actual_aliases == expected_aliases)
}

pub(crate) fn lookup_exact(
    connection: &Connection,
    headword: &str,
    maximum_results: usize,
) -> Result<Vec<DictionaryLookupEntry>, DictionaryStoreError> {
    let normalized = normalize_dictionary_term(headword);
    if normalized.is_empty() || maximum_results == 0 {
        return Ok(Vec::new());
    }
    lookup_terms(connection, &[normalized], maximum_results, false)
}

pub(crate) fn lookup_english_lemmas(
    connection: &Connection,
    lemmas: &[String],
    maximum_results: usize,
) -> Result<Vec<DictionaryLookupEntry>, DictionaryStoreError> {
    let normalized = lemmas
        .iter()
        .map(|lemma| normalize_dictionary_term(lemma))
        .filter(|lemma| !lemma.is_empty())
        .collect::<Vec<_>>();
    if normalized.is_empty() || maximum_results == 0 {
        return Ok(Vec::new());
    }
    lookup_terms(connection, &normalized, maximum_results, true)
}

fn lookup_terms(
    connection: &Connection,
    terms: &[String],
    maximum_results: usize,
    english_only: bool,
) -> Result<Vec<DictionaryLookupEntry>, DictionaryStoreError> {
    let values = (0..terms.len())
        .map(|index| format!("(?{}, {index})", index + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let language_filter = if english_only {
        "AND dictionary.source_language = 'en' AND dictionary.target_language = 'en'"
    } else {
        ""
    };
    let limit_parameter = terms.len() + 1;
    let sql = format!(
        "WITH query_terms(normalized_headword, candidate_priority) AS (VALUES {values}),
         raw_matches AS (
            SELECT dictionary_id, source_ordinal, display_headword,
                   definition_offset, definition_length, query.candidate_priority
            FROM dictionary_entries AS entry
            JOIN query_terms AS query
              ON query.normalized_headword = entry.normalized_headword
            UNION ALL
            SELECT entry.dictionary_id, entry.source_ordinal, entry.display_headword,
                   entry.definition_offset, entry.definition_length, query.candidate_priority
            FROM dictionary_aliases AS alias
            JOIN dictionary_entries AS entry
              ON entry.dictionary_id = alias.dictionary_id
             AND entry.source_ordinal = alias.source_ordinal
            JOIN query_terms AS query
              ON query.normalized_headword = alias.normalized_alias
         ),
         matched_entries AS (
            SELECT dictionary_id, source_ordinal, display_headword,
                   definition_offset, definition_length,
                   MIN(candidate_priority) AS candidate_priority
            FROM raw_matches
            GROUP BY dictionary_id, source_ordinal, display_headword,
                     definition_offset, definition_length
         )
         SELECT
            matched.dictionary_id,
            dictionary.display_name,
            dictionary.source_attribution,
            matched.source_ordinal,
            matched.display_headword,
            matched.definition_offset,
            matched.definition_length
         FROM matched_entries AS matched
         JOIN installed_dictionaries AS dictionary
           ON dictionary.dictionary_id = matched.dictionary_id
         WHERE dictionary.enabled = 1
           AND dictionary.index_state = 'ready'
           {language_filter}
         ORDER BY dictionary.sort_order, matched.dictionary_id,
                  matched.candidate_priority, matched.source_ordinal
         LIMIT ?{limit_parameter}"
    );
    let mut statement = connection.prepare(&sql)?;
    let maximum_results = i64::try_from(maximum_results)
        .map_err(|_| DictionaryStoreError::NumericOverflow("lookup result limit"))?;
    let mut parameters = terms.iter().cloned().map(Value::Text).collect::<Vec<_>>();
    parameters.push(Value::Integer(maximum_results));
    let rows = statement.query_map(params_from_iter(parameters.iter()), |row| {
        let source_ordinal: i64 = row.get(3)?;
        let definition_offset: i64 = row.get(5)?;
        let definition_length: i64 = row.get(6)?;
        Ok(DictionaryLookupEntry {
            dictionary_id: row.get(0)?,
            dictionary_name: row.get(1)?,
            source_attribution: row.get(2)?,
            source_ordinal: u32::try_from(source_ordinal).map_err(|_| conversion_error())?,
            display_headword: row.get(4)?,
            definition_offset: u64::try_from(definition_offset).map_err(|_| conversion_error())?,
            definition_length: u32::try_from(definition_length).map_err(|_| conversion_error())?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(DictionaryStoreError::from)
}

pub(crate) fn rebuild_dictionary_index(
    store: &mut DictionaryStore,
    dictionary_id: &str,
) -> Result<(), DictionaryStoreError> {
    let installed_path = store.installed_path(dictionary_id)?;
    let package = validate_installed_package(&installed_path)?;
    let installed_definition_bytes = package.definition_data.expanded_bytes;
    store.replace_index(dictionary_id, &package, installed_definition_bytes)
}

pub(crate) fn validate_installed_package(
    installed_path: &Path,
) -> Result<ValidatedStarDictPackage, DictionaryStoreError> {
    let metadata = fs::symlink_metadata(installed_path)?;
    if !metadata.file_type().is_dir() {
        return Err(DictionaryStoreError::InvalidIndex(
            "Installed dictionary storage is not a regular directory.".to_string(),
        ));
    }
    let ifo_path = find_installed_ifo(installed_path)?;
    stardict_validation::validate_package(&ifo_path)
        .map_err(|error| DictionaryStoreError::InvalidIndex(error.to_string()))
}

fn find_installed_ifo(installed_path: &Path) -> Result<std::path::PathBuf, DictionaryStoreError> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(installed_path)? {
        let path = entry?.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("ifo") {
            candidates.push(path);
        }
    }
    candidates.sort();
    if candidates.len() != 1 {
        return Err(DictionaryStoreError::InvalidIndex(
            "Installed dictionary must contain exactly one StarDict .ifo file.".to_string(),
        ));
    }
    Ok(candidates.remove(0))
}

fn validate_package_bounds(
    package: &ValidatedStarDictPackage,
    installed_definition_bytes: u64,
) -> Result<(), DictionaryStoreError> {
    if package.definition_data.expanded_bytes != installed_definition_bytes {
        return Err(DictionaryStoreError::InvalidIndex(
            "Installed dictionary definition size does not match the validated package."
                .to_string(),
        ));
    }
    if package.entries.len() != package.metadata.word_count as usize {
        return Err(DictionaryStoreError::InvalidIndex(
            "Dictionary index entry count does not match validated metadata.".to_string(),
        ));
    }
    for entry in &package.entries {
        let end = entry
            .definition_offset
            .checked_add(u64::from(entry.definition_size))
            .filter(|end| *end <= installed_definition_bytes)
            .ok_or_else(|| {
                DictionaryStoreError::InvalidIndex(
                    "Dictionary entry points outside the installed definition payload.".to_string(),
                )
            })?;
        debug_assert!(end <= installed_definition_bytes);
    }
    if package
        .synonyms
        .iter()
        .any(|synonym| synonym.target_index as usize >= package.entries.len())
    {
        return Err(DictionaryStoreError::InvalidIndex(
            "Dictionary synonym references a missing source entry.".to_string(),
        ));
    }
    Ok(())
}

fn to_sql_integer(value: u64, field: &'static str) -> Result<i64, DictionaryStoreError> {
    i64::try_from(value).map_err(|_| DictionaryStoreError::NumericOverflow(field))
}

fn conversion_error() -> rusqlite::Error {
    rusqlite::Error::IntegralValueOutOfRange(0, 0)
}

#[cfg(test)]
#[path = "dictionary_index_tests.rs"]
mod tests;
