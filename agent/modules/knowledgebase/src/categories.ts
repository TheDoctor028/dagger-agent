import { dag } from "../sdk";
import { ParsedMarkdown } from "./markdown";
import { slugify } from "./utils";

const SYSTEM_PROMPT = `
You are a technical documentation categorisation assistant.
Your job is to analyse markdown documentation and return a single
category that best describes the document's primary purpose or domain.

Rules:
- Return ONLY a single lowercase string, e.g. "networking"
- No explanations, no markdown fences, no extra text — just the raw string
- Use short, specific terms (prefer "kubernetes" over "container orchestration")
- If a category already exists in the front matter and is reasonable, prefer it
- Use "uncategorized" ONLY when the content truly does not fit any category
- Prefer reusing well-known categories: infrastructure, networking,
  ci-cd, observability, security, documentation, tooling, development,
  database, messaging, storage, authentication, deployment, testing,
  configuration, automation
- Please dont use documentation as a category
- You may create a new category if none of the above fit, but keep it
  concise and lowercase
- Return the category in $category and the sub category in $subCategory.
`.trim();

/**
 * Uses an LLM agent to determine the best category for the
 * given markdown document.  Falls back to the front-matter
 * category (or "uncategorized") when the LLM response cannot
 * be parsed.
 */
export async function defineCategory(
    parsed: ParsedMarkdown,
): Promise<{category: string, subCategory?: string}> {
    const prompt = buildPrompt(parsed);

    const llm = dag
        .llm()
        .withEnv(
            dag.env()
                .withStringOutput("category", "Top-level category describing the document's primary domain")
                .withStringOutput("subCategory", "Optional secondary classification that narrows the category.")
        )
        .withModel("gpt-4.1")
        .withSystemPrompt(SYSTEM_PROMPT)
        .withPrompt(prompt)
        .loop();

    const category = slugify(await llm.env().output("category").asString());
    const subCategory = slugify(await llm.env().output("subCategory").asString());
    return {category, subCategory}
}

function buildPrompt(parsed: ParsedMarkdown): string {
    const existingTags =
        (parsed.frontMatter.tags ?? []).join(", ") || "none";
    const headings =
        parsed.headings.join(", ") || "none";

    return [
        `Title:    ${parsed.frontMatter.title ?? "unknown"}`,
        `Category: ${parsed.frontMatter.category ?? "unknown"}`,
        `Existing tags: ${existingTags}`,
        `Headings: ${headings}`,
        ``,
        `Content:`,
        parsed.content,
    ].join("\n");
}
