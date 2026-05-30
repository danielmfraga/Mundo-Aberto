const fs = require('fs');
const html = fs.readFileSync('ficha.html', 'utf8');

// 1. Tamanho total
console.log('Tamanho total ficha.html:', (html.length / 1024).toFixed(1) + ' KB');

// 2. Manifest (assets embarcados)
const manifestEl = html.match(/<script type="__bundler\/manifest">([\s\S]*?)<\/script>/);
if (manifestEl) {
  const manifest = JSON.parse(manifestEl[1]);
  const uuids = Object.keys(manifest);
  console.log('\nAssets no manifest:', uuids.length);
  uuids.forEach(uuid => {
    const e = manifest[uuid];
    const sizeKB = (e.data.length * 3/4 / 1024).toFixed(1);
    console.log(' -', uuid.slice(0,8), '|', e.mime, '|', sizeKB, 'KB', e.compressed ? '(gzip)' : '');
  });
}

// 3. Template: tamanho e estrutura
const tplStart = html.indexOf('<script type="__bundler/template">');
const tplEnd   = html.indexOf('</script>', tplStart);
const tplRaw   = html.slice(tplStart + '<script type="__bundler/template">'.length, tplEnd).trim();
const tpl      = JSON.parse(tplRaw);
console.log('\nTemplate HTML:', (tpl.length / 1024).toFixed(1) + 'KB');

// 4. Fontes usadas no template
const fonts = [...new Set([...tpl.matchAll(/font-family:\s*['"]?([^;'"]+)/g)].map(m => m[1].trim()))];
console.log('\nFontes referenciadas:');
fonts.forEach(f => console.log(' -', f));

// 5. Google Fonts link ja presente?
const gfLink = tpl.match(/fonts\.googleapis\.com[^"']*/);
console.log('\nGoogle Fonts link:', gfLink ? gfLink[0] : 'nenhum');

// 6. Secoes do template
const hasCss   = tpl.includes('<style>');
const hasJs    = tpl.includes('<script>');
const hasBody  = tpl.includes('<body>');
console.log('\nEstrutura do template:');
console.log(' <style>:', hasCss, '| <script>:', hasJs, '| <body>:', hasBody);

// 7. Linhas de CSS vs JS (estimativa)
const cssMatch = tpl.match(/<style>([\s\S]*?)<\/style>/g);
const jsMatch  = tpl.match(/<script>([\s\S]*?)<\/script>/g);
const cssSize  = cssMatch ? cssMatch.reduce((a,b) => a + b.length, 0) : 0;
const jsSize   = jsMatch  ? jsMatch.reduce((a,b)  => a + b.length,  0) : 0;
console.log(' CSS:', (cssSize/1024).toFixed(1)+'KB | JS:', (jsSize/1024).toFixed(1)+'KB');
