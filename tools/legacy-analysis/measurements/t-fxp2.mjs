import { XMLParser, XMLBuilder } from './fxp.mjs';
const base = { preserveOrder:true, ignoreAttributes:false, parseTagValue:false, parseAttributeValue:false, trimValues:false, suppressBooleanAttributes:false, format:false, cdataPropName:'__cdata', commentPropName:'__comment', processEntities:true };
const cases = {
  stylesheetPI: `<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="prism.xsl"?><Root/>`,
  doctype: `<!DOCTYPE Root SYSTEM "r.dtd"><Root/>`,
  attrEntity: `<A t="a &lt; b &amp; &quot;q&quot;" nl="line1&#xA;line2"/>`,
  gtInText: `<A>1 > 2 and 3 &gt; 4</A>`,
  trailingNL: `<A/>\n`,
  bothEmpty: `<A><B/><C></C></A>`,
  emptyText: `<A><B></B></A>`,
  deepMixed: `<Note><B><Font Size="11" Color="#000000">Data Source</Font></B><BR/>free text<I>ital</I> tail </Note>`,
  pzfxish: `<GraphPadPrismFile xmlns="http://graphpad.com/prism/Prism.xsd" PrismXMLVersion="5.00">\n<Created><OriginalVersion CreatedByProgram="GraphPad Prism" CreatedByVersion="5.00.288" Login="user" DateTime="2024-01-01T00:00:00+00:00"/></Created>\n<Table ID="Table0" XFormat="none" TableType="OneWay" EVFormat="AsteriskAfterNumber">\n<Title>T</Title>\n<YColumn Width="243" Decimals="0" Subcolumns="1">\n<Title>A</Title>\n<Subcolumn><d>1.0</d><d/><d>3</d></Subcolumn>\n</YColumn>\n</Table>\n</GraphPadPrismFile>`,
};
for (const suppress of [true,false]) {
  console.log(`\n##### suppressEmptyNode=${suppress}`);
  const o = {...base, suppressEmptyNode:suppress};
  const p = new XMLParser(o), b = new XMLBuilder(o);
  for (const [k,xml] of Object.entries(cases)) {
    let out,err=null; try{ out=b.build(p.parse(xml)); }catch(e){err=e.message;}
    const ok = out===xml;
    console.log(`${ok?'OK  ':'FAIL'} ${k}`);
    if(!ok){console.log(`   in : ${JSON.stringify(xml)}`);console.log(`   out: ${err?'ERROR '+err:JSON.stringify(out)}`);}
  }
}
