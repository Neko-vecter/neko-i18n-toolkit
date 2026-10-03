import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    createMiddleware,
    DashScopeProvider,
    writeMiddleware,
} from "../index.js";
import type { CliFile, CliWorkflowOptions } from "./types.js";

function middlewarePath(
    root: string,
    language: string,
    documentRelative: string,
): string {
    const withoutExtension = documentRelative.replace(
        /\.(?:md|mdx)$/iu,
        ".toml",
    );
    return join(
        resolve(root),
        language,
        "docusaurus-plugin-content-docs",
        "current",
        ...withoutExtension.split("/"),
    );
}

export async function extractFiles(
    options: CliWorkflowOptions,
    files: CliFile[],
): Promise<void> {
    if (options.translate && !process.env.DASHSCOPE_API_KEY) {
        throw new Error(
            "AI translation requires DASHSCOPE_API_KEY; omit AI translation or configure the key.",
        );
    }
    const provider = options.translate ? new DashScopeProvider() : undefined;

    for (const file of files) {
        for (const language of options.languages) {
            const target = middlewarePath(
                options.middlewareRoot,
                language,
                file.relative,
            );
            const middleware = await createMiddleware({
                source: readFileSync(file.path, "utf8"),
                documentPath: file.path,
                docsRoot: resolve(options.docsRoot),
                sourceLanguage: options.sourceLanguage,
                targetLanguage: language,
                middlewarePath: target,
                ...(provider === undefined ? {} : { provider }),
            });
            writeMiddleware(target, middleware);
            console.log(`extracted ${file.relative} -> ${target}`);
        }
    }
}
