import zipfile, hashlib, glob, json, collections, re

files = glob.glob(r'C:\Program Files\GraphPad\Prism\SampleData\MultipleVariables\*.prismt') + \
        glob.glob(r'C:\Program Files\GraphPad\Prism\Portfolio\*\*.pzt')

print('=== .dt digest verification ===')
ok = bad = 0
algos = collections.Counter()
for f in files:
    try: z = zipfile.ZipFile(f)
    except Exception: continue
    for n in z.namelist():
        if not n.endswith('.dt'): continue
        want = z.read(n).decode('ascii', 'replace').strip()
        base = n[:-3]
        for cand in (base + '.csv', base + '.json',
                     n.replace('parameters.dt', 'parameters.json'),
                     n.replace('data.dt', 'data.csv')):
            if cand in z.namelist():
                blob = z.read(cand)
                for name, h in (('md5', hashlib.md5), ('sha1', hashlib.sha1)):
                    if h(blob).hexdigest() == want:
                        algos[name + ':' + cand.rsplit('/', 1)[-1]] += 1
                        ok += 1
                        break
                else:
                    bad += 1
                break
print('matched:', ok, 'unmatched:', bad)
for k, v in algos.most_common(): print('  ', k, v)

print('\n=== format/version fields across bundles ===')
vals = collections.defaultdict(collections.Counter)
for f in files:
    try: z = zipfile.ZipFile(f)
    except Exception: continue
    if 'document.json' not in z.namelist(): continue
    d = json.loads(z.read('document.json'))
    for k in ('formatVersion', 'minFormatVersion', 'minPrismVersion'):
        vals[k][d.get(k)] += 1
    vals['createdBy.version'][d.get('createdBy', {}).get('version')] += 1
    vals['createdBy.platform'][d.get('createdBy', {}).get('platform')] += 1
    for c in d.get('compatibility', []):
        vals['compatibility'][json.dumps(c, sort_keys=True)] += 1
    vals['uiSettings.viewMode'][d.get('uiSettings', {}).get('viewMode')] += 1
    vals['uiSettings.currentSheetType'][d.get('uiSettings', {}).get('currentSheetType')] += 1
for k in vals:
    print(' %-28s %s' % (k, dict(vals[k])))

print('\n=== analysisClass values ===')
ac = collections.Counter()
for f in files:
    try: z = zipfile.ZipFile(f)
    except Exception: continue
    for n in z.namelist():
        if n.endswith('sheet.json') and '/analyses/' in '/' + n:
            try: ac[json.loads(z.read(n)).get('analysisClass')] += 1
            except Exception: pass
for k, v in ac.most_common(): print('  %-34s %d' % (k, v))
