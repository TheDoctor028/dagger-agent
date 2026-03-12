import {CacheVolume, File, func, object, Service} from "@dagger.io/dagger"
import Typesense from "typesense/src/Typesense";
import Client from "typesense/src/Typesense/Client";
import {schemas} from "./schemas";
import { dag } from '../sdk';
import { parseMarkdown } from "./markdown";
import { defineTags } from "./tags";
import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
//@ts-ignore
import matter from 'gray-matter';

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
    async test(
        f: File
    ): Promise<string> {
        const contents = await f.contents();
        const matteredContents = matter(contents);

        const mdTree = unified().
            use(remarkParse).
            use(remarkFrontmatter).
            use(remarkGfm).parse(matteredContents.content);

        return JSON.stringify(mdTree);
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
     * Initializes the knowledge base by setting up the necessary collections.
     * Ensures that all schemas defined in the system are created in the database
     * if they do not already exist.
     *
     * @return {Promise<Knowlagebase>}
     */
    @func()
    async init(): Promise<Knowlagebase> {
       const client = await this.client();
       const collections = await this.collections();

        for (const schema of schemas) if (!collections.includes(schema.name))
                await client.collections().create(schema);

        return this;
    }

    async client(): Promise<Client> {
        await this.svc.start();
        return new Typesense.Client({
            nodes: [{host: await this.svc.hostname(), port: 8108, protocol: "http"}],
            apiKey: "secret",
            connectionTimeoutSeconds: 30,
        })
    }

    async collections(): Promise<string[]> {
        const client = await this.client();
        return (await client.collections().retrieve()).map(coll => coll.name)
    }
}
