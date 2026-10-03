import type { Root, Content } from "mdast";

export type BlockType =
    | "heading"
    | "paragraph"
    | "list"
    | "listItem"
    | "blockquote"
    | "table"
    | "code"
    | "yaml"
    | "toml"
    | "mdxjsEsm"
    | "mdxJsxFlowElement"
    | "mdxJsxTextElement"
    | "mdxFlowExpression"
    | "mdxTextExpression"
    | "tabs"
    | "tabItem"
    | "admonition"
    | "directive"
    | "math"
    | "html"
    | "definition"
    | "thematicBreak"
    | "image"
    | "unknown";

export interface SourceRange {
    start: number;
    end: number;
}

export interface MarkdownBlock {
    key: string;
    type: BlockType;
    origin: string;
    range: SourceRange;
    /** Leading whitespace before the node's source range on its first line. */
    indent: string;
    translatable: boolean;
    /** True when this entry is a structural template containing child blocks. */
    composite: boolean;
    /** Composite entries use this template instead of their raw source. */
    template?: string;
}

export interface ParsedDocument {
    source: string;
    tree: Root;
    filePath?: string;
}

export interface MarkdownNodeRange {
    node: Content;
    range: SourceRange;
}
