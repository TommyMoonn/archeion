#![cfg(target_os = "windows")]

use rusqlite::{params, Connection};

#[test]
fn bundled_sqlite_executes_indexed_queries() -> rusqlite::Result<()> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "CREATE TABLE entries (
            id INTEGER PRIMARY KEY,
            headword TEXT NOT NULL,
            definition TEXT NOT NULL
        );
        CREATE INDEX entries_headword_idx ON entries(headword);",
    )?;
    connection.execute(
        "INSERT INTO entries (headword, definition) VALUES (?1, ?2)",
        params!["archive", "A collection of records."],
    )?;

    let definition: String = connection.query_row(
        "SELECT definition FROM entries WHERE headword = ?1",
        ["archive"],
        |row| row.get(0),
    )?;

    assert_eq!(definition, "A collection of records.");
    Ok(())
}

#[test]
fn bundled_sqlite_exposes_fts5() -> rusqlite::Result<()> {
    let connection = Connection::open_in_memory()?;
    connection.execute_batch(
        "CREATE VIRTUAL TABLE searchable_entries USING fts5(headword, definition);
        INSERT INTO searchable_entries (headword, definition)
        VALUES ('archive', 'A collection of records.');",
    )?;

    let headword: String = connection.query_row(
        "SELECT headword FROM searchable_entries WHERE searchable_entries MATCH ?1",
        ["collection"],
        |row| row.get(0),
    )?;

    assert_eq!(headword, "archive");
    Ok(())
}
