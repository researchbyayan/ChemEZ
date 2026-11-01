// Plain-text sub/superscripts the model writes ("S_N2", "H_2O", "Br^-", "Fe^{3+}") become inline math,
// so they render as real subscripts and superscripts. Code and existing math are left alone.
const PROTECTED=/(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/;
const SUB=/(^|[^\w\\$])([A-Za-z]{1,2})\\?_(\{[^{}\n]{1,8}\}|[A-Za-z](?![a-z])|\d+)/g;
const SUP=/(^|[^\w\\$])([A-Za-z]{1,2}\d*|\))\^(\{[^{}\n]{1,8}\}|\d*[+\-−](?![\w])|\d+)/g;
const group=(value:string)=>value.startsWith('{')?value:'{'+value.replace('−','-')+'}';
// S_N1/S_N2/S_NAr however the model spelled them ("S N2", "S$_N$2", "S_{N}2") reach one form first.
const MECHANISM=/\bS\s?(?:\$\s*)?(?:\\?_\s*)?(?:\{\s*)?(?:\\mathrm\{)?N(?:\})?(?:\s*\})?(?:\s*\$)?\s?(1|2|Ar|i)\b/g;
export function chemScripts(text:string){
  text=text.replace(MECHANISM,'S_N$1');
  return text.split(PROTECTED).map((part,index)=>index%2?part:part
    .replace(SUB,(_m,before,base,sub)=>`${before}$\\mathrm{${base}_${group(sub)}}$`)
    .replace(SUP,(_m,before,base,sup)=>`${before}$\\mathrm{${base}^${group(sup)}}$`)).join('');
}
