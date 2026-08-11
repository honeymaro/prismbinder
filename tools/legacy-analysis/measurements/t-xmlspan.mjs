const pxm = (await import("./pxml.mjs")).default;
const parseXml = pxm.parseXml;
const hp2 = await import("./hp2.mjs");

// Corpus-realistic: BOM, CRLF, unnecessary &gt;, numeric ref, both empty forms, mixed content, trailing space, PI
const xml =
  "\uFEFF<?xml version=\"1.0\" encoding=\"UTF-8\"?>\r\n" +
  "<?xml-stylesheet type=\"text/xsl\" href=\"p.xsl\"?>\r\n" +
  "<GraphPadPrismFile xmlns=\"http://graphpad.com/prism/Prism.xsd\" PrismXMLVersion=\"5.00\">\r\n" +
  "<T Width=\"243\" Decimals='0'>a &gt; b &#xA; c &apos;q&apos;</T>   \r\n" +
  "<Note><B><Font Size=\"11\">Data Source</Font></B><BR/>tail text</Note>\r\n" +
  "<E/><E2></E2><!-- keep --><![CDATA[<raw & stuff>]]>\r\n" +
  "</GraphPadPrismFile>\r\n";

console.log("=== @rgrove/parse-xml 4.2.3 ===");
try {
  const doc = parseXml(xml, { includeOffsets: true, preserveCdata: true, preserveComments: true, preserveDocumentType: true });
  const rows = [];
  (function walk(n, d) {
    rows.push(`${"  ".repeat(d)}${n.type}${n.name ? " <" + n.name + ">" : ""} [${n.start},${n.end}]`);
    (n.children || []).forEach(c => walk(c, d + 1));
  })(doc, 0);
  console.log(rows.join("\n"));
  const root = doc.children.find(c => c.type === "element");
  const e1 = root.children.find(c => c.name === "E"), e2 = root.children.find(c => c.name === "E2");
  console.log("  <E/> raw   :", JSON.stringify(xml.slice(e1.start, e1.end)));
  console.log("  <E2></E2>  :", JSON.stringify(xml.slice(e2.start, e2.end)), " <-- forms distinguishable:", xml.slice(e1.start,e1.end)!==xml.slice(e2.start,e2.end));
  const t = root.children.find(c => c.name === "T");
  console.log("  <T> raw    :", JSON.stringify(xml.slice(t.start, t.end)));
  console.log("  <T> .text  :", JSON.stringify(t.text), " <-- entities decoded, &gt;/&#xA; spelling LOST in model");
  console.log("  attrs      :", JSON.stringify(t.attributes), " <-- no per-attribute offsets");
  // full-document reconstruction by splicing
  console.log("  root slice round-trips:", xml.slice(root.start, root.end) === xml.slice(root.start, root.end));
} catch (e) { console.log("  ERROR:", e.message); }

console.log("\n=== htmlparser2 12.0.0 (xmlMode + indices) ===");
try {
  const doc = hp2.parseDocument(xml, { xmlMode: true, withStartIndices: true, withEndIndices: true, decodeEntities: false, recognizeCDATA: true, recognizeSelfClosing: true });
  const rows = [];
  (function walk(ns, d) {
    for (const n of ns) {
      rows.push(`${"  ".repeat(d)}${n.type}${n.name ? " <" + n.name + ">" : ""} [${n.startIndex},${n.endIndex}]`);
      if (n.children) walk(n.children, d + 1);
    }
  })(doc.children, 0);
  console.log(rows.join("\n"));
  const root = doc.children.find(n => n.type === "tag");
  const kids = root.children.filter(n => n.type === "tag");
  const e1 = kids.find(n => n.name === "E"), e2 = kids.find(n => n.name === "E2");
  console.log("  <E/> raw   :", JSON.stringify(xml.slice(e1.startIndex, e1.endIndex + 1)));
  console.log("  <E2></E2>  :", JSON.stringify(xml.slice(e2.startIndex, e2.endIndex + 1)));
  const t = kids.find(n => n.name === "T");
  console.log("  <T> raw    :", JSON.stringify(xml.slice(t.startIndex, t.endIndex + 1)));
  console.log("  <T> attribs:", JSON.stringify(t.attribs), " <-- decodeEntities:false keeps raw spelling");
} catch (e) { console.log("  ERROR:", e.message); }

console.log("\n=== htmlparser2 low-level Tokenizer: attribute-level offsets? ===");
try {
  const seen = [];
  const { Tokenizer } = hp2;
  const tk = new Tokenizer({ xmlMode: true, decodeEntities: false }, {
    onattribname(s, e) { seen.push(`attribname[${s},${e}]=${JSON.stringify(xml.slice(s, e))}`); },
    onattribdata(s, e) { seen.push(`attribdata[${s},${e}]=${JSON.stringify(xml.slice(s, e))}`); },
    onattribentity() {}, onattribend(q, e) { seen.push(`attribend(quote=${q})@${e}`); },
    onopentagname(s, e) { seen.push(`opentagname[${s},${e}]=${JSON.stringify(xml.slice(s, e))}`); },
    onopentagend() {}, onselfclosingtag() {}, onclosetag() {}, ontext() {}, ontextentity() {},
    oncomment() {}, oncdata() {}, ondeclaration() {}, onprocessinginstruction() {}, onend() {},
  });
  tk.write(xml); tk.end();
  console.log(" ", seen.slice(0, 12).join("\n  "));
} catch (e) { console.log("  ERROR:", e.message); }
