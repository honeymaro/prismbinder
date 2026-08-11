import zipfile, json, sys, os, textwrap

path = sys.argv[1]
z = zipfile.ZipFile(path)
show = sys.argv[2:] if len(sys.argv) > 2 else None

def dump(name, maxlen=4000):
    d = z.read(name)
    print('\n' + '='*78)
    print('### %s   (%d bytes)' % (name, len(d)))
    print('='*78)
    if name.endswith('.json'):
        try:
            print(json.dumps(json.loads(d.decode('utf-8')), indent=1, ensure_ascii=False)[:maxlen])
            return
        except Exception as e:
            print('(json parse fail: %s)' % e)
    if name.endswith(('.csv', '.txt')):
        print(d.decode('utf-8', 'replace')[:maxlen]); return
    # binary
    print(repr(d[:400]))
    print('--- hex ---')
    for i in range(0, min(len(d), 320), 16):
        chunk = d[i:i+16]
        print('%06x  %-48s %s' % (i, ' '.join('%02x'%b for b in chunk),
              ''.join(chr(b) if 32 <= b < 127 else '.' for b in chunk)))

names = [n for n in z.namelist() if not n.endswith('/')]
for n in names:
    if show and not any(s in n for s in show): continue
    dump(n)
