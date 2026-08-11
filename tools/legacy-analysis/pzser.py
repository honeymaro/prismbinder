import sys, os, zipfile, zlib, struct, collections, re

def load(path, member=None):
    if member:
        z = zipfile.ZipFile(path)
        n = [x for x in z.namelist() if x.endswith(member)][0]
        return z.read(n)
    return open(path, 'rb').read()

def all_streams(d):
    """Find and decompress every zlib stream in the blob."""
    out = []
    for sig in (b'\x78\x9c', b'\x78\xda', b'\x78\x01'):
        st = 0
        while True:
            k = d.find(sig, st)
            if k < 0: break
            st = k + 1
            try:
                o = zlib.decompressobj()
                r = o.decompress(d[k:])
                if len(r) > 500:
                    out.append((k, r))
            except Exception:
                pass
    out.sort()
    # dedupe overlapping
    res, last = [], -1
    for k, r in out:
        if k > last:
            res.append((k, r)); last = k
    return res

TAG = re.compile(rb'[A-Z][a-z]{3}')

def tags_histogram(b):
    c = collections.Counter()
    i = 0
    while i < len(b) - 4:
        t = b[i:i+4]
        if TAG.fullmatch(t):
            c[t.decode()] += 1
        i += 1
    return c

def walk(b, limit=200):
    """Heuristic linear walk of the tag stream."""
    i = 0
    n = 0
    while i < len(b) - 8 and n < limit:
        t = b[i:i+4]
        if not TAG.fullmatch(t):
            i += 1; continue
        kind = chr(t[0]); field = t[1:].decode()
        a, bb = struct.unpack_from('<II', b, i+4)
        rest = ''
        if kind == 'D' and field in ('key', 'val'):
            # length-prefixed string follows
            ln = a
            if 0 < ln < 300 and i+8+ln <= len(b):
                s = b[i+8:i+8+ln]
                if all(32 <= c < 127 for c in s):
                    rest = '"%s"' % s.decode('latin1')
        print('%06x  %s  a=%-10d b=%-10d %s' % (i, t.decode(), a, bb, rest))
        n += 1
        i += 4
    print('... (showing first %d tags)' % n)

def keys(b):
    """Extract Dkey-style names."""
    out = []
    for m in re.finditer(rb'Dkey(.{4})', b, re.S):
        ln = struct.unpack('<I', m.group(1))[0]
        s = b[m.end():m.end()+ln]
        if 0 < ln < 200 and all(32 <= c < 127 for c in s):
            out.append(s.decode('latin1'))
    return out

if __name__ == '__main__':
    arg = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else 'keys'
    if '::' in arg:
        p, m = arg.split('::'); d = load(p, m)
    else:
        d = load(arg)
    streams = all_streams(d)
    print('%d zlib stream(s) found, total %d bytes inflated' % (len(streams), sum(len(r) for _, r in streams)))
    big = b''.join(r for _, r in streams)
    if mode == 'hist':
        for t, c in tags_histogram(big).most_common(40):
            print('  %-6s %d' % (t, c))
    elif mode == 'walk':
        walk(streams[0][1])
    else:
        ks = keys(big)
        seen = collections.Counter(ks)
        print('%d Dkey occurrences, %d distinct' % (len(ks), len(seen)))
        for k, c in seen.most_common(400):
            print('  %-46s %d' % (k, c))
