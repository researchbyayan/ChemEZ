import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {root} from './python-path.mjs';
const logo=await readFile(path.join(root,'assets/icon-source.svg'),'utf8');
// Keep the alpha channel: the reference mark has no enclosing tile or checkerboard.
const icon=logo.replace('width="430" height="430"','width="1024" height="1024"');
await writeFile(path.join(root,'assets/icon.svg'),icon);
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
  await page.setContent(`<style>*{margin:0;padding:0}body{background:transparent}svg{display:block}</style>${icon}`);
  await page.screenshot({path:path.join(root,'assets/icon.png'),omitBackground:true});
}finally{await browser.close();}
