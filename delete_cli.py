#!/usr/bin/env python3
"""
Wipe CLI Project conversations, annotations, brain logs, database entries, and project definition.
"""
import os
import glob
import sqlite3
import shutil

CONFIG_DIR = os.path.expanduser("~/.gemini/antigravity-cli")
CONV_DIR = os.path.join(CONFIG_DIR, "conversations")
ANNOTATIONS_DIR = os.path.join(CONFIG_DIR, "annotations")
BRAIN_DIR = os.path.join(CONFIG_DIR, "brain")
CACHE_DIR = os.path.join(CONFIG_DIR, "cache")
DB_PATH = os.path.join(CONFIG_DIR, "conversation_summaries.db")
JETBOX_PB = os.path.join(CONFIG_DIR, "jetbox_summaries_proto.pb")
AGYHUB_PB = os.path.join(CONFIG_DIR, "agyhub_summaries_proto.pb")
PROJECTS_DIR = os.path.expanduser("~/.gemini/config/projects")

# 1. Remove CLI project json
for pf in glob.glob(os.path.join(PROJECTS_DIR, "*default-cli-project*.json")):
    try:
        os.remove(pf)
        print(f"[Delete] Removed project definition: {pf}")
    except Exception as e:
        print(f"Error removing {pf}: {e}")

# 2. Delete all conversation files
for p in [CONV_DIR, ANNOTATIONS_DIR, BRAIN_DIR, CACHE_DIR]:
    if os.path.exists(p):
        for item in os.listdir(p):
            fpath = os.path.join(p, item)
            try:
                if os.path.isdir(fpath):
                    shutil.rmtree(fpath)
                else:
                    os.remove(fpath)
                print(f"[Delete] Removed {fpath}")
            except Exception as e:
                print(f"Error removing {fpath}: {e}")

# 3. Clean SQLite DB
if os.path.exists(DB_PATH):
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("DELETE FROM conversation_summaries")
        conn.commit()
        cur.execute("VACUUM")
        conn.close()
        print("[Delete] conversation_summaries table emptied.")
    except Exception as e:
        print(f"Error cleaning DB: {e}")

# 4. Remove old protobuf stores
for pb in [JETBOX_PB, AGYHUB_PB]:
    if os.path.exists(pb):
        try:
            os.remove(pb)
            print(f"[Delete] Removed {pb}")
        except Exception as e:
            print(f"Error removing {pb}: {e}")

print("[Delete] All CLI project files and conversations completely wiped.")
