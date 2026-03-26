# Diff City: Agent Context

Diff City is a lightweight, self-hosted code review tool that allows users to create workspaces for reviewing local git diffs, add comments (both general and line-specific), and manage the review lifecycle.

## Tech Stack
- **Backend:** Go (using `go-chi` for routing).
- **Frontend:** React SPA built with Vite, TypeScript, Tailwind CSS, shadcn/ui, and React Query.
  Located in `web/diff-review-hub/`. Built output goes to `web/diff-review-hub/dist/`.
- **Diff Rendering:** Custom parser in `web/diff-review-hub/src/lib/diff-parser.ts`.
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
The frontend is a React SPA located in `web/diff-review-hub/`.
- **React Query** manages all server state (queries and mutations).
- All API calls go through `web/diff-review-hub/src/lib/api.ts` using `/api` as the base URL.
- The diff is fetched as raw text and parsed by `src/lib/diff-parser.ts` into structured `DiffFile[]` data.
- Rendered by `src/components/DiffViewer.tsx` with inline comment support.
- See `web/diff-review-hub/AGENTS.md` for detailed frontend architecture notes.

## Development Workflow
1. **Backend:** Logic is split between `main.go` (HTTP handlers) and `internal/` (git/workspace logic).
2. **Frontend source:** React app in `web/diff-review-hub/src/`. See that directory's `AGENTS.md` for
   component-level details.
3. **Serving static files:** `main.go` serves `web/diff-review-hub/dist/` and falls back to `index.html`
   for all non-API routes (SPA routing support via `spaHandler`).
4. **Local Testing (production-like):**
   - Build the frontend: `cd web/diff-review-hub && npm run build`
   - Run the backend: `go run main.go` → open `http://localhost:8080`
5. **Local Development (hot reload):**
   - Run the backend: `go run main.go`
   - Run the frontend dev server: `cd web/diff-review-hub && npm run dev`
   - The Vite dev server (`:5173`) proxies `/api` requests to the Go backend (`:8080`).
6. **Local Testing:** Requires a local git repository to point a workspace at.
