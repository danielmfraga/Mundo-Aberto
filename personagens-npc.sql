-- personagens-npc.sql
-- Rode DEPOIS do personagens-protecao.sql (pode rodar de novo sem estrago).
--
-- "É NPC?" deixa de depender do começo do char_id ("npc_...") e passa a ser
-- uma coluna. Assim "Mover para NPCs" é só virar a chave — a ficha mantém o
-- MESMO código, o mesmo histórico, o mesmo espaço (BOX) — em vez de criar uma
-- cópia com código novo e apagar a original.

alter table public.personagens add column if not exists eh_npc boolean not null default false;

-- quem já era NPC pelo prefixo continua sendo (o código dele nunca muda)
update public.personagens set eh_npc = true where char_id like 'npc\_%' and eh_npc = false;

-- ficha nova criada com código "npc_..." já nasce NPC
create or replace function public.personagens_npc_nasce() returns trigger
language plpgsql as $$
begin
  if new.char_id like 'npc\_%' then new.eh_npc := true; end if;
  return new;
end $$;
drop trigger if exists personagens_npc_nasce on public.personagens;
create trigger personagens_npc_nasce before insert on public.personagens
  for each row execute function public.personagens_npc_nasce();

-- conferência: quantos NPCs e quantos personagens
select eh_npc, count(*) from public.personagens where deleted_at is null group by eh_npc order by 1;
