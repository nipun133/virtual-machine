#!/usr/bin/env python3
import glob
import json
import os
import re
import sqlite3
import time
import urllib.request

CONFIG_DIR = "/home/codespace/.gemini/antigravity-cli"
PROJECTS_DIR = "/home/codespace/.gemini/config/projects"
CLI_LOG = os.path.join(CONFIG_DIR, "cli.log")
SUMMARIES_DB = os.path.join(CONFIG_DIR, "conversation_summaries.db")
TOKEN_PATH = os.path.join(CONFIG_DIR, "antigravity-oauth-token")

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

def get_auth_token():
    if os.path.exists(TOKEN_PATH):
        try:
            with open(TOKEN_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("token", {}).get("access_token")
        except Exception:
            pass
    return None

def get_http_port():
    for _ in range(30):
        if os.path.exists(CLI_LOG):
            try:
                with open(CLI_LOG, "r", encoding="utf-8", errors="ignore") as f:
                    text = f.read()
                ports = re.findall(r"Language server listening on random port at (\d+) for HTTP", text)
                if ports:
                    return int(ports[-1])
            except Exception:
                pass
        time.sleep(1)
    return None

def warm_resident_trajectories(port):
    conv_files = glob.glob(os.path.join(CONFIG_DIR, "conversations", "*.db"))
    print(f"Found {len(conv_files)} conversation databases to make resident...")
    token = get_auth_token()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-Codeium-Api-Key"] = token

    for db_file in conv_files:
        cid = os.path.basename(db_file).replace(".db", "")
        url = f"http://127.0.0.1:{port}/exa.language_server_pb.LanguageServerService/LoadTrajectory"
        payload = json.dumps({"cascadeId": cid}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                print(f"Loaded trajectory {cid}: {resp.status}")
        except Exception as e:
            print(f"Failed to load {cid}: {e}")

if __name__ == "__main__":
    ensure_project_configs()
    restore_titles_from_annotations()
    port = get_http_port()
    if port:
        print(f"Antigravity HTTP RPC port detected: {port}")
        warm_resident_trajectories(port)
    else:
        print("Could not detect active HTTP port from log.")
