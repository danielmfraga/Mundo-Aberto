// Vercel Serverless Function: /api/jaas-webhook
// Recebe eventos do JaaS. Foco: TRANSCRIPTION_UPLOADED → baixa o transcript pelo
// preAuthenticatedLink e guarda no Supabase Storage.
//
// v1 = CAPTURA + LOG: ainda não sabemos o formato exato do arquivo (a doc diz
// "compactado/binário"). Então aqui a gente guarda o arquivo cru e loga tudo
// (headers, content-type, tamanho). No primeiro teste real, inspecionamos o
// formato e a v2 passa a PARSEAR o texto e INGERIR no Diário de Bordo (RAG).

const SB_URL = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';

export default async function handler(req, res) {
  // GET = teste rápido no navegador ("webhook ativo")
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, note: 'jaas-webhook ativo' });
  }

  const body = req.body || {};
  const eventType = body.eventType || body.event || 'desconhecido';

  // Log de diagnóstico (aparece nos logs da Vercel) — pra a gente ver o formato.
  console.log('[jaas-webhook] evento:', eventType);
  try { console.log('[jaas-webhook] headers:', JSON.stringify(req.headers)); } catch (e) {}
  try { console.log('[jaas-webhook] payload:', JSON.stringify(body).slice(0, 3000)); } catch (e) {}

  try {
    if (eventType === 'TRANSCRIPTION_UPLOADED' || eventType === 'RECORDING_UPLOADED') {
      const link = body.data && body.data.preAuthenticatedLink;
      if (link) {
        const r = await fetch(link);
        const ct = r.headers.get('content-type') || 'application/octet-stream';
        const buf = Buffer.from(await r.arrayBuffer());
        const isRec = eventType === 'RECORDING_UPLOADED';
        const path = (isRec ? 'gravacoes/' : 'transcricoes/') + Date.now() + '_' +
          Math.random().toString(36).slice(2, 7) + (isRec ? '.mp4' : '.txt');

        await fetch(SB_URL + '/storage/v1/object/personagens/' + path, {
          method: 'POST',
          headers: {
            'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
            'Content-Type': ct, 'x-upsert': 'true'
          },
          body: buf
        });

        const publicUrl = SB_URL + '/storage/v1/object/public/personagens/' + path;
        console.log('[jaas-webhook] guardado:', publicUrl, '| content-type:', ct, '| bytes:', buf.length);
        // Mostra um trechinho se parecer texto (pra inspecionar o formato sem baixar)
        if (/text|json|vtt|plain/i.test(ct)) {
          console.log('[jaas-webhook] preview:', buf.toString('utf8').slice(0, 800));
        }
      } else {
        console.log('[jaas-webhook] sem preAuthenticatedLink no payload.');
      }
    }
  } catch (e) {
    console.error('[jaas-webhook] erro:', e && (e.message || e));
  }

  // Sempre 200 — senão o JaaS reenvia o evento.
  return res.status(200).json({ ok: true });
}
