globalThis.PlannerCalendar = (() => {
  'use strict';
  function parseXML(xml, year) {
    if (xml.length > 200000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Неподдерживаемый XML календаря');
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    const root = doc.documentElement;
    if (doc.querySelector('parsererror') || root.nodeName !== 'calendar' || root.getAttribute('year') !== String(year) || root.getAttribute('country') !== 'ru') throw new Error('Онлайн-календарь повреждён или относится к другому году/стране');
    const records = Array.from(root.querySelectorAll('days > day'), day => Object.fromEntries(['d','t','h','f'].map(k=>[k,day.getAttribute(k)])));
    const holidays = new Set(Array.from(root.querySelectorAll('holidays > holiday'), h=>h.getAttribute('id')));
    if (records.some(d=>d.h && !holidays.has(d.h))) throw new Error('В XML неизвестный код праздника');
    return {dates:PlannerCore.validateCalendarRecords(year,records),sourceDate:root.getAttribute('date')||''};
  }
  async function fetchYear(year) {
    if (!Number.isInteger(year) || year < 2013 || year > 2100) throw new Error('Онлайн-источник поддерживается с 2013 года');
    const sources = [
      {name:'xmlcalendar.ru',url:`https://xmlcalendar.ru/data/ru/${year}/calendar.xml`},
      {name:'xmlcalendar/data (GitHub)',url:`https://raw.githubusercontent.com/xmlcalendar/data/master/ru/${year}/calendar.xml`}
    ];
    const errors = [];
    for (const source of sources) {
      const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
      try {
        const response = await fetch(source.url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
        if (!response.ok) throw new Error(response.status===404?'данные этого года ещё не опубликованы':`HTTP ${response.status}`);
        const result = parseXML(await response.text(),year);
        return {...result,source:source.name,updated:new Date().toISOString()};
      } catch(error) {errors.push(source.name+': '+(error.name==='AbortError'?'время ожидания истекло':error.message));}
      finally {clearTimeout(timer);}
    }
    throw new Error(errors.join('; ').slice(0,250));
  }
  return {parseXML,fetchYear};
})();
