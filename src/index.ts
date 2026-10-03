export { getBlockKey, normalizeBlock } from "./core/hash.js";
export { parseDocument } from "./markdown/parser.js";
export { extractBlocks } from "./markdown/blocks.js";
export {
    resolveAssetPath,
    transformAssetBlocks,
    transformAssets,
    transformAssetsInDocument,
} from "./markdown/assets.js";
export { createMiddleware, updateMiddleware } from "./core/extract.js";
export { buildDocument, rebuildFile } from "./core/build.js";
export {
    parseMiddleware,
    readMiddleware,
    translationMap,
} from "./middleware/reader.js";
export {
    mergeExistingTranslations,
    stringifyMiddleware,
    writeMiddleware,
} from "./middleware/writer.js";

export type {
    BlockType,
    MarkdownBlock,
    ParsedDocument,
    SourceRange,
} from "./markdown/types.js";
export type { AssetPathOptions } from "./markdown/assets.js";
export type { CreateMiddlewareOptions } from "./core/extract.js";
export type { BuildDocumentOptions, RebuildFileOptions } from "./core/build.js";
export type {
    TranslationContext,
    TranslationMap,
    TranslationProvider,
} from "./core/types.js";
export {
    DashScopeProvider,
    OpenAICompatibleProvider,
} from "./translation/providers/index.js";
export type { OpenAICompatibleProviderOptions } from "./translation/providers/index.js";
export type {
    MiddlewareBlock,
    MiddlewareDocument,
    MiddlewareTranslationMap,
    MergeTranslationsResult,
} from "./middleware/types.js";
