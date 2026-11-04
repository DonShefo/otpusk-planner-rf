import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
export function build() {
  const scripts = ['core', 'storage', 'calendar', 'app'].map(name => {
    const code = readFileSync(new URL(`src/${name}.js`, root), 'utf8');
    if (/<\/script/i.test(code)) throw new Error(`Unsafe closing script in ${name}`);
    return `<script id="planner-${name}">\n${code}</script>`;
  }).join('\n');
  return readFileSync(new URL('src/planner.html', root), 'utf8').replace('<!-- PLANNER_SCRIPTS -->', scripts);
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  writeFileSync(new URL('index.html', root), build());
  console.log('Built offline index.html');
}
