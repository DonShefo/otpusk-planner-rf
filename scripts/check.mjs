// Проверка единственного файла index.html без сборки и зависимостей: node scripts/check.mjs
// Приложение лежит в однофайловом бандле (manifest + template), поэтому проверяем распакованное содержимое.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import vm from "node:vm";

const file = new URL("../index.html", import.meta.url);
const html = readFileSync(file, "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

function block(type) {
  const m = html.match(new RegExp(`<script type="__bundler/${type}">\\s*([\\s\\S]*?)\\s*</script>`));
  if (!m) { fail(`нет блока __bundler/${type}`); return null; }
  try { return JSON.parse(m[1]); } catch (e) { fail(`блок __bundler/${type} не разбирается как JSON: ${e.message}`); return null; }
}

function syntax(name, code) {
  try { new vm.Script(code, { filename: name }); } catch (e) { fail(`синтаксическая ошибка в ${name}: ${e.message}`); }
}

// Скрипт темы в head самого index.html — выполняется до отрисовки.
const headEnd = html.indexOf("</head>");
const themeAt = html.indexOf('localStorage.getItem("zch-theme")');
if (themeAt < 0 || themeAt > headEnd) fail("скрипт темы zch-theme должен стоять в head оболочки");

const manifest = block("manifest");
const template = block("template");
const external = block("ext_resources");
if (Array.isArray(external) && external.length) fail(`внешние ресурсы бандла запрещены (работа офлайн): ${external.length}`);

let scripts = 0;
if (manifest) {
  for (const [id, asset] of Object.entries(manifest)) {
    if (!/javascript/.test(asset.mime)) continue;
    const raw = Buffer.from(asset.data, "base64");
    syntax(`manifest:${id}`, (asset.compressed ? gunzipSync(raw) : raw).toString("utf8"));
    scripts += 1;
  }
}
if (typeof template === "string") {
  for (const m of template.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/\bsrc=/.test(m[1]) || !m[2].trim()) continue;
    syntax(`template:inline#${scripts + 1}`, m[2]);
    scripts += 1;
  }
  // Данные пользователя хранятся только в localStorage и никуда не отправляются (README). Единственное сетевое
  // обращение — загрузка производственного календаря по кнопке (GET без пользовательских данных).
  // schemas.openxmlformats.org и www.w3.org — пространства имён XML для экспорта в xlsx, не запросы.
  const ALLOWED_HOSTS = new Set(["raw.githubusercontent.com", "github.com", "schemas.openxmlformats.org", "www.w3.org"]);
  for (const m of template.matchAll(/https?:\/\/([\w.-]+)/g)) {
    if (!ALLOWED_HOSTS.has(m[1])) fail(`в приложении найден неразрешённый внешний адрес: ${m[1]}`);
  }
  for (const [what, re] of [["XMLHttpRequest", /XMLHttpRequest/], ["sendBeacon", /sendBeacon/], ["WebSocket", /WebSocket/], ["POST-запрос", /method\s*:\s*["']POST/i]]) {
    if (re.test(template)) fail(`в приложении найден запрещённый сетевой вызов: ${what}`);
  }
  for (const must of ["localStorage", "@media print"]) if (!template.includes(must)) fail(`в приложении нет ожидаемого «${must}»`);
}
if (scripts < 2) fail(`найдено скриптов для проверки: ${scripts}, ожидалось не меньше 2`);

if (errors.length) {
  console.error(errors.map((e) => `✖ ${e}`).join("\n"));
  process.exit(1);
}
console.log(`index.html: ${(html.length / 1024).toFixed(0)} КБ, скриптов проверено: ${scripts}, ошибок нет`);
