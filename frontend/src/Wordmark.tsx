// ChemEZ wordmark: plain "Chem" and the connected EZ glyph from the VeritEZ wordmark
// (veritez.github.io). The EZ is white over a dark backdrop and black over a light one
// (the desktop behind the window decides; see electron/backdrop.cjs).
const EZ='M330.364 589.813H385.836V595.604L366.421 618.669H385.836V624.86H330.364V589.813ZM338.044 596.004H376.129L356.927 618.669H338.044V609.683H356.18L362.26 603.393H338.044V596.004Z';
export function EZMark(){
  return <svg className="ez-mark" viewBox="330.364 589.813 55.472 35.047" aria-hidden="true">
    <path d={EZ} fill="currentColor" fillRule="evenodd" clipRule="evenodd"/>
  </svg>;
}
export function Wordmark(){
  return <span className="wordmark" aria-label="ChemEZ">Chem<EZMark/></span>;
}
