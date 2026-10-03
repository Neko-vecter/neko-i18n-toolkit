export interface MiddlewareBlock {
    key: string;
    origin: string;
    translate: string;
    type?: string;
    composite?: boolean;
}

export interface MiddlewareDocument {
    metadata: Record<string, unknown>;
    blocks: MiddlewareBlock[];
}

export interface MiddlewareTranslationMap {
    [key: string]: string;
}

export interface MergeTranslationsResult {
    blocks: MiddlewareBlock[];
    removed: MiddlewareBlock[];
    preservedKeys: string[];
}
