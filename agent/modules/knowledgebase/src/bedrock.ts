import { File, Secret } from "@dagger.io/dagger";
import { createHash } from "node:crypto";
import {
    BedrockAgentClient,
    IngestKnowledgeBaseDocumentsCommand,
} from "@aws-sdk/client-bedrock-agent";
import {
    extractDocumentMetadata,
    DocumentMetadata,
} from "./index";

export interface AwsCredentials {
    accessKeyId: Secret;
    secretAccessKey: Secret;
    region: string;
    sessionToken?: Secret;
}

/**
 * Resolves AWS credentials into plain-text
 * key/value pairs ready for the SDK.
 */
async function resolveCredentials(
    creds: AwsCredentials,
): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {
        accessKeyId:
            await creds.accessKeyId.plaintext(),
        secretAccessKey:
            await creds.secretAccessKey
                .plaintext(),
    };
    if (creds.sessionToken) {
        resolved.sessionToken =
            await creds.sessionToken.plaintext();
    }
    return resolved;
}

/**
 * Builds the Bedrock inlineAttributes array
 * from document metadata.
 */
function buildInlineAttributes(
    name: string,
    metadata: DocumentMetadata,
) {
    return [
        {
            key: "source",
            value: {
                type: "STRING" as const,
                stringValue: name,
            },
        },
        {
            key: "title",
            value: {
                type: "STRING" as const,
                stringValue: metadata.title,
            },
        },
        {
            key: "category",
            value: {
                type: "STRING" as const,
                stringValue: metadata.category,
            },
        },
        {
            key: "subcategory",
            value: {
                type: "STRING" as const,
                stringValue: metadata.subcategory,
            },
        },
        {
            key: "tags",
            value: {
                type: "STRING_LIST" as const,
                stringListValue: metadata.tags,
            },
        },
    ];
}

/**
 * Ingests a single document into an AWS Bedrock
 * Knowledge Base via the
 * IngestKnowledgeBaseDocuments API.
 *
 * Extracts metadata (title, tags, category,
 * subcategory) from the file and sends them as
 * inline attributes alongside the content.
 */
export async function bedrockIngest(
    credentials: AwsCredentials,
    document: File,
    knowledgeBaseId: string,
    dataSourceId: string,
    documentId?: string,
): Promise<string> {
    const content = await document.contents();
    const name = await document.name();

    const { metadata } =
        await extractDocumentMetadata(document);

    const id = documentId
        ?? createHash("sha256")
            .update(name)
            .digest("hex");

    const resolved =
        await resolveCredentials(credentials);

    const client = new BedrockAgentClient({
        region: credentials.region,
        credentials: resolved as any,
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
                        inlineAttributes:
                            buildInlineAttributes(
                                name, metadata,
                            ),
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
