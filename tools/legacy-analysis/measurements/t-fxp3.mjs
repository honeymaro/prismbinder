import { XMLParser, XMLBuilder } from './fxp.mjs';
const o={preserveOrder:true,ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,suppressEmptyNode:true,format:false,processEntities:true};
const p=new XMLParser(o);
console.log('numeric char ref parse:', JSON.stringify(p.parse('<T>&#65;&#x42; &lt;x&gt;</T>')));
console.log('attr newline ref     :', JSON.stringify(p.parse('<A n="a&#xA;b"/>')));
console.log('nbsp                 :', JSON.stringify(p.parse('<T>&nbsp;</T>')));
// with htmlEntities
const p2=new XMLParser({...o, htmlEntities:true});
console.log('htmlEntities numeric :', JSON.stringify(p2.parse('<T>&#65;&#x42;&nbsp;</T>')));
const b2=new XMLBuilder({...o, htmlEntities:true});
console.log('rebuild w/htmlEnt    :', b2.build(p2.parse('<T>&#65;&#x42;</T>')));
