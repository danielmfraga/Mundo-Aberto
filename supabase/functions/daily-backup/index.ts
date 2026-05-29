// Edge Function: daily-backup
// Roda todo dia à meia-noite via cron
// Exporta todas as tabelas e salva no Storage (bucket: backups)
// Mantém apenas os últimos 7 backups

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; // service role para leitura total
const BUCKET = 'backups';
const MAX_BACKUPS = 7;

Deno.serve(async () => {
  try {
    const supabase = createClient(SB_URL, SB_KEY);

    // 1. Coleta todas as tabelas
    const [
      { data: personagens },
      { data: tramas },
      { data: spaces },
      { data: trama_links }
    ] = await Promise.all([
      supabase.from('personagens').select('*').order('created_at'),
      supabase.from('tramas').select('*').order('created_at'),
      supabase.from('spaces').select('*').order('created_at'),
      supabase.from('trama_links').select('*')
    ]);

    // 2. Monta o objeto de backup
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const filename = `backup-${today}.json`;
    const payload = {
      exported_at: new Date().toISOString(),
      version: 1,
      tables: { personagens, tramas, spaces, trama_links },
      stats: {
        personagens:  personagens?.length  ?? 0,
        tramas:       tramas?.length       ?? 0,
        spaces:       spaces?.length       ?? 0,
        trama_links:  trama_links?.length  ?? 0
      }
    };

    // 3. Salva no Storage (sobrescreve se já existir backup do mesmo dia)
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filename, JSON.stringify(payload), {
        contentType: 'application/json',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // 4. Lista todos os backups e apaga os mais antigos (mantém só os últimos 7)
    const { data: files } = await supabase.storage
      .from(BUCKET)
      .list('', { sortBy: { column: 'name', order: 'desc' } });

    if (files && files.length > MAX_BACKUPS) {
      const toDelete = files.slice(MAX_BACKUPS).map(f => f.name);
      await supabase.storage.from(BUCKET).remove(toDelete);
      console.log(`Apagados ${toDelete.length} backups antigos:`, toDelete);
    }

    console.log(`Backup ${filename} concluído — ${payload.stats.personagens} personagens, ${payload.stats.tramas} tramas`);

    return new Response(JSON.stringify({ ok: true, filename, stats: payload.stats }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Erro no backup:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
