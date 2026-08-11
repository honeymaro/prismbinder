import sys, os, zipfile, struct, zlib, math, collections

def load(path, member=None):
    if member:
        z = zipfile.ZipFile(path)
        n = [x for x in z.namelist() if x.endswith(member)][0]
        return z.read(n)
    return open(path, 'rb').read()

def entropy(b):
    if not b: return 0
    c = collections.Counter(b)
    n = len(b)
    return -sum((v/n) * math.log2(v/n) for v in c.values())

def analyze(name, d):
    print('\n' + '#'*76)
    print('# %s   %d bytes   magic=%r' % (name, len(d), d[:8]))
    print('#'*76)
    # entropy map
    blk = max(len(d)//32, 256)
    print('entropy by block (%d bytes each):' % blk)
    row = []
    for i in range(0, len(d), blk):
        row.append('%.1f' % entropy(d[i:i+blk]))
    print('  ' + ' '.join(row))
    # signatures
    sigs = {b'\x78\x9c':'zlib(default)', b'\x78\xda':'zlib(best)', b'\x78\x01':'zlib(fast)',
            b'\x89PNG':'PNG', b'\x1f\x8b':'gzip', b'BM':'BMP', b'\xff\xd8\xff':'JPEG',
            b'\x01\x00\x00\x00':'EMF-hdr?', b'PK\x03\x04':'ZIP', b'PCFF':'PCFF'}
    print('signature hits:')
    for sig, nm in sigs.items():
        offs = []
        st = 0
        while True:
            k = d.find(sig, st)
            if k < 0 or len(offs) > 6: break
            offs.append(k); st = k+1
        if offs and nm not in ('EMF-hdr?',):
            print('  %-14s %s' % (nm, ['0x%x'%o for o in offs]))
    # try decompress at zlib hits
    for sig in (b'\x78\x9c', b'\x78\xda', b'\x78\x01'):
        st = 0
        while True:
            k = d.find(sig, st)
            if k < 0: break
            st = k+1
            try:
                out = zlib.decompressobj().decompress(d[k:])
                if len(out) > 200:
                    print('  >> zlib stream at 0x%x -> %d bytes, head=%r' % (k, len(out), out[:80]))
                    break
            except Exception:
                pass
    # length-prefixed strings scan
    print('length-prefixed strings (u32 len, ascii):')
    i = 0; found = 0
    while i < len(d)-4 and found < 40:
        n = struct.unpack_from('<I', d, i)[0]
        if 4 <= n <= 200 and i+4+n <= len(d):
            s = d[i+4:i+4+n]
            if s.endswith(b'\0') and all(32 <= c < 127 for c in s[:-1]):
                print('   0x%06x len=%-4d %r' % (i, n, s[:-1].decode('latin1')))
                found += 1
                i += 4+n; continue
        i += 1

for arg in sys.argv[1:]:
    if '::' in arg:
        p, m = arg.split('::')
        analyze(os.path.basename(p)+'!'+m, load(p, m))
    else:
        analyze(os.path.basename(arg), load(arg))
