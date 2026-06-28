// Vercel Serverless Function: /api/jaas-webhook
// Recebe eventos do JaaS.
// TRANSCRIPTION_UPLOADED → baixa o transcript e guarda no bucket "sessoes" do Supabase Storage.
// RECORDING_UPLOADED     → mesmo fluxo, subpasta "gravacoes/".
//
// Pré-requisito: criar bucket "sessoes" no Supabase (Storage → New bucket → name: sessoes → public: false).
// Se quiser testar se o endpoint está vivo: GET /api/jaas-webhook → { ok: true }

const SB_URL = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';
const BUCKET = 'sessoes';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, note: 'jaas-webhook ativo' });
  }

  const body = req.body || {};
  const eventType = body.eventType || body.event || 'desconhecido';

  console.log('[jaas-webhook] evento:', eventType);
  try { console.log('[jaas-webhook] payload:', JSON.stringify(body).slice(0, 3000)); } catch (e) {}

  try {
    const isTranscript  = eventType === 'TRANSCRIPTION_UPLOADED';
    const isRecording   = eventType === 'RECORDING_UPLOADED';

    if (isTranscript || isRecording) {
      const link = body.data && body.data.preAuthenticatedLink;

      if (!link) {
        console.log('[jaas-webhook] sem preAuthenticatedLink no payload — nada a fazer.');
        return res.status(200).json({ ok: true });
      }

      // Baixa o arquivo do link temporário gerado pelo JaaS
      const r = await fetch(link);
      if (!r.ok) {
        console.error('[jaas-webhook] erro ao baixar o arquivo:', r.status, r.statusText);
        return res.status(200).json({ ok: true });
      }

      const ct  = r.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await r.arrayBuffer());

      // Nomeia o arquivo com timestamp + roomName (se vier no payload)
      const room = (body.data && body.data.roomName) ? body.data.roomName.replace(/[^a-z0-9_-]/gi, '_') : 'sala';
      const ts   = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const ext  = isRecording ? '.mp4' : (ct.includes('vtt') ? '.vtt' : '.txt');
      const folder = isRecording ? 'gravacoes' : 'transcricoes';
      const path = folder + '/' + ts + '_' + room + ext;

      const upload = await fetch(SB_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
        method: 'POST',
        headers: {
          'apikey': SB_KEY,
          'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': ct,
          'x-upsert': 'true'
        },
        body: buf
      });

      if (!upload.ok) {
        const errText = await upload.text().catch(() => '');
        console.error('[jaas-webhook] upload falhou:', upload.status, errText);
      } else {
        console.log('[jaas-webhook] salvo em:', BUCKET + '/' + path, '| bytes:', buf.length, '| content-type:', ct);
        // Preview do conteúdo se for texto (VTT, plain text etc.)
        if (/text|json|vtt|plain/i.test(ct)) {
          console.log('[jaas-webhook] preview:\n', buf.toString('utf8').slice(0, 1000));
        }
      }
    }
  } catch (e) {
    console.error('[jaas-webhook] erro inesperado:', e && (e.message || e));
  }

  // Sempre 200 — senão o JaaS reenvia o evento indefinidamente.
  return res.status(200).json({ ok: true });
}
