import {CacheVolume, File, func, object, Service} from "@dagger.io/dagger"
import {LLM} from "../sdk/client.gen"
import Typesense from "typesense/src/Typesense";
import Client from "typesense/src/Typesense/Client";
import {schemas} from "./schemas";
import { dag } from '../sdk';
import { parseMarkdown } from "./markdown";
import { defineTags } from "./tags";
import { outKnowledgeBaseFunctions } from "./utils";
const typeSenseVersion = "30.1";

/**
 * Represents a Knowledgebase system that manages a Typesense service for data indexing and retrieval.
 * Provides methods for creating the service container, managing cached data volumes, performing health checks,
 * and interacting with a Typesense client.
 */
@object()
export class Knowlagebase {

    svc: Service

    constructor() {
        this.svc = this.typesenseSVC();
        // this.svc.start().then()
    }

    dataVolume(): CacheVolume {
        return dag.cacheVolume("knowlagebase-data")
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

    @func()
    async test(): Promise<Knowlagebase> {
        const client = await this.client();

        const doc = {
            id:              "kubernetes-networking-overview-0",
            document_id:     "kubernetes-networking-overview",
            chunk_index:     0,
            title:           "Kubernetes Networking Overview",
            section_heading: "How Pod Networking Works",
            content: [
                "Every Pod in Kubernetes gets its own IP address.",
                "Pods on the same Node communicate directly via a virtual bridge (cbr0).",
                "Cross-Node traffic is routed through the CNI plugin (e.g. Calico, Flannel).",
                "Services provide a stable virtual IP (ClusterIP) that load-balances across",
                "healthy Pod endpoints using kube-proxy iptables rules.",
            ].join(" "),
            category:    "infrastructure",
            subcategory: "networking",
            tags:        ["kubernetes", "networking", "cni", "pod", "service"],
            slug:        "docs/infrastructure/networking/kubernetes-networking-overview"
                         + "#how-pod-networking-works",
            weight:      50,
            source:      "github",
            source_type: "markdown",
        };

        await client
            .collections("doc_chunks")
            .documents()
            .upsert(doc);

        console.log("Indexed test doc:", JSON.stringify(doc, null, 2));
        await this.snapshot();
        return this;
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
     * Ensures all collections exist. When migrate is true, existing collections
     * are dropped and recreated from the current schema (useful after schema changes).
     * When false (default), only missing collections are created.
     */
    @func()
    async init(
        // Drop and recreate all collections from the current schema
        migrate: boolean = false,
    ): Promise<Knowlagebase> {
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
        return (await client.collections().retrieve()).map(coll => coll.name)
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
                "collections",
                "init",
                "healthCheck"
            ))
            .withSystemPrompt(
                await dag.currentModule().source()
                    .file("prompts/curator.md").contents()
            );

        if (prompt) llm = llm.withPrompt(prompt);

        return llm;
    }
}
