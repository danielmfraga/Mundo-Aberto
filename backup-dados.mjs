// backup-dados.mjs — snapshot READ-ONLY dos dados do Supabase (Mundo Aberto)
//
// Uso:  node backup-dados.mjs
//
// Baixa todas as tabelas da campanha para backups/<AAAA-MM-DD>/ (um .json por
// tabela + um backup-<data>.json combinado). Usa só a chave anon (a mesma que
// já está no HTML público), então é impossível estragar qualquer coisa — só lê.
//
// A pasta backups/ está no .gitignore de propósito: o repo é PÚBLICO e esses
// dados (transcrições, fichas) NÃO podem ir pro git.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SB  = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';

// Tabelas da campanha (todas legíveis pela anon key). mesa_som entra quando existir.
const TABLES = ['personagens','tramas','spaces','trama_links','sessions','diario_mesa','bestas','mesa_som'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const today  = new Date().toISOString().slice(0, 10);
const OUTDIR = path.join(__dirname, 'backups', today);

async function dumpTable(t) {
  let all = [], offset = 0; const page = 1000;
  for (;;) {
    const url = `${SB}/rest/v1/${t}?select=*&limit=${page}&offset=${offset}`;
    const r = await fetch(url, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return { error: `HTTP ${r.status}: ${(await r.text()).slice(0, 160)}` };
    const rows = await r.json();
    if (!Array.isArray(rows)) return { error: 'resposta inesperada: ' + JSON.stringify(rows).slice(0, 160) };
    all = all.concat(rows);
    if (rows.length < page) break;
    offset += page;
  }
  return { rows: all };
}

console.log(`\n📸 Backup Mundo Aberto — ${today}\n`);
fs.mkdirSync(OUTDIR, { recursive: true });

const tablesObj = {}, stats = {}, errors = {};
for (const t of TABLES) {
  const res = await dumpTable(t);
  if (res.error) {
    errors[t] = res.error;
    // mesa_som pode não existir ainda — não é erro fatal
    console.log(`  ⚠️  ${t.padEnd(13)} ${res.error}`);
    continue;
  }
  tablesObj[t] = res.rows;
  stats[t] = res.rows.length;
  const file = path.join(OUTDIR, `${t}.json`);
  fs.writeFileSync(file, JSON.stringify(res.rows, null, 2));
  console.log(`  ✅ ${t.padEnd(13)} ${String(res.rows.length).padStart(5)} linhas  (${(fs.statSync(file).size/1024).toFixed(1)} KB)`);
}

const combined = { exported_at: new Date().toISOString(), version: 2, source: 'backup-dados.mjs (anon read-only)', tables: tablesObj, stats, errors };
const combFile = path.join(OUTDIR, `backup-${today}.json`);
fs.writeFileSync(combFile, JSON.stringify(combined));

console.log(`\n  📦 ${path.relative(__dirname, combFile)}  (${(fs.statSync(combFile).size/1024).toFixed(1)} KB)`);
console.log(`  📁 ${OUTDIR}\n`);
