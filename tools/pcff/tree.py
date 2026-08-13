"""
The chunk stream is a tree, and the tree is where the meaning is.

`walk.py` shows that a Prism graph binary is a stream of tagged chunks. The tag
counts then show something stronger: every tag with bit 0x8000 set is matched,
one for one across the whole corpus, by a marker with 0x4000 set and the same
low bits. 0x8020 appears 265 times and 0x4020 appears 265 times; 0x80ad and
0x40ad appear 171 times each; and so on for every pair.

Those are open and close. The format is a nested tree - closer to a binary XML
than to a struct dump - and a reader can descend into what it understands and
step over whole subtrees it does not.

Run:  python tools/pcff/tree.py [--dump] [--axes] [path-to-prism-installation]
"""

import struct
import sys

from walk import MARKER_MASK, PAYLOAD_MASK, chunks, first_chunk, graph_blobs


class Node:
    __slots__ = ("tag", "offset", "payload", "children")

    def __init__(self, tag, offset, payload):
        self.tag = tag
        self.offset = offset
        self.payload = payload
        self.children = []

    def find(self, tag):
        """Every descendant carrying `tag`, in document order."""
        for c in self.children:
            if c.tag == tag:
                yield c
            yield from c.find(tag)

    def __repr__(self):
        return f"<0x{self.tag:04x} @{self.offset} {len(self.payload)}B {len(self.children)} children>"


def tree(b):
    """
    The chunk stream as a tree.

    An opening container's payload holds its children, so it is walked again
    rather than kept as bytes. Anything else is a leaf.
    """
    start = first_chunk(b)
    if start is None:
        return None
    root = Node(0, 0, b"")
    root.children = _nodes(b, start, len(b))
    return root


def _nodes(b, start, end):
    out = []
    off = start
    while off + 2 <= end:
        tag = struct.unpack_from("<H", b, off)[0]
        if tag & MARKER_MASK and not tag & PAYLOAD_MASK:
            off += 2
            continue
        if off + 6 > end:
            break
        ln = struct.unpack_from("<I", b, off + 2)[0]
        if ln > end - off - 6:
            break
        node = Node(tag, off, b[off + 6 : off + 6 + ln])
        if tag & PAYLOAD_MASK:
            # A container: its bytes are more chunks.
            node.children = _nodes(b, off + 6, off + 6 + ln)
        out.append(node)
        off += 6 + ln
    return out


AXIS = 0x0017


def axes(root):
    """
    Every axis range in the tree.

    The chunk is 60 bytes and opens with two doubles. Which two is settled by
    the data: for the Cities elbow plot they are exactly the first and last
    value of each plotted column.
    """
    out = []
    for n in root.find(AXIS):
        if len(n.payload) < 16:
            continue
        lo, hi = struct.unpack_from("<dd", n.payload, 0)
        if lo != lo or hi != hi:
            continue
        out.append((n.offset, lo, hi, n.payload))
    return out


def strings(root):
    """Leaf chunks whose payload is a NUL-terminated printable string."""
    out = []
    for n in _all(root):
        p = n.payload
        if len(p) < 2 or p[-1] != 0:
            continue
        body = p[:-1]
        if body and all(32 <= c < 127 for c in body):
            out.append((n.offset, n.tag, body.decode("ascii")))
    return out


def _all(node):
    for c in node.children:
        yield c
        yield from _all(c)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root_dir = args[0] if args else "C:/Program Files/GraphPad/Prism"

    for name, title, b in graph_blobs(root_dir):
        t = tree(b)
        if t is None:
            continue
        got, _, _ = chunks(b, first_chunk(b))
        depth = _depth(t)
        print(f"=== {name}  ::  {title[:44]}")
        print(f"    {len(got)} top-level chunks, tree depth {depth}, {sum(1 for _ in _all(t))} nodes")
        if "--axes" in sys.argv:
            for off, lo, hi, _ in axes(t):
                print(f"    axis @{off:6}  {lo:g} .. {hi:g}")
        if "--dump" in sys.argv:
            for off, tag, s in strings(t)[:12]:
                print(f"    string @{off:6} tag=0x{tag:04x}  {s[:60]!r}")


def _depth(n, d=0):
    return max([_depth(c, d + 1) for c in n.children], default=d)


if __name__ == "__main__":
    main()
