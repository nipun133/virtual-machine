#!/usr/bin/env python3
"""
Antigravity Conversation Rebuilder for Headless Remote Control (VM / Codespaces)
Adapted from FutureisinPast/antigravity-conversation-fix (v1.07) for agy CLI daemon.
"""

import os
import sys
import glob
import sqlite3
import shutil
import re

# Resolve VM paths
HOME = os.path.expanduser("~")
GEMINI_CLI_DIR = os.path.join(HOME, ".gemini", "antigravity-cli")
CONV_DIR = os.path.join(GEMINI_CLI_DIR, "conversations")
BRAIN_DIR = os.path.join(GEMINI_CLI_DIR, "brain")
DB_PATH = os.path.join(GEMINI_CLI_DIR, "conversation_summaries.db")
JETBOX_PB = os.path.join(GEMINI_CLI_DIR, "jetbox_summaries_proto.pb")
AGYHUB_PB = os.path.join(GEMINI_CLI_DIR, "agyhub_summaries_proto.pb")


def decode_varint(data, pos):
    result, shift = 0, 0
    while pos < len(data):
        b = data[pos]
        result |= (b & 0x7F) << shift
        if (b & 0x80) == 0:
            return result, pos + 1
        shift += 7
        pos += 1
    return result, pos


def skip_protobuf_field(data, pos, wire_type):
    if wire_type == 0:
        _, pos = decode_varint(data, pos)
    elif wire_type == 2:
        length, pos = decode_varint(data, pos)
        pos += length
    elif wire_type == 1:
        pos += 8
    elif wire_type == 5:
        pos += 4
    return pos


def extract_prompt_from_conversation_db(db_path):
    """Extract first user prompt (field 19 -> subfield 2) from step_type 14."""
    if not os.path.isfile(db_path):
        return None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        # Find step table
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('steps', 'trajectories', 'conversation_steps')")
        tables = [r[0] for r in cur.fetchall()]
        table = tables[0] if tables else None
        if not table:
            # Check any table with step_payload
            for t in ["steps", "step_records", "messages"]:
                try:
                    cur.execute(f"SELECT step_payload FROM {t} LIMIT 1")
                    table = t
                    break
                except Exception:
                    pass
        if not table:
            conn.close()
            return None

        # Check idx column
        has_idx = True
        try:
            cur.execute(f"SELECT idx FROM {table} LIMIT 1")
        except Exception:
            has_idx = False

        order_col = "idx" if has_idx else "rowid"
        rows = cur.execute(f"SELECT step_payload FROM {table} WHERE step_type = 14 ORDER BY {order_col}").fetchall()
        conn.close()

        for row in rows:
            if not row or not row[0]:
                continue
            payload = bytes(row[0]) if isinstance(row[0], (bytes, memoryview)) else None
            if not payload:
                continue

            # Parse protobuf payload: look for field 19
            pos = 0
            while pos < len(payload):
                tag, pos = decode_varint(payload, pos)
                fn, wt = tag >> 3, tag & 7
                if fn == 19 and wt == 2:
                    flen, pos = decode_varint(payload, pos)
                    f19_bytes = payload[pos:pos+flen]
                    # Inside field 19, look for subfield 2 (string prompt)
                    sp = 0
                    while sp < len(f19_bytes):
                        stag, sp = decode_varint(f19_bytes, sp)
                        sfn, swt = stag >> 3, stag & 7
                        if sfn == 2 and swt == 2:
                            slen, sp = decode_varint(f19_bytes, sp)
                            prompt = f19_bytes[sp:sp+slen].decode("utf-8", errors="replace").strip()
                            if prompt:
                                return prompt
                        else:
                            sp = skip_protobuf_field(f19_bytes, sp, swt)
                    break
                else:
                    pos = skip_protobuf_field(payload, pos, wt)
    except Exception as e:
        pass
    return None


def format_title(prompt):
    if not prompt:
        return None
    # Clean whitespace and URLs
    text = re.sub(r'https?://\S+', '', prompt).strip()
    words = text.split()
    if not words:
        return None
    if len(words) > 10:
        return " ".join(words[:10]) + "..."
    title = " ".join(words)
    return title[:60] if len(title) > 60 else title


def get_brain_title(cid):
    candidate = os.path.join(BRAIN_DIR, cid)
    if os.path.isdir(candidate):
        for fname in ("overview.txt", "transcript.jsonl"):
            p = os.path.join(candidate, ".system_generated", "logs", fname)
            if os.path.exists(p):
                try:
                    with open(p, "r", encoding="utf-8", errors="ignore") as f:
                        for line in f:
                            if "USER_EXPLICIT" in line or "USER_INPUT" in line:
                                m = re.search(r'"content":\s*"([^"]+)"', line)
                                if m:
                                    return format_title(m.group(1))
                except Exception:
                    pass
    return None


def main():
    print("[Rebuild] Rebuilding conversation metadata and trajectory stores...")
    if not os.path.isdir(CONV_DIR):
        print(f"[Rebuild] No conversations directory found at {CONV_DIR}.")
        return

    # 1. Synchronize agyhub and jetbox protos
    if os.path.exists(AGYHUB_PB):
        try:
            shutil.copy2(AGYHUB_PB, JETBOX_PB)
            print("[Rebuild] Synchronized agyhub_summaries_proto.pb -> jetbox_summaries_proto.pb")
        except Exception as e:
            print(f"[Rebuild] Warning copying proto: {e}")

    # 2. Extract titles and rebuild conversation_summaries.db
    conv_files = sorted(glob.glob(os.path.join(CONV_DIR, "*.db")))
    if not os.path.isfile(DB_PATH) or not conv_files:
        print("[Rebuild] No database or conversation files to process.")
        return

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    reconciled = 0
    for fpath in conv_files:
        cid = os.path.basename(fpath)[:-3]
        prompt = extract_prompt_from_conversation_db(fpath)
        title = format_title(prompt) if prompt else None
        if not title:
            title = get_brain_title(cid)
        if not title:
            title = f"Conversation {cid[:8]}"

        cur.execute("""
            UPDATE conversation_summaries
            SET title = ?, source = 'CORTEX_TRAJECTORY_SOURCE_JETBOX'
            WHERE conversation_id = ?
        """, (title, cid))
        if cur.rowcount > 0:
            reconciled += 1
            print(f"  [+] Restored title for {cid[:8]}: {title}")

    conn.commit()
    conn.close()
    print(f"[Rebuild] Completed. Restored {reconciled} conversation summaries.")


if __name__ == "__main__":
    main()
