import { createHash } from "node:crypto";

/** Match the Python implementation's whitespace normalization exactly. */
export function normalizeBlock(content: string): string {
    return content.replace(/\s+/gu, " ").trim();
}

export function getBlockKey(content: string): string {
    return createHash("sha256")
        .update(normalizeBlock(content), "utf8")
        .digest("hex")
        .slice(0, 16);
}
