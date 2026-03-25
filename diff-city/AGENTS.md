# Diff City: Agent Context

Diff City is a lightweight, self-hosted code review tool that allows users to create workspaces for reviewing local git diffs, add comments (both general and line-specific), and manage the review lifecycle.

## Tech Stack
- **Backend:** Go (using `go-chi` for routing).
- **Frontend:** Single-page HTML/JavaScript, Tailwind CSS for styling.
- **Diff Rendering:** [Diff2Html](https://diff2html.xyz/) (UI library version).
- **Storage:** Simple JSON files stored in `./data/workspaces/`.

## Core Concepts

### Workspaces
Each review session is a "Workspace".
- **Metadata:** Name, local repository path, base ref (e.g., `main`), and head ref (e.g., `feature-branch`).
- **State:** Current status (`TO_REVIEW`, `ACCEPTED`, `REQUIRE_CHANGES`, `DECLINED`) and optional reason.
- **Comments:** A list of comment objects.

### Data Structure
Workspaces are stored in `./data/workspaces/{uuid}/`:
- `metadata.json`: Workspace configuration.
- `state.json`: Current review status.
- `comments.json`: List of all comments.

**Comment Object:**
```json
{
  "id": "uuid",
  "file": "path/to/file", // null for general comments
  "line": 10,             // null for general comments
  "text": "Comment text",
  "timestamp": "ISO8601"
}
```

## Frontend Architecture
The frontend is a single `index.html` that:
1. Fetches workspace list and details via `/api/workspaces`.
2. Fetches raw git diff via `/api/workspaces/{id}/diff`.
3. Renders the diff using `Diff2HtmlUI`.
4. **Post-processing:** The `injectLineCommenting` function iterates through the rendered HTML table rows to:
   - Identify line numbers and file names.
   - Inject "+" buttons for adding new comments.
   - Inject existing comments directly into the diff code cells.

## Critical Implementation Details

### Line Comment Injection (`injectLineCommenting`)
This is the most sensitive part of the UI. It relies on `Diff2Html`'s generated class names:
- `.d2h-file-wrapper`: Containers for each file in the diff.
- `.d2h-code-side-linenumber` / `.d2h-code-linenumber`: Line number cells.
- `.d2h-code-side-line` / `.d2h-code-line`: Code content cells.
- `.d2h-code-line-ctn`: The actual text container inside a code cell.

**Recent Fixes:**
- **Loop Logic:** Replaced `return` with `continue` inside the row processing loop. Previously, an empty line cell (common in additions/deletions) would trigger a return that killed the injection for the rest of that row.
- **Selector Robustness:** Added support for both `side-by-side` and `unified` class names to ensure comments show up regardless of view mode.
- **Layering (z-index):** 
    - `add-comment-btn`: `z-index: 10`
    - Modals (`workspace-modal`, `comment-modal`, etc.): `z-[200]`
    - This ensures modals and their backdrops correctly cover the diff and buttons.

## Development Workflow
1. **Backend:** Logic is split between `main.go` (HTTP handlers) and `internal/` (git/workspace logic).
2. **Frontend:** All logic is in `<script>` tags in `web/index.html`.
3. **Local Testing:** Requires a local git repository to point a workspace at.
