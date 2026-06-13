# Neko i18n Toolkit

## toml file design

```toml
[metadata]

[[block]] 
key = "sha256 for origin"
origin = '''
This is the original source text that needs translation.
It can span multiple lines comfortably.
'''
translate = '''
This is the translated text in the target language.
The extension makes these blocks easy to distinguish.
'''
```

## command

### build middleware file

```
python3 <path_to>/build_file_middleware.py -i docs/<path_to_file1> docs/<path_to_file2>
```

### build i18n file

```
python3 <path_to>/build_file_i18n.py -i docs/<path_to_file1> docs/<path_to_file2>
```

### build all file inside docs to middleware

```
python3 <path_to>/build_middleware.py
```

it will build to `i18n_middleware` also make a cache file in `.build_cache`.

### build all middleware to i18n docs

```
python3 <path_to>/sync_to_i18n.py
```

it will build toml file inside `i18n_middleware` to `i18n`.
