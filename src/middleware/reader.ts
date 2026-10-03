import { readFileSync } from "node:fs";
import { parse } from "@iarna/toml";
import type {
    MiddlewareBlock,
    MiddlewareDocument,
    MiddlewareTranslationMap,
} from "./types.js";

export function isMiddlewareDocument(
    value: MiddlewareDocument | MiddlewareTranslationMap | undefined,
): value is MiddlewareDocument {
    return (
        typeof value === "object" &&
        value !== null &&
        Array.isArray((value as MiddlewareDocument).blocks)
    );
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function readBlocks(value: unknown): MiddlewareBlock[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((candidate) => {
        if (typeof candidate !== "object" || candidate === null) return [];
        const item = candidate as Record<string, unknown>;
        const key = stringValue(item.key);
        const origin = stringValue(item.origin);
        const translate = stringValue(item.translate);
        if (
            key === undefined ||
            origin === undefined ||
            translate === undefined
        )
            return [];
        const block: MiddlewareBlock = { key, origin, translate };
        if (typeof item.type === "string") block.type = item.type;
        if (typeof item.composite === "boolean") block.composite = item.composite;
        return [block];
    });
}

export function parseMiddleware(content: string): MiddlewareDocument {
    const parsed = parse(content) as Record<string, unknown>;
    const metadata =
        typeof parsed.metadata === "object" && parsed.metadata !== null
            ? (parsed.metadata as Record<string, unknown>)
            : {};
    return { metadata, blocks: readBlocks(parsed.block) };
}

export function readMiddleware(path: string | URL): MiddlewareDocument {
    return parseMiddleware(readFileSync(path, "utf8"));
}

export function translationMap(
    document: MiddlewareDocument,
): MiddlewareTranslationMap {
    return Object.fromEntries(
        document.blocks.map((block) => [block.key, block.translate]),
    );
}
