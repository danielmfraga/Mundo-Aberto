// Vercel Cron: /api/limpar-mesa
// Apaga os anexos do chat da mesa (imagem, vídeo, áudio, PDF) com mais de
// RETENCAO_DIAS dias. Cada arquivo vive os 30 dias completos a contar do upload
// — não é faxina geral em data fixa.
//
// Por que dá pra apagar sem medo: o chat da mesa NÃO é persistido (é broadcast
// puro pelo Realtime). Anexo de sessão passada já é inalcançável pela interface;
// só ocupa espaço no bucket.
//
// Roda sozinho pelo cron declarado no vercel.json. Para conferir sem apagar
// nada, abra no navegador:  /api/limpar-mesa?dry=1
//
// Env opcionais:
//   SUPABASE_SERVICE_KEY → usa a service_role em vez da anon (recomendado)
//   CRON_SECRET          → se definida, exige Authorization: Bearer <secret>
//                          (a Vercel manda isso sozinha nas chamadas do cron)

const SB_URL = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';

const BUCKET         = 'personagens';
const PASTA          = 'mesa/';   // NUNCA fora daqui: a raiz do bucket é retrato de personagem
const RETENCAO_DIAS  = 30;
const PAGINA         = 1000;      // itens por página na listagem
const LOTE           = 100;       // arquivos por chamada de delete

const cab = { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' };

// A listagem devolve os nomes SEM o prefixo, e inclui o placeholder de pasta
// vazia (id null) — que não é arquivo e não pode entrar na conta.
async function listarPasta() {
  const itens = [];
  for (let offset = 0; ; offset += PAGINA) {
    const r = await fetch(SB_URL + '/storage/v1/object/list/' + BUCKET, {
      method: 'POST',
      headers: cab,
      body: JSON.stringify({ prefix: PASTA, limit: PAGINA, offset, sortBy: { column: 'name', order: 'asc' } })
    });
    if (!r.ok) throw new Error('list ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
    const pagina = await r.json();
    if (!Array.isArray(pagina) || pagina.length === 0) break;
    itens.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return itens.filter(o => o && o.id && o.name && o.name.indexOf('/') < 0);
}

// created_at é a fonte de verdade; o timestamp no nome do arquivo (Date.now() na
// hora do upload) só entra se o metadado vier faltando.
function nascidoEm(o) {
  const t = Date.parse(o.created_at || '');
  if (!isNaN(t)) return t;
  const m = /^(\d{10,16})_/.exec(o.name);
  return m ? Number(m[1]) : NaN;
}

async function apagar(caminhos) {
  const r = await fetch(SB_URL + '/storage/v1/object/' + BUCKET, {
    method: 'DELETE',
    headers: cab,
    body: JSON.stringify({ prefixes: caminhos })
  });
  if (!r.ok) throw new Error('delete ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200));
  return caminhos.length;
}

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  const dry = /(^|&)dry=1(&|$)/.test((req.url || '').split('?')[1] || '');

  if (segredo && (req.headers.authorization || '') !== 'Bearer ' + segredo) {
    return res.status(401).json({ ok: false, erro: 'nao autorizado' });
  }

  try {
    const itens = await listarPasta();
    const corte = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;

    const velhos = [], novos = [];
    for (const o of itens) {
      const nasc = nascidoEm(o);
      // sem data confiável o arquivo FICA — nunca apagar no escuro
      (!isNaN(nasc) && nasc < corte ? velhos : novos).push(o);
    }

    const bytes = velhos.reduce((s, o) => s + ((o.metadata && o.metadata.size) || 0), 0);
    const caminhos = velhos.map(o => PASTA + o.name).filter(c => c.startsWith(PASTA));  // cinto e suspensório

    let apagados = 0;
    if (!dry) {
      for (let i = 0; i < caminhos.length; i += LOTE) {
        apagados += await apagar(caminhos.slice(i, i + LOTE));
      }
    }

    const resumo = {
      ok: true,
      dry,
      retencaoDias: RETENCAO_DIAS,
      pasta: BUCKET + '/' + PASTA,
      encontrados: itens.length,
      vencidos: velhos.length,
      apagados,
      mantidos: novos.length,
      mbLiberados: +(bytes / 1024 / 1024).toFixed(1),
      exemplos: velhos.slice(0, 10).map(o => o.name)
    };
    console.log('[limpar-mesa]', JSON.stringify(resumo));
    return res.status(200).json(resumo);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    console.error('[limpar-mesa] erro:', msg);
    return res.status(500).json({ ok: false, erro: msg });
  }
}
