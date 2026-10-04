import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify } from "@iarna/toml";
import type {
    MiddlewareDocument,
    MiddlewareBlock,
    MiddlewareTranslationMap,
    MergeTranslationsResult,
} from "./types.js";
import { isMiddlewareDocument } from "./reader.js";
import { getBlockKey } from "../core/hash.js";

function normalizeNewlines(value: string): string {
    return value.replace(/\r\n?/gu, "\n");
}

function multilineLiteral(name: string, value: string): string {
    const normalized = normalizeNewlines(value);
    if (normalized.includes("'''")) {
        // TOML literal strings cannot contain their own delimiter. Keep the
        // content lossless with a basic multiline string for this rare edge case.
        const escaped = normalized
            .replaceAll("\\", "\\\\")
            .replaceAll('"', '\\"');
        const body =
            escaped.length === 0 || escaped.endsWith("\n")
                ? escaped
                : `${escaped}\n`;
        return `${name} = """\n${body}"""`;
    }
    if (normalized.length === 0) return `${name} = '''\n'''`;
    const body = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
    return `${name} = '''\n${body}'''`;
}

/**
 * Serialize every block body as a TOML literal multiline string. This keeps
 * the visible format stable for both one-line and multi-line Markdown blocks.
 */
export function stringifyMiddleware(document: MiddlewareDocument): string {
    const metadataValue = stringify({
        metadata: document.metadata,
    } as never).trimEnd();
    const metadata =
        metadataValue === "metadata = { }" ? "[metadata]" : metadataValue;
    const sections = [metadata];

    for (const block of document.blocks) {
        const lines = ["[[block]]", `key = ${JSON.stringify(block.key)}`];
        if (block.type !== undefined) lines.push(`type = ${JSON.stringify(block.type)}`);
        if (block.composite === true) lines.push("composite = true");
        lines.push(
            multilineLiteral("origin", block.origin),
            multilineLiteral("translate", block.translate),
        );
        sections.push(lines.join("\n"));
    }

    return `${sections.join("\n\n")}\n`;
}

export function writeMiddleware(
    path: string,
    document: MiddlewareDocument,
): void {
    const content = stringifyMiddleware(document);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
}

const blockPlaceholder = /\{\{([^{}\r\n]+)\}\}/gu;

function sameBlockKind(left: MiddlewareBlock, right: MiddlewareBlock): boolean {
    return (
        (left.composite === true) === (right.composite === true) &&
        (left.type === undefined ||
            right.type === undefined ||
            left.type === right.type)
    );
}

function compositeStructureKey(block: MiddlewareBlock): string {
    const shell = block.origin.replace(blockPlaceholder, "{{child}}");
    return `${block.type ?? ""}:${getBlockKey(shell)}`;
}

/** Keep the translated shell and align its child references to the current origin. */
function updateTemplateKeys(translation: string, origin: string): string {
    const currentKeys = Array.from(origin.matchAll(blockPlaceholder), (match) =>
        match[1]!.trim(),
    );
    let index = 0;
    return translation.replace(blockPlaceholder, (placeholder) => {
        const currentKey = currentKeys[index];
        index += 1;
        return currentKey === undefined ? placeholder : `{{${currentKey}}}`;
    });
}

export function mergeExistingTranslations(
    blocks: MiddlewareBlock[],
    existing: MiddlewareDocument | MiddlewareTranslationMap,
): MergeTranslationsResult {
    const existingBlocks = isMiddlewareDocument(existing)
        ? existing.blocks
        : [];
    const translations = isMiddlewareDocument(existing)
        ? Object.fromEntries(
              existing.blocks.map((block) => [block.key, block.translate]),
          )
        : existing;
    const currentKeys = new Set(blocks.map((block) => block.key));
    const preservedKeys: string[] = [];

    const existingLeafBlocks = isMiddlewareDocument(existing)
        ? existing.blocks.filter((block) => block.composite !== true)
        : [];
    const fallbackByOrigin = new Map<string, MiddlewareBlock[]>();
    for (const block of existingLeafBlocks) {
        const originKey = getBlockKey(block.origin);
        const candidates = fallbackByOrigin.get(originKey) ?? [];
        candidates.push(block);
        fallbackByOrigin.set(originKey, candidates);
    }

    const existingCompositeBlocks = isMiddlewareDocument(existing)
        ? existing.blocks.filter((block) => block.composite === true)
        : [];
    const fallbackByCompositeStructure = new Map<string, MiddlewareBlock[]>();
    for (const block of existingCompositeBlocks) {
        const structureKey = compositeStructureKey(block);
        const candidates = fallbackByCompositeStructure.get(structureKey) ?? [];
        candidates.push(block);
        fallbackByCompositeStructure.set(structureKey, candidates);
    }

    const currentLeafBlocks = blocks.filter((block) => block.composite !== true);
    const currentByOrigin = new Map<string, MiddlewareBlock[]>();
    for (const block of currentLeafBlocks) {
        const originKey = getBlockKey(block.origin);
        const candidates = currentByOrigin.get(originKey) ?? [];
        candidates.push(block);
        currentByOrigin.set(originKey, candidates);
    }

    const currentCompositeBlocks = blocks.filter(
        (block) => block.composite === true,
    );
    const currentByCompositeStructure = new Map<string, MiddlewareBlock[]>();
    for (const block of currentCompositeBlocks) {
        const structureKey = compositeStructureKey(block);
        const candidates = currentByCompositeStructure.get(structureKey) ?? [];
        candidates.push(block);
        currentByCompositeStructure.set(structureKey, candidates);
    }

    const merged = blocks.map((block) => {
        if (Object.prototype.hasOwnProperty.call(translations, block.key)) {
            preservedKeys.push(block.key);
            const translate = translations[block.key]!;
            return {
                ...block,
                translate:
                    block.composite === true
                        ? updateTemplateKeys(translate, block.origin)
                        : translate,
            };
        }

        if (block.composite === true) {
            const structureKey = compositeStructureKey(block);
            const candidates =
                fallbackByCompositeStructure.get(structureKey) ?? [];
            const currentCandidates =
                currentByCompositeStructure.get(structureKey) ?? [];
            if (candidates.length === 1 && currentCandidates.length === 1) {
                preservedKeys.push(block.key);
                return {
                    ...block,
                    translate: updateTemplateKeys(
                        candidates[0]!.translate,
                        block.origin,
                    ),
                };
            }
            return { ...block };
        }

        const originKey = getBlockKey(block.origin);
        const candidates = (fallbackByOrigin.get(originKey) ?? []).filter(
            (candidate) => sameBlockKind(candidate, block),
        );
        const currentCandidates = (currentByOrigin.get(originKey) ?? []).filter(
            (candidate) => sameBlockKind(candidate, block),
        );
        if (candidates.length === 1 && currentCandidates.length === 1) {
            preservedKeys.push(block.key);
            return { ...block, translate: candidates[0]!.translate };
        }
        return { ...block };
    });

    const removed = existingBlocks.filter(
        (block) => !currentKeys.has(block.key),
    );
    return { blocks: merged, removed, preservedKeys };
}
