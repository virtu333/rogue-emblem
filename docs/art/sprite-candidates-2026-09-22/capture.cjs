const {chromium}=require('/Users/davechen/Documents/rogue-emblem/node_modules/playwright');
const fs=require('fs'), path=require('path');const out=__dirname;
(async()=>{const browser=await chromium.launch({headless:true,args:['--mute-audio']});try{
 const page=await browser.newPage({viewport:{width:1100,height:900},isMobile:true});
 await page.addInitScript(()=>localStorage.setItem('emblem_rogue_settings',JSON.stringify({musicVolume:0,sfxVolume:0,hints:false})));
 await page.goto('http://127.0.0.1:3016/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
 await page.waitForFunction(()=>window.__emblemRogueGame?.scene.getScene('Battle')?.battleState==='PLAYER_IDLE');
 await page.waitForTimeout(1800);
 const info=await page.evaluate(async sources=>{
 const b=window.__emblemRogueGame.scene.getScene('Battle');const {spritePlacement}=await import('/src/ui/RebuiltSprites.js');const {contrastSpriteKey}=await import('/src/ui/BattleContrast.js');
 const definitions=[{id:'edric',name:'Edric',className:'Lord',faction:'player',isLord:true,kind:'infantry'},{id:'sera',name:'Sera',className:'Light Sage',faction:'player',isLord:true,kind:'mage'},{id:'archer',name:'Archer',className:'Archer',faction:'player',kind:'infantry'},{id:'knight',name:'Knight',className:'Knight',faction:'enemy',kind:'heavy'}];
 const samples=[];
 for(const u of definitions){const im=new Image();im.src=sources[u.id];await im.decode();const src=document.createElement('canvas');src.width=im.width;src.height=im.height;const ctx=src.getContext('2d');ctx.drawImage(im,0,0);const px=ctx.getImageData(0,0,src.width,src.height).data;let x0=src.width,y0=src.height,x1=0,y1=0,transparent=0;
 for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++){const a=px[(y*src.width+x)*4+3];if(a===0)transparent++;if(a>10){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
 const bounds={x:x0,y:y0,width:x1-x0+1,height:y1-y0+1};const p=spritePlacement(bounds,u.kind);const c=document.createElement('canvas');c.width=c.height=p.canvas;const cc=c.getContext('2d');cc.imageSmoothingEnabled=false;cc.drawImage(im,x0,y0,bounds.width,bounds.height,p.x,p.y,p.width,p.height);b.textures.addCanvas('candidate-'+u.id,c);
 const key=b.getSpriteKey(u);const old=b.textures.get(contrastSpriteKey(b,key)).getSourceImage();samples.push({...u,canvas:c,old,oldKey:key,bounds,placement:p,transparentFraction:transparent/(src.width*src.height)});
 }
 window.__spriteCandidates=samples;
 for(const u of b.playerUnits){const s=samples.find(x=>x.name===u.name);if(s){u.graphic.setTexture('candidate-'+s.id).setDisplaySize(64,64);}}
 return samples.map(({canvas,old,...s})=>({...s,png:canvas.toDataURL()}));
 },Object.fromEntries(['edric','sera','archer','knight'].map(n=>[n,'data:image/png;base64,'+fs.readFileSync(path.join(out,'sources',n+'.png')).toString('base64')])));
 await page.screenshot({path:out+'/validation/in-game-lords.png'});
 for(const i of info){fs.writeFileSync(out+'/validation/'+i.id+'-64.png',Buffer.from(i.png.split(',')[1],'base64'));delete i.png;}
 fs.writeFileSync(out+'/validation/metrics.json',JSON.stringify(info,null,2));
 await page.evaluate(async()=>{
 const {loadWeatheredArt,drawWeatheredTile}=await import('/src/ui/WeatheredTerrain.js');const art=await loadWeatheredArt('/assets/terrain/weathered');const samples=window.__spriteCandidates;
 const root=document.createElement('div');root.style.cssText='position:fixed;inset:0;z-index:99999;background:#10212b;color:#eee;font:16px sans-serif;padding:20px;display:grid;grid-template-columns:repeat(2,1fr);gap:20px';
 for(const mode of ['Current sprites','Candidate set']){const col=document.createElement('div');col.innerHTML='<h2>'+mode+'</h2><p>Edric · Sera · Archer · Enemy Knight — 32px tiles, 2× view</p>';
 for(const terrain of ['Plain','Forest','Floor']){const c=document.createElement('canvas');c.width=256;c.height=80;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;
 for(let y=0;y<3;y++)for(let x=0;x<8;x++){const t=document.createElement('canvas');t.width=t.height=48;drawWeatheredTile(t.getContext('2d'),art,()=>terrain,x,y);ctx.drawImage(t,x*32,y*32,32,32);}
 for(const [i,s] of samples.entries()){ctx.strokeStyle=i===3?'#df5b61':'#457acf';ctx.beginPath();ctx.ellipse(32+i*64,52,11,3,0,0,Math.PI*2);ctx.stroke();const im=mode==='Candidate set'?s.canvas:s.old;const size=mode==='Current sprites'&&s.id==='archer'?36.8:64;ctx.drawImage(im,32+i*64-size/2,40-size/2,size,size);}
 const label=document.createElement('p');label.textContent=terrain;c.style.cssText='width:512px;height:160px;image-rendering:pixelated';col.append(label,c);}
 root.append(col);}document.body.append(root);window.__comparisonRoot=root;
 });
 await page.screenshot({path:out+'/validation/terrain-comparison.png'});
 await page.evaluate(async()=>{
 window.__comparisonRoot.remove();const {loadWeatheredArt,drawWeatheredTile}=await import('/src/ui/WeatheredTerrain.js');const art=await loadWeatheredArt('/assets/terrain/weathered');
 const root=document.createElement('div');root.style.cssText='position:fixed;inset:0;z-index:99999;background:#10212b;color:#eee;font:18px sans-serif;padding:24px';root.innerHTML='<h2>Candidate set — crowded tiles and display states</h2><p>All eight shown as adjacent tiles; 3× enlargement of 32px tiles.</p>';
 for(const [label,dim,danger] of [['Normal',false,false],['Acted approximation (45% opacity)',true,false],['Danger overlay + selection',false,true]]){const c=document.createElement('canvas');c.width=320;c.height=80;const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=false;for(let y=0;y<3;y++)for(let x=0;x<10;x++){const t=document.createElement('canvas');t.width=t.height=48;drawWeatheredTile(t.getContext('2d'),art,()=> 'Floor',x,y);ctx.drawImage(t,x*32,y*32,32,32);}if(danger){ctx.fillStyle='rgba(220,45,30,.3)';ctx.fillRect(32,16,256,48);ctx.strokeStyle='#f8d783';ctx.strokeRect(96,24,32,32);}for(let i=0;i<8;i++){const s=window.__spriteCandidates[i%4];ctx.globalAlpha=1;ctx.strokeStyle=i%4===3?'#df5b61':'#457acf';ctx.beginPath();ctx.ellipse(48+i*32,52,11,3,0,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=dim?.45:1;ctx.drawImage(s.canvas,16+i*32,8,64,64);}c.style.cssText='display:block;width:960px;height:240px;image-rendering:pixelated';const p=document.createElement('div');p.textContent=label;root.append(p,c);}document.body.append(root);
 });
 await page.screenshot({path:out+'/validation/states.png'});
 console.log(JSON.stringify(info));
 }finally{await browser.close();}})();
