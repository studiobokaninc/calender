import os
import sqlite3
import chromadb
from pathlib import Path

# Paths
BACKEND_DIR = Path(__file__).resolve().parent
DB_PATH = BACKEND_DIR / "app" / "project_management.db"
CHROMA_PATH = BACKEND_DIR / "data" / "chroma"

def cleanup():
    print(f"Opening SQL DB: {DB_PATH}")
    if not DB_PATH.exists():
        print("Error: SQL Database not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM knowledge_items")
    valid_ids = [row[0] for row in cursor.fetchall()]
    conn.close()
    
    print(f"Valid IDs from SQL: {valid_ids}")

    print(f"Opening ChromaDB at {CHROMA_PATH}")
    if not CHROMA_PATH.exists():
        print("Error: ChromaDB directory not found.")
        return

    client = chromadb.PersistentClient(path=str(CHROMA_PATH))
    try:
        collection = client.get_collection("calendar_knowledge_base")
    except Exception as e:
        print(f"Error: Collection not found: {e}")
        return

    count_before = collection.count()
    print(f"ChromaDB count before: {count_before}")

    # Get all items from ChromaDB
    all_data = collection.get()
    metadatas = all_data.get("metadatas", [])
    ids_in_chroma = all_data.get("ids", [])

    items_to_delete = []
    
    # Identify items in Chroma that are NOT in SQL valid_ids
    for i, meta in enumerate(metadatas):
        item_id = meta.get("item_id")
        if item_id not in valid_ids:
            items_to_delete.append(ids_in_chroma[i])

    if items_to_delete:
        print(f"Deleting {len(items_to_delete)} ghost segments...")
        # Chromadb delete by internal IDs
        # We can also delete by item_id filter if we prefer
        collection.delete(ids=items_to_delete)
        print("Done deleting segments.")
    else:
        print("No ghost segments found.")

    count_after = collection.count()
    print(f"ChromaDB count after: {count_after}")

if __name__ == "__main__":
    cleanup()
