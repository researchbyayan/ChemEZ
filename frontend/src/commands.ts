// Slash commands shown as named tags; the slash itself is never displayed.
export const COMMAND_NAMES:Record<string,string>={'/versus':'Versus','/stepbystep':'Step by step','/synthesis':'Synthesis','/practice':'Practice','/nomenclature':'Nomenclature','/lab':'Lab','/calc':'Calc','/spectra':'Spectra'};

export interface CommandQuery {start:number;end:number;query:string}
export function commandQuery(value:string,caret:number):CommandQuery|undefined{
 const left=value.slice(0,caret),match=/(?:^|[\s(])\/([a-z]*)$/i.exec(left);
 if(!match)return;
 const start=caret-match[1].length-1;
 const tail=/^[a-z]*/i.exec(value.slice(caret))![0];
 return {start,end:caret+tail.length,query:match[1].toLowerCase()};
}
export function removeCommandQuery(value:string,range:CommandQuery){
 const before=value.slice(0,range.start),after=value.slice(range.end);
 return before+(/\s$/.test(before)?after.replace(/^ /,''):after);
}
export const COMMAND_PLACEHOLDERS:Record<string,string>={
 '/versus':'Compare compounds, e.g. chlorobenzene vs bromobenzene',
 '/stepbystep':'Enter a chemistry problem to work through',
 '/synthesis':'Enter the starting compound and target',
 '/practice':'Choose a topic for a practice question',
 '/nomenclature':'Enter a compound name or structure',
 '/lab':'Enter the reaction or procedure',
 '/calc':'Enter a calculation with quantities and units',
 '/spectra':'Enter the compound to explore its spectra',
};
