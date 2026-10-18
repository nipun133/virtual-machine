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
JETBOX_PB = os.path.join(CONFIG_DIR, "jetbox_summaries_proto.pb")
AGYHUB_PB = os.path.join(CONFIG_DIR, "agyhub_summaries_proto.pb")
PROJECTS_DIR = os.path.expanduser("~/.gemini/config/projects")

# Remove Research project json
for pf in glob.glob(os.path.join(PROJECTS_DIR, "*c3061d7b*.json")):
    try:
        os.remove(pf)
        print(f"[Delete] Removed project definition: {pf}")
    except Exception as e:
        print(f"Error removing {pf}: {e}")

# Delete conversation files referencing research
for p in [CONV_DIR, ANNOTATIONS_DIR, BRAIN_DIR]:
    for target in ["3fe36fa0*", "b8e90531*", "de7d7421*", "7953b71c*", "462e8d30*"]:
        for match in glob.glob(os.path.join(p, target)):
            try:
                if os.path.isdir(match):
                    shutil.rmtree(match)
                else:
                    os.remove(match)
                print(f"[Delete] Removed {match}")
            except Exception as e:
                print(f"Error removing {match}: {e}")

# Clean SQLite DB to match only remaining existing .db files
if os.path.exists(DB_PATH):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    existing_cids = [os.path.basename(f)[:-3] for f in glob.glob(os.path.join(CONV_DIR, "*.db"))]
    if existing_cids:
        placeholders = ",".join("?" for _ in existing_cids)
        cur.execute(f"DELETE FROM conversation_summaries WHERE conversation_id NOT IN ({placeholders})", existing_cids)
    cur.execute("DELETE FROM conversation_summaries WHERE project_id = 'c3061d7b-ed93-4bd9-920c-f93b7bc6fce3'")
    cur.execute("DELETE FROM conversation_summaries WHERE workspace_uris LIKE '%Research%'")
    conn.commit()
    conn.close()
    print(f"[Delete] Database pruned to match remaining conversations: {existing_cids}")

# Remove old protobuf stores so agy regenerates clean ones
for pb in [JETBOX_PB, AGYHUB_PB]:
    if os.path.exists(pb):
        try:
            os.remove(pb)
            print(f"[Delete] Removed {pb}")
        except Exception as e:
            print(f"Error removing {pb}: {e}")

print("[Delete] All Research files and projects completely wiped.")
