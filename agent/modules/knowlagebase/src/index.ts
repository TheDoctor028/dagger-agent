import {dag, Container, Directory, object, func, CacheVolume, Service, Secret} from "@dagger.io/dagger"
import Typesense from "typesense/src/Typesense";
import Client from "typesense/src/Typesense/Client";

const typeSenseVersion = "30.1";

/**
 * Represents a Knowledgebase system that manages a Typesense service for data indexing and retrieval.
 * Provides methods for creating the service container, managing cached data volumes, performing health checks,
 * and interacting with a Typesense client.
 */
@object()
export class Knowlagebase {

    svc: Service

    _client!: Client

    constructor() {
        this.svc = this.typesenseSVC();
        this.svc.start().then()
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

    async client(): Promise<Client> {
        if (this._client) return this._client;

        await this.svc.start();
        const client = new Typesense.Client({
            nodes: [{host: await this.svc.hostname(), port: 8108, protocol: "http"}],
            apiKey: "secret",
            connectionTimeoutSeconds: 30, // 30-second timeout for all requests
        });
        this._client = client;

        return client
    }
}
