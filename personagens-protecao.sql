-- personagens-protecao.sql
-- Cole no SQL Editor do Supabase e rode UMA vez (pode rodar de novo sem estrago).
--
-- Objetivo: uma ficha nunca vira outra, nunca perde o código, nunca some.
--   1. char_id ÚNICO (hoje não é: o Uryn do Tiago tem 2 linhas com o mesmo código).
--   2. O TIPO da ficha (dnd / vampiro / cacador / futuros) é imutável.
--   3. char_id é imutável.
--   4. Apagar de verdade é proibido (apagar = marcar deleted_at).
--   5. Toda mudança relevante guarda a versão anterior em personagens_arquivo
--      (append-only) — inclusive "ficha encolheu de repente" e "ficha apagada".
--
-- Não mexe em nenhuma coluna de dado dos personagens. Só renomeia o char_id
-- de uma linha DUPLICADA (a apagada) pra liberar a unicidade.

-- ── 1. duplicatas: mantém a linha viva (ou a mais antiga) e renomeia as outras ──
update public.personagens p
   set char_id = p.char_id || '__dup_' || left(p.id::text, 8)
  from (
    select id,
           row_number() over (
             partition by char_id
             order by (deleted_at is null) desc, created_at asc, id
           ) as rn
      from public.personagens
  ) d
 where d.id = p.id and d.rn > 1;

-- ── 2. unicidade ──
alter table public.personagens alter column char_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'personagens_char_id_unico') then
    alter table public.personagens add constraint personagens_char_id_unico unique (char_id);
  end if;
end $$;

-- ── 3. arquivo (append-only) ──
create table if not exists public.personagens_arquivo (
  arquivo_id   bigint generated always as identity primary key,
  char_id      text        not null,
  motivo       text        not null,
  arquivado_em timestamptz not null default now(),
  linha        jsonb       not null
);
create index if not exists personagens_arquivo_char on public.personagens_arquivo (char_id, arquivado_em desc);
alter table public.personagens_arquivo enable row level security;
drop policy if exists personagens_arquivo_leitura on public.personagens_arquivo;
create policy personagens_arquivo_leitura on public.personagens_arquivo for select using (true);
-- sem policy de insert/update/delete: ninguém de fora mexe; só o gatilho (security definer) grava.

-- ── 4. tipo da ficha (mesma regra do ficha-guard.js) ──
create or replace function public.personagens_tipo(sd jsonb) returns text
language sql immutable as $$
  select case
           when sd is null or jsonb_typeof(sd) <> 'object' then null
           when sd ? 'sheet_type'                           then sd->>'sheet_type'
           when sd ? 'vtmFields'                            then 'vampiro'
           else 'cacador'
         end
$$;

-- ── 5. gatilho de proteção ──
create or replace function public.personagens_protege() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  t_old text; t_new text; ultimo timestamptz; motivo text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Ficha não pode ser apagada de verdade (%). Apagar = marcar deleted_at.', old.char_id;
  end if;

  if new.char_id is distinct from old.char_id then
    raise exception 'O código da ficha (char_id) nunca muda: % → %', old.char_id, new.char_id;
  end if;

  if new.sheet_data is distinct from old.sheet_data then
    if new.sheet_data is null or jsonb_typeof(new.sheet_data) <> 'object' then
      raise exception 'Gravação recusada: sheet_data inválido em %.', old.char_id;
    end if;
    if new.sheet_data = '{}'::jsonb and old.sheet_data <> '{}'::jsonb then
      raise exception 'Gravação recusada: ficha vazia por cima de ficha preenchida (%).', old.char_id;
    end if;
    t_old := public.personagens_tipo(old.sheet_data);
    t_new := public.personagens_tipo(new.sheet_data);
    if t_old is not null and t_new is distinct from t_old then
      raise exception 'Uma ficha não vira outra: % é "%" e a gravação era "%".', old.char_id, t_old, t_new;
    end if;

    select max(arquivado_em) into ultimo from public.personagens_arquivo where char_id = old.char_id;
    if length(new.sheet_data::text) < 0.5 * length(old.sheet_data::text) then
      motivo := 'encolheu';
    elsif ultimo is null or ultimo < now() - interval '5 minutes' then
      motivo := 'edicao';
    end if;
    if motivo is not null then
      insert into public.personagens_arquivo (char_id, motivo, linha) values (old.char_id, motivo, to_jsonb(old));
    end if;
  end if;

  if old.deleted_at is null and new.deleted_at is not null then
    insert into public.personagens_arquivo (char_id, motivo, linha) values (old.char_id, 'apagado', to_jsonb(old));
  end if;

  return new;
end $$;

drop trigger if exists personagens_protege_upd on public.personagens;
create trigger personagens_protege_upd before update on public.personagens
  for each row execute function public.personagens_protege();

drop trigger if exists personagens_protege_del on public.personagens;
create trigger personagens_protege_del before delete on public.personagens
  for each row execute function public.personagens_protege();

create or replace function public.personagens_sem_truncate() returns trigger
language plpgsql as $$
begin
  raise exception 'TRUNCATE em personagens é proibido.';
end $$;
drop trigger if exists personagens_protege_trunc on public.personagens;
create trigger personagens_protege_trunc before truncate on public.personagens
  for each statement execute function public.personagens_sem_truncate();

-- ── conferência: deve listar 0 duplicatas ──
select char_id, count(*) from public.personagens group by char_id having count(*) > 1;
