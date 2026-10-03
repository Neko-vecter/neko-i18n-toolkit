# Neko i18n Toolkit

## toml file design

```toml
[metadata]

[[block]] 
key = "sha256 for origin"
type = "mdxJsxFlowElement"
composite = true
origin = '''
This is the original source text that needs translation.
It can span multiple lines comfortably.
'''
translate = '''
This is the translated text in the target language.
The extension makes these blocks easy to distinguish.
'''
```

## Development

```shell
pnpm install
pnpm build
pnpm test
```

## CLI

The CLI accepts one file, multiple files, or a directory. Below is example

```shell
pnpm i18n-toolkit extract --lang en -i docs/guide.md
```

The file will write into

```shell
i18n/en/docusaurus-plugin-content-docs/current/guide.toml
```

Build one translated document from toml file

```shell
pnpm i18n-toolkit build --lang en -i docs/guide.md
```

`sync` is `extract` then `build` the file

```shell
pnpm i18n-toolkit sync --lang en -i docs/guide.md
```

`-i/--input` can be repeated or can be replaced by a directory. If it is omitted, all `.md` and `.mdx` files below `docs/` are processed. Multiple target languages can be passed after `--lang`:

```shell
yarn cli extract -i docs/guide.md docs/api.md --lang en ja
```

The file layout

```text
i18n/<language>/docusaurus-plugin-content-docs/current/<document>.toml
i18n/<language>/docusaurus-plugin-content-docs/current/<document>.mdx
```

### env var

- `DASHSCOPE_API_KEY`: api key
- `DASHSCOPE_BASE_URL`: api url
- `DASHSCOPE_MODEL`: model

## Library API

This is example use this project as package

```tsx
import {
    buildDocument,
    createMiddleware,
    extractBlocks,
    parseDocument,
    writeMiddleware,
} from 'i18n-toolkit';

const parsed = parseDocument(markdown, 'docs/guide.md');
const blocks = extractBlocks(parsed);
const middleware = await createMiddleware({
    source: markdown,
    documentPath: 'docs/guide.md',
    targetLanguage: 'en',
});

writeMiddleware('i18n/en/guide.toml', middleware);
const translated = buildDocument(markdown, { middleware });
```
