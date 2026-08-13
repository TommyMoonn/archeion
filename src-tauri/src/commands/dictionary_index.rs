use std::{collections::HashSet, fs, path::Path};

use rusqlite::{params, Connection, Transaction};

use super::{
    dictionary_store::{DictionaryIndexState, DictionaryStore, DictionaryStoreError},
    stardict_validation::{self, ValidatedStarDictPackage},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DictionaryLookupEntry {
    pub dictionary_id: String,
    pub source_ordinal: u32,
    pub display_headword: String,
    pub definition_offset: u64,
    pub definition_length: u32,
}

pub(crate) fn normalize_headword(headword: &str) -> String {
    headword
        .trim()
        .chars()
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) fn replace_dictionary_index(
    connection: &mut Connection,
    dictionary_id: &str,
    package: &ValidatedStarDictPackage,
    installed_definition_bytes: u64,
) -> Result<(), DictionaryStoreError> {
    let transaction = connection.transaction()?;
    replace_dictionary_index_in_transaction(
        &transaction,
        dictionary_id,
        package,
        installed_definition_bytes,
    )?;
    transaction.commit()?;
    Ok(())
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
            let normalized = normalize_headword(&entry.word);
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
            let normalized = normalize_headword(&synonym.word);
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

pub(crate) fn lookup_exact(
    connection: &Connection,
    headword: &str,
) -> Result<Vec<DictionaryLookupEntry>, DictionaryStoreError> {
    let normalized = normalize_headword(headword);
    if normalized.is_empty() {
        return Ok(Vec::new());
    }
    let mut statement = connection.prepare(
        "WITH matched_entries AS (
            SELECT dictionary_id, source_ordinal, display_headword,
                   definition_offset, definition_length
            FROM dictionary_entries
            WHERE normalized_headword = ?1
            UNION
            SELECT entry.dictionary_id, entry.source_ordinal, entry.display_headword,
                   entry.definition_offset, entry.definition_length
            FROM dictionary_aliases AS alias
            JOIN dictionary_entries AS entry
              ON entry.dictionary_id = alias.dictionary_id
             AND entry.source_ordinal = alias.source_ordinal
            WHERE alias.normalized_alias = ?1
         )
         SELECT
            matched.dictionary_id,
            matched.source_ordinal,
            matched.display_headword,
            matched.definition_offset,
            matched.definition_length
         FROM matched_entries AS matched
         JOIN installed_dictionaries AS dictionary
           ON dictionary.dictionary_id = matched.dictionary_id
         WHERE dictionary.enabled = 1
           AND dictionary.index_state = 'ready'
         ORDER BY dictionary.sort_order, matched.dictionary_id, matched.source_ordinal",
    )?;
    let rows = statement.query_map([normalized], |row| {
        let source_ordinal: i64 = row.get(1)?;
        let definition_offset: i64 = row.get(3)?;
        let definition_length: i64 = row.get(4)?;
        Ok(DictionaryLookupEntry {
            dictionary_id: row.get(0)?,
            source_ordinal: u32::try_from(source_ordinal).map_err(|_| conversion_error())?,
            display_headword: row.get(2)?,
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
    let ifo_path = find_installed_ifo(&installed_path)?;
    let package = stardict_validation::validate_package(&ifo_path)
        .map_err(|error| DictionaryStoreError::InvalidIndex(error.to_string()))?;
    let installed_definition_bytes = package.definition_data.expanded_bytes;
    store.replace_index(dictionary_id, &package, installed_definition_bytes)
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
