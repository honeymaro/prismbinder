import sys, base64, zlib, re, glob, os
import xml.etree.ElementTree as ET

for f in glob.glob(sys.argv[1]):
    print('\n=== %s (%d bytes) ===' % (os.path.basename(f), os.path.getsize(f)))
    raw = open(f, 'rb').read()
    print('head:', raw[:120].decode('latin1').replace('\n', ' '))
    root = ET.parse(f).getroot()
    print('root attrs:', root.attrib)
    for el in root:
        tag = el.tag.split('}')[-1]
        if tag in ('Template', 'TemplateDescription'):
            txt = (el.text or '').strip()
            print('<%s> attrs=%s len(text)=%d' % (tag, el.attrib, len(txt)))
            if tag == 'Template':
                b = base64.b64decode(txt)
                print('   b64-decoded %d bytes, first8=%r' % (len(b), b[:8]))
                try:
                    inf = zlib.decompress(b)
                    print('   INFLATED -> %d bytes  magic=%r' % (len(inf), inf[:16]))
                    ratio = len(b) / len(inf)
                    print('   compression ratio %.3f' % ratio)
                    open(os.path.join(sys.argv[2], os.path.basename(f) + '.template.bin'), 'wb').write(inf)
                except Exception as e:
                    print('   inflate failed:', e)
