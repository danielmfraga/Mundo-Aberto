-- ============================================================
--  MESA DE SOM — setup do Supabase (rodar UMA vez)
--  Cole no SQL Editor do Supabase e execute.
-- ============================================================

-- 1) Tabela de metadados dos áudios ---------------------------
create table if not exists public.mesa_som (
  id         bigint generated always as identity primary key,
  nome       text not null,
  tags       text[] default '{}',      -- ex: {'mistério','tensão'}
  url        text not null,            -- URL pública do arquivo no Storage
  criado_em  timestamptz default now()
);

alter table public.mesa_som enable row level security;

-- Leitura e inserção liberadas para a chave anon
-- (mesmo padrão do resto da mesa: chat, diário, personagens)
drop policy if exists mesa_som_select_anon on public.mesa_som;
create policy mesa_som_select_anon on public.mesa_som
  for select using (true);

drop policy if exists mesa_som_insert_anon on public.mesa_som;
create policy mesa_som_insert_anon on public.mesa_som
  for insert with check (true);

-- 2) Bucket de Storage ----------------------------------------
--  NO PAINEL: Storage → New bucket → nome "mesa-som" → marque "Public bucket" → Save.
--  (bucket público = leitura pública dos áudios via getPublicUrl)

-- 3) Política de upload anônimo no bucket ---------------------
--  Necessária para o botão "＋ Adicionar áudio" da mesa funcionar.
--  (rode DEPOIS de criar o bucket acima)
drop policy if exists mesa_som_upload_anon on storage.objects;
create policy mesa_som_upload_anon on storage.objects
  for insert to anon
  with check (bucket_id = 'mesa-som');

-- ------------------------------------------------------------------
--  Se preferir NÃO permitir upload pela mesa (só via painel do
--  Supabase), pule o passo 3 e suba os arquivos manualmente no
--  bucket; depois insira as linhas à mão, ex:
--
--  insert into public.mesa_som (nome, tags, url) values
--    ('Chuva na floresta', array['natureza','calmo'],
--     'https://mxyqqfsyybluavwlrhsa.supabase.co/storage/v1/object/public/mesa-som/chuva.mp3');
-- ------------------------------------------------------------------
