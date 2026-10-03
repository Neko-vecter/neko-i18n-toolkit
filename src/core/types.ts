import type { BlockType, MarkdownBlock } from "../markdown/types.js";

export type { BlockType, MarkdownBlock };

export interface TranslationContext {
    sourceLanguage: string;
    targetLanguage: string;
    documentPath?: string;
    block: MarkdownBlock;
}

export interface TranslationProvider {
    translate(content: string, context: TranslationContext): Promise<string>;
}

export interface TranslationMap {
    [key: string]: string;
}
