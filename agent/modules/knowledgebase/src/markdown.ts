// @ts-ignore
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkStringify from "remark-stringify";

export interface MarkdownFrontMatter {
    title:              string;
    category:           string;
    subcategory?:       string;
    slug:               string;
    tags:               string[];
    confluence_page_id?: string;
    weight:             number;
}

export interface ParsedMarkdown {
    frontMatter: MarkdownFrontMatter;
    content:     string;
    headings:    string[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ast:         any;
}

export interface MarkdownChunk {
    sectionHeading?: string;
    content:         string;
    chunkIndex:      number;
}

function extractHeadings(node: any): string[] {
    if (!node || typeof node !== "object") return [];

    if (node.type === "heading") {
        const text = (node.children ?? [])
            .filter((c: any) => c.type === "text" || c.type === "inlineCode")
            .map((c: any) => c.value as string)
            .join("");
        return [text];
    }

    if (Array.isArray(node.children)) {
        return node.children.flatMap((child: any) => extractHeadings(child));
    }

    return [];
}

export function parseMarkdown(fileContent: string): ParsedMarkdown {
    const { data, content } = matter(fileContent);

    const ast = unified()
        .use(remarkParse)
        .use(remarkFrontmatter)
        .use(remarkGfm)
        .parse(content);

    return {
        frontMatter: data as MarkdownFrontMatter,
        content,
        headings: extractHeadings(ast),
        ast,
    };
}

/**
 * Splits a parsed markdown document into chunks, one per
 * heading section. Content before the first heading becomes
 * a chunk with no sectionHeading.
 */
export function chunkMarkdown(
    parsed: ParsedMarkdown,
): MarkdownChunk[] {
    const chunks: MarkdownChunk[] = [];
    const root = parsed.ast;

    let currentHeading: string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentNodes: any[] = [];
    let chunkIndex = 0;

    const processor = unified()
        .use(remarkGfm)
        .use(remarkStringify);

    function flush() {
        if (currentNodes.length === 0) return;
        const tree = { type: "root", children: currentNodes };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = processor.stringify(tree as any).trim();
        if (text) {
            chunks.push({
                sectionHeading: currentHeading,
                content: text,
                chunkIndex: chunkIndex++,
            });
        }
        currentNodes = [];
    }

    for (const child of root.children) {
        if (child.type === "heading") {
            flush();
            const text = (child.children ?? [])
                .filter(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (c: any) =>
                        c.type === "text"
                        || c.type === "inlineCode",
                )
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .map((c: any) => c.value as string)
                .join("");
            currentHeading = text;
        } else {
            currentNodes.push(child);
        }
    }

    flush();
    return chunks;
}
