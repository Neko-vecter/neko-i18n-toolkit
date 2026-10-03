#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { buildFiles } from "./build.js";
import { extractFiles } from "./extract.js";
import type { CliFile, CliWorkflowOptions } from "./types.js";

interface CliOptions extends CliWorkflowOptions {
    command: "extract" | "build" | "sync";
    inputs: string[];
    languages: string[];
    docsRoot: string;
    middlewareRoot: string;
    outputRoot: string;
    sourceLanguage: string;
    translate: boolean;
}

function printHelp(): void {
    console.log(`Usage:
  i18n-toolkit [options] [files...]       Build translated documents (default)
  i18n-toolkit extract [options] [files...]
  i18n-toolkit build [options] [files...]
  i18n-toolkit sync [options] [files...]

Options:
  -i, --input <file...>       Markdown or MDX files (defaults to all files under docs/)
  -l, --lang <language>       Target language; may be repeated (default: en)
      --docs-root <dir>       Source documents root (default: docs)
      --middleware <dir>      Middleware root (default: i18n)
      --output <dir>          Built document root (default: i18n)
      --source-lang <lang>    Source language passed to translation providers (default: zh)
      --no-translate          Disable AI translation even when DASHSCOPE_API_KEY is set
  -h, --help                  Show this help
`);
}

function takeValues(
    argv: string[],
    index: number,
): { values: string[]; next: number } {
    const values: string[] = [];
    let next = index + 1;
    while (next < argv.length && !argv[next]!.startsWith("-")) {
        values.push(argv[next]!);
        next += 1;
    }
    if (values.length === 0)
        throw new Error(`Missing value for ${argv[index]}`);
    return { values, next };
}

function parseArgs(argv: string[]): CliOptions {
    const hasCommand =
        argv[0] !== undefined &&
        ["extract", "build", "sync"].includes(argv[0]!);
    const command = hasCommand ? argv[0]! : "build";
    if (command === "--help" || command === "-h") {
        printHelp();
        process.exit(0);
    }
    if (!["extract", "build", "sync"].includes(command)) {
        throw new Error(`Unknown command: ${command}`);
    }

    const options: CliOptions = {
        command: command as CliOptions["command"],
        inputs: [],
        languages: [],
        docsRoot: "docs",
        middlewareRoot: "i18n",
        outputRoot: "i18n",
        sourceLanguage: "zh",
        // Keep the Python behavior: AI is opt-in through the API key and is never
        // required for extracting middleware or rebuilding documents.
        translate: Boolean(process.env.DASHSCOPE_API_KEY),
    };

    for (let index = hasCommand ? 1 : 0; index < argv.length; index += 1) {
        const argument = argv[index]!;
        if (argument === "-h" || argument === "--help") {
            printHelp();
            process.exit(0);
        }
        if (argument === "-i" || argument === "--input") {
            const result = takeValues(argv, index);
            options.inputs.push(...result.values);
            index = result.next - 1;
        } else if (argument === "-l" || argument === "--lang") {
            const result = takeValues(argv, index);
            options.languages.push(...result.values);
            index = result.next - 1;
        } else if (argument === "--docs-root") {
            const result = takeValues(argv, index);
            options.docsRoot = result.values[0]!;
            index = result.next - 1;
        } else if (argument === "--middleware") {
            const result = takeValues(argv, index);
            options.middlewareRoot = result.values[0]!;
            index = result.next - 1;
        } else if (argument === "--output") {
            const result = takeValues(argv, index);
            options.outputRoot = result.values[0]!;
            index = result.next - 1;
        } else if (argument === "--source-lang") {
            const result = takeValues(argv, index);
            options.sourceLanguage = result.values[0]!;
            index = result.next - 1;
        } else if (argument === "--no-translate") {
            options.translate = false;
        } else if (argument.startsWith("-")) {
            throw new Error(`Unknown option: ${argument}`);
        } else {
            options.inputs.push(argument);
        }
    }
    if (options.languages.length === 0) options.languages.push("en");
    return options;
}

function isDocument(filePath: string): boolean {
    return [".md", ".mdx"].includes(extname(filePath).toLowerCase());
}

function discover(root: string): string[] {
    const result: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) result.push(...discover(path));
        else if (entry.isFile() && isDocument(path)) result.push(path);
    }
    return result;
}

function sourceFiles(options: CliOptions): CliFile[] {
    const root = resolve(options.docsRoot);
    const candidates =
        options.inputs.length === 0
            ? discover(root)
            : options.inputs.flatMap((input) => {
                  const path = resolve(input);
                  if (existsSync(path) && !isDocument(path))
                      return discover(path);
                  return [path];
              });

    return candidates.map((path) => {
        if (!isDocument(path))
            throw new Error(`Invalid input file type: ${path}`);
        const pathRelative = relative(root, path).replaceAll(sep, "/");
        if (
            pathRelative.startsWith("../") ||
            pathRelative === ".." ||
            pathRelative.includes("/../")
        ) {
            throw new Error(`Input must be under ${root}: ${path}`);
        }
        if (!existsSync(path)) throw new Error(`Input does not exist: ${path}`);
        return { path, relative: pathRelative };
    });
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const files = sourceFiles(options);
    if (options.command === "extract") await extractFiles(options, files);
    else if (options.command === "build") buildFiles(options, files);
    else {
        await extractFiles(options, files);
        buildFiles(options, files);
    }
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
