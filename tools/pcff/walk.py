"""
Walking a Prism graph binary as a chunk stream.

The graph geometry of most Prism sheets lives in `PCFFGRA4`, a format nothing
outside GraphPad decodes. The useful discovery is that it is not the flat
struct dump it looks like: it is a stream of tagged, length-prefixed chunks.

    <u16 tag> <u32 length> <length bytes of payload>

That matters more than any single field, because it means an unknown chunk can
be stepped over rather than guessed at. A reader can take the parts it
understands and carry the rest through untouched, which is the same contract
the rest of this project already keeps for entries it cannot parse.

Tags whose top nibble is 4 are markers: two bytes, no length and no payload.
They appear between chunks and a walker that treats them as ordinary headers
reads their neighbours as a length and lands nowhere.

Run:  python tools/pcff/walk.py [--tags] [path-to-prism-installation]
"""

import glob
import json
import os
import struct
import sys
import zipfile
from collections import Counter

MAGIC = b"PCFFGRA4"
HEADER = 6
MARKER_MASK = 0x4000
PAYLOAD_MASK = 0x8000


def chunks(b, start):
    """Every chunk from `start`, plus where the walk stopped and why."""
    out = []
    off = start
    n = len(b)
    while off + 2 <= n:
        tag = struct.unpack_from("<H", b, off)[0]
        # A marker: two bytes, nothing else. `0x40ee` sits between chunks and
        # carries neither a length nor a payload.
        if tag & MARKER_MASK and not tag & PAYLOAD_MASK:
            out.append((off, tag, None, b""))
            off += 2
            continue
        if off + HEADER > n:
            return out, off, "truncated header"
        ln = struct.unpack_from("<I", b, off + 2)[0]
        if ln > n - off - HEADER:
            return out, off, f"length {ln} overruns at {off} (tag 0x{tag:04x})"
        out.append((off, tag, ln, b[off + HEADER : off + HEADER + ln]))
        off += HEADER + ln
    return out, off, "clean to the end" if off == n else f"stopped at {off} of {n}"


def first_chunk(b):
    """Where the chunk stream starts, which is the uid chunk the writer emits."""
    i = b.find(b"\x15\x20")
    return i if i >= 0 else None


def graph_blobs(root):
    """Every graph binary in every bundle under `root`, with its sheet title."""
    for path in glob.glob(os.path.join(root, "**", "*"), recursive=True):
        if not os.path.isfile(path):
            continue
        try:
            z = zipfile.ZipFile(path)
            names = z.namelist()
        except Exception:
            continue
        if "document.json" not in names:
            continue
        for n in names:
            if not (n.startswith("graphs/") and n.endswith("sheet.json")):
                continue
            data = n.rsplit("/", 1)[0] + "/data.bin"
            if data not in names:
                continue
            blob = z.read(data)
            if blob[:8] != MAGIC:
                continue
            sheet = json.loads(z.read(n))
            yield os.path.basename(path), sheet.get("title", ""), blob


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else "C:/Program Files/GraphPad/Prism"
    show_tags = "--tags" in sys.argv

    seen = Counter()
    covered = total = clean = blobs = 0
    for name, title, b in graph_blobs(root):
        blobs += 1
        start = first_chunk(b)
        if start is None:
            print(f"  {name[:28]:30} {title[:34]:36} no chunk stream found")
            continue
        got, end, why = chunks(b, start)
        covered += end - start
        total += len(b) - start
        if end == len(b):
            clean += 1
        for _, tag, ln, _ in got:
            seen[tag] += 1
        print(f"  {name[:28]:30} {title[:34]:36} {len(got):4} chunks  {why}")

    print()
    print(f"{blobs} blobs, {clean} walked cleanly to the end")
    print(f"bytes covered by the chunk walk: {covered}/{total} = {100 * covered / max(total, 1):.1f}%")
    if show_tags:
        print()
        print("tags, by how often they appear:")
        for tag, n in seen.most_common(40):
            kind = "marker" if tag & MARKER_MASK and not tag & PAYLOAD_MASK else "chunk"
            print(f"   0x{tag:04x}  {kind}  x{n}")


if __name__ == "__main__":
    main()
