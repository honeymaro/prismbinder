import * as fflate from './fflate.mjs';
import zlib from 'node:zlib';
const enc=new TextEncoder();
const payload = enc.encode(JSON.stringify({a:1,b:'x'.repeat(300),c:[1,2,3]}, null, '\t'));
for (const lvl of [1,6,9]) {
  const f = fflate.deflateSync(payload, {level:lvl});
  const n = zlib.deflateRawSync(Buffer.from(payload), {level:lvl});
  console.log(`level ${lvl}: fflate=${f.length}B zlib=${n.length}B identical=${Buffer.compare(Buffer.from(f),n)===0}`);
}
// per-file options in zipSync?
const files = { 'dir/': [new Uint8Array(0), {level:0, mtime:new Date('2001-02-03T04:05:06Z')}], 'f.json': [payload, {level:6, mtime:new Date('2002-03-04T05:06:07Z')}] };
const z = fflate.zipSync(files, {os:3});
function u16(b,o){return b[o]|b[o+1]<<8} function u32(b,o){return (b[o]|b[o+1]<<8|b[o+2]<<16|b[o+3]<<24)>>>0}
let eo=z.length-22; while(u32(z,eo)!==0x06054b50) eo--;
let n2=u16(z,eo+10), off=u32(z,eo+16);
for(let i=0;i<n2;i++){
  const nl=u16(z,off+28),el=u16(z,off+30),cl=u16(z,off+32);
  const name=new TextDecoder().decode(z.subarray(off+46,off+46+nl));
  const dt=u16(z,off+14), dd=u16(z,off+12);
  console.log(`  ${name.padEnd(10)} method=${u16(z,off+10)} dosDate=${((dt>>9)+1980)}-${(dt>>5)&15}-${dt&31} time=${dd>>11}:${(dd>>5)&63} extAttr=0x${u32(z,off+38).toString(16)}`);
  off+=46+nl+el+cl;
}
