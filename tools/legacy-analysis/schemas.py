import zipfile, json, glob, collections, os, sys, re

classes = collections.Counter()
ids = collections.Counter()
byfile = collections.Counter()
keys_by_class = collections.defaultdict(collections.Counter)
enum_vals = collections.defaultdict(collections.Counter)

def visit(o, cls=None):
    if isinstance(o, dict):
        c = o.get('@class', cls)
        if '@class' in o: classes[o['@class']] += 1
        if '$id' in o: ids[o['$id']] += 1
        for k, v in o.items():
            if k.startswith(('@', '$')): continue
            if c: keys_by_class[c][k] += 1
            if isinstance(v, str) and len(v) < 40 and c:
                enum_vals['%s.%s' % (c, k)][v] += 1
            visit(v, c)
    elif isinstance(o, list):
        for v in o: visit(v, cls)

files = []
for pat in sys.argv[1:]:
    files.extend(glob.glob(pat))
for f in files:
    try: z = zipfile.ZipFile(f)
    except Exception: continue
    for n in z.namelist():
        if n.endswith('.json'):
            byfile[re.sub(r'[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27}', '<uuid>', n)] += 1
            try: visit(json.loads(z.read(n).decode('utf-8')))
            except Exception: pass

print('== BUNDLE ENTRY LAYOUT (%d bundles) ==' % len(files))
for k, v in byfile.most_common(): print('  %-58s %d' % (k, v))
print('\n== JSON SCHEMA IDs ($id) ==')
for k, v in ids.most_common(): print('  %-62s %d' % (k, v))
print('\n== @class TYPES ==')
for k, v in classes.most_common(): print('  %-40s %d' % (k, v))
print('\n== FIELDS PER CLASS ==')
for c in sorted(keys_by_class, key=lambda x: -sum(keys_by_class[x].values())):
    print('\n  %s:' % c)
    print('    ' + ', '.join(sorted(keys_by_class[c])))
print('\n== ENUM-LIKE STRING VALUES ==')
for k in sorted(enum_vals):
    v = enum_vals[k]
    if 1 <= len(v) <= 10 and all(len(x) < 30 for x in v):
        print('  %-46s %s' % (k, ', '.join(sorted(v))[:80]))
