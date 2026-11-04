import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {build} from './build.mjs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
assert.equal(html,build(),'index.html устарел: выполни node scripts/build.mjs');
let count=0;
for(const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
  assert(!/\bsrc\s*=/.test(m[1]),'Внешние скрипты запрещены');
  new vm.Script(m[2]);count++;
}
assert.equal(count,5,'Ожидались тема, core, storage, calendar и app');
const allowed=new Set(['www.cbr.ru','xmlcalendar.ru','raw.githubusercontent.com','schemas.openxmlformats.org','www.w3.org']);
for(const m of html.matchAll(/https?:\/\/([\w.-]+)/g))assert(allowed.has(m[1]),'Неожиданный домен '+m[1]);
for(const regex of [/XMLHttpRequest/,/sendBeacon/,/WebSocket/,/method\s*:\s*['"]POST/i])assert(!regex.test(html),'Запрещённый сетевой вызов');
assert.equal([...html.matchAll(/\bfetch\(/g)].length,1,'Сеть разрешена только модулю календаря');
assert(html.indexOf('localStorage.getItem("zch-theme")')<html.indexOf('</head>'),'Тема должна быть в head');
assert(html.includes('@media print'));
console.log(`Сборка, синтаксис ${count} скриптов и разрешённые запросы: OK`);
