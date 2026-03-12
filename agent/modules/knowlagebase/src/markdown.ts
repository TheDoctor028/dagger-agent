// @ts-ignore
import matter from "gray-matter";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";

export interface MarkdownFrontMatter {
    title:              string;
    category:           string;
    subcategory?:       string;
    slug:               string;
    tags?:              string[];
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
