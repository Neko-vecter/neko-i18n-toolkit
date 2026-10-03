import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { getBlockKey } from "./hash.js";
import {
    extractBlocks,
    normalizeBlockContent,
} from "../markdown/blocks.js";
import { parseDocument } from "../markdown/parser.js";
import type { MarkdownBlock } from "../markdown/types.js";
import { readMiddleware } from "../middleware/reader.js";
import { isMiddlewareDocument } from "../middleware/reader.js";
import type {
    MiddlewareDocument,
    MiddlewareTranslationMap,
} from "../middleware/types.js";

export interface BuildDocumentOptions {
    middleware: MiddlewareDocument | MiddlewareTranslationMap;
}

function translationForBlock(
    block: ReturnType<typeof extractBlocks>[number],
    middleware: MiddlewareDocument | MiddlewareTranslationMap,
): string | undefined {
    if (isMiddlewareDocument(middleware)) {
        const exact = middleware.blocks.find(
            (candidate) =>
                candidate.key === block.key && candidate.composite !== true,
        );
        if (exact !== undefined) return exact.translate;

        const localKey = getBlockKey(block.origin);
        const candidates = middleware.blocks.filter(
            (candidate) =>
                candidate.composite !== true &&
                getBlockKey(candidate.origin) === localKey,
        );
        return candidates.length === 1 ? candidates[0]!.translate : undefined;
    }

    if (Object.prototype.hasOwnProperty.call(middleware, block.key)) {
        return middleware[block.key];
    }

    const localKey = getBlockKey(block.origin);
    const candidates = Object.entries(middleware).filter(
        ([key]) => key === localKey || key.endsWith(`-${localKey}`),
    );
    return candidates.length === 1 ? candidates[0]![1] : undefined;
}

function removeMiddlewareBoundaryNewline(translation: string): string {
    // TOML multiline strings retain the newline immediately before the closing
    // delimiter. It is a serialization boundary, not part of the AST node
    // range, so leaving it here creates an extra line during reconstruction.
    if (translation.endsWith("\r\n")) return translation.slice(0, -2);
    if (translation.endsWith("\n") || translation.endsWith("\r")) {
        return translation.slice(0, -1);
    }
    return translation;
}

interface RenderNode {
    block: MarkdownBlock;
    children: RenderNode[];
}

function containsRange(parent: MarkdownBlock, child: MarkdownBlock): boolean {
    return (
        parent.range.start <= child.range.start &&
        child.range.end <= parent.range.end
    );
}

function buildBlockTree(blocks: MarkdownBlock[]): RenderNode[] {
    const roots: RenderNode[] = [];
    const stack: RenderNode[] = [];

    for (const block of blocks) {
        while (
            stack.length > 0 &&
            !containsRange(stack[stack.length - 1]!.block, block)
        ) {
            stack.pop();
        }

        const node: RenderNode = { block, children: [] };
        const parent = stack[stack.length - 1];
        if (parent === undefined) {
            roots.push(node);
        } else {
            parent.children.push(node);
        }

        if (block.composite) stack.push(node);
    }

    return roots;
}

function lineIndentBefore(template: string, offset: number): string {
    const lineStart = Math.max(
        template.lastIndexOf("\n", Math.max(0, offset - 1)),
        template.lastIndexOf("\r", Math.max(0, offset - 1)),
    ) + 1;
    const prefix = template.slice(lineStart, offset);
    return /^[ \t]*$/u.test(prefix) ? prefix : "";
}

/** Add an indentation prefix to non-empty continuation lines only. */
function indentContinuationLines(value: string, indent: string): string {
    if (value.length === 0 || indent.length === 0) return value;
    return value.replace(/(\r\n|\r|\n)(?=[^\r\n])/gu, (lineBreak) => {
        return `${lineBreak}${indent}`;
    });
}

function renderTemplate(
    template: string,
    children: RenderNode[],
    middleware: MiddlewareDocument | MiddlewareTranslationMap,
): string {
    const childrenByKey = new Map(
        children.map((child) => [child.block.key, child]),
    );
    const placeholder = /\{\{([^{}\r\n]+)\}\}/gu;
    let cursor = 0;
    let output = "";

    for (const match of template.matchAll(placeholder)) {
        const matchText = match[0];
        const key = match[1]?.trim();
        const matchOffset = match.index ?? 0;
        output += template.slice(cursor, matchOffset);

        const child = key === undefined ? undefined : childrenByKey.get(key);
        if (child === undefined) {
            // Keep malformed or stale placeholders visible instead of silently
            // deleting source content.
            output += matchText;
        } else {
            const childIndent = lineIndentBefore(template, matchOffset);
            output += indentContinuationLines(
                renderNode(child, middleware),
                childIndent,
            );
        }
        cursor = matchOffset + matchText.length;
    }

    return output + template.slice(cursor);
}

function renderNode(
    node: RenderNode,
    middleware: MiddlewareDocument | MiddlewareTranslationMap,
): string {
    if (!node.block.composite) {
        const translation = translationForBlock(node.block, middleware);
        return translation === undefined
            ? normalizeBlockContent(node.block.origin, node.block.indent)
            : removeMiddlewareBoundaryNewline(translation);
    }

    const template =
        node.block.template ??
        normalizeBlockContent(node.block.origin, node.block.indent);
    return renderTemplate(template, node.children, middleware);
}

/** Rebuild a document with descending source-range replacements. */
export function buildDocument(
    source: string,
    options: BuildDocumentOptions,
): string {
    const document = parseDocument(source);
    const blocks = extractBlocks(document);
    const roots = buildBlockTree(blocks);
    const replacements = roots.map((node) => ({
        start: node.block.range.start,
        end: node.block.range.end,
        translation: indentContinuationLines(
            renderNode(node, options.middleware),
            node.block.indent,
        ),
    }));

    replacements.sort((left, right) => right.start - left.start);
    let output = source;
    for (const replacement of replacements) {
        output =
            output.slice(0, replacement.start) +
            replacement.translation +
            output.slice(replacement.end);
    }
    return output;
}

export interface RebuildFileOptions {
    sourcePath: string;
    middlewarePath: string;
    outputPath: string;
}

export function rebuildFile(options: RebuildFileOptions): void {
    mkdirSync(dirname(options.outputPath), { recursive: true });
    if (!existsSync(options.middlewarePath)) {
        copyFileSync(options.sourcePath, options.outputPath);
        return;
    }
    const source = readFileSync(options.sourcePath, "utf8");
    const middleware = readMiddleware(options.middlewarePath);
    writeFileSync(
        options.outputPath,
        buildDocument(source, { middleware }),
        "utf8",
    );
}
