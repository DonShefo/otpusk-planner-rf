import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/core.js';
import '../src/storage.js';
const C=globalThis.PlannerCore,S=globalThis.PlannerStorage;
const legacy=()=>({year:2026,annual:28,overlap:2,employees:[{id:'e1',name:'Иван',position:'Менеджер'}],schedules:{2025:{e1:[{start:'2025-04-07',days:14}]},2026:{e1:[{start:'2026-12-28',days:14}]}},holidays:{2026:C.federalHolidays(2026)}});
test('v2 → v3: все годы, имена, графики и настройки',()=>{
 const input=legacy(),before=JSON.stringify(input),out=C.validateDatabase(input);
 assert.equal(JSON.stringify(input),before);assert.equal(out.schedules[2025].e1[0].days,14);
 out.rosters[2026][0].name='Новое имя';out.yearSettings[2026].annual=35;
 assert.equal(out.rosters[2025][0].name,'Иван');assert.equal(out.yearSettings[2025].annual,28);
});
test('v1 parts без ID и строковые дни',()=>{
 const out=C.validateDatabase({year:2026,employees:[{name:'А',parts:[{start:'2026-06-01',days:'14'}]}]});
 assert.equal(out.schedules[2026].legacy_1[0].days,14);
});
test('JSON round trip, BOM и предыдущая запись',()=>{
 const db=C.validateDatabase(legacy());db._previous=C.snapshot(db);
 assert.deepEqual(C.parseDatabase('\uFEFF'+JSON.stringify(db)),db);assert(!db._previous._previous);
});
test('merge заменяет только импортированные годы',()=>{
 const current=C.validateDatabase(legacy()),incoming=C.validateDatabase({year:2027,employees:[{id:'e2',name:'Пётр'}]});
 incoming.holidays[2025]=[];
 const out=C.mergeDatabases(current,incoming);
 assert.deepEqual(Object.keys(out.rosters),['2025','2026','2027']);
 assert.deepEqual(out.schedules[2025],current.schedules[2025]);assert.deepEqual(out.holidays[2025],current.holidays[2025]);
 assert.deepEqual(out._previous,C.snapshot(current));
});
const invalids=[['не JSON','{'],['нет сотрудников','{}'],['чужое приложение',{...legacy(),_app:'other'}],['будущая версия',{...legacy(),_ver:4}],['нет состава v3',{...legacy(),_ver:3}],['повторный ID',{...legacy(),employees:[{id:'e1'},{id:'e1'}]}],['инъекция ID',{...legacy(),employees:[{id:'e" onclick="x'}]}],['неизвестный сотрудник',{...legacy(),schedules:{2026:{unknown:[]}}}],['неверная дата',{...legacy(),schedules:{2026:{e1:[{start:'2026-02-30',days:14}]}}}],['дробные дни',{...legacy(),schedules:{2026:{e1:[{start:'2026-02-01',days:1.5}]}}}],['лишние дни',{...legacy(),schedules:{2026:{e1:[{start:'2026-02-01',days:999999}]}}}],['праздник другого года',{...legacy(),holidays:{2026:['2027-01-01']}}],['опасный ключ','{"employees":[],"__proto__":{"polluted":true}}']];
for(const [name,input] of invalids)test('Отклоняет: '+name,()=>assert.throws(()=>C.parseDatabase(typeof input==='string'?input:JSON.stringify(input))));
test('Пустые части и ручной календарь остаются пустыми',()=>{
 const db=C.validateDatabase({...legacy(),schedules:{2026:{e1:[{start:'',days:0}]}},holidays:{2026:[]}});
 assert.deepEqual(db.holidays[2026],[]);assert.equal(db.schedules[2026].e1[0].days,0);
});
test('Праздники, переносы выходных, Новый год и високосные даты',()=>{
 const hs=new Set([...C.federalHolidays(2026),...C.federalHolidays(2027)]);
 const end=(s,d)=>new Date(C.computeEnd(C.parseDate(s),d,hs).end).toISOString().slice(0,10);
 assert.equal(end('2026-03-07',3),'2026-03-10');assert.equal(end('2026-12-28',14),'2027-01-18');
 assert.equal(end('2026-04-06',14),'2026-04-19');assert.equal(end('2026-01-01',1),'2026-01-09');
 assert.equal(C.parseDate('2025-02-29'),null);assert.notEqual(C.parseDate('2024-02-29'),null);
});
test('Нет ложного результата для неправильной длительности',()=>{
 for(const d of [NaN,Infinity,-1,0,1.5,99999])assert.equal(C.computeEnd(C.parseDate('2026-01-01'),d,new Set()),null);
});
const records=()=>C.federalHolidays(2026).map(d=>({d:d.slice(5).replace('-','.'),t:'1',h:'1',f:null}));
test('Онлайн: переносы и короткие дни не удлиняют отпуск',()=>{
 const days=[...records(),{d:'01.09',t:'1',f:'01.03'},{d:'04.30',t:'2'},{d:'12.31',t:'1',f:'01.04',h:'1'}];
 assert.deepEqual(C.validateCalendarRecords(2026,days),C.federalHolidays(2026));
});
test('Онлайн: отклонение неполных, лишних, повторных праздников',()=>{
 assert.throws(()=>C.validateCalendarRecords(2026,records().slice(1)));
 assert.throws(()=>C.validateCalendarRecords(2026,[...records(),{d:'12.31',t:'1',h:'1'}]));
 assert.throws(()=>C.validateCalendarRecords(2026,[...records(),records()[0]]));
});
function fakeHandle(initial='old'){
 let bytes=initial,pending,aborted=false,opened=0;
 return {name:'db.json',queryPermission:async()=>'granted',requestPermission:async()=>'granted',getFile:async()=>({size:bytes.length,text:async()=>bytes}),
 createWritable:async()=>{opened++;return {write:async text=>{pending=text;},close:async()=>{bytes=pending;},abort:async()=>{aborted=true;}};},
 get bytes(){return bytes;},set bytes(v){bytes=v;},get aborted(){return aborted;},get opened(){return opened;}};
}
test('Запись проверяет закрытый файл',async()=>{const h=fakeHandle();await S.write(h,'old','new');assert.equal(h.bytes,'new');});
test('Внешняя правка не перезаписывается',async()=>{const h=fakeHandle('outside');await assert.rejects(S.write(h,'old','new'),/Файл изменён/);assert.equal(h.bytes,'outside');assert(h.aborted);});
test('Отказ разрешения не открывает поток',async()=>{const h=fakeHandle();h.queryPermission=async()=>'denied';await assert.rejects(S.write(h,'old','new'),/Нет доступа/);assert.equal(h.opened,0);});
test('Ручное сохранение запрашивает разрешение',async()=>{const h=fakeHandle();h.queryPermission=async()=>'prompt';await S.write(h,'old','new',true);assert.equal(h.bytes,'new');});
test('Сбой записи прерывает поток и сохраняет исходник',async()=>{
 const h=fakeHandle();let aborted=false;
 h.createWritable=async()=>({write:async()=>{throw Error('disk full');},abort:async()=>{aborted=true;}});
 await assert.rejects(S.write(h,'old','new'),/disk full/);assert.equal(h.bytes,'old');assert(aborted);
});
test('Неподтверждённая запись не считается успехом',async()=>{
 const h=fakeHandle();h.createWritable=async()=>({write:async()=>{},close:async()=>{}});
 await assert.rejects(S.write(h,'old','new'),/подтвердить/);
});
