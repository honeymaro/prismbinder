const pkgs = process.argv.slice(2);
for (const p of pkgs) {
  try {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(p).replace('%40','@')}`);
    if(!r.ok){ console.log(`${p}: HTTP ${r.status}`); continue; }
    const j = await r.json();
    const latest = j['dist-tags']?.latest;
    const t = j.time || {};
    const vers = Object.keys(t).filter(k=>!['created','modified'].includes(k));
    const last5 = vers.slice(-6).map(v=>`${v}@${t[v].slice(0,10)}`).join(' ');
    const m = j.versions[latest]||{};
    console.log(`\n### ${p}`);
    console.log(`latest=${latest} (${t[latest]?.slice(0,10)})  license=${m.license}  deprecated=${m.deprecated?'YES: '+m.deprecated:'no'}`);
    console.log(`modified=${t.modified?.slice(0,10)} totalVersions=${vers.length}`);
    console.log(`type=${m.type} main=${m.main} module=${m.module} exports=${JSON.stringify(m.exports)?.slice(0,300)}`);
    console.log(`engines=${JSON.stringify(m.engines)} peerDeps=${JSON.stringify(m.peerDependencies)}`);
    console.log(`deps=${JSON.stringify(Object.keys(m.dependencies||{}))}`);
    console.log(`recent: ${last5}`);
  } catch(e){ console.log(`${p}: ERR ${e.message}`); }
}
