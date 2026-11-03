// Plain-text sub/superscripts the model writes ("S_N2", "H_2O", "Br^-", "Fe^{3+}") become inline math,
// so they render as real subscripts and superscripts. Code and existing math are left alone.
const PROTECTED=/(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/;
const SUB=/(^|[^\w\\$])([A-Za-z]{1,2})\\?_(\{[^{}\n]{1,8}\}|[A-Za-z](?![a-z])|\d+)/g;
const SUP=/(^|[^\w\\$])([A-Za-z]{1,2}\d*|\))\^(\{[^{}\n]{1,8}\}|\d*[+\-−](?![\w])|\d+)/g;
const group=(value:string)=>value.startsWith('{')?value:'{'+value.replace('−','-')+'}';
// S_N1/S_N2/S_NAr however the model spelled them ("S N2", "S$_N$2", "S_{N}2") reach one form first.
const MECHANISM=/\bS\s?(?:\$\s*)?(?:\\?_\s*)?(?:\{\s*)?(?:\\mathrm\{)?N(?:\})?(?:\s*\})?(?:\s*\$)?\s?(1|2|Ar|i)\b/g;
// Plain chemical formulas in prose ("CH3Cl", "AlCl₃", "NaCl", "SO₄²⁻") are typeset with mhchem.
// A token counts only when every symbol is a real element and it has a count, a charge, or a
// two-letter element among several (so "OK", "CO" in a sentence's caps, or "I" stay as text).
const ELEMENTS=new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu'.split(' '));
const SUBSCRIPT='₀₁₂₃₄₅₆₇₈₉',SUPERSCRIPT='⁰¹²³⁴⁵⁶⁷⁸⁹';
const FORMULA=/(?<![\w$\\{])((?:\((?:[A-Z][a-z]?[0-9₀-₉]*)+\)[0-9₀-₉]*|[A-Z][a-z]?[0-9₀-₉]*){1,8})([⁰-⁹¹²³]*[⁺⁻]|[+\-−](?![\w+\-−]))?(?![\w])/g;
function formula(token:string,charge:string|undefined){
  const symbols=token.match(/[A-Z][a-z]?/g)||[];
  if(!symbols.length||!symbols.every(symbol=>ELEMENTS.has(symbol))||/[a-z]{2}/.test(token.replace(/[A-Z][a-z]/g,'X')))return null;
  const counted=/[0-9₀-₉]/.test(token),twoLetter=symbols.some(symbol=>symbol.length===2);
  if(!counted&&!charge&&!(twoLetter&&symbols.length>=2))return null;
  const plain=token.replace(/[₀-₉]/g,d=>String(SUBSCRIPT.indexOf(d)));
  const sign=charge?charge.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g,d=>String(SUPERSCRIPT.indexOf(d))).replace('⁺','+').replace('⁻','-').replace('−','-').replace('^',''):'';
  return `$\\ce{${plain}${sign?'^{'+sign+'}':''}}$`;
}
export function chemScripts(text:string){
  text=text.replace(MECHANISM,'S_N$1');
  return text.split(PROTECTED).map((part,index)=>index%2?part:part
    .replace(SUB,(_m,before,base,sub)=>`${before}$\\mathrm{${base}_${group(sub)}}$`)
    .replace(SUP,(_m,before,base,sup)=>`${before}$\\mathrm{${base}^${group(sup)}}$`)).join('')
    // Second pass, outside any math just produced: plain formulas.
    .split(PROTECTED).map((part,index)=>index%2?part:part.replace(FORMULA,(whole,token,charge)=>formula(token,charge)??whole)).join('');
}
