import zipfile, glob, collections, json, re

files = glob.glob(r'C:\Program Files\GraphPad\Prism\SampleData\MultipleVariables\*.prismt') + \
        glob.glob(r'C:\Program Files\GraphPad\Prism\Portfolio\*\*.pzt')
files = [f for f in files if open(f,'rb').read(2) == b'PK']

print('=== CSV characteristics (%d bundles) ===' % len(files))
quoted = crlf = lf = nonascii = bom = embedded_nl = 0
maxcell = 0; total = 0
sample_quoted = []
for f in files:
    z = zipfile.ZipFile(f)
    for n in z.namelist():
        if not n.endswith('.csv'): continue
        b = z.read(n); total += 1
        if b.startswith(b'\xef\xbb\xbf'): bom += 1
        if b'\r\n' in b: crlf += 1
        elif b'\n' in b: lf += 1
        if b'"' in b:
            quoted += 1
            if len(sample_quoted) < 4:
                i = b.find(b'"')
                sample_quoted.append((n.rsplit('/',1)[0][-14:], b[max(0,i-60):i+70]))
        try: b.decode('ascii')
        except UnicodeDecodeError:
            nonascii += 1
            try: b.decode('utf-8')
            except UnicodeDecodeError: print('   !! not UTF-8:', f, n)
        for line in b.split(b'\n'):
            maxcell = max(maxcell, max((len(c) for c in line.split(b',')), default=0))
print(' total csv=%d  with-quote=%d  BOM=%d  CRLF=%d  LF-only=%d  non-ascii=%d' % (total, quoted, bom, crlf, lf, nonascii))
print(' longest comma-field = %d bytes' % maxcell)
for n, s in sample_quoted: print('   %-14s %r' % (n, s))

print('\n=== ZIP entry order pattern ===')
orders = collections.Counter()
for f in files:
    z = zipfile.ZipFile(f)
    seq = []
    for n in z.namelist():
        top = n.split('/')[0]
        if not seq or seq[-1] != top: seq.append(top)
    orders[' > '.join(seq)] += 1
for k, v in orders.most_common(6): print('  %-72s %d' % (k[:72], v))

print('\n=== compression / size ===')
for f in sorted(files, key=lambda x: -__import__('os').path.getsize(x))[:5]:
    z = zipfile.ZipFile(f)
    raw = sum(i.file_size for i in z.infolist())
    cmp_ = sum(i.compress_size for i in z.infolist())
    meth = collections.Counter(i.compress_type for i in z.infolist())
    dirs = sum(1 for i in z.infolist() if i.filename.endswith('/'))
    print('  %-46s entries=%-4d dirs=%-3d raw=%-9d cmp=%-8d methods=%s' %
          (f.rsplit('\\',1)[-1][:46], len(z.infolist()), dirs, raw, cmp_, dict(meth)))
    ei = z.infolist()[0]
    print('       date_time=%s  create_system=%s  extract_version=%s  flag=0x%x' %
          (ei.date_time, ei.create_system, ei.extract_version, ei.flag_bits))

print('\n=== per-bundle entry counts ===')
tot = collections.Counter()
for f in files:
    z = zipfile.ZipFile(f)
    for n in z.namelist():
        if n.endswith('/'): continue
        tot[re.sub(r'[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27}', '<id>', n)] += 1
print(' distinct entry shapes:', len(tot))
