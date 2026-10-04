-- ============================================================
--  HISTÓRICO DO CHAT DA MESA — cada mensagem vive 15 dias (rodar UMA vez)
--  Cole no SQL Editor do Supabase e clique RUN. Pode rodar de novo sem estrago.
--
--  Antes o chat era só broadcast (quem não estava conectado perdia tudo).
--  Agora cada mensagem enviada (texto ou anexo) também vira uma linha aqui;
--  quem entra na mesa vê as dos últimos 15 dias. Rolagem de dados e aparte
--  do Mestre NÃO entram: não passam pelo chat.
--
--  Expiração: a mesa só LÊ os últimos 15 dias, e a faxina diária
--  (api/limpar-mesa, cron das 06:00 UTC) apaga o que passou disso.
-- ============================================================

create table if not exists public.mesa_chat (
  id        bigint generated always as identity primary key,
  sala      text        not null,
  mid       text        not null unique,   -- id da mensagem (evita duplicar entre broadcast e histórico)
  payload   jsonb       not null,          -- { autor, ts, text } ou { autor, ts, file:{...} }
  criado_em timestamptz not null default now(),
  constraint mesa_chat_tamanho check (octet_length(payload::text) < 20000)
);

create index if not exists mesa_chat_sala_idx on public.mesa_chat (sala, criado_em desc);

alter table public.mesa_chat enable row level security;

-- mesmo padrão do resto da mesa (chave anon). Sem UPDATE: mensagem não se edita.
drop policy if exists mesa_chat_select_anon on public.mesa_chat;
create policy mesa_chat_select_anon on public.mesa_chat for select using (true);

drop policy if exists mesa_chat_insert_anon on public.mesa_chat;
create policy mesa_chat_insert_anon on public.mesa_chat for insert with check (true);

-- DELETE só de mensagem JÁ VENCIDA (a faxina). Ninguém apaga mensagem viva.
drop policy if exists mesa_chat_delete_vencidas on public.mesa_chat;
create policy mesa_chat_delete_vencidas on public.mesa_chat
  for delete using (criado_em < now() - interval '15 days');

grant select, insert, delete on public.mesa_chat to anon;

-- conferência: deve devolver 0 (tabela nova, ainda vazia)
select count(*) as mensagens from public.mesa_chat;
