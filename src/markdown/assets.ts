import { posix, relative, resolve, sep } from "node:path";
import { parseDocument } from "./parser.js";
import type { MarkdownBlock, ParsedDocument } from "./types.js";

export interface AssetPathOptions {
    docsRoot?: string;
}

interface SourceReplacement {
    start: number;
    end: number;
    value: string;
}

interface PositionedNode {
    position?: {
        start?: { offset?: number };
        end?: { offset?: number };
    };
    children?: unknown[];
    url?: string;
    type: string;
    name?: string;
    attributes?: unknown[];
}

function normalizedPath(value: string): string {
    return value.replaceAll("\\", "/");
}

function splitSuffix(assetPath: string): { path: string; suffix: string } {
    const match = /([?#].*)$/u.exec(assetPath);
    if (!match || match.index === undefined) {
        return { path: assetPath, suffix: "" };
    }
    return {
        path: assetPath.slice(0, match.index),
        suffix: match[0],
    };
}

function isUntransformablePath(assetPath: string): boolean {
    return (
        assetPath.length === 0 ||
        ["/", "#", "@site/", "data:", "mailto:"].some((prefix) =>
            assetPath.startsWith(prefix),
        ) ||
        /^[a-z][a-z\d+.-]*:/iu.test(assetPath)
    );
}

function documentDirectory(documentPath: string, docsRoot?: string): string {
    const document = normalizedPath(documentPath);
    if (docsRoot !== undefined) {
        const absoluteDocument = normalizedPath(resolve(documentPath));
        const absoluteRoot = normalizedPath(resolve(docsRoot));
        const relativeDocument = relative(
            absoluteRoot,
            absoluteDocument,
        ).replaceAll(sep, "/");
        return posix.dirname(relativeDocument);
    }

    const docsMarker = document.indexOf("/docs/");
    if (docsMarker >= 0) {
        return posix.dirname(document.slice(docsMarker + "/docs/".length));
    }
    if (document.startsWith("docs/")) {
        return posix.dirname(document.slice("docs/".length));
    }
    return posix.dirname(document);
}

/** Resolve a document-relative asset to the Docusaurus @site/docs form. */
export function resolveAssetPath(
    documentPath: string | undefined,
    assetPath: string,
    options: AssetPathOptions = {},
): string {
    if (documentPath === undefined || isUntransformablePath(assetPath)) {
        return assetPath;
    }

    const { path: pathPart, suffix } = splitSuffix(assetPath);
    const directory = documentDirectory(documentPath, options.docsRoot);
    const resolved = posix.normalize(posix.join(directory, pathPart));
    if (resolved === ".." || resolved.startsWith("../")) {
        return assetPath;
    }
    return `@site/docs/${resolved.replace(/^\.\//u, "")}${suffix}`;
}

function nodeRange(
    node: PositionedNode,
): { start: number; end: number } | undefined {
    const start = node.position?.start?.offset;
    const end = node.position?.end?.offset;
    return start === undefined || end === undefined
        ? undefined
        : { start, end };
}

function walk(
    node: PositionedNode,
    visit: (node: PositionedNode) => void,
): void {
    visit(node);
    for (const child of node.children ?? []) {
        if (typeof child === "object" && child !== null) {
            walk(child as PositionedNode, visit);
        }
    }
}

function imageDestinationRange(
    raw: string,
): { start: number; end: number } | undefined {
    const open = raw.indexOf("](");
    if (open < 0) return undefined;

    let cursor = open + 2;
    if (raw[cursor] === "<") {
        cursor += 1;
        const end = raw.indexOf(">", cursor);
        return end < 0 ? undefined : { start: cursor, end };
    }

    let depth = 0;
    for (let index = cursor; index < raw.length; index += 1) {
        const character = raw[index];
        if (character === "\\") {
            index += 1;
            continue;
        }
        if (character === "(") {
            depth += 1;
            continue;
        }
        if (character === ")") {
            if (depth === 0) return { start: cursor, end: index };
            depth -= 1;
            continue;
        }
        if (/\s/u.test(character ?? "") && depth === 0) {
            return { start: cursor, end: index };
        }
    }
    return undefined;
}

function regexReplacements(
    raw: string,
    pattern: RegExp,
    replace: (match: RegExpExecArray) => string | undefined,
    absoluteStart: number,
): SourceReplacement[] {
    const replacements: SourceReplacement[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(raw)) !== null) {
        const value = replace(match);
        if (value !== undefined && value !== match[0]) {
            replacements.push({
                start: absoluteStart + match.index,
                end: absoluteStart + match.index + match[0].length,
                value,
            });
        }
        if (match[0].length === 0) pattern.lastIndex += 1;
    }
    return replacements;
}

function mdxTextReplacements(
    raw: string,
    absoluteStart: number,
    documentPath: string | undefined,
    options: AssetPathOptions,
): SourceReplacement[] {
    const replacements = [
        ...regexReplacements(
            raw,
            /\brequire\(\s*(["'])([^"']+)\1\s*\)(\.default)?/gu,
            (match) => {
                const asset = resolveAssetPath(
                    documentPath,
                    match[2] ?? "",
                    options,
                );
                if (asset === match[2]) return undefined;
                return `require(${match[1]}${asset}${match[1]})${match[3] ?? ".default"}`;
            },
            absoluteStart,
        ),
        ...regexReplacements(
            raw,
            /\b(src|img)(\s*=\s*)(["'])([^"']+)\3/gu,
            (match) => {
                const asset = resolveAssetPath(
                    documentPath,
                    match[4] ?? "",
                    options,
                );
                if (asset === match[4]) return undefined;
                return `${match[1]}${match[2]}${match[3]}${asset}${match[3]}`;
            },
            absoluteStart,
        ),
    ];

    return replacements;
}

function imageImportReplacements(
    raw: string,
    absoluteStart: number,
    documentPath: string | undefined,
    options: AssetPathOptions,
): SourceReplacement[] {
    return regexReplacements(
        raw,
        /\b(from\s*)(["'])(\.{1,2}\/[^"']+\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#][^"']*)?)(\2)/giu,
        (match) => {
            const asset = resolveAssetPath(
                documentPath,
                match[3] ?? "",
                options,
            );
            if (asset === match[3]) return undefined;
            return `${match[1]}${match[2]}${asset}${match[4]}`;
        },
        absoluteStart,
    );
}

function applyReplacements(
    source: string,
    replacements: SourceReplacement[],
): string {
    const unique = new Map<string, SourceReplacement>();
    for (const replacement of replacements) {
        unique.set(`${replacement.start}:${replacement.end}`, replacement);
    }

    const sorted = [...unique.values()].sort(
        (left, right) => right.start - left.start,
    );
    let output = source;
    let nextStart = Number.POSITIVE_INFINITY;
    for (const replacement of sorted) {
        if (replacement.end > nextStart) continue;
        output =
            output.slice(0, replacement.start) +
            replacement.value +
            output.slice(replacement.end);
        nextStart = replacement.start;
    }
    return output;
}

function collectAssetReplacements(
    document: ParsedDocument,
    options: AssetPathOptions,
): SourceReplacement[] {
    const { source, filePath: documentPath } = document;
    const replacements: SourceReplacement[] = [];
    const mdxContainers: { start: number; end: number }[] = [];

    walk(document.tree as unknown as PositionedNode, (node) => {
        const range = nodeRange(node);
        if (!range) return;

        if (node.type === "image" && typeof node.url === "string") {
            const raw = source.slice(range.start, range.end);
            const destination = imageDestinationRange(raw);
            const transformed = resolveAssetPath(
                documentPath,
                node.url,
                options,
            );
            if (destination && transformed !== node.url) {
                replacements.push({
                    start: range.start + destination.start,
                    end: range.start + destination.end,
                    value: transformed,
                });
            }
        }

        if (
            node.type === "mdxJsxFlowElement" ||
            node.type === "mdxJsxTextElement"
        ) {
            if (
                !mdxContainers.some(
                    (parent) =>
                        parent.start <= range.start && parent.end >= range.end,
                )
            ) {
                mdxContainers.push(range);
            }
        }
        if (node.type === "mdxjsEsm") {
            const raw = source.slice(range.start, range.end);
            replacements.push(
                ...imageImportReplacements(
                    raw,
                    range.start,
                    documentPath,
                    options,
                ),
            );
            replacements.push(
                ...mdxTextReplacements(raw, range.start, documentPath, options),
            );
        }
    });

    for (const range of mdxContainers) {
        const raw = source.slice(range.start, range.end);
        replacements.push(
            ...mdxTextReplacements(raw, range.start, documentPath, options),
        );
    }

    return replacements;
}

/** Transform assets in an already parsed document without parsing it again. */
export function transformAssetsInDocument(
    document: ParsedDocument,
    options: AssetPathOptions = {},
): string {
    return applyReplacements(
        document.source,
        collectAssetReplacements(document, options),
    );
}

/** Transform each extracted block using the source document's existing AST. */
export function transformAssetBlocks(
    document: ParsedDocument,
    blocks: MarkdownBlock[],
    options: AssetPathOptions = {},
): string[] {
    const replacements = collectAssetReplacements(document, options);
    return blocks.map((block) => {
        if (block.composite) return block.template ?? block.origin;
        const blockReplacements = replacements
            .filter(
                (replacement) =>
                    replacement.start >= block.range.start &&
                    replacement.end <= block.range.end,
            )
            .map((replacement) => ({
                ...replacement,
                start: replacement.start - block.range.start,
                end: replacement.end - block.range.start,
            }));
        return applyReplacements(block.origin, blockReplacements);
    });
}

/** Transform assets using AST-selected Markdown image and MDX/ESM ranges. */
export function transformAssets(
    source: string,
    documentPath?: string,
    options: AssetPathOptions = {},
): string {
    const document = parseDocument(source, documentPath);
    return transformAssetsInDocument(document, options);
}
