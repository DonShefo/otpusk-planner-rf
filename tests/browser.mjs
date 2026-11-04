import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
const {chromium}=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const temp=mkdtempSync(join(tmpdir(),'otpusk-tests-')),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
let assertions=0;
const errors=[];
const check=(condition,message)=>{assert(condition,message);assertions++;};
const legacy={_ver:2,_app:'grafik_otpuskov',year:2026,annual:28,overlap:2,employees:[{id:'e1',name:'Тестовый сотрудник',position:'Менеджер'}],schedules:{2025:{e1:[{start:'2025-06-02',days:14}]},2026:{e1:[{start:'2026-12-28',days:14}]}},holidays:{}};
function fixture(data,name='import.json'){return {name,mimeType:'application/json',buffer:Buffer.from(typeof data==='string'?data:JSON.stringify(data))};}
async function pageFor(init){
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',acceptDownloads:true});
 if(init)await context.addInitScript(init);
 await context.route('https://planner.test/',r=>r.fulfill({contentType:'text/html',body:html}));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto('https://planner.test/');await page.locator('#tbl tbody tr').first().waitFor();
 return {page,context};
}
const cache=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('grafik_otpuskov_v3')));
async function importFile(page,data,mode='merge'){
 await page.locator(mode==='merge'?'#btnImport':'#btnOpenFallback').evaluate(el=>el.click());
 await page.locator('#fileImport').setInputFiles(fixture(data));
 await page.waitForFunction(()=>!document.getElementById('editor').inert);
}
try{
 const {page:p,context}=await pageFor();
 check((await p.locator('#holList .holchip').count())===14,'Встроенный календарь без сети');
 await importFile(p,legacy,'open');
 check((await p.locator('td.end').first().innerText()).includes('18.01.2027'),'Переход через Новый год');
 await p.locator('#yPrev').click();
 check((await p.locator('[data-f="start"]').first().inputValue())==='2025-06-02','История 2025 открыта');
 await p.locator('#yNext').click();await p.locator('#yNext').click();
 check(await p.locator('.carry').count()===1,'Переходящий отпуск виден в новом году');
 await p.locator('[data-f="name"]').first().fill('Имя только в 2027');
 await p.locator('#setAnnual').fill('35');await p.locator('#setAnnual').press('Tab');
 await p.locator('[data-act="delemp"]').first().click();
 await p.locator('#yPrev').click();
 check((await p.locator('[data-f="name"]').first().inputValue())==='Тестовый сотрудник','Удаление/переименование не меняет прошлый год');
 check((await p.locator('#setAnnual').inputValue())==='28','Норма прошлого года не меняется');
 const before=await cache(p);
 await importFile(p,'{bad json');
 check(JSON.stringify(await cache(p))===JSON.stringify(before),'Повреждённый импорт не меняет базу');
 await importFile(p,{year:2028,employees:[{id:'e2',name:'Новый год',parts:[{start:'2028-07-01',days:14}]}]});
 check(Object.keys((await cache(p)).rosters).join(',')==='2025,2026,2027,2028','Импорт добавляет год без потери истории');
 const downloadPromise=p.waitForEvent('download');await p.locator('#btnSave').click();
 const download=await downloadPromise,path=join(temp,'base.json');await download.saveAs(path);
 const exported=JSON.parse(readFileSync(path,'utf8'));
 check(exported._ver===3&&exported.schedules[2025].e1[0].days===14,'Выгрузка JSON содержит все годы');
 const clean=await pageFor();await importFile(clean.page,readFileSync(path,'utf8'),'open');
 check(JSON.stringify((await cache(clean.page)).rosters)===JSON.stringify(exported.rosters),'Открытие в чистом сеансе сохраняет все годы');
 await clean.context.close();
 // Native FileSystemFileHandle backed by Chromium OPFS. Only file picker UI is substituted.
 await p.evaluate(()=>{
   window.showSaveFilePicker=async()=>{window.testHandle=await(await navigator.storage.getDirectory()).getFileHandle('database.json',{create:true});return window.testHandle;};
   window.showOpenFilePicker=async()=>[window.testHandle];
 });
 await p.locator('#btnNewDb').click();
 await p.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('сохранена и проверена'));
 check(await p.locator('#autoSave').isChecked(),'После подключения автосохранение включено');
 await p.locator('[data-f="name"]').first().fill('Сохранено в файл');
 await p.waitForFunction(async()=>JSON.parse(await(await window.testHandle.getFile()).text()).employees[0].name==='Сохранено в файл');
 await p.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('Сохранено и проверено'));
 check(true,'Запись подтверждена чтением');
 let disk=await p.evaluate(async()=>JSON.parse(await(await window.testHandle.getFile()).text()));
 check(disk._previous.employees[0].name==='Тестовый сотрудник','Предыдущая запись хранится в JSON');
 await p.reload();
 await p.locator('#btnReconnect').waitFor();await p.locator('#btnReconnect').click();
 check((await p.locator('[data-f="name"]').first().inputValue())==='Сохранено в файл','Handle восстановлен из IndexedDB после reload');
 await p.evaluate(async()=>{window.testHandle=await(await navigator.storage.getDirectory()).getFileHandle('database.json');const s=await window.testHandle.createWritable();await s.write('external change');await s.close();});
 await p.locator('[data-f="name"]').first().fill('Несохранённая правка');
 await p.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('Файл изменён'));
 check(!await p.locator('#autoSave').isChecked(),'Внешняя правка останавливает автосохранение');
 check(await p.evaluate(async()=>(await window.testHandle.getFile()).text())==='external change','Чужой файл не затёрт');
 await p.locator('details summary').click();await p.locator('#btnRollback').click();
 check((await p.locator('[data-f="name"]').first().inputValue())==='Тестовый сотрудник','Откат предыдущей записи');
 // Real source snapshots retrieved on 2026-11-04.
 for(const year of [2026,2027]){
  const xml=readFileSync(new URL(`fixtures/calendar-${year}.xml`,import.meta.url),'utf8');
  check(await p.evaluate(({xml,year})=>PlannerCalendar.parseXML(xml,year).dates.length,{xml,year})===14,'Реальный XML '+year+' проверен');
 }
 // Controlled online responses exercise parsing, validation, fallback and retention.
 const dates=['01.01','01.02','01.03','01.04','01.05','01.06','01.07','01.08','02.23','03.08','05.01','05.09','06.12','11.04'];
 const xml=`<calendar year="2026" country="ru" date="2025.09.30"><holidays><holiday id="1"/></holidays><days>${dates.map(d=>`<day d="${d}" t="1" h="1"/>`).join('')}<day d="01.09" t="1" f="01.03"/></days></calendar>`;
 await p.route('https://xmlcalendar.ru/**',r=>r.fulfill({status:503,body:'Unavailable'}));
 await p.route('https://raw.githubusercontent.com/**',r=>r.fulfill({contentType:'application/xml',body:xml}));
 await p.locator('#btnHolOnline').click();
 await p.waitForFunction(()=>document.getElementById('holStatus').textContent.includes('Последнее успешное'));
 check((await cache(p)).holidaysMeta[2026].source==='xmlcalendar/data (GitHub)','Обновление через запасной адрес');
 const holidays=(await cache(p)).holidays[2026];
 await p.unroute('https://raw.githubusercontent.com/**');await p.route('https://raw.githubusercontent.com/**',r=>r.fulfill({contentType:'application/xml',body:xml.replace('d="01.01"','d="12.31"')}));
 await p.locator('#btnHolOnline').click();
 await p.waitForFunction(()=>document.getElementById('holStatus').textContent.includes('Обновление не выполнено'));
 check(JSON.stringify((await cache(p)).holidays[2026])===JSON.stringify(holidays),'Ошибка онлайн не меняет последний календарь');
 check(!!(await cache(p)).holidaysMeta[2026].updated,'Сохраняется дата последнего успешного обновления');
 const badXML=await p.evaluate(xml=>{try{PlannerCalendar.parseXML(xml.replace('year="2026"','year="2027"'),2026);return false;}catch{return true;}},xml);
 check(badXML,'Отклонён календарь другого года');
 const xlsxPromise=p.waitForEvent('download');await p.locator('#btnXlsx').click();
 const xlsx=await xlsxPromise;await xlsx.saveAs(join(temp,'plan.xlsx'));
 check(readFileSync(join(temp,'plan.xlsx')).subarray(0,2).toString()==='PK','Excel сохранён как ZIP/XLSX');
 // Viewports, sticky identity column, dark theme and print.
 await p.locator('.table-scroll').evaluate(el=>el.scrollLeft=500);
 const nameRect=await p.locator('td.name').first().boundingBox(),scrollRect=await p.locator('.table-scroll').boundingBox();
 check(Math.abs(nameRect.x-scrollRect.x)<4,'Имя остаётся при горизонтальной прокрутке');
 const screenshots=process.env.SCREENSHOT_DIR;
 if(screenshots)await p.screenshot({path:join(screenshots,'planner-desktop.png'),fullPage:true});
 await p.emulateMedia({colorScheme:'dark'});
 await p.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 check(await p.locator('html').getAttribute('data-theme')==='dark','Системная тёмная тема');
 if(screenshots)await p.screenshot({path:join(screenshots,'planner-dark.png'),fullPage:true});
 await p.setViewportSize({width:390,height:844});
 check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Нет горизонтального выхода страницы на мобильном');
 if(screenshots)await p.screenshot({path:join(screenshots,'planner-mobile.png'),fullPage:true});
 await p.setViewportSize({width:1440,height:1000});await p.emulateMedia({media:'print'});
 check(await p.locator('.filebar').isHidden(),'Управление файлами скрыто в печати');
 check(await p.evaluate(()=>getComputedStyle(document.body).backgroundColor)==='rgb(255, 255, 255)','Печать светлая');
 await context.close();
 const blocked=await pageFor(()=>{Storage.prototype.getItem=function(){throw Error('blocked');};Storage.prototype.setItem=function(){throw Error('blocked');};});
 check((await blocked.page.locator('#cacheWarning').innerText()).includes('не сохраняет'),'Блокировка localStorage не ломает приложение');
 await blocked.page.locator('#btnAdd').click();check(await blocked.page.locator('#tbl tbody tr').count()===2,'Редактирование без localStorage');await blocked.context.close();
 const corrupt=await pageFor(()=>localStorage.setItem('grafik_otpuskov_v3','{broken'));
 check((await corrupt.page.locator('#fileStatus').innerText()).includes('не перезаписана'),'Повреждённая локальная копия не скрывается');
 check(await corrupt.page.evaluate(()=>localStorage.getItem('grafik_otpuskov_v3'))==='{broken','Сырые данные остаются для восстановления');await corrupt.context.close();
 const concurrent=await pageFor();
 await concurrent.page.evaluate(()=>{window.showSaveFilePicker=async()=>{window.testHandle=await(await navigator.storage.getDirectory()).getFileHandle('concurrent.json',{create:true});return window.testHandle;};});
 await concurrent.page.locator('#btnNewDb').click();
 await concurrent.page.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('сохранена и проверена'));
 await concurrent.page.evaluate(()=>{
  const original=PlannerStorage.write;let first=true;
  PlannerStorage.write=async(...args)=>{if(first){first=false;await new Promise(resolve=>window.finishFirstWrite=resolve);}return original(...args);};
 });
 await concurrent.page.locator('[data-f="name"]').first().fill('Первая правка');
 await concurrent.page.waitForFunction(()=>!!window.finishFirstWrite);
 await concurrent.page.locator('[data-f="name"]').first().fill('Правка во время записи');
 await concurrent.page.evaluate(()=>window.finishFirstWrite());
 await concurrent.page.waitForFunction(async()=>JSON.parse(await(await window.testHandle.getFile()).text()).employees[0].name==='Правка во время записи');
 await concurrent.page.waitForFunction(()=>document.getElementById('fileStatus').textContent.includes('Сохранено и проверено'));
 check(true,'Правка во время записи попадает в следующую автоматическую запись');
 await concurrent.context.close();
 check(errors.length===0,'Нет ошибок JS: '+errors.join('; '));
 console.log(`Browser: ${assertions} проверок OK (файлы, чистый сеанс, календарь, тема, интерфейс).`);
}finally{await browser.close();rmSync(temp,{recursive:true,force:true});}
