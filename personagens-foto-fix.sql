-- ============================================================
--  CORRIGIR "não deixa atualizar a foto" na ficha (rodar UMA vez)
--  Cole no SQL Editor do Supabase e clique RUN.
--
--  SINTOMA: a primeira foto de um personagem sobe normal; trocar a
--  foto depois não funciona (e, até agora, falhava sem avisar nada).
--
--  CAUSA: a ficha salva sempre no MESMO caminho (<char_id>.jpg) com
--  x-upsert. Arquivo novo é INSERT — permitido. Arquivo que já existe
--  é UPDATE — e o bucket `personagens` só tem policy de INSERT pra
--  chave anon. O Storage responde:
--      400 / "new row violates row-level security policy"
--
--  Confirmado na mão em 2026-08-23: gravar caminho novo dá 200,
--  regravar o mesmo caminho dá 400.
-- ============================================================

drop policy if exists "personagens_update_anon" on storage.objects;

create policy "personagens_update_anon"
  on storage.objects
  for update
  to anon, authenticated
  using      (bucket_id = 'personagens')
  with check (bucket_id = 'personagens');

-- ------------------------------------------------------------------
--  CONFERIR (opcional): lista as policies do bucket depois de rodar.
--  Tem que aparecer uma linha com cmd = UPDATE.
-- ------------------------------------------------------------------
-- select policyname, cmd, roles
--   from pg_policies
--  where schemaname = 'storage' and tablename = 'objects'
--    and qual like '%personagens%'
--  order by cmd;
