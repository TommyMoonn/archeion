# Archeion annotation export format

Archeion JSON annotation exports use the schema identifier
`archeion.annotation-export`. The current version is `1`.

```json
{
  "schema": "archeion.annotation-export",
  "version": 1,
  "exportedAt": "2026-07-13T12:00:00.000Z",
  "books": [
    {
      "id": "book-id",
      "title": "Book title",
      "author": "Book author",
      "annotations": [
        {
          "chapterLabel": "Chapter One",
          "annotation": {
            "id": "annotation-id",
            "type": "highlight",
            "cfiRange": "epubcfi(...)",
            "selectedText": "Quoted passage",
            "color": "yellow",
            "note": "An optional attached note",
            "createdAt": "2026-07-01T00:00:00.000Z",
            "updatedAt": "2026-07-01T00:00:00.000Z"
          }
        }
      ]
    }
  ]
}
```

Each bookmark or highlight is one record. A highlight's optional note remains
inside that highlight record; notes are not exported as standalone annotations.
Detached records retain `anchorStatus: "detached"`. Annotation fields unknown
to an older Archeion release may also be present and should be preserved by
consumers that rewrite the data.

`chapterLabel` is display metadata resolved at export time. The annotation's
`chapterHref` and `cfiRange` remain the durable location references. Consumers
should use `schema` and `version` before interpreting an export. Incompatible
future structures will increment `version`.

Markdown exports must be saved with a `.md` extension and JSON exports with a
`.json` extension. Extension matching is case-insensitive. Archeion rejects
missing, unsupported, or opposing extensions without changing the selected
path or writing a file.
