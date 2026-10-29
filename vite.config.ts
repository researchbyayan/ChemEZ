import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {readFileSync} from 'node:fs';
const version=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
export default defineConfig(({command})=>({
  root:'frontend',base:'./',define:{__APP_VERSION__:JSON.stringify(version)},plugins:[react(),{name:'desktop-csp',transformIndexHtml(html){
    const scripts=command==='serve'?"'self' 'unsafe-inline'":"'self'";
    return html.replace('__CSP__',`default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:5173; object-src 'none'; base-uri 'none'`);
  }}],assetsInclude:['**/RDKit_minimal.wasm'],build:{outDir:'../dist',emptyOutDir:true},server:{host:'127.0.0.1',port:5173,strictPort:true}
}));
