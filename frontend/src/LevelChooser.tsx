import {Dialog} from './Dialog';
import {LEVELS,type Level} from './levels';

// First-launch question: answers are written for this level, and it can be changed any time.
export function LevelChooser({current,onChoose,onClose}:{current:Level|null;onChoose:(level:Level)=>void;onClose:()=>void}){
  return <Dialog title={current?'Your chemistry level':'Welcome to ChemEZ'} onClose={onClose} className="level-dialog">
    <p className="level-intro">{current?'Answers are written for this level.':'What’s your chemistry level? ChemEZ writes every answer for it, with the same structures, reactions and mechanisms at each level.'}</p>
    <div className="level-options" role="radiogroup" aria-label="Chemistry level">{(Object.keys(LEVELS) as Level[]).map(level=><button key={level} type="button" role="radio" aria-checked={current===level} className="level-option" onClick={()=>onChoose(level)}>
      <i className={LEVELS[level].icon} aria-hidden="true"/><span className="level-name">{LEVELS[level].label}</span><span className="level-blurb">{LEVELS[level].blurb}</span>
    </button>)}</div>
    <p className="level-note">You can change this any time from the composer or Preferences.</p>
  </Dialog>;
}
