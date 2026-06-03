# Neko.vecter i18n Toolkit

## toml file design

```toml
[metadata]

[[block]] 
key = "3a9d397ac5618c86"
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

### build toml file

```
python3 <path_to>/build_middleware.py
```

it will build to `i18n_middleware` also make a cache file in `.build_cache`.

### build i18n docs

```
python3 <path_to>/sync_to_i18n.py
```

it will build toml file inside `i18n_middleware` to `i18n`.
