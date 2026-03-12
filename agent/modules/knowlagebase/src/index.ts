import {CacheVolume, File, func, object, Service} from "@dagger.io/dagger"
import Typesense from "typesense/src/Typesense";
import Client from "typesense/src/Typesense/Client";
import {schemas} from "./schemas";
import { dag } from '../sdk';
import { parseMarkdown } from "./markdown";
import { defineTags } from "./tags";
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
        withEnvVariable("TYPESENSE_SNAPSHOT_INTERVAL_SECONDS", "30").
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
     * Searches the doc_chunks collection
     * Returns a human-readable summary of matching results.
     */
    @func({cache: "never"})
    async testSearch(
        // The search query string
        query: string,
        // Max number of results to return (default 5)
        limit: number = 5,
    ): Promise<string> {
        const client = await this.client();

        const results = await client
            .collections("doc_chunks")
            .documents()
            .search({
                q:            query,
                query_by:     "title,section_heading,content,tags",
                per_page:     limit,
                highlight_full_fields: "title,section_heading,content",
            });

        if (!results.hits?.length)
            return `No results found for "${query}"`;

        const lines: string[] = [
            `Found ${results.found} result(s) for "${query}" (showing ${results.hits.length}):`,
            "",
        ];

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
     * Forces a Raft snapshot
     * Without this Typesense wipes /data/db on startup when the node IP changes.
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

    @func({cache: "never"})
    async collections(): Promise<string[]> {
        const client = await this.client();
        return (await client.collections().retrieve()).map(coll => coll.name)
    }
}
