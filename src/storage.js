/* File writes compare the loaded bytes and verify the closed stream before reporting success. */
globalThis.PlannerStorage = (() => {
  'use strict';
  async function read(handle) {
    const file = await handle.getFile();
    if (file.size > PlannerCore.MAX_BYTES) throw new Error('База превышает 10 МБ');
    return file.text();
  }
  async function write(handle, expected, next, requestPermission = false) {
    if (new TextEncoder().encode(next).length > PlannerCore.MAX_BYTES) throw new Error('База превышает 10 МБ');
    const options = {mode:'readwrite'};
    let permission = await handle.queryPermission(options);
    if (permission !== 'granted' && requestPermission) permission = await handle.requestPermission(options);
    if (permission !== 'granted') throw new Error('Нет доступа к записи. Нажми «Сохранить базу» для повторного разрешения или скачай JSON');
    let stream;
    try {
      // Exclusive mode locks writers in supporting Chromium versions; compare after acquiring the lock.
      stream = await handle.createWritable({mode:'exclusive'});
      if (await read(handle) !== expected) throw new Error('Файл изменён вне этой вкладки. Запись остановлена. Скачай копию текущих данных, затем открой изменённую базу и импортируй нужные годы');
      await stream.write(next);
      await stream.close();
      stream = null;
      if (await read(handle) !== next) throw new Error('Не удалось подтвердить содержимое после записи. Скачай копию JSON и проверь файл');
    } catch (error) {
      if (stream) { try { await stream.abort(); } catch {} }
      throw error;
    }
    return next;
  }
  function handleStore(value) {
    const writing = arguments.length > 0;
    return new Promise((resolve,reject) => {
      const open = indexedDB.open('otpusk-planner-files',1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('Хранилище доступа занято другой вкладкой'));
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('handles',writing?'readwrite':'readonly');
        const request = writing ? tx.objectStore('handles').put(value,'working') : tx.objectStore('handles').get('working');
        let result;
        request.onsuccess = () => {result=request.result;};
        tx.oncomplete = () => {db.close();resolve(result);};
        tx.onerror = tx.onabort = () => {db.close();reject(tx.error);};
      };
    });
  }
  return {read,write,handleStore};
})();
