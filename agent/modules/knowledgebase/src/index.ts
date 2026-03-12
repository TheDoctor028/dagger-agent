import {
    argument,
    CacheVolume,
    Directory,
    File,
    func,
    object,
    Service,
} from "@dagger.io/dagger"
import {LLM} from "../sdk/client.gen"
import Typesense from "typesense/src/Typesense";
import Client from "typesense/src/Typesense/Client";
import {schemas} from "./schemas";
import { dag } from '../sdk';
import { chunkMarkdown, parseMarkdown } from "./markdown";
import { defineTags } from "./tags";
import { defineCategory } from "./categories";
import { createHash } from "node:crypto";
import {
    outKnowledgeBaseFunctions,
    slugify,
} from "./utils";
const typeSenseVersion = "30.1";

/**
 * Represents a Knowledgebase system that manages a Typesense service for data indexing and retrieval.
 * Provides methods for creating the service container, managing cached data volumes, performing health checks,
 * and interacting with a Typesense client.
 */
@object()
export class Knowledgebase {

    svc: Service

    constructor() {
        this.svc = this.typesenseSVC();
        // this.svc.start().then()
    }

    dataVolume(): CacheVolume {
        return dag.cacheVolume("knowledgebase-data")
    }

    /**
     * Creates and configures a Typesense service container using the specified version and settings.
     * The container is customized with environment variables, health checks, port exposure, and caching for its data directory.
     *
     * @return {Service} A service object representing the configured Typesense container.
     */
    @func()
    typesenseSVC(): Service {
    return dag.container().
        from(`typesense/typesense:${typeSenseVersion}`).
        withExec([
            "/bin/sh", "-c",
            "apt update && apt install -y curl && rm -rf /var/lib/apt/lists/*"
        ]).
        withMountedCache("/data", this.dataVolume()).
        withEnvVariable("TYPESENSE_DATA_DIR", "/data").
        withEnvVariable("TYPESENSE_ENABLE_CORS", "1").
        withEnvVariable("TYPESENSE_API_KEY", "secret").
        // Take an automatic Raft snapshot every 30s so data survives IP changes
        withEnvVariable("TYPESENSE_SNAPSHOT_INTERVAL_SECONDS", "15").
        withExposedPort(8108, {}).
        withDockerHealthcheck(["curl --fail http://localhost:8108/health"], {
            shell: true,
            startPeriod: "10s",
            startInterval: "2s",
            interval: "10s",
            retries: 5,
        }).
        asService().
        withHostname("typesense")
    }

    /**
     * Performs a health check operation by starting the required service and retrieving the health status from the client.
     *
     * @return {Promise<string>} A promise that resolves to "ok" if the health status is positive, otherwise "not ok".
     */
    @func()
    async healthCheck(): Promise<string> {
        await this.svc.start()
        return (await (await this.client()).health.retrieve()).ok ? "ok" : "not ok"
    }

    /**
     * Search the knowledge base for documents matching a query.
     *
     * HOW TO USE THIS TOOL:
     * - Use natural language queries to find relevant documentation
     *   (e.g. "kubernetes networking", "helm chart deployment").
     * - By default a full-text search across title, section_heading,
     *   content and tags is performed.
     * - Set semantic=true to switch to vector/embedding-based search
     *   which finds conceptually similar documents even when exact
     *   keywords do not match.
     * - Increase limit to retrieve more results when exploring a
     *   broad topic; decrease it for focused lookups.
     *
     * RETURN FORMAT:
     * Returns a JSON array of hit objects. Each hit contains:
     *   - document: the matched doc_chunk fields
     *     (title, section_heading, content, category, subcategory,
     *      tags, slug, weight, source, source_type)
     *   - highlights (text search only): matching snippets
     *   - text_match (text search only): relevance score
     *   - vector_distance (semantic only): cosine distance
     *
     * Returns a plain message when no results are found.
     */
    @func({cache: "never"})
    async search(
        /**
         * Natural language or keyword query to search for in the
         * knowledge base (e.g. "pod networking", "CI/CD pipeline").
         */
        query: string,
        /**
         * Maximum number of results to return.
         * Use a small value (1-3) for precise lookups, larger
         * (5-10) for exploratory searches.
         */
        limit: number = 5,
        /**
         * When true, use vector/semantic search via the embedding
         * field instead of keyword-based text search. Useful when
         * the exact terminology is unknown.
         */
        semantic: boolean = false,
    ): Promise<string> {
        const client = await this.client();

        const results = await client
            .collections("doc_chunks")
            .documents()
            .search(semantic ? {
                q:            query,
                query_by:     "embedding",
                vector_query: `embedding:([], k:${limit})`,
                per_page:     limit,
                exclude_fields: "embedding",
            } : {
                q:            query,
                query_by:     "title,section_heading,content,tags",
                per_page:     limit,
                highlight_full_fields:
                    "title,section_heading,content",
                exclude_fields: "embedding",
            });

        if (!results.hits?.length)
            return `No results found for "${query}"`;

        return JSON.stringify(results.hits);
    }

    /**
     * Indexes all markdown files from the given directory into
     * the knowledge base. Each file is parsed, chunked by
     * heading sections, tagged via an LLM, and upserted into
     * the doc_chunks collection.
     *
     * If the directory is a git repository (.git present),
     * source_type is set to "github" and source is the
     * remote URL. Otherwise source_type is "local" and
     * source is the file path.
     */
    @func()
    async index(
        /** Directory containing markdown files to index */
        @argument({ defaultPath: "/" })
        dir: Directory,
    ): Promise<Knowledgebase> {
        const isGit = await dir.exists(".git");
        let sourceType = "local";
        let repoUrl = "";
        if (isGit) {
            sourceType = "github";
            try {
                repoUrl = await dir.asGit().url();
            } catch {
                repoUrl =
                    `git@local/${await dir.name()}`;
            }
        }

        const files = await dir.filter({
            gitignore: true,
        }).glob("**/*.md");
        
        for (const path of files) {
            const source = repoUrl
                ? `${repoUrl}/${path}`
                : path;
            await this.indexFile(
                dir.file(path),
                source,
                sourceType,
                path,
            );
        }

        await this.snapshot();
        return this;
    }

    /**
     * Parses a single markdown file, chunks it by heading
     * sections, generates tags via an LLM, and upserts
     * every chunk into the doc_chunks collection.
     */
    @func()
    async indexFile(
        /** The markdown file to index */
        md: File,
        /** Path or URL pointing to the original file */
        source: string,
        /**
         * Origin platform of the document
         * (e.g. "github", "local")
         */
        sourceType: string = "local",
        /**
         * Relative path of the file within the source.
         * Used for slug generation and weight derivation.
         */
        documentPath?: string,
    ): Promise<Knowledgebase> {
        const client = await this.client();
        const path = await md.name();
        const contents = await md.contents();
        const parsed = parseMarkdown(contents);
        const tags = await defineTags(parsed);
        const category = await defineCategory(parsed);
        const chunks = chunkMarkdown(parsed);

        const docPath = documentPath ?? path;

        // Top-level heading (#) of the Markdown document
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const h1Node = parsed.ast.children?.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (n: any) => n.type === "heading"
                && n.depth === 1,
        );
        const h1Title = h1Node?.children
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ?.filter((c: any) =>
                c.type === "text"
                || c.type === "inlineCode")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => c.value)
            .join("");

        // Importance score derived from documentation tree
        // depth and section heading level.
        // Lower values = higher priority.
        const pathDepth = docPath
            .split("/").filter(Boolean).length - 1;

        for (const chunk of chunks) {
            const heading = chunk.sectionHeading;
            const sectionLevel = heading ? 1 : 0;
            const derivedWeight = Math.min(
                100,
                10 + (pathDepth * 15)
                    + (sectionLevel * 5),
            );

            const slug = [
                slugify(sourceType),
                slugify(docPath),
                String(chunk.chunkIndex),
            ].join("-");

            const id = createHash("sha256")
                .update(slug)
                .digest("hex");

            await client
                .collections("doc_chunks")
                .documents()
                .upsert({
                    id,
                    chunk_index: chunk.chunkIndex,
                    title: h1Title
                        || parsed.frontMatter.title
                        || path,
                    section_heading: heading ?? "",
                    content: chunk.content,
                    category: category.category,
                    subcategory: category.subCategory,
                    tags,
                    slug,
                    weight:
                        parsed.frontMatter.weight
                        ?? derivedWeight,
                    source,
                    source_type: sourceType,
                });
        }

        return this;
    }

    /**
     * Uses an LLM agent to derive tags for the given markdown file.
     * Parses the file, feeds its content and metadata to the agent,
     * and returns a JSON array of lowercase tag strings.
     */
    @func()
    async extractTags(md: File): Promise<string[]> {
        const contents = await md.contents();
        const parsed   = parseMarkdown(contents);
        return defineTags(parsed);
    }

    /**
     * Uses an LLM agent to determine the best category for the
     * given markdown file. Parses the file, feeds its content
     * and metadata to the agent, and returns a single lowercase
     * category string.
     */
    @func()
    async extractCategory(md: File): Promise<string[]> {
        const contents = await md.contents();
        const parsed   = parseMarkdown(contents);
        const res = await defineCategory(parsed);

        return [res.category, (res.subCategory || "none")];
    }

    /**
     * Ensures all collections exist. When migrate is true, existing collections
     * are dropped and recreated from the current schema (useful after schema changes).
     * When false (default), only missing collections are created.
     */
    @func()
    async init(
        // Drop and recreate all collections from the current schema
        migrate: boolean = false,
    ): Promise<Knowledgebase> {
        const client = await this.client();

        for (const schema of schemas) {
            if (migrate) {
                try { await client.collections(schema.name).delete(); } catch (_) {}
                await client.collections().create(schema);
            } else {
                try {
                    await client.collections().create(schema);
                } catch (e: any) {
                    // 409 means the collection already exists — that's fine
                    if (!(e?.message ?? "").includes("already exists")) throw e;
                }
            }
        }

        await this.snapshot();
        return this;
    }

    /**
     * Forces a Raft snapshot to /data/state/snapshot so data survives container
     * restarts. Without this, Typesense wipes /data/db when the node IP changes
     * between Dagger runs.
     * cache:"never" is required because Dagger deduplicates identical function
     * calls within the same session — without it, only the first snapshot() in a
     * chain (e.g. init → test) would actually execute; subsequent calls would
     * return the cached result and skip the HTTP request entirely.
     */
    @func({cache: "never"})
    async snapshot(): Promise<void> {
        const client = await this.client();
        await client.operations.perform("snapshot",
            { "snapshot-path": "/data/state/snapshot" });
    }

    async client(): Promise<Client> {
        await this.svc.start();
        return new Typesense.Client({
            nodes: [{host: await this.svc.hostname(), port: 8108, protocol: "http"}],
            apiKey: "secret",
            connectionTimeoutSeconds: 30,
        })
    }

    @func()
    async collections(): Promise<string[]> {
        const client = await this.client();
        return (await client.collections().retrieve())
            .map(coll => coll.name)
    }

    /**
     * Returns all documents in the doc_chunks collection
     * as a JSON string. Useful for debugging.
     */
    @func({cache: "never"})
    async documents(): Promise<string> {
        const client = await this.client();
        const results = await client
            .collections("doc_chunks")
            .documents()
            .search({
                q: "*",
                per_page: 250,
                exclude_fields: "embedding, content",
            });
        return JSON.stringify(results.hits ?? [], null, 2);
    }

    /**
     * Start an interactive chat with the knowledge base curator.
     * The curator is an LLM agent that can search through the
     * indexed documentation on your behalf and provide summarised,
     * context-aware answers.
     *
     * Pass your question or topic as the prompt and the curator
     * will query the knowledge base, synthesise the results and
     * reply in a conversational format.
     */
    @func()
    async curator(
        /**
         * Optional question or topic to explore in the knowledge
         * base (e.g. "How does pod networking work in Kubernetes?").
         * When omitted the curator starts without an initial query.
         */
        prompt?: string,
    ): Promise<LLM> {
        const env = dag.env()
            .withCurrentModule();

        let llm = dag
            .llm()
            .withEnv(env)
            .with(outKnowledgeBaseFunctions(
                "curator",
                "test",
                "snapshot",
                "typesenseSVC",
                "extractTags",
                "extractCategory",
                "collections",
                "init",
                "healthCheck",
                "index",
                "indexFile",
                "documents",
            ))
            .withSystemPrompt(
                await dag.currentModule().source()
                    .file("prompts/curator.md").contents()
            );

        if (prompt) llm = llm.withPrompt(prompt);

        return llm;
    }
}
