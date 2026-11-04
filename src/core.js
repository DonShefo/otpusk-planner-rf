/* Pure data and date operations. The same source is embedded in the offline HTML. */
globalThis.PlannerCore = (() => {
  'use strict';
  const DAY = 86400000, MAX_BYTES = 10 * 1024 * 1024;
  const FEDERAL_DATES = ['01-01','01-02','01-03','01-04','01-05','01-06','01-07','01-08','02-23','03-08','05-01','05-09','06-12','11-04'];
  const federalHolidays = year => FEDERAL_DATES.map(d => `${year}-${d}`);
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(message) { throw new Error(message); }
  function record(v, label) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) fail(`${label}: ожидается объект`);
    return v;
  }
  function integer(v, fallback, min, max, label) {
    if (v === undefined) return fallback;
    if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
    if (!Number.isSafeInteger(v) || v < min || v > max) fail(`${label}: допустимо целое число от ${min} до ${max}`);
    return v;
  }
  function yearKey(v) {
    if (!/^\d{4}$/.test(String(v))) fail(`Неверный год: ${v}`);
    return String(integer(Number(v), 2026, 2000, 2100, 'Год'));
  }
  function parseDate(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y,m,d] = v.split('-').map(Number), t = Date.UTC(y,m-1,d);
    return new Date(t).toISOString().slice(0,10) === v ? t : null;
  }
  function text(v, label) {
    if (v === undefined) return '';
    if (typeof v !== 'string' || v.length > 250) fail(`${label}: ожидается строка до 250 символов`);
    return v;
  }
  function rejectKeys(v, depth = 0) {
    if (depth > 20) fail('Слишком глубокая вложенность JSON');
    if (v && typeof v === 'object') for (const key of Object.keys(v)) {
      if (['__proto__','constructor','prototype'].includes(key)) fail(`Недопустимый ключ: ${key}`);
      rejectKeys(v[key], depth + 1);
    }
  }
  function roster(list, legacy = false) {
    if (!Array.isArray(list) || list.length > 2000) fail('Список сотрудников отсутствует или превышает 2000 записей');
    const seen = new Set();
    return list.map((emp, i) => {
      record(emp, 'Сотрудник');
      const id = String(emp.id ?? (legacy ? `legacy_${i+1}` : ''));
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || seen.has(id)) fail(`Некорректный или повторный ID сотрудника: ${id}`);
      seen.add(id);
      return {id, name:text(emp.name,'Имя'), position:text(emp.position,'Должность')};
    });
  }
  function parts(list) {
    if (!Array.isArray(list) || list.length > 8) fail('Допустимо до 8 частей отпуска');
    return list.map(p => {
      record(p,'Часть отпуска');
      const start = p.start ?? '';
      if (start !== '' && (parseDate(start) === null || +start.slice(0,4) < 2000 || +start.slice(0,4) > 2100)) fail(`Некорректная дата начала: ${start}`);
      return {start, days:integer(p.days,0,0,366,'Дни отпуска')};
    });
  }
  function validateDatabase(input, allowPrevious = true) {
    record(input, 'База'); rejectKeys(input);
    if (input._app !== undefined && input._app !== 'grafik_otpuskov') fail('Это файл другого приложения');
    const version = integer(input._ver, 1, 1, 3, 'Версия формата');
    const active = yearKey(input.year ?? 2026);
    const annual = integer(input.annual,28,1,366,'Норма отпуска');
    const overlap = integer(input.overlap,2,1,2000,'Порог пересечений');
    const employees = roster(input.employees, version < 3);
    const schedulesIn = record(input.schedules ?? {},'Графики');
    const rostersIn = input.rosters === undefined ? {} : record(input.rosters,'Состав по годам');
    if (version === 3 && !rostersIn[active]) fail('Нет состава сотрудников выбранного года');
    const settingsIn = record(input.yearSettings ?? {},'Настройки по годам');
    const holidaysIn = record(input.holidays ?? {},'Праздники');
    const metaIn = record(input.holidaysMeta ?? {},'Источники праздников');
    const years = new Set([active,...Object.keys(schedulesIn),...Object.keys(rostersIn),...Object.keys(settingsIn)]);
    const out = {_app:'grafik_otpuskov',_ver:3,year:+active,annual,overlap,employees:[],rosters:{},schedules:{},yearSettings:{},holidays:{},holidaysMeta:{}};
    for (const raw of years) {
      const y = yearKey(raw);
      if (version === 3 && !rostersIn[y]) fail(`Нет состава сотрудников за ${y}`);
      out.rosters[y] = rostersIn[y] ? roster(rostersIn[y]) : clone(employees);
      const ids = new Set(out.rosters[y].map(e=>e.id));
      const schedule = record(schedulesIn[y] ?? {}, `График ${y}`);
      out.schedules[y] = {};
      for (const [id, list] of Object.entries(schedule)) {
        if (!ids.has(id)) fail(`В графике ${y} неизвестный сотрудник: ${id}`);
        out.schedules[y][id] = parts(list);
      }
      if (y === active && version < 3) input.employees.forEach((e,i) => {
        if (e.parts !== undefined && out.schedules[y][employees[i].id] === undefined) out.schedules[y][employees[i].id] = parts(e.parts);
      });
      for (const e of out.rosters[y]) out.schedules[y][e.id] ??= [];
      const settings = record(settingsIn[y] ?? {},`Настройки ${y}`);
      out.yearSettings[y] = {annual:integer(settings.annual,annual,1,366,'Норма'),overlap:integer(settings.overlap,overlap,1,2000,'Порог')};
    }
    for (const raw of new Set([...years,...Object.keys(holidaysIn)])) {
      const y = yearKey(raw), dates = holidaysIn[y] ?? federalHolidays(y);
      if (!Array.isArray(dates) || dates.length > 366) fail(`Некорректный список праздников ${y}`);
      for (const date of dates) if (parseDate(date) === null || !date.startsWith(y+'-')) fail(`Некорректная праздничная дата: ${date}`);
      out.holidays[y] = [...new Set(dates)].sort();
      const meta = record(metaIn[y] ?? {},'Источник');
      out.holidaysMeta[y] = {source:text(meta.source ?? (holidaysIn[y] ? 'imported' : 'federal'),'Источник'),updated:text(meta.updated ?? '', 'Дата проверки'),sourceDate:text(meta.sourceDate ?? '', 'Дата источника'),error:text(meta.error ?? '', 'Ошибка календаря')};
    }
    out.employees = out.rosters[active];
    Object.assign(out,out.yearSettings[active]);
    const settings = record(input._settings ?? {},'Параметры интерфейса');
    out._settings = {zoom:integer(settings.zoom,100,75,130,'Масштаб'),tlScale:integer(settings.tlScale,100,50,300,'Масштаб графика')};
    if (allowPrevious && input._previous) out._previous = validateDatabase(input._previous, false);
    return out;
  }
  function parseDatabase(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('JSON превышает 10 МБ');
    let obj;
    try { obj = JSON.parse(raw.replace(/^\uFEFF/,'')); } catch { fail('Повреждён JSON: проверь, что выбран файл экспорта планировщика'); }
    return validateDatabase(obj);
  }
  function snapshot(state) { const s = clone(state); delete s._previous; return s; }
  function mergeDatabases(current, incoming) {
    const out = validateDatabase(current), add = validateDatabase(incoming);
    for (const y of Object.keys(add.rosters)) {
      for (const key of ['rosters','schedules','yearSettings']) out[key][y] = clone(add[key][y]);
    }
    // Calendar-only years in legacy exports must not replace another year's custom calendar.
    for (const y of Object.keys(add.holidays)) if (add.rosters[y] || !out.holidays[y]) {
      out.holidays[y] = clone(add.holidays[y]); out.holidaysMeta[y] = clone(add.holidaysMeta[y]);
    }
    out.employees = out.rosters[String(out.year)];
    Object.assign(out,out.yearSettings[String(out.year)]);
    out._previous = snapshot(current);
    return out;
  }
  function computeEnd(start, days, holidays) {
    if (start === null || !Number.isFinite(start) || !Number.isInteger(days) || days < 1 || days > 366) return null;
    let t = start, counted = 0, holsInside = 0;
    // Valid data contains at most 366 holidays per year. Fail rather than return a truncated result.
    for (let guard = 0; guard < 1461; guard++, t += DAY) {
      const date = new Date(t).toISOString().slice(0,10);
      if (holidays.has(date)) holsInside++; else counted++;
      if (counted === days) return {end:t,holsInside,span:(t-start)/DAY+1};
    }
    return null;
  }
  function validateCalendarRecords(year, records) {
    const seen = new Set(), result = [];
    if (!Array.isArray(records) || records.length > 366) fail('Некорректный список календарных дней');
    for (const day of records) {
      const date = `${year}-${String(day.d).replace('.', '-')}`;
      if (parseDate(date) === null || seen.has(date) || !['1','2','3'].includes(day.t)) fail('В онлайн-календаре неверная или повторная дата');
      seen.add(date);
      if (day.t === '1' && day.h && !day.f) result.push(date);
    }
    result.sort();
    if (JSON.stringify(result) !== JSON.stringify(federalHolidays(year).sort())) fail('Онлайн-праздники отличаются от проверенного перечня ст. 112 ТК РФ. Требуется проверка источника или изменений закона');
    return result;
  }
  return {MAX_BYTES,federalHolidays,parseDate,validateDatabase,parseDatabase,snapshot,mergeDatabases,computeEnd,validateCalendarRecords};
})();
