import { dag } from "../sdk";
import { ParsedMarkdown } from "./markdown";
import { slugify } from "./utils";

const SYSTEM_PROMPT = `
You are a technical documentation tagging assistant.
Your job is to analyse markdown documentation and return a concise list of tags
that best describe its topics, technologies, and concepts.

Rules:
- Return ONLY a JSON array of lowercase strings, e.g. ["kubernetes","helm","networking"]
- No explanations, no markdown fences, no extra text — just the raw JSON array
- Use short, specific terms (prefer "kubernetes" over "container orchestration")
- Limit to 10 tags maximum
- If tags already exist in the front matter, you may reuse relevant ones but still
  evaluate the full content for additional tags
`.trim();

/**
 * Uses an LLM agent to generate a list of tags that describe the given markdown document.
 * Falls back to the front-matter tags if the LLM response cannot be parsed.
 */
export async function defineTags(parsed: ParsedMarkdown): Promise<string[]> {
    const prompt = buildPrompt(parsed);

    const reply = await dag
        .llm()
        .withModel("gpt-4.1")
        .withSystemPrompt(SYSTEM_PROMPT)
        .withPrompt(prompt)
        .loop()
        .lastReply();

    return parseTagsFromReply(
        reply,
        parsed.frontMatter.tags ?? [],
    );
}

function buildPrompt(parsed: ParsedMarkdown): string {
    const existingTags =
        (parsed.frontMatter.tags ?? []).join(", ") || "none";
    const headings    = parsed.headings.join(", ")                  || "none";

    return [
        `Title:    ${parsed.frontMatter.title    ?? "unknown"}`,
        `Category: ${parsed.frontMatter.category ?? "unknown"}`,
        `Existing tags: ${existingTags}`,
        `Headings: ${headings}`,
        ``,
        `Content:`,
        parsed.content,
    ].join("\n");
}

function parseTagsFromReply(reply: string, fallback: string[]): string[] {
    try {
        // Strip optional markdown code fences (```json ... ``` or ``` ... ```)
        const stripped = reply.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/,  "").trim();
        const parsed   = JSON.parse(stripped);

        if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
            return (parsed as string[]).map(slugify);
        }
    } catch {
        // fall through to fallback
    }

    return fallback.map(slugify);
}
