-- ============================================================
--  TESOURO DA MESA — setup do Supabase (rodar UMA vez)
--  Cole TUDO no SQL Editor do Supabase e clique RUN.
--
--  Três tabelas, mesmo padrão do resto da mesa (chave anon):
--    · mesa_tesouro         os itens que o grupo achou (um por linha)
--    · mesa_tesouro_bolsa   as moedas do grupo (uma linha por sala)
--    · mesa_tesouro_envios  itens/moedas mandados pra ficha de alguém.
--                           A ficha-dnd busca os pendentes quando abre
--                           (e a cada ~20 s), põe no inventário e marca
--                           entregue_em. Serve também de histórico.
--  Por que "envios" e não gravar direto na ficha: se o jogador estiver
--  com a ficha aberta, o salvamento dela passaria por cima do item.
-- ============================================================

-- 1) Itens do Tesouro --------------------------------------------
create table if not exists public.mesa_tesouro (
  id         bigint generated always as identity primary key,
  sala       text not null,
  cat_id     text,                      -- id do catálogo (itens-dnd.js); null = item avulso
  nome       text not null,
  qtd        integer not null default 1 check (qtd >= 1),
  peso       numeric not null default 0, -- kg, por unidade
  valor      text,                      -- ex.: '15 PO'
  raridade   text,                      -- comum | incomum | raro | muito raro | lendario
  onde       text,                      -- onde foi achado
  notas      text,
  por        text,                      -- quem registrou
  criado_em  timestamptz default now()
);
create index if not exists mesa_tesouro_sala_idx on public.mesa_tesouro (sala, criado_em);

-- 2) Moedas do grupo ----------------------------------------------
create table if not exists public.mesa_tesouro_bolsa (
  sala text primary key,
  pc   bigint not null default 0,   -- cobre
  pp   bigint not null default 0,   -- prata
  pe   bigint not null default 0,   -- electro
  po   bigint not null default 0,   -- ouro
  pl   bigint not null default 0,   -- platina
  atualizado_em timestamptz default now()
);

-- 3) Envios para fichas -------------------------------------------
create table if not exists public.mesa_tesouro_envios (
  id          bigint generated always as identity primary key,
  sala        text not null,
  char_id     text not null,            -- personagens.char_id de quem recebe
  char_nome   text,
  item        jsonb not null,           -- {id|nome, q, peso, valor, obs, raridade}  ou  {moedas:{po:10,...}}
  por         text,
  criado_em   timestamptz default now(),
  entregue_em timestamptz               -- null = ainda na estrada
);
create index if not exists mesa_tesouro_envios_pend_idx on public.mesa_tesouro_envios (char_id) where entregue_em is null;
create index if not exists mesa_tesouro_envios_sala_idx on public.mesa_tesouro_envios (sala, criado_em);

-- 4) Policies (leitura/escrita pela anon, como mesa_som e o chat) ---
do $$
declare t text;
begin
  foreach t in array array['mesa_tesouro', 'mesa_tesouro_bolsa', 'mesa_tesouro_envios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_anon_all', t);
    execute format('create policy %I on public.%I for all using (true) with check (true)', t || '_anon_all', t);
  end loop;
end $$;
