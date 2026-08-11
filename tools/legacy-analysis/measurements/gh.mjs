const repos=['101arrowz/fflate','gildas-lormeau/zip.js','NaturalIntelligence/fast-xml-parser','glideapps/glide-data-grid','egoist/tsup','rolldown/tsdown','unjs/unbuild','Yue-Jiang/pzfx','Biomiha/prism2R','ulido/pzfx_parser','smestern/prismWriter','hari7696/Graphpad-Prism-Export','charkour/zundo','GoogleChromeLabs/comlink'];
for(const r of repos){
  try{
    const j=await (await fetch(`https://api.github.com/repos/${r}`)).json();
    if(j.message){console.log(`${r}: ${j.message}`);continue;}
    const c=await (await fetch(`https://api.github.com/repos/${r}/commits?per_page=1`)).json();
    const last=Array.isArray(c)&&c[0]?c[0].commit.committer.date.slice(0,10):'?';
    console.log(`${r.padEnd(38)} stars=${String(j.stargazers_count).padEnd(6)} openIssues=${String(j.open_issues_count).padEnd(5)} license=${(j.license?.spdx_id||'none').padEnd(12)} archived=${j.archived} pushed=${j.pushed_at.slice(0,10)} lastCommit=${last}`);
  }catch(e){console.log(`${r}: ERR ${e.message}`);}
}
