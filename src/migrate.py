import tomlkit
import logging
from pathlib import Path
from parser import parse_blocks, get_block_key

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

def align_and_migrate_blocks(origin_blocks, translated_blocks):
    if len(origin_blocks) != len(translated_blocks):
        return None
    
    translation_mapping = {}
    for i in range(len(origin_blocks)):
        orig_b = origin_blocks[i]
        trans_b = translated_blocks[i]
        
        key = get_block_key(orig_b)
        translation_mapping[key] = trans_b
        
    return translation_mapping

def build_migrated_toml(blocks, translation_mapping):
    doc = tomlkit.document()
    doc.add("metadata", {}) 
    blocks_array = tomlkit.aot() 
    
    for b in blocks:
        key = get_block_key(b)
        translated = translation_mapping.get(key, b)

        table = tomlkit.table()
        table.add("key", key)
        for field, content in [("origin", b), ("translate", translated)]:
            if "\n" in content:
                table.add(field, tomlkit.string(f"\n{content}", multiline=True, literal=True))
            else:
                table.add(field, f"\n{content}")
        blocks_array.append(table)

    doc.add("block", blocks_array)
    return tomlkit.dumps(doc)

def migrate_single_file(old_trans_path: Path, origin_doc_path: Path, output_toml_path: Path):
    if not old_trans_path.exists():
        logger.error(f"old translate not found {old_trans_path}")
        return
    if not origin_doc_path.exists():
        logger.error(f"origin docs not found {origin_doc_path}")
        return

    try:
        origin_content = origin_doc_path.read_text(encoding="utf-8")
        origin_blocks = parse_blocks(origin_content)

        old_trans_content = old_trans_path.read_text(encoding="utf-8")
        translated_blocks = parse_blocks(old_trans_content)

        translation_mapping = align_and_migrate_blocks(origin_blocks, translated_blocks)
        
        if translation_mapping is None:
            logger.warning(
                f"[not migrate] origin block {len(origin_blocks)} translate block {len(translated_blocks)}"
            )
            return

        toml_string = build_migrated_toml(origin_blocks, translation_mapping)

        output_toml_path.parent.mkdir(parents=True, exist_ok=True)
        output_toml_path.write_text(toml_string, encoding="utf-8")
        logger.info(f"migrate and write -> {output_toml_path}")

    except Exception as e:
        logger.error(f"migrate error {old_trans_path.name}: {e}")

def main():
    old_docs_dir = Path("i18n/en/docusaurus-plugin-content-docs/current") 
    origin_docs_dir = Path("docs")
    output_base_dir = Path("i18n_middleware/en")

    logger.info("start migrate...")

    if not old_docs_dir.exists():
        logger.error(f"old translate not found {old_docs_dir}")
        return

    old_md_files = list(old_docs_dir.rglob("*.md")) + list(old_docs_dir.rglob("*.mdx"))
    
    logger.info(f"found {len(old_md_files)} need migrate")

    for old_file in old_md_files:
        rel_path = old_file.relative_to(old_docs_dir)
        origin_file = origin_docs_dir / rel_path
        target_toml = (output_base_dir / rel_path).with_suffix(".toml")

        logger.info(f"{rel_path}")
        migrate_single_file(old_file, origin_file, target_toml)

    logger.info("done.")

if __name__ == "__main__":
    main()
