import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildDocument, readMiddleware } from "../index.js";
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

function outputPath(
    root: string,
    language: string,
    documentRelative: string,
): string {
    return join(
        resolve(root),
        language,
        "docusaurus-plugin-content-docs",
        "current",
        ...documentRelative.split("/"),
    );
}

export function buildFiles(
    options: CliWorkflowOptions,
    files: CliFile[],
): void {
    for (const file of files) {
        for (const language of options.languages) {
            const middlewareFile = middlewarePath(
                options.middlewareRoot,
                language,
                file.relative,
            );
            const target = outputPath(
                options.outputRoot,
                language,
                file.relative,
            );
            const source = readFileSync(file.path, "utf8");
            const output = existsSync(middlewareFile)
                ? buildDocument(source, {
                      middleware: readMiddleware(middlewareFile),
                  })
                : source;
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, output, "utf8");
            console.log(`built ${file.relative} -> ${target}`);
        }
    }
}
