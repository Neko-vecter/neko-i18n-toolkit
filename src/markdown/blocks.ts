import { getBlockKey } from "../core/hash.js";
import type { BlockType, MarkdownBlock, ParsedDocument, SourceRange } from "./types.js";

interface PositionedNode {
    type: string;
    name?: string;
    children?: unknown[];
    position?: {
        start?: { offset?: number };
        end?: { offset?: number };
    };
}

function nodeRange(node: PositionedNode): SourceRange | undefined {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    if (start === undefined || end === undefined || end <= start) return undefined;
    return { start, end };
}

function lineIndentAt(source: string, offset: number): string {
    const previousLineBreak = Math.max(
        source.lastIndexOf("\n", Math.max(0, offset - 1)),
        source.lastIndexOf("\r", Math.max(0, offset - 1)),
    );
    const lineStart = previousLineBreak + 1;
    const prefix = source.slice(lineStart, offset);
    return /^[ \t]*$/u.test(prefix) ? prefix : "";
}

/** Remove only the indentation inherited from the node's parent. */
export function normalizeBlockContent(
    content: string,
    inheritedIndent: string,
): string {
    if (inheritedIndent.length === 0) return content;

    const parts = content.split(/(\r\n|\r|\n)/u);
    for (let index = 2; index < parts.length; index += 2) {
        const line = parts[index]!;
        if (line.startsWith(inheritedIndent)) {
            parts[index] = line.slice(inheritedIndent.length);
        }
    }
    return parts.join("");
}

function blockType(node: PositionedNode): BlockType {
    if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        node.name === "Tabs"
    )
        return "tabs";
    if (
        (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
        node.name === "TabItem"
    )
        return "tabItem";
    if (node.type === "containerDirective") return "admonition";
    if (node.type === "leafDirective" || node.type === "textDirective")
        return "directive";

    // An image is phrasing content in mdast. A paragraph containing only one
    // image is promoted to an image leaf so it can be handled independently.
    if (
        node.type === "paragraph" &&
        node.children?.length === 1 &&
        typeof node.children[0] === "object" &&
        node.children[0] !== null &&
        (node.children[0] as PositionedNode).type === "image"
    ) {
        return "image";
    }

    switch (node.type) {
        case "heading":
        case "paragraph":
        case "list":
        case "listItem":
        case "blockquote":
        case "table":
        case "code":
        case "yaml":
        case "toml":
        case "mdxjsEsm":
        case "mdxJsxFlowElement":
        case "mdxJsxTextElement":
        case "mdxFlowExpression":
        case "mdxTextExpression":
        case "html":
        case "definition":
        case "thematicBreak":
        case "math":
            return node.type;
        default:
            return "unknown";
    }
}

function hasDescendant(node: PositionedNode, type: string): boolean {
    if (node.type === type) return true;
    return (node.children ?? []).some(
        (child) =>
            typeof child === "object" &&
            child !== null &&
            hasDescendant(child as PositionedNode, type),
    );
}

function containsJsxAssetReference(origin: string): boolean {
    return (
        origin.includes("require(") || /<[^>]*\b(?:src|img)\s*=/su.test(origin)
    );
}

function isTranslatable(
    type: BlockType,
    node: PositionedNode,
    origin: string,
    composite: boolean,
): boolean {
    if (
        composite ||
        [
            "code",
            "yaml",
            "toml",
            "mdxjsEsm",
            "mdxFlowExpression",
            "mdxTextExpression",
            "html",
            "definition",
            "math",
            "image",
        ].includes(type)
    )
        return false;

    // Asset-bearing leaves are prepared for the translated document but are
    // never sent through an AI provider.
    if (hasDescendant(node, "image") || containsJsxAssetReference(origin))
        return false;
    return true;
}

function positionedChildren(source: string, node: PositionedNode): PositionedNode[] {
    const range = nodeRange(node);
    const firstLineEnd =
        node.type === "containerDirective" && range !== undefined
            ? source.indexOf("\n", range.start)
            : -1;
    return (node.children ?? [])
        .filter(
            (child): child is PositionedNode =>
                typeof child === "object" &&
                child !== null &&
                nodeRange(child as PositionedNode) !== undefined,
        )
        .filter((child) => {
            if (firstLineEnd < 0) return true;
            const childRange = nodeRange(child);
            return childRange !== undefined && childRange.start > firstLineEnd;
        })
        .filter((child) => blockType(child) !== "unknown");
}

function isCompositeNode(
    source: string,
    node: PositionedNode,
    type: BlockType,
): boolean {
    if (
        ![
            "mdxJsxFlowElement",
            "mdxJsxTextElement",
            "containerDirective",
            "blockquote",
            "list",
            "listItem",
        ].includes(node.type)
    ) {
        return false;
    }
    return positionedChildren(source, node).length > 0 && type !== "image";
}

function structuralTemplate(
    source: string,
    range: SourceRange,
    children: Array<{ key: string; range: SourceRange }>,
    inheritedIndent: string,
): string {
    let cursor = range.start;
    let result = "";
    for (const child of children) {
        if (child.range.start < cursor || child.range.end > range.end) continue;
        result += source.slice(cursor, child.range.start);
        result += `{{${child.key}}}`;
        cursor = child.range.end;
    }
    return normalizeBlockContent(
        result + source.slice(cursor, range.end),
        inheritedIndent,
    );
}

interface CollectedNode {
    block: MarkdownBlock;
    children: CollectedNode[];
}

function collectNode(
    source: string,
    node: PositionedNode,
    parentKey?: string,
): CollectedNode | undefined {
    const range = nodeRange(node);
    if (range === undefined) return undefined;

    const origin = source.slice(range.start, range.end);
    if (origin.trim().length === 0) return undefined;

    const type = blockType(node);
    const indent = lineIndentAt(source, range.start);
    const localKey = getBlockKey(origin);
    const key = parentKey === undefined ? localKey : `${parentKey}-${localKey}`;
    const children = isCompositeNode(source, node, type)
        ? positionedChildren(source, node)
              .map((child) => collectNode(source, child, key))
              .filter((child): child is CollectedNode => child !== undefined)
        : [];
    const composite = children.length > 0;
    const template = composite
        ? structuralTemplate(
              source,
              range,
              children.map((child) => ({
                  key: child.block.key,
                  range: child.block.range,
              })),
              indent,
          )
        : undefined;

    return {
        block: {
            key,
            type,
            origin,
            range,
            indent,
            translatable: isTranslatable(type, node, origin, composite),
            composite,
            ...(template === undefined ? {} : { template }),
        },
        children,
    };
}

function flatten(node: CollectedNode): MarkdownBlock[] {
    return [node.block, ...node.children.flatMap(flatten)];
}

/** Extract a recursive block tree as a flat, source-ordered block list. */
export function extractBlocks(document: ParsedDocument): MarkdownBlock[] {
    const children = document.tree.children as unknown as PositionedNode[];
    return children.flatMap((node) => {
        const collected = collectNode(document.source, node);
        return collected === undefined ? [] : flatten(collected);
    });
}
