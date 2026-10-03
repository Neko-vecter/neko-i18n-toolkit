import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildDocument,
    createMiddleware,
    extractBlocks,
    getBlockKey,
    parseDocument,
    parseMiddleware,
    resolveAssetPath,
    stringifyMiddleware,
    transformAssets,
} from "../index.js";

test("block keys remain compatible with the Python normalization algorithm", () => {
    assert.equal(getBlockKey("  hello\nworld  "), "b94d27b9934d3e08");
    assert.equal(getBlockKey("你好\t世界"), getBlockKey("你好 世界"));
});

test("remark extracts top-level Markdown, GFM, frontmatter, and MDX blocks", () => {
    const source = [
        "---",
        "title: Demo",
        "---",
        "",
        "# Heading",
        "",
        "A paragraph.",
        "",
        "- one",
        "- two",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        '<Component value="x">',
        "  Child text.",
        "</Component>",
        "",
        "~~~ts",
        "const answer = 42",
        "~~~",
        "",
    ].join("\n");
    const document = parseDocument(source, "docs/demo.mdx");
    const blocks = extractBlocks(document);

    assert.deepEqual(
        blocks.map((block) => [block.type, block.translatable]),
        [
            ["yaml", false],
            ["heading", true],
            ["paragraph", true],
            ["list", false],
            ["listItem", false],
            ["paragraph", true],
            ["listItem", false],
            ["paragraph", true],
            ["table", true],
            ["mdxJsxFlowElement", false],
            ["paragraph", true],
            ["code", false],
        ],
    );
    assert.equal(blocks[1]?.origin, "# Heading");
    assert.equal(
        source.slice(blocks[4]!.range.start, blocks[4]!.range.end),
        blocks[4]!.origin,
    );
});

test("asset transformations operate on AST-selected ranges", () => {
    assert.equal(
        resolveAssetPath("docs/guide/page.md", "../img/x.png"),
        "@site/docs/img/x.png",
    );
    assert.equal(
        resolveAssetPath("docs/guide/page.md", "https://example.com/x.png"),
        "https://example.com/x.png",
    );

    const source = [
        '![alt](../img/x.png "title")',
        "",
        'import Icon from "./img/icon.svg"',
        "",
        '<Picture src={require("./img/photo.png")} />',
        "",
    ].join("\n");
    assert.equal(
        transformAssets(source, "docs/guide/page.mdx"),
        [
            '![alt](@site/docs/img/x.png "title")',
            "",
            'import Icon from "@site/docs/guide/img/icon.svg"',
            "",
            '<Picture src={require("@site/docs/guide/img/photo.png").default} />',
            "",
        ].join("\n"),
    );
});

test("Docusaurus JSX image, img, Markdown image, and image import paths are transformed", () => {
    const source = [
        "import image from './img/test.webp';",
        "",
        "<ImageView src={require('./img/test.webp').default} width=\"60%\"/>",
        "",
        "<img src={require('./img/test.webp').default} alt=\"test\" />",
        "",
        '<img src="./img/test.webp" alt="test" />',
        "",
        "![test](./img/test.webp)",
    ].join("\n");
    const expectedPath = "@site/docs/guide/img/test.webp";
    const transformed = transformAssets(source, "docs/guide/page.mdx");
    assert.equal(transformed.split(expectedPath).length - 1, 5);
    assert.match(
        transformed,
        /require\('@site\/docs\/guide\/img\/test\.webp'\)\.default/u,
    );
    assert.match(
        transformed,
        /<img src="@site\/docs\/guide\/img\/test\.webp"/u,
    );
    assert.match(
        transformed,
        /import image from '@site\/docs\/guide\/img\/test\.webp'/u,
    );
});

test("tabs, admonitions, and display math become stable top-level blocks", () => {
    const source = [
        "<Tabs>",
        '  <TabItem value="one" label="One">',
        "    Tab text.",
        "  </TabItem>",
        "</Tabs>",
        "",
        ":::note[Important]",
        "",
        "Admonition text.",
        "",
        ":::",
        "",
        "$$",
        "E = mc^2",
        "$$",
    ].join("\n");
    const blocks = extractBlocks(parseDocument(source, "docs/features.mdx"));
    assert.deepEqual(
        blocks.map((block) => [block.type, block.translatable]),
        [
            ["tabs", false],
            ["tabItem", false],
            ["paragraph", true],
            ["admonition", false],
            ["paragraph", true],
            ["math", false],
        ],
    );
    assert.equal(blocks[5]?.origin, "$$\nE = mc^2\n$$");
});

test("nested containers produce structural templates and leaf blocks", async () => {
    const source = [
        "<div>",
        '  <ImageView src={require("./img/test.webp").default} />',
        "",
        "  Keep this paragraph.",
        "",
        "  | A | B |",
        "  | - | - |",
        "  | 1 | 2 |",
        "</div>",
    ].join("\n");
    const blocks = extractBlocks(parseDocument(source, "docs/guide/page.mdx"));

    assert.deepEqual(
        blocks.map((block) => [block.type, block.composite, block.translatable]),
        [
            ["mdxJsxFlowElement", true, false],
            ["mdxJsxFlowElement", false, false],
            ["paragraph", false, true],
            ["table", false, true],
        ],
    );
    assert.match(blocks[0]!.template ?? "", /\{\{[^}]+\}\}/u);
    assert.match(
        blocks[0]!.template ?? "",
        new RegExp(`\\{\\{${blocks[1]!.key}\\}\\}`, "u"),
    );

    const middleware = await createMiddleware({
        source,
        documentPath: "docs/guide/page.mdx",
        docsRoot: "docs",
    });
    const serialized = stringifyMiddleware(middleware);
    const parsed = parseMiddleware(serialized);
    const composite = middleware.blocks.find((block) => block.composite);
    assert.ok(composite);
    assert.match(composite.translate, /\{\{[^}]+\}\}/u);
    assert.equal(parsed.blocks.find((block) => block.composite)?.composite, true);
    assert.match(parsed.blocks.find((block) => block.composite)?.translate ?? "", /\{\{[^}]+\}\}/u);
    assert.match(
        middleware.blocks.find((block) => block.type === "mdxJsxFlowElement" && !block.composite)!.translate,
        /@site\/docs\/guide\/img\/test\.webp/u,
    );
    const rebuilt = buildDocument(source, { middleware });
    assert.doesNotMatch(rebuilt, /\{\{[^}]+\}\}/u);
    assert.match(rebuilt, /@site\/docs\/guide\/img\/test\.webp/u);
});

test("nested templates store relative indentation and rebuild recursively", async () => {
    const source = [
        "<Tabs>",
        "    <Item>",
        "        item",
        "    </Item>",
        "</Tabs>",
        "",
    ].join("\n");
    const blocks = extractBlocks(parseDocument(source));
    const tabs = blocks[0]!;
    const item = blocks[1]!;
    const leaf = blocks[2]!;

    assert.equal(
        tabs.template,
        `<Tabs>\n    {{${item.key}}}\n</Tabs>`,
    );
    assert.equal(
        item.template,
        `<Item>\n    {{${leaf.key}}}\n</Item>`,
    );

    const middleware = await createMiddleware({ source });
    assert.equal(middleware.blocks[1]?.origin, item.template + "\n");
    assert.equal(middleware.blocks[2]?.origin, "item\n");

    const translated = {
        ...middleware,
        blocks: middleware.blocks.map((block) =>
            block.key === leaf.key
                ? { ...block, translate: "第一行\n第二行\n" }
                : block,
        ),
    };
    assert.equal(
        buildDocument(source, { middleware: translated }),
        [
            "<Tabs>",
            "    <Item>",
            "        第一行",
            "        第二行",
            "    </Item>",
            "</Tabs>",
            "",
        ].join("\n"),
    );
});

test("admonition templates preserve indentation only when it exists", async () => {
    const indentedSource = [
        ":::note",
        "",
        "    xxx",
        "",
        ":::",
        "",
    ].join("\n");
    const indentedBlocks = extractBlocks(parseDocument(indentedSource));
    const indentedParent = indentedBlocks[0]!;
    const indentedLeaf = indentedBlocks[1]!;
    assert.equal(
        indentedParent.template,
        `:::note\n\n    {{${indentedLeaf.key}}}\n\n:::`,
    );

    const indentedMiddleware = await createMiddleware({
        source: indentedSource,
    });
    const indentedTranslated = {
        ...indentedMiddleware,
        blocks: indentedMiddleware.blocks.map((block) =>
            block.key === indentedLeaf.key
                ? { ...block, translate: "line 1\nline 2\n" }
                : block,
        ),
    };
    assert.equal(
        buildDocument(indentedSource, { middleware: indentedTranslated }),
        [
            ":::note",
            "",
            "    line 1",
            "    line 2",
            "",
            ":::",
            "",
        ].join("\n"),
    );

    const flatSource = [":::note", "", "xxx", "", ":::", ""].join("\n");
    const flatBlocks = extractBlocks(parseDocument(flatSource));
    assert.equal(
        flatBlocks[0]?.template,
        `:::note\n\n{{${flatBlocks[1]!.key}}}\n\n:::`,
    );
    assert.equal(flatBlocks[1]?.indent, "");
});

test("list containers and their first item may share a source range", async () => {
    const source = [
        '6. <ImageView src={require("./test_System20.webp").default} width="60%"/>',
        "",
    ].join("\n");
    const blocks = extractBlocks(parseDocument(source));
    assert.deepEqual(
        blocks.map((block) => [block.type, block.composite]),
        [
            ["list", true],
            ["listItem", true],
            ["mdxJsxFlowElement", false],
        ],
    );
    assert.equal(blocks[0]?.range.start, blocks[1]?.range.start);
    assert.equal(blocks[0]?.range.end, blocks[1]?.range.end);

    const middleware = await createMiddleware({
        source,
        documentPath: "docs/page.mdx",
        docsRoot: "docs",
    });
    assert.equal(
        buildDocument(source, { middleware }),
        [
            '6. <ImageView src={require("@site/docs/test_System20.webp").default} width="60%"/>',
            "",
        ].join("\n"),
    );
});

test("list item templates do not corrupt adjacent JSX children", async () => {
    const source = [
        "6.",
        '   <ImageView src={require("./test_System19.webp").default} width="60%"/>',
        '   <ImageView src={require("./test_System20.webp").default} width="60%"/>',
        "",
    ].join("\n");
    const middleware = await createMiddleware({
        source,
        documentPath: "docs/page.mdx",
        docsRoot: "docs",
    });
    const rebuilt = buildDocument(source, { middleware });

    assert.equal(
        rebuilt,
        [
            "6.",
            '   <ImageView src={require("@site/docs/test_System19.webp").default} width="60%"/>',
            '   <ImageView src={require("@site/docs/test_System20.webp").default} width="60%"/>',
            "",
        ].join("\n"),
    );
    assert.doesNotMatch(rebuilt, /\{\{[^}]+\}\}/u);
});

test("unchanged nested leaves reuse translations when a parent key changes", async () => {
    const source = [
        "<div>",
        '  <ImageView src={require("./img/test.webp").default} />',
        "",
        "Keep this paragraph.",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "</div>",
    ].join("\n");
    const first = await createMiddleware({
        source,
        documentPath: "docs/guide/page.mdx",
        docsRoot: "docs",
        provider: {
            async translate(content) {
                return `translated: ${content}`;
            },
        },
    });
    const changedSource = source.replace("Keep this paragraph.", "Changed paragraph.");
    const calls: string[] = [];
    const second = await createMiddleware({
        source: changedSource,
        documentPath: "docs/guide/page.mdx",
        docsRoot: "docs",
        existing: first,
        provider: {
            async translate(content) {
                calls.push(content);
                return `translated: ${content}`;
            },
        },
    });

    assert.deepEqual(calls, ["Changed paragraph.\n"]);
    assert.equal(
        second.blocks.find((block) => block.type === "table" && !block.composite)?.translate,
        first.blocks.find((block) => block.type === "table" && !block.composite)?.translate,
    );
    const rebuilt = buildDocument(changedSource, { middleware: second });
    assert.match(rebuilt, /translated: Changed paragraph\./u);
    assert.doesNotMatch(rebuilt, /\{\{[^}]+\}\}/u);
});

test("AI providers only receive eligible text blocks", async () => {
    const calls: string[] = [];
    const middleware = await createMiddleware({
        source: [
            "Translate this.",
            "",
            "![image](./img/test.webp)",
            "",
            "<ImageView src={require('./img/test.webp').default} />",
        ].join("\n"),
        documentPath: "docs/guide/page.mdx",
        provider: {
            async translate(content) {
                calls.push(content);
                return "Translated.\n";
            },
        },
    });

    assert.deepEqual(calls, ["Translate this.\n"]);
    assert.equal(middleware.blocks[0]?.translate, "Translated.\n");
    assert.equal(
        middleware.blocks[1]?.origin,
        "![image](./img/test.webp)\n",
    );
    assert.equal(
        middleware.blocks[1]?.translate,
        "![image](@site/docs/guide/img/test.webp)\n",
    );
    assert.match(
        middleware.blocks[2]?.origin ?? "",
        /require\('\.\/img\/test\.webp'\)/u,
    );
    assert.match(
        middleware.blocks[2]?.translate ?? "",
        /@site\/docs\/guide\/img\/test\.webp/u,
    );
});

test("range-based building handles repeated blocks without replacing unrelated text", () => {
    const source = "# Title\n\nSame\n\nSame\n";
    const blocks = extractBlocks(parseDocument(source));
    const middleware = {
        metadata: {},
        blocks: blocks.map((block) => ({
            key: block.key,
            origin: block.origin,
            translate: block.type === "heading" ? "# 标题" : "相同",
        })),
    };
    assert.equal(
        buildDocument(source, { middleware }),
        "# 标题\n\n相同\n\n相同\n",
    );
});

test("building ignores the TOML multiline boundary newline", () => {
    const source = "# Title";
    const block = extractBlocks(parseDocument(source))[0]!;
    const middleware = {
        metadata: {},
        blocks: [
            {
                key: block.key,
                origin: `${block.origin}\n`,
                translate: "# 标题\n",
            },
        ],
    };

    assert.equal(buildDocument(source, { middleware }), "# 标题");
});

test("middleware TOML round trips multiline content and preserves translations", async () => {
    const source = "# Hello\n\n![x](./img.png)\n";
    const document = await createMiddleware({
        source,
        documentPath: "docs/page.md",
    });
    const serialized = stringifyMiddleware(document);
    assert.match(serialized, /^\[metadata\]/u);
    assert.match(serialized, /origin = '''\n# Hello\n'''/u);
    assert.match(serialized, /translate = '''\n# Hello\n'''/u);
    const parsed = parseMiddleware(serialized);
    assert.equal(parsed.blocks.length, 2);
    assert.equal(parsed.blocks[0]?.origin, "# Hello\n");
    assert.equal(parsed.blocks[1]?.translate, "![x](@site/docs/img.png)\n");
    const emptyTranslation = parseMiddleware(
        stringifyMiddleware({
            metadata: {},
            blocks: [{ key: "empty", origin: "x\n", translate: "" }],
        }),
    );
    assert.equal(emptyTranslation.blocks[0]?.translate, "");

    const updated = await createMiddleware({
        source,
        documentPath: "docs/page.md",
        existing: {
            metadata: {},
            blocks: parsed.blocks.map((block) => ({
                ...block,
                translate:
                    block.key === parsed.blocks[0]?.key
                        ? "你好"
                        : block.translate,
            })),
        },
    });
    assert.equal(updated.blocks[0]?.translate, "你好");
});

test("middleware reader accepts the Python implementation multiline TOML shape", () => {
    const legacy = [
        "metadata = {}",
        "",
        "[[block]]",
        'key = "legacy-key"',
        "origin = '''",
        "# Legacy heading",
        "'''",
        "translate = '''",
        "# 旧标题",
        "'''",
        "",
    ].join("\n");
    const parsed = parseMiddleware(legacy);
    assert.equal(parsed.blocks[0]?.origin, "# Legacy heading\n");
    assert.equal(parsed.blocks[0]?.translate, "# 旧标题\n");
});
