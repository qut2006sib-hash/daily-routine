import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const roots = ['react','react-dom','zustand','lucide-react','@radix-ui/react-dialog','clsx','tailwind-merge',
  '@capacitor/core','@capacitor/android','@capacitor/app','@capacitor/filesystem','@capacitor/share'];
const seen = new Map();
function locate(name, from) {
  for(let p=from;;p=dirname(p)) { const candidate=join(p,'node_modules',name);
    if(existsSync(join(candidate,'package.json'))) return candidate;
    if(dirname(p)===p) return null;
  }
}
function visit(name, from) {
  const folder=locate(name,from); if(!folder || seen.has(folder)) return;
  const pkg=JSON.parse(readFileSync(join(folder,'package.json'),'utf8'));
  const licenses=readdirSync(folder).filter(f=>/^(licen[cs]e|copying)(\..*)?$/i.test(f));
  seen.set(folder,{pkg,texts:licenses.map(f=>readFileSync(join(folder,f),'utf8'))});
  for(const child of Object.keys(pkg.dependencies??{})) visit(child,folder);
}
for(const name of roots) visit(name,root);
const sections=[...seen.values()].sort((a,b)=>a.pkg.name.localeCompare(b.pkg.name)).map(({pkg,texts})=>
  `${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license)}\n\n${texts.join('\n\n')||'See license information distributed in the corresponding package.'}`);
const out=join(root,'mobile/public');mkdirSync(out,{recursive:true});
writeFileSync(join(out,'THIRD_PARTY_NOTICES.txt'),`Dayline Android third-party notices\n\nSuper Productivity, Tasks.org and Vikunja were behavioral references. No application source was copied.\nSee docs/OPEN_SOURCE_RESEARCH.md for inspected revisions. The Dayline reminder bridge is original.\n\n${sections.join('\n\n'+'='.repeat(72)+'\n\n')}\n`);
console.log(`Wrote notices for ${seen.size} packages.`);
