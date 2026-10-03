export interface CliFile {
    path: string;
    relative: string;
}

export interface CliWorkflowOptions {
    languages: string[];
    docsRoot: string;
    middlewareRoot: string;
    outputRoot: string;
    sourceLanguage: string;
    translate: boolean;
}
