/** Supplied white-ring ChemEZ mark for dark interface surfaces. */
export function Logo({mini=false}:{mini?:boolean}){
  const gradientId=mini?'chemez-mini-gradient':'chemez-hero-gradient';
  return <svg viewBox="0 0 430 430" fill="none" aria-hidden="true" className={'logo-symbol '+(mini?'logo-symbol--mini':'logo-symbol--hero')}>
    <defs><linearGradient id={gradientId} x1="165.217" y1="26" x2="365.028" y2="331.953" gradientUnits="userSpaceOnUse"><stop stopColor="#94FFC0"/><stop offset=".48" stopColor="#65F5A2"/><stop offset="1" stopColor="#13A77E"/></linearGradient></defs>
    <path d="M103.956 53.53H209.6L188.9 103.47H128.93L70.44 199.701L124.99 293.93H181.3L161.6 345.873H100.023L13.5 199.701L103.956 53.53Z" fill="#fff"/>
    <path d="M251.085 26H403.811L306.8 172.171H386.769L173.083 397L235.353 232.475H165.217L251.085 26Z" fill={`url(#${gradientId})`}/>
  </svg>;
}
