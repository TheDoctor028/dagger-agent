# Knowledgebase

A [Dagger](https://docs.dagger.io/) module that provides a self-contained, LLM-powered knowledge base
for indexing and searching markdown documentation using [Typesense](https://typesense.org/).

## Prerequisites

- **Dagger** must be installed on your machine.
  Follow the official installation guide: [https://docs.dagger.io/install](https://docs.dagger.io/install)

## Features

- **Typesense-backed search** — spins up a Typesense container with persistent caching,
  health checks, and automatic Raft snapshots
- **Markdown indexing** — parses `.md` files (including frontmatter), chunks them by heading
  sections, and upserts them into a `doc_chunks` collection
- **LLM-powered tagging & categorisation** — automatically derives tags and categories for
  each document using an LLM agent
- **Full-text & semantic search** — query the knowledge base with keywords or switch to
  vector/embedding-based search for conceptually similar results
- **Git-aware source tracking** — detects `.git` repositories and stores the remote URL as
  the document source
- **Curator agent** — an interactive LLM chat agent that can search the knowledge base on
  your behalf and provide summarised answers with source citations
- **AWS Bedrock ingestion** — ingest documents into an AWS Bedrock Knowledge Base with
  auto-extracted metadata (title, tags, category, subcategory) sent as inline attributes

## Functions

### `init`

Ensures all Typesense collections exist. Use `migrate: true` to drop and recreate
collections from the current schema (useful after schema changes).

```shell path=null start=null
dagger call init
dagger call init --migrate=true
```

### `index`

Indexes all markdown files from a directory. Parses, chunks, tags, categorises, and
upserts every file into the knowledge base.

```shell path=null start=null
dagger call index --dir /path/to/docs
```

### `filesToIndex`

Returns all markdown files from a directory that should be indexed.
Respects `.gitignore` when a `.git` directory is present.
The returned `File[]` can be piped into `bedrock-ingest` or other consumers.

```shell path=null start=null
dagger call files-to-index --dir /path/to/docs
```

### `indexFile`

Indexes a single markdown file with explicit source metadata.

```shell path=null start=null
dagger call index-file --md ./docs/guide.md --source "https://github.com/org/repo/docs/guide.md" --source-type github
```

### `search`

Searches the knowledge base. Supports both full-text and semantic (vector) search.

```shell path=null start=null
# Full-text search (default)
dagger call search --query "kubernetes networking"

# Semantic search
dagger call search --query "pod communication" --semantic=true --limit 10
```

**Parameters:**

- `query` — natural language or keyword query
- `limit` (default: `5`) — max number of results
- `semantic` (default: `false`) — use vector search instead of keyword search

### `withAwsCredentials`

Stores AWS credentials on the instance for use by `bedrock-ingest`.

```shell path=null start=null
dagger call \
  with-aws-credentials \
    --access-key-id env://AWS_ACCESS_KEY_ID \
    --secret-access-key env://AWS_SECRET_ACCESS_KEY \
    --session-token env://AWS_SESSION_TOKEN \
    --region "eu-west-1" \
  bedrock-ingest \
    --document ./README.md \
    --knowledge-base-id "EVC8YVP3EK" \
    --data-source-id "7VI7NMHOOM"
```

### `bedrockIngest`

Ingests a document into an AWS Bedrock Knowledge Base. Extracts metadata
(title, tags, category, subcategory) from the file and sends them as
inline attributes alongside the content.

Requires `with-aws-credentials` to be called first.

**Parameters:**

- `document` — the text file to ingest
- `knowledgeBaseId` — Bedrock Knowledge Base ID
- `dataSourceId` — data source ID connected to the KB
- `documentId` (optional) — custom document identifier; defaults to SHA-256 of the file name

### `curator`

Starts an interactive LLM chat agent that searches the indexed documentation and
provides summarised, cited answers.

```shell path=null start=null
dagger call curator --prompt "How does pod networking work?"
```

### `healthCheck`

Returns `"ok"` or `"not ok"` based on the Typesense service status.

```shell path=null start=null
dagger call health-check
```

### `typesenseSVC`

Returns the underlying Typesense service container. Useful for binding as a service
dependency in other Dagger modules.

### `collections`

Lists all collection names in the Typesense instance.

```shell path=null start=null
dagger call collections
```

### `documents`

Returns all documents in the `doc_chunks` collection as JSON. Useful for debugging.

```shell path=null start=null
dagger call documents
```

### `extractTags`

Extracts LLM-generated tags from a single markdown file.

```shell path=null start=null
dagger call extract-tags --md ./docs/guide.md
```

### `extractCategory`

Determines the best category and subcategory for a single markdown file via an LLM.

```shell path=null start=null
dagger call extract-category --md ./docs/guide.md
```

### `withRemote`

Configures the knowledgebase to use a remote Typesense instance instead of
the local Dagger-managed service.

```shell path=null start=null
dagger call \
  with-remote \
    --address "ts.example.com:8108" \
    --api-key env://TYPESENSE_API_KEY \
  search --query "kubernetes"
```

### `snapshot`

Forces a Raft snapshot so data survives container restarts between Dagger runs.

```shell path=null start=null
dagger call snapshot
```

## Architecture

- **Runtime:** TypeScript (Dagger SDK)
- **Search engine:** Typesense `30.1` with built-in `ts/e5-small` embeddings for vector search
- **Markdown parsing:** `remark` + `gray-matter` for frontmatter extraction and AST-based chunking
- **LLM integration:** Dagger's built-in LLM support (`dag.llm()`) for tag/category extraction and the curator agent
- **AWS Bedrock:** `@aws-sdk/client-bedrock-agent` for inline document ingestion with metadata
