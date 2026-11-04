(() => {
    "use strict";
    const MAXP = 8;
    const MONTHS = ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"];
    const DAY = 86400000;
    let DAYW = 3.25; const NAMEW = 196;

    const {federalHolidays,validateDatabase,parseDatabase,mergeDatabases,snapshot} = PlannerCore;
    const BUILTIN_HOLIDAYS = {"2025":federalHolidays(2025),"2026":federalHolidays(2026)};
    const CALENDAR_SOURCE = "https://www.cbr.ru/other/holidays/";
    const CALENDAR_CHECKED = "2026-11-04";

    const SEED = [
      {name:"Иванов Иван", position:"Менеджер по продажам", parts:[{start:"2026-04-06",days:14},{start:"2026-07-13",days:7},{start:"2026-10-05",days:7}]}
    ];

    const LS = "grafik_otpuskov_v3", LEGACY_LS = "grafik_otpuskov_v2", RECOVERY = LS+'_recovery';

    function withId(e){ e.id = e.id||("e"+Math.random().toString(36).slice(2,9)); return e; }

    function seedState(){
      const employees = SEED.map(s=>withId({name:s.name,position:s.position}));
      const sched2026 = {};
      SEED.forEach((s,i)=>{ sched2026[employees[i].id]=s.parts.map(p=>({start:p.start,days:p.days})); });
      return {
        annual:28, overlap:2, year:2026,
        employees,
        schedules:{"2026":sched2026},
        holidays:{"2025":BUILTIN_HOLIDAYS["2025"].slice(),"2026":BUILTIN_HOLIDAYS["2026"].slice()},
        holidaysMeta:{"2026":{source:"встроенные данные",updated:null}}
      };
    }

    function safeGet(key){ try{return localStorage.getItem(key);}catch{return null;} }
    function safeSet(key,value){ try{localStorage.setItem(key,value);return true;}catch{return false;} }
    let loadError='', cacheBlocked=false;
    function load(){
      const raw=safeGet(LS) ?? safeGet(LEGACY_LS);
      if(!raw)return null;
      try{return parseDatabase(raw);}catch(e){loadError=e.message;cacheBlocked=true;return null;}
    }
    let state = load()||validateDatabase(seedState());
    let selected = null;
    let zoomLevel = +(state._settings?.zoom||safeGet('grf_zoom')||100);
    let tlScalePct = +(state._settings?.tlScale||safeGet('grf_tlscale')||100);
    let databaseHandle=null, rememberedHandle=null, diskText=null, dirty=false, ready=false, saving=false, autoTimer=null, busy=false;
    let savedSnapshot=null;
    const status = message => {document.getElementById('fileStatus').textContent=message;};
    function dump(){
      state.rosters[String(state.year)]=state.employees;
      state.yearSettings[String(state.year)]={annual:state.annual,overlap:state.overlap};
      return {...state,_app:"grafik_otpuskov",_ver:3,_settings:{zoom:zoomLevel,tlScale:tlScalePct}};
    }
    function serialized(){return JSON.stringify(dump(),null,2);}
    function fingerprint(value=dump()){return JSON.stringify(snapshot(validateDatabase(value)));}
    function save(){
      if(!ready)return;
      dirty=fingerprint()!==savedSnapshot;
      const cached=!cacheBlocked && safeSet(LS,JSON.stringify(dump()));
      document.getElementById('cacheWarning').textContent=cached?'':(cacheBlocked?'Старая браузерная копия повреждена и оставлена без изменений. Скачай её для восстановления.':'Браузер не сохраняет запасную копию. Сохраняй изменения в JSON перед закрытием.');
      document.getElementById('btnRollback').disabled=!state._previous;
      document.getElementById('savedYears').textContent='Годы в базе: '+Object.keys(state.rosters).sort().join(', ');
      if(dirty)status(databaseHandle?`Есть изменения, ещё не записанные в ${databaseHandle.name}`:'Рабочий файл не подключён. Сохрани базу в «Документы» или скачай JSON.');
      else if(databaseHandle)status(`Файл ${databaseHandle.name}: изменения сохранены и проверены.`);
      clearTimeout(autoTimer);
      if(dirty && !busy && !saving && databaseHandle && document.getElementById('autoSave').checked)autoTimer=setTimeout(()=>writeDatabase(false),900);
    }
    window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});

    function yearKey(){ return String(state.year); }
    function yearStart(){ return Date.UTC(state.year,0,1); }
    function daysInYear(){ const y=state.year; const leap=(y%4===0&&y%100!==0)||y%400===0; return leap?366:365; }
    function ensureYear(y){
      const yK=String(y);
      if(!state.schedules[yK]) state.schedules[yK]={};
      if(!state.holidays[yK]){
        if(BUILTIN_HOLIDAYS[yK]){ state.holidays[yK]=BUILTIN_HOLIDAYS[yK].slice(); state.holidaysMeta[yK]={source:"federal",updated:CALENDAR_CHECKED}; }
        else { state.holidays[yK]=federalHolidays(y); state.holidaysMeta[yK]={source:"federal",updated:CALENDAR_CHECKED}; }
      }
    }
    function partsFor(emp){
      const yK=yearKey();
      if(!state.schedules[yK]) state.schedules[yK]={};
      if(!state.schedules[yK][emp.id]) state.schedules[yK][emp.id]=[];
      return state.schedules[yK][emp.id];
    }
    function holidaySet(year=state.year){ const dates=[]; for(let y=year;y<=year+3;y++){ dates.push(...(state.holidays[String(y)]||federalHolidays(y))); } return new Set(dates); }

    function pad(n){ return n<10?"0"+n:""+n; }
    function iso(t){ const d=new Date(t); return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate()); }
    const parse = PlannerCore.parseDate;
    function idxOf(t){ return Math.round((t-yearStart())/DAY); }
    function fmtRu(t){ const d=new Date(t); return pad(d.getUTCDate())+"."+pad(d.getUTCMonth()+1); }
    function fmtRuFull(isoStr){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr); return m?`${m[3]}.${m[2]}.${m[1]}`:isoStr; }
    function fmtDateTime(s){ if(!s)return""; const d=new Date(s); return pad(d.getDate())+"."+pad(d.getMonth()+1)+"."+d.getFullYear()+" "+pad(d.getHours())+":"+pad(d.getMinutes()); }
    function isHol(t,hset){ return (hset||holidaySet()).has(iso(t)); }

    const computeEnd = PlannerCore.computeEnd;

    function empDerived(e){
      const hset=holidaySet();
      const arr=partsFor(e);
      const parts=arr.map(p=>{
        const s=parse(p.start); const r=computeEnd(s,p.days,hset);
        return { start:s, days:p.days||0, end:r?r.end:null, span:r?r.span:0, hols:r?r.holsInside:0, raw:p };
      });
      const used=parts.reduce((a,p)=>a+(p.days||0),0);
      return { parts, used, left:state.annual-used };
    }

    function carriedParts(){
      const out=[];
      for(const [year,roster] of Object.entries(state.rosters)){
        if(+year>=state.year || +year<state.year-4)continue;
        const holidays=holidaySet(+year);
        for(const employee of roster){
          (state.schedules[year]?.[employee.id]||[]).forEach((part,pi)=>{
            const start=parse(part.start), range=computeEnd(start,part.days,holidays);
            if(range && start<yearStart() && range.end>=yearStart())out.push({...range,start,days:part.days,employee,pi,year:+year});
          });
        }
      }
      return out;
    }
    function chartEmployees(){
      const byId=new Map(state.employees.map(e=>[e.id,e]));
      for(const part of carriedParts())if(!byId.has(part.employee.id))byId.set(part.employee.id,part.employee);
      return [...byId.values()];
    }

    function occupancy(){
      const days=new Array(daysInYear()).fill(null).map(()=>[]);
      state.employees.forEach(e=>{
        empDerived(e).parts.forEach(p=>{
          if(p.start==null||!p.end) return;
          for(let t=p.start;t<=p.end;t+=DAY){ const i=idxOf(t); if(i>=0&&i<daysInYear()) days[i].push(e.id); }
        });
      });
      for(const p of carriedParts())for(let t=yearStart();t<=Math.min(p.end,yearStart()+(daysInYear()-1)*DAY);t+=DAY)days[idxOf(t)].push(p.employee.id);
      return days.map(a=>Array.from(new Set(a)));
    }

    function color(i){ return `hsl(${(i*47)%360} 58% 52%)`; }
    // Подпись на полосе: белая или чёрная — та, что даёт контраст не ниже 4.5:1 к цвету полосы
    // (для любого цвета лучший из двух вариантов даёт не меньше 4.58:1).
    function labelColor(i){
      const h=((i*47)%360)/360,s=.58,l=.52,q=l+s-l*s,p=2*l-q;
      const f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};
      const lin=v=>v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4);
      const Y=.2126*lin(f(h+1/3))+.7152*lin(f(h))+.0722*lin(f(h-1/3));
      return 1.05/(Y+.05)>=(Y+.05)/.05?"#fff":"#000";
    }
    function nameById(id){ const e=chartEmployees().find(x=>x.id===id); return e?e.name:"?"; }
    function esc(s){ return (s==null?"":(""+s)).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

    // ── Holidays panel ──
    function renderHolidays(){
      const yK=yearKey();
      document.getElementById("holTitle").textContent="Праздники для расчёта отпуска "+state.year;
      const list=(state.holidays[yK]||[]).slice().sort();
      const el=document.getElementById("holList");
      el.innerHTML=list.length
        ?list.map(d=>`<span class="holchip">${fmtRuFull(d)}<button data-act="delhol" data-date="${d}" title="Убрать">✕</button></span>`).join("")
        :`<div class="hol-empty">Праздники на ${state.year} год не заданы — расчёт пойдёт без сдвига дат на праздники. Нажмите «Восстановить праздники РФ» или добавьте даты вручную.</div>`;
      const meta=state.holidaysMeta[yK]||{};
      const st=document.getElementById("holStatus");
      const standard=JSON.stringify(list)===JSON.stringify(federalHolidays(state.year).sort());
      st.className="hol-status "+(meta.error?'err':standard?'ok':'warn');
      const online=meta.source==='xmlcalendar.ru'||meta.source==='xmlcalendar/data (GitHub)';
      st.innerHTML=`<span class="dot"></span>${standard?"Федеральные праздники по ст. 112 ТК РФ":"Пользовательский список: отличается от федерального"}. <a href="${CALENDAR_SOURCE}" target="_blank" rel="noopener">Проверочный перечень: Банк России</a>, сверено ${CALENDAR_CHECKED}. Выходные и переносы не продлевают отпуск.`+
        (online?`<br>Последнее успешное обновление: ${esc(fmtDateTime(meta.updated))}. Источник: ${esc(meta.source)}, выпуск ${esc(meta.sourceDate||'не указан')}.`:'<br>Для обновления используются xmlcalendar.ru и его зеркало на GitHub. Это сторонний источник; даты проверяются перед применением.')+
        (meta.error?`<br>Обновление не выполнено: ${esc(meta.error)}. Последние сохранённые даты оставлены.`:'')+
        (![2025,2026,2027].includes(state.year)?'<br>Этот год отдельно не сверен. Встроенный список соответствует законодательству на дату проверки; для старых лет и при изменении закона нужна сверка.':'');

    }

    document.getElementById("holPanel").addEventListener("click",ev=>{
      const btn=ev.target.closest('button[data-act="delhol"]'); if(!btn) return;
      const yK=yearKey();
      state.holidays[yK]=(state.holidays[yK]||[]).filter(d=>d!==btn.dataset.date);
      state.holidaysMeta[yK]={source:'manual',updated:new Date().toISOString()};
      renderAll();
    });

    document.getElementById("btnHolAdd").onclick=()=>{
      const inp=document.getElementById("holInput"); const v=inp.value; if(!v) return;
      if(parse(v)===null || !v.startsWith(yearKey()+'-')){alert('Выбери дату в '+state.year+' году');return;}
      const yK=yearKey(); if(!state.holidays[yK]) state.holidays[yK]=[];
      if(!state.holidays[yK].includes(v)) state.holidays[yK].push(v);
      state.holidaysMeta[yK]={source:'manual',updated:new Date().toISOString()};
      inp.value=""; renderAll();
    };

    document.getElementById("btnHolUpdate").onclick=()=>{
      if(!confirm("Заменить список праздников выбранного года федеральным перечнем? Ручные изменения этого года будут удалены."))return;
      state.holidays[yearKey()]=federalHolidays(state.year);
      state.holidaysMeta[yearKey()]={source:"federal",updated:CALENDAR_CHECKED};
      renderAll();
    };
    document.getElementById('btnHolOnline').onclick=async()=>{
      if(busy||saving)return;
      const year=state.year, key=yearKey();
      if(!confirm('Обновить праздники '+year+' года через интернет? После проверки источник заменит ручной список этого года. При ошибке текущие даты сохранятся.'))return;
      setBusy(true,true);
      const button=document.getElementById('btnHolOnline');button.disabled=true;button.textContent='Проверяю источники…';
      try{
        const result=await PlannerCalendar.fetchYear(year);
        state.holidays[key]=result.dates;
        state.holidaysMeta[key]={source:result.source,sourceDate:result.sourceDate,updated:result.updated,error:''};
      }catch(e){state.holidaysMeta[key]={...state.holidaysMeta[key],error:e.message.slice(0,250)};}
      finally{button.disabled=false;button.textContent='Обновить через интернет';setBusy(false);renderAll();}
    };

    // ── Table ──
    function renderTable(){
      const maxParts=Math.max(4,...state.employees.map(e=>partsFor(e).length));
      let head=`<thead><tr><th rowspan="2" class="name">Сотрудник</th><th rowspan="2" class="pos">Должность</th>`;
      for(let i=0;i<maxParts;i++) head+=`<th class="part" colspan="3">Часть ${i+1}</th>`;
      head+=`<th rowspan="2">Изр.</th><th rowspan="2">Ост.</th></tr><tr>`;
      for(let i=0;i<maxParts;i++) head+=`<th class="part">начало</th><th class="part">дней</th><th class="part">конец</th>`;
      head+=`</tr></thead>`;
      let body="<tbody>";
      state.employees.forEach((e,ei)=>{
        const d=empDerived(e);
        const eParts=partsFor(e);
        body+=`<tr data-emp="${e.id}">`;
        body+=`<td class="name">
          <div class="nrow">
            <button class="iconbtn no-print" data-act="delemp" title="Удалить сотрудника">✕</button>
            <input data-f="name" maxlength="250" aria-label="Фамилия и имя сотрудника ${ei+1}" value="${esc(e.name)}" placeholder="Фамилия Имя">
          </div>
          <div class="nrow2 no-print">
            <button class="addpart" data-act="addpart" ${eParts.length>=MAXP?"disabled":""}>+ часть</button>
            <span class="pcount">${eParts.length} ч.</span>
          </div>
        </td>`;
        body+=`<td class="pos"><input data-f="position" maxlength="250" aria-label="Должность сотрудника ${ei+1}" value="${esc(e.position)}" title="${esc(e.position)}" placeholder="Должность"></td>`;
        for(let i=0;i<maxParts;i++){
          const p=eParts[i],dp=d.parts[i];
          if(p){
            const endTxt=dp&&dp.end?fmtRu(dp.end)+"."+new Date(dp.end).getUTCFullYear():"—";
            const shift=dp&&dp.hols>0?" shift":"";
            body+=`<td><input type="date" min="2000-01-01" max="2100-12-31" aria-label="Начало части ${i+1}, сотрудник ${ei+1}" data-pi="${i}" data-f="start" value="${esc(p.start||"")}"></td>`;
            body+=`<td><input class="days" type="number" min="0" max="366" aria-label="Дней в части ${i+1}, сотрудник ${ei+1}" data-pi="${i}" data-f="days" value="${p.days||""}" inputmode="numeric"></td>`;
            body+=`<td class="end${shift}" title="${dp&&dp.hols>0?("сдвиг +"+dp.hols+" дн. (праздники)"):""}">${endTxt}<button class="iconbtn pdel no-print" data-act="delpart" data-pi="${i}" title="Удалить часть ${i+1}">✕</button></td>`;
          } else {
            body+=`<td></td><td></td><td></td>`;
          }
        }
        const usedCls=d.used>state.annual?"bad":"used";
        const leftCls=d.left<0?"left bad":(d.left===0?"left zero":"left pos");
        body+=`<td><span class="chip ${usedCls}">${d.used}</span></td>`;
        body+=`<td><span class="chip ${leftCls}">${d.left}</span></td>`;
        body+=`</tr>`;
      });
      body+="</tbody>";
      document.getElementById("tbl").innerHTML=head+body;
      renderFlags();
    }

    function renderFlags(){
      const out=[];
      state.employees.forEach(e=>{
        const d=empDerived(e); const nm=e.name||"(без имени)";
        if(!d.used)out.push(['warn',`<b>${esc(nm)}</b>: отпуск пока не запланирован.`]);
        d.parts.forEach((p,i)=>{if(p.days>0&&p.start===null||p.start!==null&&p.days===0)out.push(['warn',`<b>${esc(nm)}</b>: заполни дату и длительность части ${i+1}.`]);});
        if(d.used>state.annual) out.push(["err",`<b>${esc(nm)}</b>: запланировано ${d.used} дн. — превышение нормы (${state.annual}).`]);
        else if(d.used>0&&d.used<state.annual) out.push(["warn",`<b>${esc(nm)}</b>: выбрано ${d.used} из ${state.annual} дн. нормы — отпуск распланирован не полностью.`]);
        const hasLong=d.parts.some(p=>(p.days||0)>=14);
        if(d.used>0&&!hasLong) out.push(["warn",`<b>${esc(nm)}</b>: ни одна часть не ≥ 14 дней — нарушение ч.1 ст.125 ТК РФ.`]);
        const segs=d.parts.filter(p=>p.start!=null&&p.end).map(p=>[p.start,p.end]).sort((a,b)=>a[0]-b[0]);
        for(let i=1;i<segs.length;i++) if(segs[i][0]<=segs[i-1][1]){ out.push(["err",`<b>${esc(nm)}</b>: части отпуска пересекаются по датам.`]); break; }
        d.parts.forEach((p,i)=>{ if(p.start!=null&&(p.start<yearStart()||p.start>=yearStart()+daysInYear()*DAY)) out.push(["err",`<b>${esc(nm)}</b>: дата начала части ${i+1} вне ${state.year} года.`]); });
      });
      const el=document.getElementById("flags");
      el.innerHTML=out.length
        ?out.map(([t,m])=>`<div class="flag ${t}"><span class="dot">${t==="err"?"●":"▲"}</span><span>${m}</span></div>`).join("")
        :`<div class="flag" style="background:var(--success-bg);color:var(--success-fg)"><span class="dot">✓</span><span>${state.employees.length?'Нарушений не обнаружено.':'В этом году пока нет сотрудников.'}</span></div>`;
    }

    // ── Timeline ──
    function monthOffsets(){ const o=[]; for(let m=0;m<12;m++) o.push(idxOf(Date.UTC(state.year,m,1))); o.push(daysInYear()); return o; }

    function renderTimeline(){
      const tlScroll=document.querySelector('.tl-scroll');
      const availW=tlScroll?tlScroll.clientWidth:(window.innerWidth-80);
      DAYW=Math.max(2.2,(availW-NAMEW)/daysInYear())*(tlScalePct/100);
      const occ=occupancy(),offs=monthOffsets(),DIY=daysInYear();
      const trackW=DIY*DAYW,full=NAMEW+trackW;
      let html=`<div class="tl-months" style="width:${full}px"><div class="tl-namecol" style="width:${NAMEW}px;min-width:${NAMEW}px"></div>`;
      for(let m=0;m<12;m++){ const w=(offs[m+1]-offs[m])*DAYW; html+=`<div class="tl-month" style="width:${w}px">${MONTHS[m]}</div>`; }
      html+=`</div>`;
      let bands=`<div class="tl-bands">`;
      for(let m=1;m<12;m++) bands+=`<div class="band-month" style="left:${offs[m]*DAYW}px"></div>`;
      for(let i=0;i<DIY;i++){ if(isHol(yearStart()+i*DAY)) bands+=`<div class="band-hol" style="left:${i*DAYW}px;width:${DAYW}px"></div>`; }
      bands+=`</div>`;
      const maxC=Math.max(1,...occ.map(a=>a.length));
      html+=`<div class="tl-density" style="width:${full}px"><div class="tl-name">Одновременно</div><div class="dens-track" style="width:${trackW}px">${bands}`;
      for(let i=0;i<DIY;i++){ const c=occ[i].length; if(!c) continue;
        const h=4+Math.round((c/maxC)*24),over=c>state.overlap;
        const col=over?"var(--danger)":`color-mix(in srgb,var(--info-fg) ${60+Math.round((c/maxC)*40)}%,var(--surface))`;
        html+=`<div class="dens-day" style="left:${i*DAYW}px;width:${Math.max(DAYW,1.6)}px;height:${h}px;background:${col}" title="${fmtRu(yearStart()+i*DAY)}: ${c} чел."></div>`;
      }
      html+=`</div></div>`;
      const carry=carriedParts();
      chartEmployees().forEach((e,ei)=>{
        const d=state.employees.some(current=>current.id===e.id)?empDerived(e):{parts:[]};
        html+=`<div class="tl-row" data-emp="${e.id}" style="width:${full}px"><div class="tl-name"><span class="sw" style="background:${color(ei)}"></span><span class="nm" title="${esc(e.name)}">${esc(e.name||"—")}</span></div><div class="tl-track" style="width:${trackW}px">${bands}`;
        for(const p of carry.filter(p=>p.employee.id===e.id)){
          const width=(Math.min(idxOf(p.end),DIY-1)+1)*DAYW;
          html+=`<button class="bar carry" data-emp="${e.id}" data-pi="${p.pi}" data-year="${p.year}" style="left:0;width:${width}px;background:${color(ei)};color:${labelColor(ei)}" title="${esc(e.name)}: переходящий отпуск из ${p.year}, до ${fmtRu(p.end)}. Открыть исходный год">↪</button>`;
        }
        d.parts.forEach((p,pi)=>{
          if(p.start==null||!p.end) return;
          const x=Math.max(0,idxOf(p.start))*DAYW,w=(Math.min(DIY-1,idxOf(p.end))-Math.max(0,idxOf(p.start))+1)*DAYW;
          if(w<=0)return;
          html+=`<div class="bar" data-emp="${e.id}" data-pi="${pi}" style="left:${x}px;width:${w}px;background:${color(ei)}" title="${esc(e.name)}: ${fmtRu(p.start)}–${fmtRu(p.end)} • ${p.days} дн.${p.hols?(" (+"+p.hols+" празд.")+"":""}">`;
          for(let t=p.start;t<=p.end;t+=DAY){ if(isHol(t)){ const rel=Math.round((t-p.start)/DAY)*DAYW; html+=`<span class="hol-seg" style="left:${rel}px;width:${DAYW}px"></span>`; } }
          if(w>28) html+=`<span class="lab" style="color:${labelColor(ei)}">${p.days}</span>`;
          html+=`</div>`;
        });
        html+=`</div></div>`;
      });
      const tl=document.getElementById("tl");
      tl.className="tl"+(selected?" dimmed":"");
      tl.innerHTML=html;
      if(selected) highlightOverlaps();
    }

    function partRange(empId,pi){ const e=state.employees.find(x=>x.id===empId); if(!e) return null; const p=empDerived(e).parts[pi]; return p&&p.start!=null&&p.end?p:null; }

    function highlightOverlaps(){
      document.querySelectorAll(".bar").forEach(b=>b.classList.remove("hi","sel"));
      const base=partRange(selected.emp,selected.partIdx); if(!base){ clearDetail(); return; }
      const selEl=document.querySelector(`.bar[data-emp="${selected.emp}"][data-pi="${selected.partIdx}"]`); if(selEl) selEl.classList.add("sel");
      const ov=[];
      state.employees.forEach(e=>{ if(e.id===selected.emp) return;
        empDerived(e).parts.forEach((p,pi)=>{ if(p.start==null||!p.end) return;
          if(p.start<=base.end&&p.end>=base.start){
            const el=document.querySelector(`.bar[data-emp="${e.id}"][data-pi="${pi}"]`); if(el) el.classList.add("hi");
            ov.push({name:e.name,from:fmtRu(Math.max(p.start,base.start)),to:fmtRu(Math.min(p.end,base.end))});
          }
        });
      });
      for(const p of carriedParts()){
        if(p.employee.id!==selected.emp && p.start<=base.end && p.end>=base.start){
          document.querySelector(`.carry[data-emp="${p.employee.id}"][data-year="${p.year}"][data-pi="${p.pi}"]`)?.classList.add('hi');
          ov.push({name:p.employee.name+' (из '+p.year+')',from:fmtRu(Math.max(p.start,base.start)),to:fmtRu(Math.min(p.end,base.end))});
        }
      }
      const det=document.getElementById("detail"); det.classList.add("on");
      const who=ov.length?ov.map(o=>`<b>${esc(o.name)}</b> (${o.from}–${o.to})`).join(", "):"пересечений нет — сотрудник отдыхает один.";
      det.innerHTML=`Отпуск <b>${esc(nameById(selected.emp))}</b>, ${fmtRu(base.start)}–${fmtRu(base.end)} (${base.days} дн.) пересекается с: ${who}`;
    }

    // ── Conflicts ──
    function renderConflicts(){
      const occ=occupancy(); const windows=[]; let cur=null;
      for(let i=0;i<daysInYear();i++){ const c=occ[i].length;
        if(c>state.overlap){ if(!cur) cur={from:i,to:i,peak:c,ids:new Set(occ[i])}; else{ cur.to=i; if(c>cur.peak) cur.peak=c; occ[i].forEach(x=>cur.ids.add(x)); } }
        else if(cur){ windows.push(cur); cur=null; }
      }
      if(cur) windows.push(cur);
      const el=document.getElementById("conflicts");
      if(!windows.length){ el.innerHTML=`<div class="conf-empty">Нет дней, где одновременно отдыхает более ${state.overlap} чел. Порог можно изменить вверху.</div>`; return; }
      el.innerHTML=windows.map((w,wi)=>{
        const from=fmtRu(yearStart()+w.from*DAY),to=fmtRu(yearStart()+w.to*DAY);
        const ids=Array.from(w.ids);
        const names=ids.map(nameById).join(", ");
        const byPos=Object.create(null);
        const roster=chartEmployees();
        // Count positions on each date, not the union of everyone in a long overload window.
        for(let day=w.from;day<=w.to;day++){
          const daily=Object.create(null);
          for(const id of occ[day]){const emp=roster.find(e=>e.id===id),pos=(emp?.position||'').trim();if(pos)(daily[pos]??=[]).push(emp.name||'?');}
          for(const [pos,people] of Object.entries(daily))if(people.length>(byPos[pos]?.length||0))byPos[pos]=people;
        }
        const roleHits=Object.entries(byPos).filter(([,arr])=>arr.length>=2);
        const roleHtml=roleHits.length?`<div class="conf-role">⚠ Одна должность одновременно: ${roleHits.map(([p,arr])=>`<b>${esc(p)}</b> — ${arr.length} чел. (${esc(arr.join(", "))})`).join("; ")}</div>`:"";
        return `<div class="conf" data-from="${w.from}"><span class="when">${from}–${to}</span><span class="cnt">до ${w.peak}</span><span class="who">${esc(names)}${roleHtml}</span></div>`;
      }).join("");
    }

    function renderAll(){ renderHolidays(); renderTable(); renderTimeline(); renderConflicts(); save(); }
    function clearDetail(){ const d=document.getElementById("detail"); d.classList.remove("on"); d.innerHTML=""; }

    // ── Events ──
    document.getElementById("tbl").addEventListener("input",ev=>{
      const inp=ev.target.closest("input"); if(!inp) return;
      const tr=inp.closest("tr"); const e=state.employees.find(x=>x.id===tr.dataset.emp); if(!e) return;
      const f=inp.dataset.f;
      if(f==="name"||f==="position"){ e[f]=inp.value.slice(0,250); renderTimeline(); renderFlags(); renderConflicts(); save(); }
      else{
        const pi=+inp.dataset.pi; const arr=partsFor(e); if(!arr[pi]) arr[pi]={start:"",days:0};
        if(f==="start"){
          const valid=!inp.value||(parse(inp.value)!==null&&+inp.value.slice(0,4)>=2000&&+inp.value.slice(0,4)<=2100);
          inp.setCustomValidity(valid?'':'Дата должна быть в диапазоне 2000–2100');
          if(!valid){inp.reportValidity();return;}
          arr[pi].start=inp.value;
        }
        if(f==="days"){ const v=parseInt(inp.value,10); arr[pi].days=isNaN(v)?0:Math.max(0,Math.min(366,v)); if(v>366||v<0)inp.value=arr[pi].days; }
        const d=empDerived(e),dp=d.parts[pi];
        const endCell=tr.querySelectorAll("td.end")[pi];
        if(endCell){ const txt=dp&&dp.end?fmtRu(dp.end)+"."+new Date(dp.end).getUTCFullYear():"—"; endCell.classList.toggle("shift",!!(dp&&dp.hols>0));
          const btn=endCell.querySelector(".pdel"); endCell.textContent=txt; if(btn) endCell.appendChild(btn);
        }
        const chips=tr.querySelectorAll(".chip");
        chips[0].textContent=d.used; chips[0].className="chip "+(d.used>state.annual?"bad":"used");
        chips[1].textContent=d.left; chips[1].className="chip "+(d.left<0?"left bad":(d.left===0?"left zero":"left pos"));
        renderFlags(); renderTimeline(); renderConflicts(); save();
      }
    });

    document.getElementById("tbl").addEventListener("click",ev=>{
      const btn=ev.target.closest("button"); if(!btn) return;
      const tr=btn.closest("tr"); const e=state.employees.find(x=>x.id===tr.dataset.emp); if(!e) return;
      const act=btn.dataset.act;
      if(act==="addpart"){ const arr=partsFor(e); if(arr.length<MAXP){ arr.push({start:"",days:0}); selected=null; clearDetail(); renderAll(); } }
      else if(act==="delpart"){ const pi=+btn.dataset.pi;
        if(!confirm(`Удалить часть ${pi+1} отпуска сотрудника «${e.name||"без имени"}»?`)) return;
        partsFor(e).splice(pi,1); selected=null; clearDetail(); renderAll(); }
      else if(act==="delemp"){
        if(!confirm(`Удалить сотрудника «${e.name||"без имени"}» из выбранного года (история других лет сохранится)?`)) return;
        const rid=e.id;
        state.employees=state.employees.filter(x=>x.id!==rid);
        if(state.schedules[yearKey()]) delete state.schedules[yearKey()][rid];
        state.rosters[yearKey()]=state.employees;
        selected=null; clearDetail(); renderAll(); }
    });

    document.getElementById("btnAdd").onclick=()=>{
      if(state.employees.length>=2000){alert('Допустимо до 2000 сотрудников в одном году');return;}
      const _ne=withId({name:"",position:""});
      state.employees.push(_ne);
      partsFor(_ne).push({start:"",days:0});
      renderAll();
      const input=document.querySelector('#tbl tbody tr:last-child input[data-f="name"]');
      input?.focus(); input?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
    };

    document.getElementById("tl").addEventListener("click",ev=>{
      const bar=ev.target.closest(".bar");
      if(!bar){ selected=null; clearDetail(); renderTimeline(); return; }
      if(bar.dataset.year){setYear(+bar.dataset.year);return;}
      const id=bar.dataset.emp,pi=+bar.dataset.pi;
      if(selected&&selected.emp===id&&selected.partIdx===pi){ selected=null; clearDetail(); } else selected={emp:id,partIdx:pi};
      renderTimeline();
    });

    document.getElementById("conflicts").addEventListener("click",ev=>{
      const c=ev.target.closest(".conf"); if(!c) return;
      document.querySelector(".tl-scroll").scrollTo({left:Math.max(0,(+c.dataset.from)*DAYW-120),behavior:"smooth"});
    });

    document.getElementById("setAnnual").onchange=ev=>{ const v=parseInt(ev.target.value,10); state.annual=isNaN(v)?28:Math.max(1,Math.min(366,v)); ev.target.value=state.annual; renderAll(); };
    document.getElementById("setOverlap").onchange=ev=>{ const v=parseInt(ev.target.value,10); state.overlap=isNaN(v)?2:Math.max(1,Math.min(2000,v)); ev.target.value=state.overlap; renderAll(); };

    function setYear(y){
      y=Math.max(2000,Math.min(2100,parseInt(y,10)||state.year));
      state.rosters[yearKey()]=state.employees;
      state.yearSettings[yearKey()]={annual:state.annual,overlap:state.overlap};
      if(!state.rosters[String(y)])state.rosters[String(y)]=JSON.parse(JSON.stringify(state.employees));
      if(!state.yearSettings[String(y)])state.yearSettings[String(y)]={annual:state.annual,overlap:state.overlap};
      state.year=y; state.employees=state.rosters[String(y)]; ensureYear(y); selected=null; clearDetail();
      Object.assign(state,state.yearSettings[String(y)]);
      document.getElementById('setAnnual').value=state.annual;
      document.getElementById('setOverlap').value=state.overlap;
      document.getElementById("yInput").value=y;
      document.title="График отпусков "+y;
      renderAll();
    }
    document.getElementById("yPrev").onclick=()=>setYear(state.year-1);
    document.getElementById("yNext").onclick=()=>setYear(state.year+1);
    document.getElementById("yInput").onchange=ev=>setYear(ev.target.value);

    // ── Export ──
    function tableRows(){
      const maxParts=Math.max(4,...state.employees.map(e=>partsFor(e).length));
      const head=["Сотрудник","Должность"];
      for(let i=0;i<maxParts;i++) head.push(`Начало ${i+1}`,`Дней ${i+1}`,`Конец ${i+1}`);
      head.push("Положено","Израсходовано","Осталось");
      const rows=[head];
      state.employees.forEach(e=>{ const d=empDerived(e); const eParts=partsFor(e); const r=[e.name||"",e.position||""];
        for(let i=0;i<maxParts;i++){ const p=eParts[i],dp=d.parts[i];
          if(p){ r.push(p.start?fmtRu(parse(p.start))+"."+new Date(parse(p.start)).getUTCFullYear():"",p.days||"",dp&&dp.end?fmtRu(dp.end)+"."+new Date(dp.end).getUTCFullYear():""); }
          else r.push("","","");
        }
        r.push(state.annual,d.used,d.left); rows.push(r);
      });
      return rows;
    }

    function download(name,data,mime){ const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([data],{type:mime})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1500); }

    function crc32(buf){let tab=crc32.t||(crc32.t=(()=>{let t=[],c;for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})());let crc=0^-1;for(let i=0;i<buf.length;i++)crc=(crc>>>8)^tab[(crc^buf[i])&0xFF];return(crc^-1)>>>0;}
    function u8(s){return new TextEncoder().encode(s);}
    function colLetter(n){let s="";n++;while(n>0){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=(n-r-1)/26;}return s;}
    function xesc(s){return(""+s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));}
    function sheetXml(rows){let r="";rows.forEach((row,ri)=>{let cells="";row.forEach((v,ci)=>{const ref=colLetter(ci)+(ri+1);
      if(typeof v==="number"&&isFinite(v))cells+=`<c r="${ref}"><v>${v}</v></c>`;
      else if(v===""||v==null){}else cells+=`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;});
      r+=`<row r="${ri+1}">${cells}</row>`;});
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${r}</sheetData></worksheet>`;}
    function buildXlsx(rows,sheetName){
      const files=[
        ["[Content_Types].xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
        ["_rels/.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
        ["xl/workbook.xml",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xesc(sheetName).slice(0,31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
        ["xl/_rels/workbook.xml.rels",`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
        ["xl/worksheets/sheet1.xml",sheetXml(rows)]
      ];
      const enc=files.map(([name,content])=>({name:u8(name),data:u8(content)}));
      let parts=[],offset=0,central=[];
      const u16=n=>[n&255,(n>>8)&255],u32=n=>[n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];
      enc.forEach(f=>{const crc=crc32(f.data),sz=f.data.length,nl=f.name.length;
        const lh=[].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(nl),u16(0));
        parts.push(new Uint8Array(lh),f.name,f.data);
        const cd=[].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(sz),u32(sz),u16(nl),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset));
        central.push({head:new Uint8Array(cd),name:f.name});offset+=lh.length+nl+sz;
      });
      const cstart=offset;let csize=0;
      central.forEach(c=>{parts.push(c.head,c.name);csize+=c.head.length+c.name.length;});
      parts.push(new Uint8Array([].concat(u32(0x06054b50),u16(0),u16(0),u16(enc.length),u16(enc.length),u32(csize),u32(cstart),u16(0))));
      let total=parts.reduce((a,p)=>a+p.length,0),out=new Uint8Array(total),pos=0;
      parts.forEach(p=>{out.set(p,pos);pos+=p.length;});
      return out;
    }

    document.getElementById("btnXlsx").onclick=()=>{
      const bytes=buildXlsx(tableRows(),"График отпусков "+state.year);
      download(`grafik_otpuskov_${state.year}.xlsx`,bytes,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    };



    document.getElementById("btnPrint").onclick=()=>window.print();

    document.getElementById("btnSort").onclick=()=>{
      state.employees.sort((a,b)=>(a.name||"").localeCompare(b.name||"","ru",{sensitivity:"base"}));
      selected=null; clearDetail(); renderAll();
    };

    const pickerOptions={types:[{description:'База графика отпусков',accept:{'application/json':['.json']}}],excludeAcceptAllOption:true};
    let importMode='merge', exportedSnapshot=null;
    function setBusy(value, freezeEditor=false){
      busy=value;
      document.getElementById('editor').inert=value&&freezeEditor;
      for(const id of ['btnOpenDb','btnNewDb','btnWriteDb','btnReconnect','btnImport','btnRollback','btnRecovery'])document.getElementById(id).disabled=value;
      if(!value)document.getElementById('btnRollback').disabled=!state._previous;
      clearTimeout(autoTimer);
    }
    function fileError(error){
      if(error.name==='AbortError'){status('Выбор файла отменён. Текущие данные сохранены в сеансе.');return;}
      document.getElementById('autoSave').checked=false;
      status('Операция не выполнена: '+error.message+'. Можно использовать «Скачать JSON» и «Открыть JSON без подключения».');
    }
    function exportJson(){
      const text=serialized();
      parseDatabase(text);
      download(`grafik_otpuskov_all_${new Date().toISOString().replace(/[:.]/g,'-')}.json`,text,'application/json');
      exportedSnapshot=fingerprint();
      status('JSON передан браузеру для скачивания. Проверь файл в «Документах» или «Загрузках». Прямую запись эта операция не подтверждает.');
    }
    function checkpoint(){
      if(safeSet(RECOVERY,serialized())){document.getElementById('btnRecovery').hidden=false;return true;}
      if(exportedSnapshot===fingerprint())return confirm('Браузерная копия недоступна. Продолжить, если скачанный JSON уже сохранён тобой?');
      status('Не удалось создать копию перед заменой. Сначала скачай JSON текущей базы и сохрани файл.');
      return false;
    }
    function replaceState(next){
      ready=false; state=next; selected=null; clearDetail();
      zoomLevel=state._settings.zoom; tlScalePct=state._settings.tlScale;
      ensureYear(state.year);
      document.getElementById('yInput').value=state.year;
      document.getElementById('setAnnual').value=state.annual;
      document.getElementById('setOverlap').value=state.overlap;
      document.title='График отпусков '+state.year;
      renderAll(); applyZoom(zoomLevel); applyTlScale(tlScalePct);
      ready=true;
    }
    async function rememberHandle(handle){
      rememberedHandle=handle;
      document.getElementById('btnReconnect').hidden=true;
      try{await PlannerStorage.handleStore(handle);}catch{document.getElementById('cacheWarning').textContent='Доступ к файлу не удалось запомнить. При следующем открытии выбери JSON заново.';}
    }
    async function acceptOpen(raw, handle=null){
      const next=parseDatabase(raw);
      const years=Object.keys(next.rosters).sort().join(', ');
      if(!confirm(`Открыть базу за годы: ${years}? Она заменит текущую базу в окне. Для добавления лет используй «Добавить из JSON».${dirty?' Есть изменения, не подтверждённые в рабочем файле.':''}`))return;
      if(!checkpoint())return;
      replaceState(next);
      databaseHandle=handle; diskText=handle?raw:null;
      savedSnapshot=fingerprint(); dirty=false;
      document.getElementById('autoSave').checked=!!handle;
      save();
      if(handle){await rememberHandle(handle);status(`Открыт ${handle.name}. Все годы загружены. Автосохранение включено; доступ к записи может потребовать подтверждения.`);}
      else {status('JSON открыт без подключения. После изменений нажимай «Скачать JSON» или «Сохранить как базу…».');}
    }
    async function openDatabase(handle=null){
      if(busy||saving)return;
      if(!handle && !window.showOpenFilePicker){openFallback('open');return;}
      setBusy(true,true);
      try{
        if(!handle)[handle]=await window.showOpenFilePicker({...pickerOptions,multiple:false,startIn:'documents'});
        else if(await handle.queryPermission({mode:'read'})!=='granted' && await handle.requestPermission({mode:'read'})!=='granted')throw new Error('Доступ к прежнему файлу не разрешён');
        await acceptOpen(await PlannerStorage.read(handle),handle);
      }catch(e){fileError(e);}finally{setBusy(false);}
    }
    async function writeDatabase(manual=true){
      if(busy||saving)return;
      if(!databaseHandle){await saveAsDatabase();return;}
      saving=true; setBusy(true);
      const handle=databaseHandle;
      try{
        const next=validateDatabase(dump());
        next._previous=snapshot(parseDatabase(diskText));
        const fingerprintWritten=fingerprint(next), text=JSON.stringify(next,null,2);
        status('Запись в '+handle.name+'…');
        await PlannerStorage.write(handle,diskText,text,manual);
        diskText=text; state._previous=next._previous; savedSnapshot=fingerprintWritten;
        saving=false; setBusy(false); save();
        if(!dirty)status(`Сохранено и проверено: ${handle.name} · ${new Date().toLocaleTimeString('ru-RU')}`);
      }catch(e){saving=false;setBusy(false);save();fileError(e);clearTimeout(autoTimer);}
    }
    async function saveAsDatabase(){
      if(busy||saving)return;
      if(!window.showSaveFilePicker){exportJson();return;}
      setBusy(true); saving=true;let completed=false;
      try{
        const handle=await window.showSaveFilePicker({...pickerOptions,suggestedName:'grafik_otpuskov_all.json',startIn:'documents'});
        const previousText=await PlannerStorage.read(handle);
        let previous=null;
        if(previousText.trim()){
          previous=parseDatabase(previousText);
          if(!confirm('Выбран существующий JSON. Заменить его текущей базой всех лет? Предыдущая запись останется внутри файла для отката.'))return;
        }
        const next=validateDatabase(dump());
        if(previous)next._previous=snapshot(previous);
        const fingerprintWritten=fingerprint(next), text=JSON.stringify(next,null,2);
        await PlannerStorage.write(handle,previousText,text,true);
        databaseHandle=handle; diskText=text; state._previous=next._previous;
        savedSnapshot=fingerprintWritten;
        document.getElementById('autoSave').checked=true;
        await rememberHandle(handle);
        completed=true;
      }catch(e){fileError(e);}finally{
        saving=false;setBusy(false);
        if(completed){save();if(!dirty)status('База сохранена и проверена: '+databaseHandle.name+'. Автосохранение включено.');}
      }
    }
    function openFallback(mode){
      if(busy||saving)return;
      importMode=mode;
      document.getElementById('fileImport').value='';
      document.getElementById('fileImport').click();
    }
    document.getElementById('fileImport').onchange=async ev=>{
      const file=ev.target.files?.[0]; if(!file||busy||saving)return;
      setBusy(true,true);
      try{
        if(file.size>PlannerCore.MAX_BYTES)throw new Error('Файл превышает 10 МБ');
        const raw=await file.text();
        if(importMode==='open')await acceptOpen(raw);
        else{
          const incoming=parseDatabase(raw), years=Object.keys(incoming.rosters), conflicts=years.filter(y=>state.rosters[y]);
          if(!confirm(`Добавить годы ${years.sort().join(', ')} из JSON? ${conflicts.length?'Совпадающие годы '+conflicts.join(', ')+' будут заменены целиком после создания копии.':'Остальные годы сохранятся.'}`))return;
          if(!checkpoint())return;
          const next=mergeDatabases(dump(),incoming);
          replaceState(next);
          document.getElementById('autoSave').checked=false;
          save();status('Импорт проверен. Остальные годы сохранены. Проверь график и нажми «Сохранить базу»; автосохранение выключено.');
        }
      }catch(e){fileError(e);}finally{ev.target.value='';setBusy(false);}
    };
    document.getElementById('btnOpenDb').onclick=()=>openDatabase();
    document.getElementById('btnOpenFallback').onclick=()=>openFallback('open');
    document.getElementById('btnNewDb').onclick=()=>saveAsDatabase();
    document.getElementById('btnWriteDb').onclick=()=>writeDatabase(true);
    document.getElementById('btnReconnect').onclick=()=>openDatabase(rememberedHandle);
    document.getElementById('btnSave').onclick=()=>{try{exportJson();}catch(e){fileError(e);}};
    document.getElementById('btnImport').onclick=()=>openFallback('merge');
    document.getElementById('autoSave').onchange=()=>save();
    document.getElementById('btnRollback').onclick=()=>{
      if(busy||saving||!state._previous)return;
      if(!confirm('Вернуть предыдущую запись базы целиком? Все годы вернутся к ней. Текущая версия будет доступна для обратного отката.'))return;
      const previous=validateDatabase(state._previous);
      if(!checkpoint())return;
      previous._previous=snapshot(dump());
      replaceState(previous);document.getElementById('autoSave').checked=false;save();
      status('Предыдущая запись восстановлена в окне. Проверь её и сохрани базу.');
    };
    document.getElementById('btnRecovery').hidden=!safeGet(RECOVERY);
    document.getElementById('btnRecovery').onclick=()=>{
      if(busy||saving)return;
      try{
        const next=parseDatabase(safeGet(RECOVERY));
        if(!confirm('Вернуть браузерную копию перед последним открытием или импортом? Проверь годы перед сохранением в файл.'))return;
        if(!checkpoint())return;
        replaceState(next);document.getElementById('autoSave').checked=false;save();
      }catch(e){fileError(e);}
    };
    document.getElementById('btnRawCache').hidden=!loadError;
    document.getElementById('btnRawCache').onclick=()=>download('planner_recovery_raw.json',safeGet(LS)??safeGet(LEGACY_LS)??'','application/json');
    async function restoreHandle(){
      try{
        const handle=await PlannerStorage.handleStore();
        if(!handle||databaseHandle)return;
        rememberedHandle=handle;
        const button=document.getElementById('btnReconnect');
        button.hidden=false;button.textContent='Открыть прежний файл: '+handle.name;
      }catch{/* File pickers and manual download remain available without IndexedDB. */}
    }

    // ── Init ──
    document.getElementById("setAnnual").value=state.annual;
    document.getElementById("setOverlap").value=state.overlap;
    document.getElementById("yInput").value=state.year;
    document.title="График отпусков "+state.year;
    renderAll();
    window.addEventListener('resize', ()=>renderTimeline());

    function applyZoom(v){
      zoomLevel=v;
      document.querySelector('.wrap').style.zoom=v/100;
      document.getElementById('setZoomVal').textContent=v+'%';
      document.getElementById('setZoom').value=v;
      safeSet('grf_zoom',v); save();
    }
    function applyTlScale(v){
      tlScalePct=v;
      document.getElementById('setTlScaleVal').textContent=v+'%';
      document.getElementById('setTlScale').value=v;
      safeSet('grf_tlscale',v); save();
      renderTimeline();
    }
    document.getElementById('setZoom').oninput=ev=>applyZoom(+ev.target.value);
    document.getElementById('setTlScale').oninput=ev=>applyTlScale(+ev.target.value);
    applyZoom(zoomLevel);
    applyTlScale(tlScalePct);
    ready=true; save();
    status(loadError?'Не удалось открыть браузерную копию: '+loadError+'. Она не перезаписана. Сейчас показан пример.':'Рабочий файл не подключён. Открой существующую базу или сохрани текущие данные как базу.');
    restoreHandle();
})();
