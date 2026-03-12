import { LLM } from "../sdk/client.gen";

/**
 * Returns a callback for LLM.with() that blocks the given
 * Knowlagebase functions so they cannot be invoked as tools.
 */
export function outKnowledgeBaseFunctions(
    ...functions: string[]
): (llm: LLM) => LLM {
    return (llm: LLM) => {
        for (const fn of functions) {
            llm = llm.withBlockedFunction("Knowlagebase", fn);
        }
        return llm;
    };
}
