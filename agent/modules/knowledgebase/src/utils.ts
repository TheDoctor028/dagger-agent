import { LLM } from "../sdk/client.gen";

/**
 * Returns a callback for LLM.with() that blocks the given
 * Knowledgebase functions so they cannot be invoked as tools.
 */
export function outKnowledgeBaseFunctions(
    ...functions: string[]
): (llm: LLM) => LLM {
    return (llm: LLM) => {
        for (const fn of functions) {
            llm = llm.withBlockedFunction("Knowledgebase", fn);
        }
        return llm;
    };
}

/**
 * Turns an arbitrary string into a URL-safe, lowercase slug.
 */
export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
