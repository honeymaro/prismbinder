import { XMLParser, XMLBuilder } from './fxp.mjs';

const cases = {
  mixed: `<Note><B><Font Size="11">Data Source</Font></B><BR/>some text after</Note>`,
  attrOrder: `<Table Zeta="1" Alpha="2" Mid="3"/>`,
  selfClose: `<A><B/><C></C></A>`,
  ns: `<GraphPadPrismFile xmlns="http://graphpad.com/prism/Prism.xsd" PrismXMLVersion="5.00"><Table/></GraphPadPrismFile>`,
  entities: `<T>a &lt; b &amp; c &gt; d &quot;e&quot; &apos;f&apos; &#65;</T>`,
  ws: `<A>\n  <B>1</B>\n  <B>2</B>\n</A>`,
  cdata: `<A><![CDATA[<raw & stuff>]]></A>`,
  numlike: `<A Ver="5.00" N="007"><V>1676.0</V><V>0100</V></A>`,
  decl: `<?xml version="1.0" encoding="UTF-8"?>\n<A/>`,
  comment: `<A><!-- keep me --><B/></A>`,
  emptyattr: `<A B="" C='single'/>`,
  nested: `<Subcolumn><d>1.0</d><d/><d>3</d></Subcolumn>`,
};

const optsList = [
  ['minimal', { preserveOrder:true, ignoreAttributes:false, parseTagValue:false, parseAttributeValue:false, trimValues:false, suppressEmptyNode:true, suppressBooleanAttributes:false, format:false, cdataPropName:'__cdata', commentPropName:'__comment', processEntities:true }],
  ['noEntities', { preserveOrder:true, ignoreAttributes:false, parseTagValue:false, parseAttributeValue:false, trimValues:false, suppressEmptyNode:true, suppressBooleanAttributes:false, format:false, cdataPropName:'__cdata', commentPropName:'__comment', processEntities:false }],
];

for (const [label, opts] of optsList) {
  console.log(`\n########## opts=${label}`);
  const p = new XMLParser(opts);
  const b = new XMLBuilder(opts);
  for (const [k, xml] of Object.entries(cases)) {
    let out, err=null;
    try { out = b.build(p.parse(xml)); } catch(e){ err = e.message; }
    const ok = out === xml;
    console.log(`${ok?'OK  ':'FAIL'} ${k}`);
    if(!ok){ console.log(`   in : ${JSON.stringify(xml)}`); console.log(`   out: ${err?('ERROR '+err):JSON.stringify(out)}`); }
  }
}
