import { unified } from "unified";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import type { Root } from "mdast";
import type { ParsedDocument } from "./types.js";

/**
 * Parse Markdown/MDX without serializing it. Positions are kept so callers
 * can replace exact source slices and retain the author's original format.
 */
export function parseDocument(
    source: string,
    filePath?: string,
): ParsedDocument {
    const parser = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkFrontmatter, ["yaml", "toml"])
        .use(remarkDirective)
        .use(remarkMath)
        .use(remarkMdx);

    const tree = parser.parse(source) as Root;
    return filePath === undefined
        ? { source, tree }
        : { source, tree, filePath };
}
