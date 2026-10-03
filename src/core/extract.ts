import { existsSync } from "node:fs";
import type { TranslationProvider } from "./types.js";
import {
    extractBlocks,
    normalizeBlockContent,
} from "../markdown/blocks.js";
import { transformAssetBlocks } from "../markdown/assets.js";
import { parseDocument } from "../markdown/parser.js";
import type { MarkdownBlock } from "../markdown/types.js";
import { readMiddleware } from "../middleware/reader.js";
import { isMiddlewareDocument } from "../middleware/reader.js";
import { mergeExistingTranslations } from "../middleware/writer.js";
import type {
    MiddlewareDocument,
    MiddlewareTranslationMap,
} from "../middleware/types.js";

function ensureTrailingNewline(value: string): string {
    return value.length === 0 || value.endsWith("\n") ? value : `${value}\n`;
}

export interface CreateMiddlewareOptions {
    source: string;
    documentPath?: string;
    docsRoot?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    provider?: TranslationProvider;
    existing?: MiddlewareDocument | MiddlewareTranslationMap;
    middlewarePath?: string;
    metadata?: Record<string, unknown>;
}

function initialBlock(block: MarkdownBlock, transformed: string) {
    const origin = block.composite
        ? block.template ?? block.origin
        : normalizeBlockContent(block.origin, block.indent);
    const translate = block.composite
        ? origin
        : normalizeBlockContent(transformed, block.indent);
    return {
        key: block.key,
        type: block.type,
        composite: block.composite,
        origin: ensureTrailingNewline(origin),
        translate: ensureTrailingNewline(translate),
    };
}

/** Extract AST blocks and prepare a TOML middleware document. */
export async function createMiddleware(
    options: CreateMiddlewareOptions,
): Promise<MiddlewareDocument> {
    const document = parseDocument(options.source, options.documentPath);
    const blocks = extractBlocks(document);
    const assetOptions =
        options.docsRoot === undefined ? {} : { docsRoot: options.docsRoot };
    const transformedBlocks = transformAssetBlocks(
        document,
        blocks,
        assetOptions,
    );
    const prepared = blocks.map((block, index) =>
        initialBlock(block, transformedBlocks[index]!),
    );

    const existing =
        options.existing ??
        (options.middlewarePath !== undefined &&
        existsSync(options.middlewarePath)
            ? readMiddleware(options.middlewarePath)
            : undefined);
    const merged =
        existing === undefined
            ? { blocks: prepared, removed: [], preservedKeys: [] }
            : mergeExistingTranslations(prepared, existing);

    if (options.provider === undefined) {
        return {
            metadata:
                options.metadata ??
                (isMiddlewareDocument(existing) ? existing.metadata : {}),
            blocks: merged.blocks,
        };
    }

    const sourceLanguage = options.sourceLanguage ?? "zh";
    const targetLanguage = options.targetLanguage ?? "en";
    const byKey = new Map(blocks.map((block) => [block.key, block]));
    const existingKeys = new Set(merged.preservedKeys);

    for (const block of merged.blocks) {
        // Existing translations always win, including deliberately empty values.
        if (existingKeys.has(block.key)) continue;
        const sourceBlock = byKey.get(block.key);
        if (!sourceBlock || !sourceBlock.translatable) continue;
        const context = {
            sourceLanguage,
            targetLanguage,
            block: sourceBlock,
        };
        if (options.documentPath !== undefined) {
            block.translate = ensureTrailingNewline(
                await options.provider.translate(block.translate, {
                    ...context,
                    documentPath: options.documentPath,
                }),
            );
        } else {
            block.translate = ensureTrailingNewline(
                await options.provider.translate(block.translate, context),
            );
        }
    }

    return {
        metadata:
            options.metadata ??
            (isMiddlewareDocument(existing) ? existing.metadata : {}),
        blocks: merged.blocks,
    };
}

/** Update an existing middleware file's block set while preserving keyed translations. */
export async function updateMiddleware(
    options: CreateMiddlewareOptions,
): Promise<MiddlewareDocument> {
    return createMiddleware(options);
}
