-- ============================================================
--  MESA DE SOM — setup do Supabase (rodar UMA vez)
--  Cole TUDO no SQL Editor do Supabase e clique RUN.
--  Faz: tabela + policies + bucket público + teto de 1 MB por
--  arquivo (trava no servidor) + permissão de upload anônimo.
--  Não precisa clicar em nenhuma outra tela.
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

-- 2) Bucket público "mesa-som" -------------------------------
--  file_size_limit = 1 MB (1048576 bytes) → trava real no servidor.
--  allowed_mime_types = só áudio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mesa-som', 'mesa-som', true, 1048576, array['audio/*'])
on conflict (id) do update
  set public             = true,
      file_size_limit    = 1048576,
      allowed_mime_types = array['audio/*'];

-- 3) Permissão de upload anônimo no bucket -------------------
--  (a leitura já é pública porque o bucket é público)
drop policy if exists mesa_som_upload_anon on storage.objects;
create policy mesa_som_upload_anon on storage.objects
  for insert to anon
  with check (bucket_id = 'mesa-som');

-- ------------------------------------------------------------------
--  Se a linha do passo 2 der erro de permissão no seu projeto,
--  crie o bucket pela tela (Storage → New bucket → nome "mesa-som"
--  → marque "Public" → em Additional config, File size limit = 1 MB)
--  e rode só os passos 1 e 3.
-- ------------------------------------------------------------------
