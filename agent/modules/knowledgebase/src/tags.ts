import { dag } from "../sdk";
import { ParsedMarkdown } from "./markdown";
import { slugify } from "./utils";

const SYSTEM_PROMPT = `
You are a technical documentation tagging assistant.
Your job is to analyse markdown documentation and return a concise list of tags
that best describe its topics, technologies, and concepts.

Rules:
- Return ONLY a JSON array of lowercase strings, e.g. ["kubernetes","helm","networking"]
- No explanations, no markdown fences, no extra text
- Use short, specific terms (prefer "kubernetes" over "container orchestration")
- Limit to 10 tags maximum
- If tags already exist in the front matter, you may reuse relevant ones but still
  evaluate the full content for additional tags
- Return the tags in the $tags
`.trim();

/**
 * Uses an LLM agent to generate a list of tags that describe the given markdown document.
 * Falls back to the front-matter tags if the LLM response cannot be parsed.
 */
export async function defineTags(parsed: ParsedMarkdown): Promise<string[]> {
    const prompt = buildPrompt(parsed);

    const llm = dag
        .llm()
        .withEnv(
            dag.env().withStringOutput("tags", "tags as a ',' separated list of lowercase strings")
        )
        .withModel("gpt-4.1")
        .withSystemPrompt(SYSTEM_PROMPT)
        .withPrompt(prompt)
        .loop()

    const res = await llm.env().output("tags").asString()

    return [...res.split(",").map(tag => tag.trim())]
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
