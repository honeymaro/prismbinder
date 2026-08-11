import * as fflate from './fflate.mjs';
// Build a "Prism-like" zip with python-zipfile-ish traits using fflate low level, then see what we can read back
const enc = new TextEncoder();
const files = {
  'analyses/': new Uint8Array(0),
  'analyses/a.json': enc.encode('{"a":1.0}\n'),
  'data/': new Uint8Array(0),
  'document.json': enc.encode('{"formatVersion":"1-6-0"}\n'),
  'data/0/data.csv': enc.encode('a,b\n1,2\n'),
};
const z = fflate.zipSync(files, { level: 6, os: 3, mtime: new Date('2024-05-01T12:34:56Z') });
console.log('zip bytes', z.length);
// what does unzipSync give?
const un = fflate.unzipSync(z);
console.log('unzipSync keys (order):', Object.keys(un));
console.log('unzipSync value type:', un['document.json'].constructor.name, '-> NO metadata available');
// inspect raw headers we wrote
function u16(b,o){return b[o]|b[o+1]<<8} function u32(b,o){return (b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0}
// find EOCD
let eo=z.length-22; while(u32(z,eo)!==0x06054b50) eo--;
let n=u16(z,eo+10), off=u32(z,eo+16);
console.log(`\nCentral directory entries=${n}`);
for(let i=0;i<n;i++){
  const vmb=u16(z,off+4), vne=u16(z,off+6), flg=u16(z,off+8), meth=u16(z,off+10);
  const nl=u16(z,off+28), el=u16(z,off+30), cl=u16(z,off+32), eattr=u32(z,off+38);
  const name=new TextDecoder().decode(z.subarray(off+46,off+46+nl));
  console.log(`  ${name.padEnd(20)} versionMadeBy=${vmb} (os=${vmb>>8},spec=${vmb&255}) versionNeeded=${vne} flag=0x${flg.toString(16)} method=${meth} extraLen=${el} extAttr=0x${eattr.toString(16)}`);
  off += 46+nl+el+cl;
}
// Can fflate roundtrip? re-zip from unzipSync output:
const z2 = fflate.zipSync(un, { level:6, os:3, mtime:new Date('2024-05-01T12:34:56Z') });
console.log(`\nre-zip identical? ${Buffer.compare(Buffer.from(z),Buffer.from(z2))===0}  (len ${z.length} vs ${z2.length})`);
