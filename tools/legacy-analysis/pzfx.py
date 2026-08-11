import sys, glob, collections
import xml.etree.ElementTree as ET

paths = []
for a in sys.argv[1:]:
    paths.extend(glob.glob(a))

struct = collections.OrderedDict()   # path -> [count, attrs Counter, sample text]
attrvals = collections.defaultdict(collections.Counter)

def walk(el, prefix=''):
    tag = el.tag.split('}')[-1]
    p = prefix + '/' + tag
    e = struct.setdefault(p, [0, collections.Counter(), None])
    e[0] += 1
    for k, v in el.attrib.items():
        e[1][k] += 1
        attrvals[p + '@' + k][v] += 1
    if e[2] is None and (el.text or '').strip():
        e[2] = (el.text or '').strip()[:70]
    for c in el:
        walk(c, p)

for f in paths:
    try:
        walk(ET.parse(f).getroot())
    except Exception as ex:
        print('!! %s: %s' % (f, ex))

print('Parsed %d files\n' % len(paths))
print('%-64s %7s  %s' % ('ELEMENT PATH', 'COUNT', 'ATTRIBUTES'))
print('-'*130)
for p, (c, at, txt) in struct.items():
    depth = p.count('/') - 1
    name = '  '*depth + p.rsplit('/', 1)[-1]
    print('%-64s %7d  %s' % (name[:64], c, ', '.join('%s(%d)' % (k, v) for k, v in at.most_common())[:60]))
    if txt: print('%-64s          text e.g. %r' % ('', txt))

print('\n\nENUMERATED ATTRIBUTE VALUES (<=14 distinct)')
print('-'*130)
for k in sorted(attrvals):
    vals = attrvals[k]
    if 1 <= len(vals) <= 14:
        print('%-58s %s' % (k.rsplit('/', 1)[-1], ', '.join('%s(%d)' % (v, c) for v, c in vals.most_common())[:70]))
