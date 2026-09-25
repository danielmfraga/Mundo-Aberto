// backup-dados.mjs — snapshot READ-ONLY dos dados do Supabase (Mundo Aberto)
//
// Uso:  node backup-dados.mjs
//
// Salva em backups/<AAAA-MM-DD>/:
//   tabelas/<tabela>.json        uma por tabela da campanha
//   storage/personagens/...      os arquivos do bucket público (fotos, fichas
//                                de D&D, fundos) com a mesma estrutura de pastas
//   MANIFESTO.json               o que entrou, quantos itens, quanto pesa
//
// Usa só a chave anon (a mesma que já está no HTML público), então é
// impossível estragar qualquer coisa: só lê.
//
// A pasta backups/ está no .gitignore de propósito: o repo é PÚBLICO e esses
// dados (transcrições, fichas, fotos) NÃO podem ir pro git.
//
// O QUE ESTE BACKUP **NÃO** ALCANÇA, e você precisa saber:
//   - bucket `sessoes` (gravações e transcrições cruas) — é privado, e com a
//     chave anon ele responde igualzinho a "vazio". O TEXTO das sessões está
//     salvo, porque mora na tabela `sessions`; os arquivos originais, não.
//   - bucket `mesa-som` (áudios do soundboard) — mesma coisa.
//   - estrutura do banco (colunas, políticas, funções). Isto aqui é o
//     CONTEÚDO, não o esquema.
//   Pra esses dois buckets, só pelo painel do Supabase ou com a service key.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SB = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Todas as tabelas da campanha que a anon consegue ler (conferido em 2026-09-25)
const TABLES = [
  'personagens', 'tramas', 'spaces', 'trama_links', 'sessions',
  'diario_mesa', 'bestas', 'mesa_som', 'mesa_ctx_hist', 'mesa_bau_publico',
];
const BUCKETS = ['personagens'];   // os outros são privados: ver o aviso acima

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hoje = new Date().toISOString().slice(0, 10);
const OUT = path.join(__dirname, 'backups', hoje);

function kb(n) { return (n / 1024).toFixed(0) + ' KB'; }

async function baixaTabela(t) {
  let todas = [], offset = 0;
  const pagina = 1000;
  for (;;) {
    const r = await fetch(`${SB}/rest/v1/${t}?select=*&limit=${pagina}&offset=${offset}`, { headers: H });
    if (!r.ok) return { erro: `HTTP ${r.status}: ${(await r.text()).slice(0, 160)}` };
    const linhas = await r.json();
    if (!Array.isArray(linhas)) return { erro: 'resposta inesperada' };
    todas = todas.concat(linhas);
    if (linhas.length < pagina) break;
    offset += pagina;
  }
  return { linhas: todas };
}

// O list do Storage devolve arquivos e pastas juntos; pasta vem com id null.
async function lista(bucket, prefixo) {
  const r = await fetch(`${SB}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: prefixo, limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!r.ok) return [];
  const itens = await r.json();
  return Array.isArray(itens) ? itens : [];
}

async function baixaBucket(bucket) {
  const arquivos = [];
  async function anda(prefixo, nivel) {
    if (nivel > 3) return;   // trava de segurança contra pasta circular
    for (const item of await lista(bucket, prefixo)) {
      const nome = item.name;
      if (!nome) continue;
      const caminho = prefixo ? `${prefixo}${nome}` : nome;
      if (item.id === null) { await anda(`${caminho}/`, nivel + 1); continue; }
      const r = await fetch(`${SB}/storage/v1/object/public/${bucket}/${caminho}`);
      if (!r.ok) { arquivos.push({ caminho, erro: `HTTP ${r.status}` }); continue; }
      const dados = Buffer.from(await r.arrayBuffer());
      const destino = path.join(OUT, 'storage', bucket, caminho);
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, dados);
      arquivos.push({ caminho, bytes: dados.length });
    }
  }
  await anda('', 0);
  return arquivos;
}

console.log(`\nBackup do Mundo Aberto — ${hoje}\n${'─'.repeat(52)}`);
fs.mkdirSync(path.join(OUT, 'tabelas'), { recursive: true });

const manifesto = { data: new Date().toISOString(), tabelas: {}, storage: {}, naoAlcancado: [
  'bucket sessoes (privado) — o texto das sessões está salvo na tabela sessions',
  'bucket mesa-som (privado) — áudios do soundboard',
  'estrutura do banco: colunas, políticas e funções',
] };

console.log('\nTABELAS');
for (const t of TABLES) {
  const r = await baixaTabela(t);
  if (r.erro) {
    console.log(`  ✗ ${t.padEnd(20)} ${r.erro}`);
    manifesto.tabelas[t] = { erro: r.erro };
    continue;
  }
  const txt = JSON.stringify(r.linhas, null, 2);
  fs.writeFileSync(path.join(OUT, 'tabelas', `${t}.json`), txt);
  console.log(`  ✓ ${t.padEnd(20)} ${String(r.linhas.length).padStart(5)} linhas   ${kb(txt.length)}`);
  manifesto.tabelas[t] = { linhas: r.linhas.length, bytes: txt.length };
}

console.log('\nARQUIVOS (Storage)');
for (const b of BUCKETS) {
  const arquivos = await baixaBucket(b);
  const ok = arquivos.filter(a => a.bytes != null);
  const total = ok.reduce((s, a) => s + a.bytes, 0);
  console.log(`  ✓ ${b.padEnd(20)} ${String(ok.length).padStart(5)} arquivos  ${kb(total)}`);
  const falhas = arquivos.filter(a => a.erro);
  if (falhas.length) console.log(`    (${falhas.length} não baixaram)`);
  manifesto.storage[b] = { arquivos: ok.length, bytes: total, falhas: falhas.length };
}

fs.writeFileSync(path.join(OUT, 'MANIFESTO.json'), JSON.stringify(manifesto, null, 2));
console.log(`\nSalvo em  backups/${hoje}/`);
console.log('Fora do alcance da chave anon: buckets sessoes e mesa-som (privados).\n');
