#!/usr/bin/env python3
import glob
import json
import os
import re
import sqlite3
import sys
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

def restore_titles_and_sources():
    if not os.path.exists(SUMMARIES_DB):
        return
    try:
        conn = sqlite3.connect(SUMMARIES_DB, timeout=5)
        cur = conn.cursor()
        updated = False
        for pbtxt in glob.glob(os.path.join(CONFIG_DIR, "annotations", "*.pbtxt")):
            cid = os.path.basename(pbtxt).replace(".pbtxt", "")
            try:
                with open(pbtxt, "r", encoding="utf-8") as f:
                    content = f.read()
                m = re.search(r'title\s*:\s*"([^"]+)"', content)
                if m:
                    title = m.group(1).strip()
                    # Check if update is needed
                    cur.execute("SELECT title, source FROM conversation_summaries WHERE conversation_id=?", (cid,))
                    row = cur.fetchone()
                    if row:
                        cur_title, cur_source = row[0], row[1]
                        if not cur_title or cur_source == 'CORTEX_TRAJECTORY_SOURCE_CLI':
                            new_title = cur_title if cur_title else title
                            cur.execute(
                                "UPDATE conversation_summaries SET title=?, source='CORTEX_TRAJECTORY_SOURCE_JETBOX' WHERE conversation_id=?",
                                (new_title, cid)
                            )
                            updated = True
            except Exception:
                pass
        if updated:
            conn.commit()
            print("[Watcher] Restored conversation titles and Jetbox source.")
        conn.close()
    except Exception:
        pass

def update_default_project_to_most_recent():
    if not os.path.exists(SUMMARIES_DB):
        return
    try:
        conn = sqlite3.connect(SUMMARIES_DB, timeout=5)
        cur = conn.cursor()
        cur.execute(
            "SELECT project_id FROM conversation_summaries WHERE project_id IS NOT NULL AND project_id != '' ORDER BY last_modified_time DESC LIMIT 1"
        )
        row = cur.fetchone()
        conn.close()
        if row and row[0]:
            pid = row[0].strip()
            cache_dir = os.path.join(CONFIG_DIR, "cache")
            os.makedirs(cache_dir, exist_ok=True)
            target_file = os.path.join(cache_dir, "default_project_id.txt")
            current = ""
            if os.path.exists(target_file):
                with open(target_file, "r") as f:
                    current = f.read().strip()
            if current != pid:
                with open(target_file, "w") as f:
                    f.write(pid)
                print(f"[Watcher] Pinned active project to: {pid}")
    except Exception:
        pass

def sync_all():
    ensure_project_configs()
    restore_titles_and_sources()
    update_default_project_to_most_recent()

if __name__ == "__main__":
    if "--daemon" in sys.argv:
        print("[Watcher] Starting continuous Antigravity metadata supervisor...")
        while True:
            sync_all()
            time.sleep(5)
    else:
        sync_all()
        print("Completed one-shot sync.")
