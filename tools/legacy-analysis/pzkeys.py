import sys, os, zipfile, zlib, struct, collections, re, glob

def streams(d):
    out, last = [], -1
    cands = []
    for sig in (b'\x78\x9c', b'\x78\xda', b'\x78\x01'):
        st = 0
        while True:
            k = d.find(sig, st)
            if k < 0: break
            st = k+1
            cands.append(k)
    for k in sorted(cands):
        if k <= last: continue
        try:
            r = zlib.decompressobj().decompress(d[k:])
            if len(r) > 300:
                out.append(r); last = k + 1
        except Exception:
            pass
    return out

def keys(b):
    out = []
    for m in re.finditer(rb'Dkey(.{4})', b, re.S):
        ln = struct.unpack('<I', m.group(1))[0]
        s = b[m.end():m.end()+ln]
        if 0 < ln < 200 and all(32 <= c < 127 for c in s):
            out.append(s.decode('latin1'))
    return out

blobs = []
for path in sys.argv[1:]:
    for f in glob.glob(path):
        try:
            z = zipfile.ZipFile(f)
            for n in z.namelist():
                if n.endswith(('.bin',)):
                    blobs.append(z.read(n))
        except zipfile.BadZipFile:
            blobs.append(open(f, 'rb').read())

print('blobs:', len(blobs))
allkeys = collections.Counter()
for b in blobs:
    for s in streams(b):
        allkeys.update(keys(s))

print('%d distinct keys, %d total' % (len(allkeys), sum(allkeys.values())))
# group by prefix
groups = collections.defaultdict(list)
for k in allkeys:
    if '::' in k:
        groups[k.split('::')[0]].append(k.split('::', 1)[1])
    else:
        groups['<plain>'].append(k)
for g in sorted(groups, key=lambda x: -len(groups[x])):
    print('\n== %s  (%d) ==' % (g, len(groups[g])))
    print('   ' + ', '.join(sorted(groups[g])))
