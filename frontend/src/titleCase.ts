// Header-style capitalisation for scheme titles and conditions, without breaking chemistry:
// formulas (HCl, NaOH, H2SO4), units and abbreviations (°C, min, h, conc., cat.), and italic
// descriptors (tert-, cis-, o-, n-) keep their case; short joining words stay lowercase.
const MINOR=new Set(['a','an','the','and','or','nor','but','of','to','in','on','at','by','for','from','with','via','as','vs','per','into','onto','over','under']);
const KEEP=new Set(['min','h','s','ms','ml','mL','l','L','g','mg','kg','mol','mmol','equiv','eq','ppm','nm','atm','bar','kpa','kPa','pH','cat.','conc.','dil.','aq.','aq','sat.','approx.','tert','sec','cis','trans','syn','anti','endo','exo','ipso','in situ','o','m','p','n','i','t']);

export function titleCase(text:string){
  let first=true;
  return text.replace(/[A-Za-z][\w'.]*/g,(word,offset:number)=>{
    const before=text.slice(0,offset);
    const afterHyphen=/-$/.test(before);
    const lead=first;first=false;
    if(/[A-Z0-9]/.test(word.slice(1))||/\d/.test(word))return word;      // HCl, NaOH, H2SO4, pKa
    if(KEEP.has(word)||KEEP.has(word.toLowerCase())&&/\.$/.test(word))return word;
    if(afterHyphen)return word;                                         // tert-butyl stays as written
    if(!lead&&MINOR.has(word.toLowerCase()))return word.toLowerCase();
    return word[0].toUpperCase()+word.slice(1);
  });
}
