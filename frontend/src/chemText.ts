// Plain-text chemistry formatting shared by the drawings, popovers and copied answers.
const subscripts='₀₁₂₃₄₅₆₇₈₉',superscripts='⁰¹²³⁴⁵⁶⁷⁸⁹';
const sub=(digits:string)=>digits.replace(/\d/g,d=>subscripts[Number(d)]);
const sup=(text:string)=>text.replace(/\d/g,d=>superscripts[Number(d)]).replace(/\+/g,'⁺').replace(/-/g,'⁻');
// IUPAC names start with a capital letter after locants and italic prefixes: "2-Acetyloxybenzoic acid", "tert-Butanol", "N,N-Dimethylformamide".
export const displayName=(name:string)=>name.replace(/^((?:[\d\s,'′]+-|\([^)]*\)-|[A-Z\d,'′]+-|(?:n|sec|tert|cis|trans|o|m|p|endo|exo)-)*)([a-z])/,(_,prefix:string,letter:string)=>prefix+letter.toUpperCase());
// C7H6O3 -> C₇H₆O₃, CH4BrO- -> CH₄BrO⁻
export function formulaText(formula:string){
  const match=formula.match(/^(.*?)([+-])(\d*)$/);
  return match?sub(match[1])+sup(match[3]+match[2]):sub(formula);
}
// Reagent text without LaTeX: "$\text{AlCl}_3$" -> "AlCl₃", "CH3OH" -> "CH₃OH".
// Plain-text arrows and symbols, after markdown-simplechem (MIT): "<=>" ⇌, "<->" ↔ (resonance), "->" →, "hnu" hν.
const ARROWS:[RegExp,string][]=[[/<=>|<>/g,'⇌'],[/<->/g,'↔'],[/->/g,'→'],[/=>/g,'⇒'],[/\bhnu\b/g,'hν']];
export const chemArrows=(text:string)=>ARROWS.reduce((value,[pattern,glyph])=>value.replace(pattern,glyph),text);
export function plainChem(text:string){
  text=chemArrows(text);
  return text.replace(/\\(?:text|mathrm|ce|mathbf|textbf)\{([^{}]*)\}/g,'$1').replace(/_\{?([0-9]+)\}?/g,(_,d:string)=>sub(d)).replace(/\^\{?([0-9+-]+)\}?/g,(_,d:string)=>sup(d))
    .replace(/\\(?:rightarrow|to)\b/g,'→').replace(/\\Delta\b/g,'Δ').replace(/[$\\{}]/g,'').replace(/([A-Z][a-z]?|\))(\d+)/g,(_,atom:string,d:string)=>atom+sub(d));
}

// Resolve formula-only captions from exact, common diatomic structures; never infer isomers.
export function moleculeCaption(smiles:string,label:string,formula?:string){
  const known:Record<string,string>={ClCl:'Chlorine',BrBr:'Bromine',II:'Iodine',FF:'Fluorine','O=O':'Oxygen','N#N':'Nitrogen','[H][H]':'Hydrogen'};
  const normalize=(value:string)=>value.replace(/[₀-₉]/g,d=>String(subscripts.indexOf(d))).replace(/\s/g,'').toLowerCase();
  if(known[smiles]&&(!label||normalize(label)===normalize(formula||'')||normalize(label)===normalize(smiles)))return known[smiles];
  return formula&&normalize(label)===normalize(formula)?formulaText(formula):label;
}

export function spectralAssignment(text:string){
  return plainChem(text.replace(/(?<![A-Za-z0-9])(13|35|37|79|81)(C|Cl|Br)(?=\d|\b)/g,(_,mass:string,element:string)=>sup(mass)+element))
    .replace(/\]([+-])/g,(_,sign:string)=>']'+sup(sign));
}
