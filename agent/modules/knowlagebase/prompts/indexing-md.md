# Typesense Document Field Guide — Markdown Docs

This document describes how each field in a Typesense docs collection should be populated when indexing a markdown file from a documentation repository.

---

## Fields

### `id`
A unique, URL-safe identifier for the document.
Construct by combining the relative file path and the section heading (slugified), separated by `#`.
If no section heading exists, use the slugified file path alone.

**Format:** `<path-slugified>#<section-heading-slugified>`
**Example:** `security-elastic-alert-integrations#connectors`

[link](https://alama.com)

---

### `title`
The top-level title of the page.
Extract from the first `#` heading in the file.
If no `#` heading is present, use the filename (without extension, replace `-`/`_` with spaces, title-cased).

---

### `section_heading`
The heading of the specific section this document represents.
Extract from the `##` or `###` heading that introduces this content block.
Leave empty if the file is not split into sections.

---

### `content`
Plain text body of the section — stripped of all markdown syntax (no `#`, `**`, `_`, backticks,
table pipes, HTML comments, or link syntax).
Only include the content that belongs to this section (between the current heading and the next
same-level heading).
This is the field that gets tokenized and searched.

---

### `raw_content`
The full raw markdown of the entire file, exactly as it appears on disk — including frontmatter,
HTML comments, tables, and code blocks.
Stored but not indexed. Used to render the full document when a user opens a result.

---

### `category`
The first directory segment under the docs root (e.g. `docs/<category>/`).
For files directly at the docs root, use `general`.
Normalize to lowercase, replace `_` with `-`.

---

### `subcategory`
The second directory segment, if one exists. Leave empty for files directly inside the category
directory.
Normalize to lowercase, replace `_` with `-`.

---

### `slug`
The file path relative to the repo root, with a `#anchor` suffix derived from the `section_heading`
(lowercased, spaces replaced with `-`).
If no section heading, omit the anchor.

**Format:** `docs/<path>/<filename>.md#<section-heading-slug>`

---

### `tags`
Extract from the YAML frontmatter block at the top of the file (between `---` delimiters), from
the `tags` key.
If no frontmatter or no `tags` key is present, use an empty array.

---

### `confluence_page_id`
Extract from the HTML comment `<!-- confluence-page-id: XXXXXXXXXX -->` near the top of the file.
If not present, leave empty.

---

### `headings`
Array of all heading texts found in the file (all levels: `#`, `##`, `###`), in document order,
stripped of markdown symbols.

---

### `weight`
Integer controlling ranking. Assign based on nesting depth:

| Condition                       | Weight |
|---------------------------------|--------|
| Root `README.md`                | `100`  |
| Category index `README.md`      | `80`   |
| Top-level page in a category    | `50`   |
| Page in a subcategory           | `20`   |
| Deeply nested (3+ levels)       | `10`   |
