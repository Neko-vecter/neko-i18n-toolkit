import type {
    TranslationContext,
    TranslationProvider,
} from "../../core/types.js";

export interface OpenAICompatibleProviderOptions {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    fetchImplementation?: typeof fetch;
}

interface ChatCompletionResponse {
    choices?: Array<{
        message?: {
            content?: string | Array<{ text?: string }>;
        };
    }>;
}

/** A small adapter for DashScope and other OpenAI-compatible chat endpoints. */
export class OpenAICompatibleProvider implements TranslationProvider {
    private readonly apiKey: string | undefined;
    private readonly baseUrl: string;
    private readonly model: string;
    private readonly fetchImplementation: typeof fetch;

    public constructor(options: OpenAICompatibleProviderOptions = {}) {
        this.apiKey = options.apiKey;
        this.baseUrl = (
            options.baseUrl ??
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        ).replace(/\/+$/u, "");
        this.model = options.model ?? "qwen3-30b-a3b-instruct-2507";
        this.fetchImplementation = options.fetchImplementation ?? fetch;
    }

    public async translate(
        content: string,
        context: TranslationContext,
    ): Promise<string> {
        if (!this.apiKey) {
            throw new Error(
                "An API key is required for the OpenAI-compatible translation provider.",
            );
        }

        const response = await this.fetchImplementation(
            `${this.baseUrl}/chat/completions`,
            {
                method: "POST",
                headers: {
                    authorization: `Bearer ${this.apiKey}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: this.model,
                    messages: [
                        {
                            role: "system",
                            content: [
                                `Translate from ${context.sourceLanguage} to ${context.targetLanguage}.`,
                                "Return only the translated block.",
                                "Preserve Markdown, MDX, links, images, code, whitespace, and line structure.",
                            ].join(" "),
                        },
                        { role: "user", content },
                    ],
                }),
            },
        );

        if (!response.ok) {
            throw new Error(
                `Translation provider returned HTTP ${response.status}: ${await response.text()}`,
            );
        }
        const data = (await response.json()) as ChatCompletionResponse;
        const result = data.choices?.[0]?.message?.content;
        if (typeof result === "string") return result;
        if (Array.isArray(result))
            return result.map((part) => part.text ?? "").join("");
        throw new Error("Translation provider returned no message content.");
    }
}

export class DashScopeProvider extends OpenAICompatibleProvider {
    public constructor(options: OpenAICompatibleProviderOptions = {}) {
        const resolved: OpenAICompatibleProviderOptions = {};
        const apiKey = options.apiKey ?? process.env.DASHSCOPE_API_KEY;
        const baseUrl = options.baseUrl ?? process.env.DASHSCOPE_BASE_URL;
        const model = options.model ?? process.env.DASHSCOPE_MODEL;
        if (apiKey !== undefined) resolved.apiKey = apiKey;
        if (baseUrl !== undefined) resolved.baseUrl = baseUrl;
        if (model !== undefined) resolved.model = model;
        if (options.fetchImplementation !== undefined)
            resolved.fetchImplementation = options.fetchImplementation;
        super(resolved);
    }
}
