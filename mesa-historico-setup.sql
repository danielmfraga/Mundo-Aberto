-- ============================================================
--  LINHA DO TEMPO / HISTÓRICO DO CONTEXTO DA MESA (rodar UMA vez)
--  Cole no SQL Editor do Supabase e clique RUN.
--
--  Cada vez que alguém edita a data/contexto no topo da mesa
--  (ex: "DIA 13 JUNHO DE 2026"), vira uma linha aqui.
--  O valor ATUAL é a linha mais recente; o HISTÓRICO é a lista.
--  Bônus: o contexto para de viver só no localStorage.
-- ============================================================

create table if not exists public.mesa_ctx_hist (
  id         bigint generated always as identity primary key,
  sala       text not null,
  texto      text not null,          -- ex: 'DIA 13 JUNHO DE 2026'
  autor      text,                   -- quem mudou (nome na mesa)
  criado_em  timestamptz default now()
);

-- busca do valor atual e da lista é sempre por sala + mais recente primeiro
create index if not exists mesa_ctx_hist_sala_idx
  on public.mesa_ctx_hist (sala, criado_em desc);

alter table public.mesa_ctx_hist enable row level security;

-- Leitura e inserção liberadas para a chave anon
-- (mesmo padrão do resto da mesa: chat, diário, mesa de som)
drop policy if exists mesa_ctx_hist_select_anon on public.mesa_ctx_hist;
create policy mesa_ctx_hist_select_anon on public.mesa_ctx_hist
  for select using (true);

drop policy if exists mesa_ctx_hist_insert_anon on public.mesa_ctx_hist;
create policy mesa_ctx_hist_insert_anon on public.mesa_ctx_hist
  for insert with check (true);

-- DELETE: pra apagar uma entrada inserida errada (o ✕ na lista)
drop policy if exists mesa_ctx_hist_delete_anon on public.mesa_ctx_hist;
create policy mesa_ctx_hist_delete_anon on public.mesa_ctx_hist
  for delete using (true);

-- ------------------------------------------------------------------
--  Só isso. A mesa passa a gravar cada mudança e o 🕘 ao lado da
--  data abre a lista. Enquanto a tabela não existir, a mesa segue
--  funcionando normal (o histórico só avisa que não carregou).
-- ------------------------------------------------------------------
