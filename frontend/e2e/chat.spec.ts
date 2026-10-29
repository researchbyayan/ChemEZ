import {test,expect} from '@playwright/test';

async function mockDesktop(page:import('@playwright/test').Page){
  // Skip the first-launch level question; the onboarding test below clears this.
  await page.addInitScript(()=>{if(!sessionStorage.getItem('fresh-launch')&&!localStorage.getItem('chemez-level'))localStorage.setItem('chemez-level','undergraduate');});
  await page.addInitScript(()=>{
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340"><path d="M 180 200 L 290 140 L 400 200" stroke="#243b3c" stroke-width="3" fill="none"/><text x="405" y="205" font-size="24" fill="#b42c2c">OH</text></svg>';
    let listener:(event:unknown)=>void=()=>{};
    const blocks=[{id:'b1',type:'markdown',text:'Ethanol is an alcohol. Its formula is $\\ce{C2H6O}$.\n\n$$\n\\ce{CH3CH2OH + 3O2 -> 2CO2 + 3H2O}\n$$\n\n```python\nprint("chemistry")\n```'},{id:'b2',type:'molecule',label:'Ethanol',iupac_name:'ethanol',smiles:'CCO',formula:'C2H6O',svg,encoding:{available:true,shape:[150,3],alphabet:{C:0,O:1,' ':2},one_hot_indices:[0,0,1]}},{id:'b3',type:'markdown',text:'The hydroxyl group makes it polar.'}];
    let config={config:{provider:'openai',model:'test-model',endpoint:''},has_key:true,warning:''};
    let messages:unknown[]=[];
    let turn=0;
    let title='Draw ethanol';let pinned=false;
    let archived=false;let activeID='12345678-1234-1234-1234-123456789abc';
    const originals=new Map<string,{id:string;title:string;pinned:boolean;archived:boolean;updated:string;messages:unknown[]}>();
    (window as unknown as {chemez:unknown}).chemez={
      request:async(command:string,payload:unknown)=>{
        if(command==='startLocal')return {ok:true};
        if(command==='getConfig')return config;
        if(command==='saveConfig'){config={...config,config:payload as typeof config.config};return {...config,ready:true};}
        if(command==='loadModels')return {models:[{id:'available-text-model',label:'Available text model',free_tier:true},{id:'paid-model',label:'Paid model',free_tier:false}]};
        if(command==='testConnection')return {ok:true};
        if(command==='deleteKey'){config.has_key=false;return config;}
        if(command==='listConversations')return [...Array.from(originals.values()).map(({messages,...chat})=>chat),...(messages.length?[{id:activeID,title,pinned,archived,updated:'2026-10-25T00:00:00Z'}]:[])];
        if(command==='updateConversation'){const data=payload as {id:string;title:string;pinned:boolean;archived?:boolean};if(originals.has(data.id)){Object.assign(originals.get(data.id)!,data);}else{title=data.title;pinned=data.pinned;archived=data.archived??archived;}return {ok:true};}
        if(command==='getConversation'){if(originals.has(payload as string)){originals.set(activeID,{id:activeID,title,pinned,archived,updated:'2026-10-25',messages:[...messages]});const target=originals.get(payload as string)!;activeID=target.id;title=target.title;pinned=target.pinned;archived=target.archived;messages=[...target.messages];originals.delete(activeID);}return {messages};}
        if(command==='searchConversations')return [...Array.from(originals.values()),{id:activeID,title,pinned,archived,updated:'2026-10-25',messages}].filter(chat=>(chat.title+JSON.stringify(chat.messages)).toLowerCase().includes(String(payload).toLowerCase())).map(({messages,...chat})=>({...chat,snippet:'Ethanol is an alcohol. Its formula is C2H6O.'}));
        if(command==='listDiagrams')return (messages as {id:string;role:string;content:typeof blocks}[]).filter(message=>message.role==='assistant').flatMap(message=>message.content.filter(block=>block.type==='molecule').map(block=>({id:message.id+':'+block.id,conversation_id:activeID,title,block})));
        if(command==='rewindConversation'){const data=payload as {before_message_id:string};const index=(messages as {id:string}[]).findIndex(message=>message.id===data.before_message_id);messages=messages.slice(0,index);return {id:activeID,messages};}
        if(command==='deleteConversation'){messages=[];return {ok:true};}
      },
      windowAction:async()=>true,
      saveText:async(text:string)=>{(window as unknown as {exported:string}).exported=text;return true;},
      pickImage:async()=>{const data='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';return {name:'reaction-question.png',mime:'image/png',data,dataUrl:'data:image/png;base64,'+data};},
      onEvent:(fn:(event:unknown)=>void)=>{listener=fn;return()=>{};},
      chat:async({text,images=[],response_style='balanced',command=null}:{text:string;images:unknown[];response_style?:string;command?:string|null})=>{
        (window as unknown as {lastResponseStyle:string}).lastResponseStyle=response_style;
        const userID='u'+(++turn);const assistantID='a'+turn;
        const long='INT FOR BUTADIENE, HEPTENES, SEC-BUTYL ALC, BUTYLENE OXIDE; PRODN OF HIGH-DENSITY POLYETHYLENE & POLYMER GASOLINES, a deliberately long unbroken value: H220ExtremelyFlammableGasH270MayCauseOrIntensifyFire';
        const compound=['trans','cis'].map((form,index)=>({id:'c'+index,type:'molecule',label:form+'-2-butene',smiles:'C/C=C/C',formula:'C4H8',svg,properties:[['Formula','C4H8'],['Molar mass','56.11 g/mol'],['Hazards (GHS)',long],['Common uses',long],['SMILES','C/C=C/C']],source:{label:'PubChem',url:'https://pubchem.ncbi.nlm.nih.gov/compound/62695'}}));
        const reply=text==='simulate provider failure'?[{id:'failure',type:'error',text:'Provider returned HTTP 503.'}]:text==='compound cards'?compound:blocks;
        messages=[...messages,{id:userID,role:'user',content:{text,images,command}},{id:assistantID,role:'assistant',content:reply,...(reply===blocks?{follow_ups:['Why is ethanol polar?']}:{})}];
        listener({type:'start',conversation_id:activeID,user_id:userID});
        listener({type:'status',message:'Checking chemistry…'});
        if(text==='simulate slow answer')await new Promise(resolve=>setTimeout(resolve,1800));
        for(const block of reply)listener({type:'block',block});
        listener({type:'done',message_id:assistantID,follow_ups:['Why is ethanol polar?']});listener({type:'finished'});
      },cancel:async()=>{},saveImage:async()=>true
    };
  });
}
test('glass canvas, aligned glyphs, drafts and chat management',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await expect.poll(()=>page.locator('html').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('normal');
  await expect.poll(()=>page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await expect.poll(()=>page.locator('.ambient').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0.85)');
  for(const name of ['Attach chemistry image','Collapse sidebar','Minimize window']){
    const button=page.getByRole('button',{name,exact:true});
    const offset=await button.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('i')!.getBoundingClientRect();return {x:Math.abs((a.left+a.right-b.left-b.right)/2),y:Math.abs((a.top+a.bottom-b.top-b.bottom)/2)};});
    expect(offset.x).toBeLessThanOrEqual(1);expect(offset.y).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  await page.getByLabel('Background opacity').fill('60');
  await expect.poll(()=>page.locator('.ambient').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0.6)');
  await page.keyboard.press('Escape');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Draft question');await page.reload();await expect(input).toHaveValue('Draft question');
  await input.fill('Draw ethanol');await input.press('Enter');
  await expect(page.getByRole('button',{name:'Copy answer',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Actions for Draw ethanol'}).click();
  await page.getByRole('menuitem',{name:'Rename'}).click();
  await page.getByLabel('Conversation name').fill('Organic revision');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('button',{name:'Organic revision',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Actions for Organic revision'}).click();
  await page.getByRole('menuitem',{name:'Pin',exact:true}).click();
  await expect(page.getByLabel('Pinned',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Export conversation'}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {exported:string}).exported)).toContain('## ChemEZ');
  await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as unknown as {copiedText:string}).copiedText=text;}},configurable:true});});
  await page.getByRole('button',{name:'Copy question'}).click();await expect.poll(()=>page.evaluate(()=>(window as unknown as {copiedText:string}).copiedText)).toBe('Draw ethanol');await expect(input).toHaveValue('');
  await page.screenshot({path:'test-results/chat-controls-glass.png',omitBackground:true});
});
test('pasted and dropped images are processed locally before sending',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  for(const method of ['paste','drop']){
    await page.evaluate(async(method)=>{
      const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=200;
      const blob=await new Promise<Blob>(resolve=>canvas.toBlob(blob=>resolve(blob!),'image/png'));
      const transfer=new DataTransfer();transfer.items.add(new File([blob],method+'.png',{type:'image/png'}));
      document.querySelector('.composer')!.dispatchEvent(method==='paste'?new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}):new DragEvent('drop',{dataTransfer:transfer,bubbles:true,cancelable:true}));
    },method);
    await expect(page.getByLabel('Attached images').getByText(method+'.png')).toBeVisible();
  }
  const widths=await page.getByLabel('Attached images').locator('img').evaluateAll(images=>images.map(image=>(image as HTMLImageElement).naturalWidth));
  expect(widths).toEqual([1600,1600]);
  await page.getByRole('button',{name:'Send question'}).click();
  await expect(page.locator('.message.user img')).toHaveCount(2);
});
test('full-text search and reversible archive manage existing chats',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Draw ethanol');await input.press('Enter');
  await expect(page.getByRole('button',{name:'Copy answer',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search all chats'}).click();
  await page.getByRole('textbox',{name:'Search messages and structures'}).fill('hydroxyl');
  await expect(page.getByRole('dialog',{name:'Search chats'}).getByRole('button',{name:/Draw ethanol/})).toBeVisible();
  await page.screenshot({path:'test-results/ux-fulltext-search.png',omitBackground:true});
  await page.getByRole('dialog',{name:'Search chats'}).getByRole('button',{name:/Draw ethanol/}).click();
  await page.getByRole('button',{name:'Actions for Draw ethanol'}).click();
  await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
  await expect(page.getByRole('button',{name:'Draw ethanol',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  await expect(page.getByRole('button',{name:'Draw ethanol',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Actions for Draw ethanol'}).click();await page.getByRole('menuitem',{name:'Archive',exact:true}).click();
  await page.getByRole('button',{name:'Archived chats',exact:true}).click();
  await page.getByRole('button',{name:'Actions for Draw ethanol'}).click();await page.getByRole('menuitem',{name:'Restore',exact:true}).click();
  await page.getByRole('button',{name:'Back to chats',exact:true}).click();
  await expect(page.getByRole('button',{name:'Draw ethanol',exact:true})).toBeVisible();
});
test('editing and retrying continue the same chat',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Draw ethanol');await input.press('Enter');
  await expect(page.getByRole('button',{name:'Copy answer',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit this question'}).click();
  await expect(page.getByText(/Sending replaces it/)).toBeVisible();
  await input.fill('Draw propanol instead');await input.press('Enter');
  await expect(page.locator('.message.user .user-text')).toHaveText('Draw propanol instead');
  await expect(page.getByRole('button',{name:/· branch/})).toHaveCount(0);
  await page.getByRole('button',{name:'Retry answer',exact:true}).click();
  await expect(page.locator('.message.user .user-text')).toHaveText('Draw propanol instead');
  await expect(page.getByRole('button',{name:/· branch/})).toHaveCount(0);
});
test('drafts survive navigation and images have accessible zoom previews',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await page.getByRole('button',{name:'Attach chemistry image'}).click();
  await input.fill('Draw ethanol');await input.press('Enter');
  await expect(page.getByRole('button',{name:'Copy answer',exact:true})).toBeVisible();
  await input.fill('Keep this follow-up');
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await input.fill('New chat draft');
  await page.getByRole('button',{name:'Draw ethanol',exact:true}).click();
  await expect(input).toHaveValue('Keep this follow-up');
  await page.getByRole('button',{name:'Preview reaction-question.png'}).click();
  await expect(page.getByRole('dialog',{name:'reaction-question.png'})).toBeVisible();
  await page.getByRole('slider',{name:'Image zoom'}).fill('150');
  await expect(page.getByText('150%',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/ux-image-preview.png',omitBackground:true});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'New conversation',exact:true}).click();
  await expect(input).toHaveValue('New chat draft');
  await page.getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Keyboard shortcuts'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('generation leaves the next draft editable and failed sends keep the question',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.evaluate(()=>{const original=window.chemez.chat;window.chemez.chat=payload=>new Promise(resolve=>{(window as unknown as {finishTestChat:()=>Promise<void>}).finishTestChat=async()=>{await original(payload);resolve();};});});
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Draw ethanol');await input.press('Enter');
  await expect(page.getByRole('button',{name:'Stop generation'})).toBeVisible();
  await expect(input).toBeEnabled();await input.fill('Next question draft');
  await page.evaluate(()=>(window as unknown as {finishTestChat:()=>Promise<void>}).finishTestChat());
  await expect(page.getByRole('button',{name:'Send question'})).toBeVisible();
  await expect(input).toHaveValue('Next question draft');
  await page.evaluate(()=>{window.chemez.chat=async()=>{throw new Error('Connection unavailable');};});
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Connection unavailable');
  await expect(input).toHaveValue('Next question draft');
  await page.keyboard.press('Meta+k');
  await expect(page.getByRole('dialog',{name:'Search chats'})).toBeVisible();
});
test('structure library stays beside the chat and answer styles reach the provider request',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await expect(page.getByRole('combobox',{name:'Answer style'}).locator('option[value="tutor"]')).toHaveCount(0);
  await page.getByRole('combobox',{name:'Answer style'}).selectOption('concise');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Draw ethanol');await input.press('Enter');
  await expect(page.getByRole('button',{name:'Copy answer',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>(window as unknown as {lastResponseStyle:string}).lastResponseStyle)).toBe('concise');
  await page.getByRole('button',{name:'Structure library',exact:true}).click();
  const library=page.getByRole('complementary',{name:'Structure library'});
  await expect(library.locator('.structure-grid button')).toHaveCount(1);
  await library.locator('.structure-grid button').click();
  await library.locator('.structure-trigger').hover();
  await expect(page.getByRole('button',{name:'Copy molecular formula',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link',{name:'ChemEZ home'})).toBeVisible();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await page.screenshot({path:'test-results/ux-structure-panel.png',omitBackground:true});
  await library.getByRole('button',{name:'Ask about this structure'}).click();
  await expect(input).toHaveValue('Explain this structure and its functional groups: CCO');
  await page.getByRole('button',{name:'Actions for Draw ethanol'}).click();
  await page.getByRole('menuitem',{name:'Delete Draw ethanol'}).click();
  await page.getByRole('dialog',{name:'Delete chat?'}).getByRole('button',{name:'Delete',exact:true}).click();
  await expect(library.getByText('Your chemistry, collected.')).toBeVisible();
  await expect(library.getByRole('button',{name:'Copy molecular formula',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Close structure library'}).click();
  await expect(library).toHaveCount(0);
});
for(const variant of ['default','reduced-motion','reduced-transparency']){
  test(`formatted answer and inline molecule with ${variant} appearance`,async({page})=>{
    await mockDesktop(page);await page.goto('/');
    const media=await page.context().newCDPSession(page);
    await media.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:variant==='reduced-motion'?'reduce':'no-preference'},{name:'prefers-reduced-transparency',value:variant==='reduced-transparency'?'reduce':'no-preference'}]});
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
    // Vitrio glass rims on the composer and sidebar are on by default in every appearance.
    await expect(page.locator('.lqg-lens')).toHaveCount(1);
    await expect(page.getByRole('heading',{name:/Chemistry, clearer/})).toBeVisible();
    await page.screenshot({path:`test-results/welcome-${variant}.png`,fullPage:true,omitBackground:true});
    if(variant==='default'){await page.setViewportSize({width:1040,height:740});await page.setViewportSize({width:1320,height:900});}
    await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
    await page.getByRole('button',{name:'Send question'}).click();
    await expect(page.getByRole('img',{name:'Ethanol molecular structure'})).toBeVisible();
    await expect(page.locator('.katex-display')).toBeVisible();
    await expect(page.locator('.katex-error')).toHaveCount(0);
    await expect(page.locator('.hljs')).toBeVisible();
    await expect(page.getByText('The hydroxyl group makes it polar.')).toBeVisible();
    await expect(page.getByRole('button',{name:'Save PNG'})).toHaveCount(0);
    const order=await page.locator('.answer-flow').evaluate(el=>Array.from(el.children).map(x=>x.className));
    expect(order.indexOf('molecule-row')).toBeGreaterThan(0);
    await page.locator('.molecule-card .structure-trigger').hover();
    await expect(page.getByRole('dialog',{name:'Ethanol molecular structure details'})).toContainText('Ethanol');
    await expect(page.getByRole('button',{name:'Copy molecular formula'})).toHaveText('C2H6O');
    await page.getByRole('button',{name:'Save PNG'}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.screenshot({path:`test-results/answer-${variant}.png`,fullPage:true,omitBackground:true});
  });
}
test('settings and conversation restoration/deletion',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByRole('radio',{name:/Custom/}).click();
  await page.getByLabel('API base URL').fill('http://127.0.0.1:11434/v1');
  await page.getByLabel('API key',{exact:true}).fill('local-gateway-key');
  await page.getByLabel('Model',{exact:true}).selectOption('available-text-model');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('Connected. You’re ready to chat.');
  await page.getByRole('button',{name:'Close settings'}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
  await page.getByRole('button',{name:'Send question'}).click();
  await page.locator('.molecule-card .structure-trigger').hover();
  await expect(page.getByRole('button',{name:'Copy molecular formula'})).toBeVisible();
  await page.getByRole('button',{name:/New conversation/}).click();
  await page.getByRole('button',{name:'Draw ethanol',exact:true}).click();
  await page.locator('.molecule-card .structure-trigger').hover();
  await expect(page.getByRole('button',{name:'Copy molecular formula'})).toBeVisible();
  await page.getByRole('button',{name:'Actions for Draw ethanol'}).click();
  await page.getByRole('menuitem',{name:'Delete Draw ethanol'}).click();
  await page.getByRole('dialog',{name:'Delete chat?'}).getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.getByRole('heading',{name:/Chemistry, clearer/})).toBeVisible();
});

test('Gemini models load automatically once a key is pasted',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByRole('radio',{name:/Google Gemini/}).click();
  await page.getByLabel('API key',{exact:true}).fill('test-gemini-key');
  await page.getByLabel('Model',{exact:true}).selectOption('available-text-model');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('Connected');
});

test('local Ollama needs no API key and lists installed models',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByRole('radio',{name:/Ollama/}).click();
  await expect(page.getByLabel('API key',{exact:true})).toHaveCount(0);
  await page.getByLabel('Model',{exact:true}).selectOption('available-text-model');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('Connected');
});

test('Gemini free-tier filter hides paid-only models until unchecked',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByRole('radio',{name:/Google Gemini/}).click();
  await page.getByLabel('API key',{exact:true}).fill('test-gemini-key');
  await expect(page.getByLabel('Model',{exact:true}).locator('option[value="available-text-model"]')).toHaveCount(1);
  await expect(page.getByLabel('Model',{exact:true}).locator('option[value="paid-model"]')).toHaveCount(0);
  await page.getByLabel('Free-tier models only').uncheck();
  await expect(page.getByLabel('Model',{exact:true}).locator('option[value="paid-model"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Type a model ID instead'}).click();
  await page.getByLabel('Model ID').fill('custom-model-id');
  await expect(page.getByLabel('Model ID')).toHaveValue('custom-model-id');
  await page.screenshot({path:'test-results/free-provider-settings.png'});
});

test('gateway preset discovers aliases without a key only on loopback',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByRole('radio',{name:/Custom/}).click();
  await page.getByLabel('Gateway preset').selectOption('litellm');
  await expect(page.getByLabel('API base URL')).toHaveValue('http://127.0.0.1:4000/v1');
  await page.getByLabel('Authentication',{exact:true}).selectOption('none');
  await expect(page.getByLabel('API key',{exact:true})).toHaveCount(0);
  await page.getByLabel('Model',{exact:true}).selectOption('available-text-model');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('Connected');
  await page.getByLabel('API base URL').fill('https://gateway.example/v1');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('only allowed for a gateway on this computer');
});

test('setup needs only a service and key, then starts chat',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await expect(page.getByRole('heading',{name:'Model & API'})).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(7);
  await page.getByRole('radio',{name:/Google Gemini/}).click();
  await expect(page.getByLabel('API base URL')).toHaveCount(0);
  await page.getByLabel('API key',{exact:true}).fill('test-key-12345');
  await expect(page.getByLabel('Model',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('Connected. You’re ready to chat.');
  await page.getByRole('button',{name:'Start chatting'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.getByRole('img',{name:'Ethanol molecular structure'})).toBeVisible();
});

test('setup explains temporary failure without showing connected',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.evaluate(()=>{const original=window.chemez.request;window.chemez.request=((command:string,payload:unknown)=>command==='testConnection'?Promise.reject(new Error('Error invoking remote method \'chemez:request\': Error: Provider returned HTTP 503.')):(original as Function)(command,payload)) as typeof original;});
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByLabel('API key',{exact:true}).fill('test-key-12345');
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('status')).toContainText('service is busy');
  await expect(page.getByRole('button',{name:'Start chatting'})).toHaveCount(0);
  await expect(page.getByLabel('API key',{exact:true})).toHaveValue('test-key-12345');
  await page.screenshot({path:'test-results/simple-connection-failure.png'});
});

test('chat supports Shift Enter for multiline input',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Line one');await input.press('Shift+Enter');await input.pressSequentially('Line two');
  await expect(input).toHaveValue('Line one\nLine two');
  await expect(page.locator('.message')).toHaveCount(0);
});

test('image intake previews, removes, sends and restores an attachment',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:'Attach chemistry image'}).click();
  await expect(page.getByLabel('Attached images').getByText('reaction-question.png')).toBeVisible();
  await page.getByRole('button',{name:'Remove reaction-question.png'}).click();
  await expect(page.getByLabel('Attached images')).toHaveCount(0);
  await page.getByRole('button',{name:'Attach chemistry image'}).click();
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Read this structure');
  await page.getByRole('button',{name:'Send question'}).click();
  await expect(page.locator('.message.user img')).toHaveCount(1);
  await page.getByRole('button',{name:/New conversation/}).click();
  await page.getByRole('button',{name:'Draw ethanol',exact:true}).click();
  await expect(page.locator('.message.user img')).toHaveCount(1);
});

test('NVIDIA setup discovers models without asking for an endpoint',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await page.getByRole('radio',{name:/NVIDIA/}).click();
  await page.getByLabel('API key',{exact:true}).fill('test-nvidia-key');
  await expect(page.getByLabel('API base URL')).toHaveCount(0);
  await expect(page.getByLabel('Model',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save & connect'}).click();
  await expect(page.getByRole('button',{name:'Start chatting'})).toBeVisible();
});

test('history search, compact navigation and recovery keep API settings accessible',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.screenshot({path:'test-results/overall-welcome.png',omitBackground:true});
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.getByRole('img',{name:'Ethanol molecular structure'})).toBeVisible();
  await page.getByRole('button',{name:'Search all chats'}).click();
  await page.getByLabel('Search messages and structures').fill('no matching title');
  await expect(page.getByText('No matching messages.')).toBeVisible();
  await page.getByRole('button',{name:'Close Search chats'}).click();
  await page.getByRole('button',{name:'Collapse sidebar'}).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole('button',{name:'Model settings'})).toBeVisible();
  await page.getByRole('button',{name:'Expand sidebar'}).click();
  await page.setViewportSize({width:900,height:680});
  await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(200);
  await page.locator('.conversation-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const settingsBounds=await page.getByRole('button',{name:'Model settings',exact:true}).boundingBox();
  expect(settingsBounds!.x+settingsBounds!.width).toBeLessThanOrEqual(900);
  const sendBounds=await page.getByRole('button',{name:'Send question'}).boundingBox();
  expect(sendBounds!.x+sendBounds!.width).toBeLessThanOrEqual(900);
  await page.screenshot({path:'test-results/overall-chat-compact.png',omitBackground:true});
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('simulate provider failure');
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect(page.getByRole('alert')).toContainText('service is busy');
  await expect(page.locator('.message.assistant').last().getByRole('button',{name:'Copy answer'})).toHaveCount(0);
  await page.getByRole('button',{name:'Edit question',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Chemistry question'})).toHaveValue('simulate provider failure');
  await page.locator('.error-actions').getByRole('button',{name:'Model settings'}).click();
  await expect(page.getByRole('heading',{name:'Model & API'})).toBeVisible();
});

test('first launch asks for a chemistry level and sends it with questions',async({page})=>{
  await page.addInitScript(()=>{sessionStorage.setItem('fresh-launch','1');localStorage.removeItem('chemez-level');});
  await mockDesktop(page);await page.goto('/');
  await expect(page.getByRole('heading',{name:'Welcome to ChemEZ'})).toBeVisible();
  await page.getByRole('radio',{name:/High school/}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.composer-tools').getByLabel('Chemistry level')).toHaveCount(0);
  await page.evaluate(()=>{const original=window.chemez.chat;(window as unknown as {sent:unknown[]}).sent=[];window.chemez.chat=(payload=>{(window as unknown as {sent:unknown[]}).sent.push(payload);return original(payload);}) as typeof original;});
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
  await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
  await expect.poll(()=>page.evaluate(()=>((window as unknown as {sent:{level:string}[]}).sent[0]||{}).level)).toBe('school');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('.settings-pane .setting-value').first().click();
  await page.getByRole('radio',{name:/Graduate/}).click();
  await page.locator('.settings-window').press('Escape');
  await page.getByRole('button',{name:'Model settings',exact:true}).click();
  await expect(page.getByLabel('Chemistry level')).toHaveValue('graduate');
  await page.screenshot({path:'test-results/level-preference.png'});
});

test('glass effects switch on and off from Settings',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const media=await page.context().newCDPSession(page);
  await media.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});
  await expect(page.locator('.lqg-lens')).toHaveCount(1);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('button',{name:'Appearance',exact:true}).click();
  const toggle=page.getByRole('switch',{name:'Glass effects'});
  await expect(toggle).toHaveAttribute('aria-checked','true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked','false');
  await expect(page.locator('.lqg-lens')).toHaveCount(0);
  await toggle.click();
  await expect(page.locator('.lqg-lens')).toHaveCount(1);
});

test('the likeliest follow-up is suggested in the composer and Tab accepts it',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('Draw ethanol');
  await input.press('Enter');
  // Quick answer suggests a quick question about the compound in context.
  await expect(input).toHaveAttribute('placeholder',/What is ethanol used for\?/);
  await page.getByRole('combobox',{name:'Answer style'}).selectOption('mechanism');
  await expect(input).toHaveAttribute('placeholder',/mechanism of a typical reaction of ethanol/);
  // Explain keeps the model's own follow-up.
  await page.getByRole('combobox',{name:'Answer style'}).selectOption('balanced');
  await expect(input).toHaveAttribute('placeholder',/Why is ethanol polar\?/);
  await input.press('Tab');
  await expect(input).toHaveValue('Why is ethanol polar?');
  await input.press('Enter');
  await expect(page.locator('.message.user').last()).toContainText('Why is ethanol polar?');
});


test('follow-up suggestions stay out of replies by default',async({page})=>{
 await mockDesktop(page);await page.goto('/');
 await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
 await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
 await expect(page.getByRole('button',{name:'Copy answer'})).toBeVisible();
 await expect(page.getByRole('group',{name:'Suggested follow-up questions'})).toHaveCount(0);
});


test('generation keeps answer status free of decorative icons',async({page})=>{
 await mockDesktop(page);await page.goto('/');
 await page.getByRole('textbox',{name:'Chemistry question'}).fill('simulate slow answer');
 await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
 const status=page.locator('.answer-status');await expect(status).toBeVisible();
 await expect(page.locator('.atom-loader,.answer-skeleton,.generating-text')).toHaveCount(0);
 await expect(page.locator('.message-avatar')).toHaveCount(0);
 await expect.poll(()=>status.evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
 await page.emulateMedia({reducedMotion:'reduce'});
 await expect.poll(()=>status.evaluate(el=>getComputedStyle(el,'::before').animationName)).toBe('none');
 await expect(page.getByRole('button',{name:'Stop generation'})).toBeVisible();
});

test('structure explorer opens on 2D and switches to 3D on the same tab',async({page})=>{
 await mockDesktop(page);await page.goto('/');
 await page.evaluate(()=>{
  const w=window as unknown as {threeDCalls:number;analysisCalls:number;chemez:{request:(...args:unknown[])=>Promise<unknown>}};
  w.threeDCalls=0;w.analysisCalls=0;const original=w.chemez.request;
  w.chemez.request=async(...args)=>{
   if(args[0]==='structure3d'){w.threeDCalls++;return {molblock:null,force_field:null,properties:{formula:'C2H6O'}};}
   if(args[0]==='analyseStructure'){w.analysisCalls++;const svg='<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><text x="70" y="55">OH</text><circle cx="70" cy="40" r="2"/><circle cx="75" cy="40" r="2"/></svg>';return {lewis_svg:svg,hydrogens_svg:svg,lewis_hydrogens_svg:svg,groups:[],stereo_svg:svg,stereo:[],inchi:'',inchikey:''};}
   return original(...args);
  };
 });
 await page.getByRole('textbox',{name:'Chemistry question'}).fill('Draw ethanol');
 await page.getByRole('textbox',{name:'Chemistry question'}).press('Enter');
 await page.getByRole('button',{name:'Details for Ethanol molecular structure'}).hover();
 await page.getByRole('button',{name:'Explore structure'}).click();
 await expect(page.getByRole('tab',{name:'Structure'})).toHaveAttribute('aria-selected','true');
 // The Structure tab opens on 2D; 3D is one click away on the same tab.
 await expect(page.getByRole('radio',{name:'2D'})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('img',{name:'2D molecular structure',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {threeDCalls:number}).threeDCalls)).toBe(1);
 expect(await page.evaluate(()=>(window as unknown as {analysisCalls:number}).analysisCalls)).toBe(0);
 await page.getByRole('checkbox',{name:'Lone pairs'}).check();
 await expect(page.getByRole('img',{name:'Structure showing lone electron pairs'})).toBeVisible();
 await page.getByRole('checkbox',{name:'Show hydrogens'}).check();
 expect(await page.evaluate(()=>(window as unknown as {analysisCalls:number}).analysisCalls)).toBe(1);
 // Opens fitted to the stage; manual zoom sticks until Fit is pressed again.
 const fitted=await page.getByLabel('2D zoom level').textContent();
 await page.getByRole('button',{name:'Zoom out 2D structure'}).click();
 await expect(page.getByLabel('2D zoom level')).toHaveText((parseInt(fitted!)-25)+'%');
 await page.getByRole('button',{name:'Fit',exact:true}).click();
 await expect(page.getByLabel('2D zoom level')).toHaveText(fitted!);
 await expect(page.getByRole('slider',{name:'2D structure zoom'})).toHaveCount(0);
 await page.getByRole('radio',{name:'3D'}).click();
 await expect(page.getByRole('radio',{name:'3D'})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('img',{name:'2D molecular structure',exact:true})).toHaveCount(0);
 await page.getByRole('radio',{name:'2D'}).click();
 await expect(page.getByRole('img',{name:'2D molecular structure',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {threeDCalls:number}).threeDCalls)).toBe(1);
});

test('mechanism mode is sent and answer level lives in settings',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await expect(page.locator('.composer-tools').getByLabel('Chemistry level')).toHaveCount(0);
  await page.getByLabel('Answer style').selectOption('mechanism');
  await page.getByRole('textbox',{name:'Chemistry question'}).fill('Show the SN2 mechanism');
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {lastResponseStyle:string}).lastResponseStyle)).toBe('mechanism');
  await page.getByRole('button',{name:'Model settings',exact:true}).click();
  await page.getByLabel('Chemistry level').selectOption('graduate');
  await expect(page.getByLabel('Chemistry level')).toHaveValue('graduate');
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  await page.reload();
  await expect(page.getByLabel('Answer style')).toHaveValue('mechanism');
  await page.getByRole('button',{name:'Model settings',exact:true}).click();
  await expect(page.getByLabel('Chemistry level')).toHaveValue('graduate');
  await page.screenshot({path:'test-results/mechanism-level-settings.png'});
});

test('compound cards fit the window at every size, including after resizing',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByPlaceholder(/Ask anything/).fill('compound cards');await page.keyboard.press('Enter');
  await expect(page.locator('.compound-card')).toHaveCount(2);
  for(const width of [760,1100,1320,1920,900]){
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>{const scroller=document.querySelector('.conversation-scroll')!;const edge=scroller.getBoundingClientRect().right;
      return {scroll:scroller.scrollWidth-scroller.clientWidth,cards:[...document.querySelectorAll('.compound-card')].map(card=>card.getBoundingClientRect().right-edge)};});
    expect(overflow.scroll,`horizontal scroll at ${width}px`).toBeLessThanOrEqual(1);
    for(const right of overflow.cards)expect(right,`card past the edge at ${width}px`).toBeLessThanOrEqual(1);
  }
});
test('slash menu offers /versus',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.locator('#question');
  await input.fill('/');
  await expect(page.locator('.slash-command')).toHaveCount(8);
  await page.locator('.slash-menu').screenshot({path:'test-results/slash-menu.png'});
  await input.fill('/ve');
  await page.getByRole('button',{name:/\/versus/}).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.composer .slash-chip')).toHaveText('Versus');
  await page.locator('.composer').screenshot({path:'test-results/slash-chip.png'});
  await input.press('Backspace');
  await expect(page.locator('.composer .slash-chip')).toHaveCount(0);
});
test('settings window has sections and opens model settings',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  const pane=page.locator('.settings-pane');
  expect(await pane.evaluate(el=>getComputedStyle(el).overflowY)).toBe('auto');
  await expect(page.getByRole('switch',{name:'Follow Up'})).toBeVisible();
  await page.waitForTimeout(300);await page.locator('.settings-window').screenshot({path:'test-results/settings-general.png'});
  await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.waitForTimeout(300);await page.locator('.settings-window').screenshot({path:'test-results/settings-appearance.png'});
  await page.getByRole('button',{name:'Diagrams',exact:true}).click();
  await expect(page.getByLabel('Diagram layout')).toBeVisible();
  await page.waitForTimeout(300);await page.screenshot({path:'test-results/settings-window.png'});
  await page.getByRole('button',{name:'About',exact:true}).click();
  await expect(page.locator('.settings-about')).toContainText(/Version \d+\.\d+\.\d+/);
  await page.waitForTimeout(300);await page.locator('.settings-window').screenshot({path:'test-results/settings-about.png'});
  await page.getByRole('button',{name:'Model & API',exact:true}).click();
  await page.waitForTimeout(300);await page.locator('.settings-window').screenshot({path:'test-results/settings-model.png'});
  await page.getByRole('button',{name:/Manage model/}).click();
  await expect(page.locator('dialog.settings[open], .settings[open]').first()).toBeVisible();
});
test('a pasted key selects its service',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  await page.getByRole('button',{name:/Model settings/}).click();
  await expect(page.getByRole('button',{name:/Sign in with OpenRouter/})).toHaveCount(0);
  await page.getByLabel('API key',{exact:true}).fill('nvapi-test-key-12345');
  await expect(page.getByRole('radio',{name:/NVIDIA/})).toHaveAttribute('aria-checked','true');
  await expect(page.getByRole('status')).toContainText('NVIDIA key');
  await expect(page.getByLabel('API key',{exact:true})).toHaveValue('nvapi-test-key-12345');
  await expect(page.getByLabel('Model',{exact:true})).toContainText('Automatic');
  await page.locator('.api-settings').screenshot({path:'test-results/model-settings.png'});
});

test('About credits are offline and update checks distinguish success and failure',async({page})=>{
 await mockDesktop(page);await page.goto('/');
 await page.evaluate(()=>{
  window.chemez.appInfo=async()=>({version:'1.2.3',platform:'darwin',arch:'x64',nativeArch:'arm64',build:'abcdef1234567890',dirty:false,source:'https://github.com/researchbyayan/ChemEZ'});
  window.chemez.credits=async()=>({entries:[{id:'chemez',name:'ChemEZ',url:'https://github.com/researchbyayan/ChemEZ',group:'software',license:'MIT',note:'Original application',licenseAvailable:true},{id:'nmr',name:'NMRShiftDB2',url:'https://nmrshiftdb.nmr.uni-koeln.de',group:'data',license:'Database license',note:'Derived data',licenseAvailable:true},{id:'rmg',name:'RMG-Py',url:'https://github.com/ReactionMechanismGenerator/RMG-Py',group:'reference',license:'Reference only',note:'Not bundled or executed',licenseAvailable:false}]});
  window.chemez.license=async()=> 'MIT License\nPermission is hereby granted';
  window.chemez.openCreditSource=async()=>true;
  window.chemez.checkUpdates=async()=>({status:'available',version:'1.3.0',url:'https://github.com/researchbyayan/ChemEZ/releases/download/v1.3.0/ChemEZ-1.3.0-mac-arm64.dmg',size:100});
  window.chemez.openLink=async url=>{(window as unknown as {opened:string}).opened=url;return true;};
 });
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'About',exact:true}).click();
 await expect(page.locator('.settings-about')).toContainText('Version 1.2.3');
 await page.getByText('Credits & licenses (3)').click();await page.getByLabel('Search credits').fill('ChemEZ');
 await page.locator('.credit-entry summary').filter({hasText:'ChemEZ'}).click();await page.getByRole('button',{name:'Read license'}).click();await expect(page.locator('.license-reader pre')).toContainText('Permission is hereby granted');
 await page.getByRole('button',{name:'Check for updates'}).click();await expect(page.getByRole('status')).toContainText('1.3.0');await page.getByRole('button',{name:'Download installer'}).click();
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {opened:string}).opened)).toContain('mac-arm64.dmg');
 await page.evaluate(()=>{window.chemez.checkUpdates=async()=>{throw new Error('offline');};});await page.getByRole('button',{name:'Check for updates'}).click();await expect(page.getByRole('alert')).toContainText('Could not check for updates');await expect(page.getByRole('button',{name:'Download installer'})).toHaveCount(0);
 const navigation=page.getByRole('button',{name:'General',exact:true});await expect(navigation).toBeInViewport();
});

test('malformed live follow-ups never show answer JSON in the composer',async({page})=>{
 await mockDesktop(page);await page.goto('/');
 await page.evaluate(()=>{const request=window.chemez.request;window.chemez.request=((command:string,payload:unknown)=>command==='suggestQuestion'?Promise.resolve({question:'{"blocks":[{"type":"reaction","caption":"Grignard"}]}'}):request(command as any,payload as any)) as typeof request;});
 const input=page.getByRole('textbox',{name:'Chemistry question'});await input.fill('Draw ethanol');await input.press('Enter');
 await expect(page.getByRole('button',{name:'Send question',exact:true})).toBeVisible();
 await expect.poll(()=>input.getAttribute('placeholder')).not.toContain('"blocks"');
 await expect.poll(()=>input.getAttribute('placeholder')).not.toContain('{');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'About',exact:true}).click();
 await expect(page.locator('.about-developer')).toContainText('Mohammed Ayan Mahmood');
 await expect(page.locator('.about-developer').getByRole('button',{name:'Copy app information'})).toHaveCount(0);
 await expect(page.getByLabel('Application information')).toContainText('Check for updates');
});

test('slash commands apply when typed first or clicked, and preserve mid-sentence text',async({page})=>{
 await mockDesktop(page);await page.goto('/');
 await page.evaluate(()=>{const chat=window.chemez.chat;window.chemez.chat=async payload=>{(window as unknown as {sentCommand:unknown}).sentCommand=payload;return chat(payload);};});
 const input=page.getByRole('textbox',{name:'Chemistry question'});
 await input.fill('/versus benzene vs phenol');await expect(page.locator('.composer .slash-chip')).toHaveCount(0);
 await input.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as unknown as {sentCommand:{command:unknown}}).sentCommand?.command)).toBe('versus');
 // A command typed in full at the start counts the same as one picked from the menu.
 await expect(page.locator('.message.user .slash-chip')).toHaveCount(1);
 await input.fill('Compare /ve chlorobenzene vs bromobenzene');
 await input.evaluate(el=>{(el as HTMLTextAreaElement).setSelectionRange(11,11);document.dispatchEvent(new Event('selectionchange'));});
 await expect(page.getByRole('button',{name:/\/versus/})).toBeVisible();await expect(page.locator('.composer .slash-chip')).toHaveCount(0);
 await page.getByRole('button',{name:/\/versus/}).click();
 await expect(page.locator('.composer .slash-chip')).toHaveText('Versus');await expect(input).toHaveValue('Compare chlorobenzene vs bromobenzene');
 await input.press('Enter');await expect.poll(()=>page.evaluate(()=>(window as unknown as {sentCommand:{command:string}}).sentCommand?.command)).toBe('versus');
 await page.getByRole('button',{name:'New conversation',exact:true}).click();
 await input.fill('Explain /');await expect(page.locator('.slash-command')).toHaveCount(8);await input.press('Tab');await expect(page.locator('.composer .slash-chip')).toHaveCount(0);
 await input.focus();await input.press('Escape');await expect(page.locator('.slash-command')).toHaveCount(0);
});

test('answer references popup lists lookup sources and handles no sources',async({page})=>{
  await mockDesktop(page);await page.goto('/');
  const input=page.getByRole('textbox',{name:'Chemistry question'});
  await input.fill('compound cards');await input.press('Enter');
  await page.getByRole('button',{name:'References (1)',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'References',exact:true});
  await expect(popup.getByText('Compound lookup source')).toBeVisible();
  await expect(popup.getByRole('button',{name:'PubChem'})).toBeVisible();
  await expect(popup.getByRole('button',{name:'Copy references'})).toBeVisible();
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  await popup.getByRole('button',{name:'Copy references'}).click();
  await expect(popup.getByRole('status')).toHaveText('Copied references.');
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('https://pubchem.ncbi.nlm.nih.gov/compound/62695');
  await popup.getByRole('button',{name:'Close References'}).click();
  await input.fill('Draw ethanol');await input.press('Enter');
  await page.getByRole('button',{name:'References',exact:true}).last().click();
  await expect(page.getByText('No external references were attached to this answer.',{exact:false})).toBeVisible();
});
