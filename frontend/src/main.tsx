import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
// macOS draws its own traffic-light buttons in the top-left corner; the layout makes room for them.
if((window as unknown as {chemez?:{platform?:string}}).chemez?.platform==='darwin')document.documentElement.classList.add('mac');
import {RenderBoundary} from './RenderBoundary';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './icons.css';
import './style.css';
import './chat-layout.css';
import './diagram-layout.css';
// Light or dark desktop behind the wordmark (sets the EZ mark to black or white).
window.chemez?.onBackdrop?.(value=>{document.documentElement.dataset.backdrop=value;});
createRoot(document.getElementById('root')!).render(<React.StrictMode><RenderBoundary fallback={<main className="shell-recovery" role="alert"><h1>ChemEZ could not display this view</h1><p>Reload to restore your saved conversations. Your local history has not been deleted.</p><button onClick={()=>window.location.reload()}>Reload ChemEZ</button></main>}><App/></RenderBoundary></React.StrictMode>);
