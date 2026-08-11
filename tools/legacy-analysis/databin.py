import zipfile, sys, re, struct

z = zipfile.ZipFile(sys.argv[1])
name = [n for n in z.namelist() if n.endswith(sys.argv[2])][0]
d = z.read(name)
print('%s  %d bytes' % (name, len(d)))
print('magic:', d[:16])
print('\n--- first 512 bytes ---')
for i in range(0, min(len(d), 512), 16):
    c = d[i:i+16]
    print('%06x  %-47s %s' % (i, ' '.join('%02x'%b for b in c),
          ''.join(chr(b) if 32 <= b < 127 else '.' for b in c)))

print('\n--- embedded ASCII strings (len>=4) ---')
seen = []
for m in re.finditer(rb'[\x20-\x7e]{4,}', d):
    seen.append((m.start(), m.group().decode('latin1')))
for off, s in seen[:120]:
    print('%06x  %s' % (off, s))
print('... total %d strings' % len(seen))

print('\n--- u32 header words ---')
for i in range(0, 96, 4):
    v = struct.unpack_from('<I', d, i)[0]
    print('  +%02x = %-12d 0x%08x' % (i, v, v))
