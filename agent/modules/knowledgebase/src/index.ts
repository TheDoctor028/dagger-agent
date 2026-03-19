import {
    argument,
    CacheVolume,
    Directory,
    File,
    func,
    object,
    Secret,
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
import {
    BedrockAgentClient,
    IngestKnowledgeBaseDocumentsCommand,
} from "@aws-sdk/client-bedrock-agent";
const typeSenseVersion = "30.1";
const TYPESENSE_DEFAULT_API_KEY = "secret";

export interface DocumentMetadata {
    title: string;
    tags: string[];
    category: string;
    subcategory: string;
}

/**
 * Parses a markdown string and extracts
 * document-level metadata (title, tags,
 * category, subcategory) via LLM agents.
 *
 * Reused by both indexFile and bedrockIngest.
 */
export async function extractDocumentMetadata(
    contents: string,
    fallbackTitle?: string,
): Promise<{
    parsed: ReturnType<typeof parseMarkdown>;
    metadata: DocumentMetadata;
}> {
    const parsed = parseMarkdown(contents);
    const tags = await defineTags(parsed);
    const category = await defineCategory(parsed);

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

    const title = h1Title
        || parsed.frontMatter.title
        || fallbackTitle
        || "";

    return {
        parsed,
        metadata: {
            title,
            tags,
            category: category.category,
            subcategory:
                category.subCategory || "",
        },
    };
}

/**
 * Represents a Knowledgebase system that manages a Typesense service for data indexing and retrieval.
 * Provides methods for creating the service container, managing cached data volumes, performing health checks,
 * and interacting with a Typesense client.
 */
@object()
export class Knowledgebase {

    svc: Service
    remoteAddress?: string
    remoteApiKey?: Secret
    remoteProtocol?: string

    private awsAccessKeyId?: Secret
    private awsSecretAccessKey?: Secret
    private awsSessionToken?: Secret
    private awsRegion?: string

    constructor(
        /** Optional remote Typesense address
         * (e.g. "ts.example.com:8108") */
        remoteAddress?: string,
        /** Optional API key secret for the remote */
        remoteApiKey?: Secret,
        /** Protocol to use for the remote
         * (default: "http") */
        remoteProtocol: string = "http",
    ) {
        this.svc = this.typesenseSVC();
        if (remoteAddress || remoteApiKey) {
            this.withRemote(
                remoteAddress!,
                remoteApiKey!,
                remoteProtocol ?? "http",
            );
        }
    }

    /**
     * Configures the knowledgebase to use a remote
     * Typesense instance instead of the local
     * Dagger-managed service.
     */
    @func()
    withRemote(
        /** Address of the remote Typesense instance
         * (e.g. "ts.example.com:8108") */
        address: string,
        /** API key secret for the remote instance */
        apiKey: Secret,
        /** Protocol to use (default: "http") */
        protocol: string = "http",
    ): Knowledgebase {
        this.remoteAddress = address;
        this.remoteApiKey = apiKey;
        this.remoteProtocol = protocol;
        return this;
    }

    /**
     * Stores AWS credentials on the Knowledgebase
     * instance so they can be reused by
     * bedrockIngest without passing them every time.
     */
    @func()
    withAwsCredentials(
        /** AWS access key ID */
        accessKeyId: Secret,
        /** AWS secret access key */
        secretAccessKey: Secret,
        /** AWS region (e.g. "us-east-1") */
        region: string,
        /**
         * AWS session token (required for SSO /
         * assumed-role credentials).
         */
        sessionToken?: Secret,
    ): Knowledgebase {
        this.awsAccessKeyId = accessKeyId;
        this.awsSecretAccessKey = secretAccessKey;
        this.awsRegion = region;
        this.awsSessionToken = sessionToken;
        return this;
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
        withEnvVariable("TYPESENSE_API_KEY", TYPESENSE_DEFAULT_API_KEY).
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
     * Returns all markdown files from the given directory
     * that should be indexed. Respects .gitignore when
     * a .git directory is present.
     *
     * The returned File[] can be piped into bedrockIngest
     * or any other consumer.
     */
    @func()
    async filesToIndex(
        /** Directory containing markdown files */
        @argument({ defaultPath: "/" })
        dir: Directory,
    ): Promise<File[]> {
        const filtered = dir.filter({ gitignore: true });
        const paths = await filtered.glob("**/*.md");
        return paths.map((p) => filtered.file(p));
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

        const files = await this.filesToIndex(dir);

        for (const file of files) {
            const path = await file.name();
            const source = repoUrl
                ? `${repoUrl}/${path}`
                : path;
            await this.indexFile(
                file,
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

        let result;
        try {
            result =
                await extractDocumentMetadata(
                    contents, path,
                );
        } catch (e) {
            console.error(
                "Failed to parse markdown:", e,
            );
            return this;
        }

        const { parsed, metadata } = result;
        const chunks = chunkMarkdown(parsed);
        const docPath = documentPath ?? path;

        // Importance score derived from documentation
        // tree depth and section heading level.
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
                    title: metadata.title || path,
                    section_heading: heading ?? "",
                    content: chunk.content,
                    category: metadata.category,
                    subcategory:
                        metadata.subcategory,
                    tags: metadata.tags,
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
        const isRemote =
            this.remoteAddress && this.remoteApiKey;

        if (!isRemote) await this.svc.start();

        const [host, portStr] = isRemote
            ? this.remoteAddress!.split(":")
            : [await this.svc.hostname(), "8108"];

        return new Typesense.Client({
            nodes: [{
                host,
                port: parseInt(portStr, 10) || 8108,
                protocol: isRemote
                    ? (this.remoteProtocol ?? "http")
                    : "http",
            }],
            apiKey: isRemote ? await this.remoteApiKey!.plaintext() : TYPESENSE_DEFAULT_API_KEY,
            connectionTimeoutSeconds: 30,
        });
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
    /**
     * Ingests a document into an AWS Bedrock
     * Knowledge Base using the
     * IngestKnowledgeBaseDocuments API.
     *
     * The document content is sent inline as text
     * to a **custom** data source. A unique document
     * ID is derived from the file name via SHA-256.
     *
     * Returns the raw JSON response from the API.
     */
    @func()
    async bedrockIngest(
        /** The text file to ingest */
        document: File,
        /** Bedrock Knowledge Base ID */
        knowledgeBaseId: string,
        /** Data source ID connected to the KB */
        dataSourceId: string,
        /**
         * Optional custom document identifier.
         * When omitted a SHA-256 of the file name
         * is used.
         */
        documentId?: string,
    ): Promise<string> {
        if (!this.awsAccessKeyId
            || !this.awsSecretAccessKey
            || !this.awsRegion) {
            throw new Error(
                "AWS credentials not set. "
                + "Call withAwsCredentials() first.",
            );
        }

        const content = await document.contents();
        const name = await document.name();

        const { metadata } =
            await extractDocumentMetadata(
                content, name,
            );

        const id = documentId
            ?? createHash("sha256")
                .update(name)
                .digest("hex");

        const credentials: Record<string, string> = {
            accessKeyId:
                await this.awsAccessKeyId.plaintext(),
            secretAccessKey:
                await this.awsSecretAccessKey
                    .plaintext(),
        };
        if (this.awsSessionToken) {
            credentials.sessionToken =
                await this.awsSessionToken.plaintext();
        }

        const client = new BedrockAgentClient({
            region: this.awsRegion,
            credentials: credentials as any,
        });

        const command =
            new IngestKnowledgeBaseDocumentsCommand({
                knowledgeBaseId,
                dataSourceId,
                documents: [
                    {
                        content: {
                            dataSourceType: "CUSTOM",
                            custom: {
                                customDocumentIdentifier:
                                    { id },
                                sourceType: "IN_LINE",
                                inlineContent: {
                                    type: "TEXT",
                                    textContent: {
                                        data: content,
                                    },
                                },
                            },
                        },
                        metadata: {
                            type: "IN_LINE_ATTRIBUTE",
                            inlineAttributes: [
                                {
                                    key: "source",
                                    value: {
                                        type: "STRING",
                                        stringValue:
                                            name,
                                    },
                                },
                                {
                                    key: "title",
                                    value: {
                                        type: "STRING",
                                        stringValue:
                                            metadata
                                                .title,
                                    },
                                },
                                {
                                    key: "category",
                                    value: {
                                        type: "STRING",
                                        stringValue:
                                            metadata
                                                .category,
                                    },
                                },
                                {
                                    key: "subcategory",
                                    value: {
                                        type: "STRING",
                                        stringValue:
                                            metadata
                                                .subcategory,
                                    },
                                },
                                {
                                    key: "tags",
                                    value: {
                                        type: "STRING_LIST",
                                        stringListValue:
                                            metadata
                                                .tags,
                                    },
                                },
                            ],
                        },
                    },
                ],
            });

        const response =
            await client.send(command);

        return JSON.stringify(
            response.documentDetails,
            null,
            2,
        );
    }

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
                "bedrockIngest",
                "withAwsCredentials",
                "filesToIndex",
            ))
            .withSystemPrompt(
                await dag.currentModule().source()
                    .file("prompts/curator.md").contents()
            );

        if (prompt) llm = llm.withPrompt(prompt);

        return llm;
    }
}
