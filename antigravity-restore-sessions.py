#!/usr/bin/env python3
import glob
import json
import os
import re
import sqlite3
import time

CONFIG_DIR = "/home/codespace/.gemini/antigravity-cli"
PROJECTS_DIR = "/home/codespace/.gemini/config/projects"
CLI_LOG = os.path.join(CONFIG_DIR, "cli.log")
SUMMARIES_DB = os.path.join(CONFIG_DIR, "conversation_summaries.db")

def ensure_project_configs():
    os.makedirs(PROJECTS_DIR, exist_ok=True)
    outside_proj = os.path.join(PROJECTS_DIR, "outside-of-project.json")
    if not os.path.exists(outside_proj):
        with open(outside_proj, "w") as f:
            json.dump({"id": "outside-of-project", "name": "Outside of Project", "projectResources": {}}, f, indent=2)
        print("Created outside-of-project.json")

def restore_titles_from_annotations():
    if not os.path.exists(SUMMARIES_DB):
        return
    try:
        conn = sqlite3.connect(SUMMARIES_DB)
        cur = conn.cursor()
        for pbtxt in glob.glob(os.path.join(CONFIG_DIR, "annotations", "*.pbtxt")):
            cid = os.path.basename(pbtxt).replace(".pbtxt", "")
            try:
                with open(pbtxt, "r", encoding="utf-8") as f:
                    content = f.read()
                m = re.search(r'title\s*:\s*"([^"]+)"', content)
                if m:
                    title = m.group(1).strip()
                    cur.execute("UPDATE conversation_summaries SET title=? WHERE conversation_id=? AND (title IS NULL OR title='')", (title, cid))
            except Exception as e:
                print(f"Error parsing annotation for {cid}: {e}")
        conn.commit()
        conn.close()
        print("Synchronized conversation titles from annotations.")
    except Exception as e:
        print(f"Error updating summaries DB: {e}")

def update_default_project_to_most_recent():
    if not os.path.exists(SUMMARIES_DB):
        return
    try:
        conn = sqlite3.connect(SUMMARIES_DB)
        cur = conn.cursor()
        cur.execute("SELECT project_id, conversation_id, workspace_uris FROM conversation_summaries WHERE project_id IS NOT NULL AND project_id != '' ORDER BY last_modified_time DESC LIMIT 1")
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            cache_dir = os.path.join(CONFIG_DIR, "cache")
            os.makedirs(cache_dir, exist_ok=True)
            with open(os.path.join(cache_dir, "default_project_id.txt"), "w") as f:
                f.write(row[0].strip())
            print(f"Updated default_project_id.txt to most recent project: {row[0]}")
    except Exception as e:
        print(f"Error updating default project: {e}")

if __name__ == "__main__":
    ensure_project_configs()
    restore_titles_from_annotations()
    update_default_project_to_most_recent()
