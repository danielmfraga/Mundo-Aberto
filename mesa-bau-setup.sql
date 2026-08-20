-- ============================================================
--  BAÚ DA MESA (rodar UMA vez)
--  Cole no SQL Editor do Supabase e clique RUN.
--
--  O mestre lacra uma palavra/frase num baú. Ninguém vê o conteúdo
--  enquanto estiver lacrado. Quando alguém abre, aparece pra todos.
--
--  O LACRE É DE VERDADE: a chave anon NÃO consegue ler a coluna
--  `conteudo` de um baú fechado, nem pelo devtools. Isso é feito
--  tirando o acesso direto à tabela e deixando o cliente falar só com:
--    · a VIEW mesa_bau_publico, que devolve NULL no conteúdo enquanto
--      o baú está fechado;
--    · duas funções (guardar / abrir).
--  Sem isso o "lacre" seria só esconder na tela — e o sentido do baú
--  é justamente o conteúdo ter sido escrito ANTES e ninguém saber.
-- ============================================================

create table if not exists public.mesa_bau (
  id         bigint generated always as identity primary key,
  sala       text not null,
  rotulo     text,                     -- nome do baú (opcional), visível fechado
  conteudo   text not null,            -- o que está lacrado
  aberto     boolean not null default false,
  autor      text,                     -- quem lacrou
  aberto_por text,                     -- quem abriu
  criado_em  timestamptz default now(),
  aberto_em  timestamptz
);

create index if not exists mesa_bau_sala_idx on public.mesa_bau (sala, criado_em);

-- A tabela fica trancada: nenhuma policy e nenhum privilégio pra anon.
-- Todo acesso passa pela view e pelas funções abaixo.
alter table public.mesa_bau enable row level security;
revoke all on public.mesa_bau from anon, authenticated;

-- ------------------------------------------------------------------
--  LEITURA: a view mascara o conteúdo enquanto o baú está fechado.
--  Ela roda com os privilégios do dono (não é security_invoker), então
--  enxerga a tabela mesmo com a anon sem acesso direto.
-- ------------------------------------------------------------------
create or replace view public.mesa_bau_publico as
  select id, sala, rotulo, aberto, autor, aberto_por, criado_em, aberto_em,
         case when aberto then conteudo else null end as conteudo
    from public.mesa_bau;

grant select on public.mesa_bau_publico to anon, authenticated;

-- ------------------------------------------------------------------
--  LACRAR
-- ------------------------------------------------------------------
create or replace function public.bau_guardar(
  p_sala text, p_rotulo text, p_conteudo text, p_autor text
) returns bigint
language sql
security definer
set search_path = public
as $$
  insert into public.mesa_bau (sala, rotulo, conteudo, autor)
  values (p_sala,
          nullif(btrim(coalesce(p_rotulo, '')), ''),
          btrim(p_conteudo),
          nullif(btrim(coalesce(p_autor, '')), ''))
  returning id;
$$;

-- ------------------------------------------------------------------
--  ABRIR — devolve o conteúdo. Idempotente: abrir de novo não troca
--  quem abriu nem a hora (dois cliques ao mesmo tempo não brigam).
-- ------------------------------------------------------------------
create or replace function public.bau_abrir(p_id bigint, p_quem text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text;
begin
  update public.mesa_bau
     set aberto     = true,
         aberto_por = coalesce(aberto_por, nullif(btrim(coalesce(p_quem, '')), '')),
         aberto_em  = coalesce(aberto_em, now())
   where id = p_id
   returning conteudo into v;
  return v;
end;
$$;

-- ------------------------------------------------------------------
--  APAGAR — só baú JÁ ABERTO. A regra mora aqui, não na tela: assim
--  ninguém consegue destruir uma palavra ainda lacrada antes da hora.
--  Devolve true se apagou, false se não existe ou ainda está fechado.
-- ------------------------------------------------------------------
create or replace function public.bau_apagar(p_id bigint)
returns boolean
language sql
security definer
set search_path = public
as $$
  with removido as (
    delete from public.mesa_bau where id = p_id and aberto = true returning 1
  )
  select exists (select 1 from removido);
$$;

grant execute on function public.bau_guardar(text, text, text, text) to anon, authenticated;
grant execute on function public.bau_abrir(bigint, text)             to anon, authenticated;
grant execute on function public.bau_apagar(bigint)                  to anon, authenticated;

-- ------------------------------------------------------------------
--  CONFERIR se ficou tudo certo (opcional — pode rodar e depois apagar)
-- ------------------------------------------------------------------
-- select public.bau_guardar('teste-sql', 'Baú de teste', 'o irmão dela está vivo', 'Mestre');
--
-- -- fechado: conteudo tem que vir NULL
-- select id, rotulo, aberto, conteudo from public.mesa_bau_publico where sala = 'teste-sql';
--
-- -- abrir devolve o conteúdo
-- select public.bau_abrir((select id from public.mesa_bau_publico where sala = 'teste-sql'), 'Fulano');
--
-- -- agora sim o conteudo aparece na view
-- select id, aberto, aberto_por, conteudo from public.mesa_bau_publico where sala = 'teste-sql';
--
-- -- limpeza do teste
-- delete from public.mesa_bau where sala = 'teste-sql';

-- ------------------------------------------------------------------
--  Enquanto este SQL não for rodado, a mesa segue funcionando normal:
--  o painel do Baú só avisa que a tabela ainda não existe.
-- ------------------------------------------------------------------
