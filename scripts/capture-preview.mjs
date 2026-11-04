// Capture real UI panels for the README using the public, fictional demo database.
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const root=new URL('../',import.meta.url);
const html=readFileSync(new URL('index.html',root),'utf8');
const demo=JSON.parse(readFileSync(new URL('docs/assets/demo.json',root),'utf8'));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1200},deviceScaleFactor:1,locale:'ru-RU'});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>dialog.accept());
  await page.route('https://preview.test/',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://preview.test/');
  await page.locator('#btnOpenFallback').evaluate(el=>el.click());
  await page.locator('#fileImport').setInputFiles({name:'demo.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(demo))});
  await page.waitForFunction(()=>!document.getElementById('editor').inert&&document.querySelectorAll('#tbl tbody tr').length===6);
  const validated=await page.evaluate(()=>JSON.parse(localStorage.getItem('grafik_otpuskov_v3')));
  // Keep the downloadable example in the current, validated data format.
  writeFileSync(new URL('docs/assets/demo.json',root),JSON.stringify(validated,null,2)+'\n');
  for(const theme of ['light','dark']){
    await page.locator('#themeSelect').selectOption(theme);
    const chart=page.locator('section.panel').filter({has:page.locator('#tl')});
    const conflicts=page.locator('section.panel').filter({has:page.locator('#conflicts')});
    const a=await chart.boundingBox(),b=await conflicts.boundingBox();
    await page.screenshot({path:new URL(`docs/assets/schedule-${theme}.png`,root).pathname,fullPage:true,
      clip:{x:a.x-8,y:a.y-8,width:a.width+16,height:b.y+b.height-a.y+16}});
  }
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('README previews captured in both themes; demo imported successfully.');
}finally{await browser.close();}
