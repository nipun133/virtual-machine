#!/usr/bin/env python3
"""
Wipe Research project conversations, annotations, brain logs, and database entries.
"""
import os
import glob
import sqlite3
import shutil

CONFIG_DIR = os.path.expanduser("~/.gemini/antigravity-cli")
CONV_DIR = os.path.join(CONFIG_DIR, "conversations")
ANNOTATIONS_DIR = os.path.join(CONFIG_DIR, "annotations")
BRAIN_DIR = os.path.join(CONFIG_DIR, "brain")
DB_PATH = os.path.join(CONFIG_DIR, "conversation_summaries.db")

RESEARCH_CIDS = [
    "3fe36fa0-a78e-451b-9e10-5e9baa23a654",
    "b8e90531-9de4-404f-a5e3-08e1747b29be",
    "de7d7421-2e26-4ec3-af1a-03f075e1b36e"
]

print("[Delete] Removing Research conversation files...")
for cid in RESEARCH_CIDS:
    # 1. Delete conversation files
    for f in glob.glob(os.path.join(CONV_DIR, f"{cid}*")):
        try:
            os.remove(f)
            print(f"  Deleted conversation file: {os.path.basename(f)}")
        except Exception as e:
            print(f"  Error removing {f}: {e}")

    # 2. Delete annotations
    for f in glob.glob(os.path.join(ANNOTATIONS_DIR, f"{cid}*")):
        try:
            os.remove(f)
            print(f"  Deleted annotation: {os.path.basename(f)}")
        except Exception as e:
            print(f"  Error removing {f}: {e}")

    # 3. Delete brain folder
    brain_path = os.path.join(BRAIN_DIR, cid)
    if os.path.exists(brain_path):
        try:
            shutil.rmtree(brain_path)
            print(f"  Deleted brain folder: {cid}")
        except Exception as e:
            print(f"  Error removing brain {cid}: {e}")

# 4. Remove from conversation_summaries.db
if os.path.exists(DB_PATH):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    for cid in RESEARCH_CIDS:
        cur.execute("DELETE FROM conversation_summaries WHERE conversation_id = ?", (cid,))
    cur.execute("DELETE FROM conversation_summaries WHERE workspace_uris LIKE '%Research%'")
    cur.execute("DELETE FROM conversation_summaries WHERE project_id = 'c3061d7b-ed93-4bd9-920c-f93b7bc6fce3'")
    conn.commit()
    conn.close()
    print("[Delete] Removed Research entries from conversation_summaries.db")

print("[Delete] Research project and conversations wiped successfully.")
