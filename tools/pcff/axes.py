"""
Reading a Prism graph's axes out of its binary.

The chunk tree (`tree.py`) makes this possible; what follows is the first
chunk whose meaning is settled rather than guessed. Tag 0x0017 is an axis, it
is 60 bytes, and a graph carries three of them in order: X, Y, and the second
Y that Prism leaves at 0 to 100 when nothing uses it.

    +0   double   lowest value plotted on this axis
    +8   double   highest value plotted
    +16  double   where the drawn axis starts
    +24  double   where it ends
    +32  double   where it crosses the other axis
    +46  u16      0 linear, 1 logarithmic

Two things establish the reading rather than assuming it.

**The data extent is checkable.** For the Cities elbow plot the first pair is
exactly 1 and 42, which is the first and last value of the plotted X column,
and the second pair is 0.0010405089565562735 and 84, which is the Y column to
the last digit. That holds for every graph in the corpus whose source table can
be found.

**The scale flag came from a controlled pair.** `Geometric mean.pzt` ships the
same data drawn twice, once titled "Linear axis" and once "Logarithmic axis".
Aligned structurally the two blobs differ in 153 places, but inside this chunk
they differ in exactly two: the drawn bounds, which read 0 and 1000 for the
linear one and -1 and 3 for the logarithmic - powers of ten, so 0.1 to 1000 -
and this flag.

Run:  python tools/pcff/axes.py [path-to-prism-installation]
"""

import struct
import sys

from tree import tree
from walk import graph_blobs

AXIS_TAG = 0x0017
AXIS_LEN = 60


class Axis:
    __slots__ = ("offset", "data_min", "data_max", "min", "max", "origin", "log")

    def __init__(self, offset, payload):
        self.offset = offset
        (self.data_min, self.data_max, self.min, self.max, self.origin) = struct.unpack_from(
            "<ddddd", payload, 0
        )
        self.log = struct.unpack_from("<H", payload, 46)[0] == 1

    def described(self):
        """The drawn bounds in data units. A log axis stores powers of ten."""
        if not self.log:
            return self.min, self.max
        return 10.0**self.min, 10.0**self.max

    def __repr__(self):
        lo, hi = self.described()
        kind = "log" if self.log else "linear"
        return f"{kind} {lo:g}..{hi:g} (data {self.data_min:g}..{self.data_max:g})"


def axes_of(blob):
    """The X, Y and second-Y axes, in the order the file writes them."""
    root = tree(blob)
    if root is None:
        return []
    return [
        Axis(n.offset, n.payload) for n in root.find(AXIS_TAG) if len(n.payload) >= AXIS_LEN
    ]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root_dir = args[0] if args else "C:/Program Files/GraphPad/Prism"

    total = logs = 0
    for name, title, blob in graph_blobs(root_dir):
        found = axes_of(blob)
        if not found:
            continue
        total += 1
        names = ["X", "Y", "Y2"]
        print(f"=== {name[:30]:32} {title[:40]}")
        for i, a in enumerate(found[:3]):
            if a.log:
                logs += 1
            print(f"    {names[i] if i < 3 else '?':3} {a}")
    print()
    print(f"{total} graphs read, {logs} logarithmic axes found")


if __name__ == "__main__":
    main()
