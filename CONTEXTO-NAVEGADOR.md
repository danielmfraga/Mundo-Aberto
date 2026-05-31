# Contexto — Mundo Aberto · Frente "Navegador" (RAG de sessões)

> **Documento de handoff.** Gerado em 2026-05-31 extraindo o chat anterior que estourou o limite de contexto (sessão `ce00da40`). Serve pra qualquer chat novo retomar a frente da **Navegação/Forja/Diário** sem perder o fio.

---

## 1. O que é o projeto Mundo Aberto (resumo de 30s)

RPG Manager cyberpunk. **Stack vanilla** (HTML/CSS/JS puro, sem framework) + **Supabase** (Postgres + REST + Realtime + Storage) + **Vercel** (deploy + serverless functions em `/api`).

- Repo local: `C:\Users\dani0\Desktop\Nebula\Programação\Mundo-Aberto`
- Produção: `https://project-1opl1.vercel.app`
- Supabase project: `mxyqqfsyybluavwlrhsa`
- Páginas: `index.html` (home), `personagens.html`, `ficha.html`, `mestre-view.html`, `npcs.html`, `trama.html`, `tramas.html`, `ferramentas.html` (a "Forja")
- Padrão de dados: soft delete (`deleted_at`), `sbFetch` wrapper, anon key no front (sem RLS — decisão consciente, projeto ~single-user por enquanto)

---

## 2. A VISÃO da "Navegação" (o que o Daniel quer construir)

Nome provisório: **Navegação** / **Navegador**. É um sistema **RAG** (Retrieval-Augmented Generation) sobre as sessões de jogo.

**A ideia, nas palavras dele:**
- Toda sessão de RPG gera dados (transcrições do Google Meet, anotações dos jogadores, "alfarrábios").
- Quer centralizar esses dados num lugar (Supabase).
- As transcrições do Google são "babilônicas" (cheias de ruído) → precisam ser **limpas automaticamente** (extrair só o que é jogo, descartar tagarelice off-topic).
- Depois, jogadores poderão **fazer perguntas** a essa base de conhecimento ("o que aconteceu com o NPC X?", "onde encontramos o item Y?") e a IA responde com base nas sessões.

**Arquitetura aprovada (approach simplificado, SEM vector DB no início):**
- Cada sessão fica no banco como **texto inteiro** (não há chunking nem embeddings ainda).
- Cada pergunta no Navegador manda **TODAS as sessões no prompt** com **prompt caching** (corta ~90% do custo da parte fixa).
- Justificativa: Opus 4.8 tem 200K tokens de contexto (~15 sessões de 1h). Pro volume real dele, RAG completo com pgvector seria overkill no começo.
- **Quando escalar** (>15 sessões grandes): aí sim migra pra embeddings + pgvector. O endpoint deve **contar tokens antes de enviar** e dar erro claro se passar de ~150K (não ir pra produção quebrada).

---

## 3. Separação ADMIN vs PÚBLICO (decisão de arquitetura importante)

O Daniel definiu claramente dois lados:

| Quem | Onde | Faz o quê |
|---|---|---|
| **Ele (admin/mestre)** | URL privada **não-linkada** | Ingere sessões (upload de transcrição) |
| **Players (público)** | Botão visível (na Forja/home) | Consultam o Navegador (fazem perguntas) |

**Plano combinado (NÃO totalmente implementado ainda):**
1. **Diário de Bordo** (a ferramenta de ingestão) deve sair da Forja pública e ir pra uma página separada **`diario.html`**, não-linkada de lugar nenhum (URL = chave de acesso).
2. Dentro do Diário, um **toggle Ativo/Inativo** — quando ele não está fazendo upload, desativa; reativa quando precisa subir a próxima transcrição.
3. A Forja pública mostra só ferramentas públicas (hoje: Scanner de Ficha). Futuramente, o **Navegador** (painel de perguntas) aparece pros jogadores ali.

⚠️ **No estado atual o "Diário de Bordo" ESTÁ dentro de `ferramentas.html` (Forja)** — a movimentação pra `diario.html` + toggle ainda NÃO foi feita. Era um dos próximos passos.

---

## 4. O que JÁ foi implementado (Fases 1 e 2 — commit `0f41ae2`)

### Fase 1 — Banco
Tabela `sessions` criada no Supabase (o Daniel rodou o SQL):
```sql
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  session_date date,
  session_number integer,
  raw_content text not null,        -- transcrição ORIGINAL (nunca sobrescrita — segurança)
  cleaned_content text,             -- versão limpa pela IA
  summary text,
  metadata jsonb default '{}'::jsonb,  -- { npcs, locais, eventos, loot }
  space_id text references public.spaces(id),  -- NOTE: text, não uuid (legado)
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);
-- índices: sessions_active_idx (created_at desc where deleted_at is null), sessions_space_idx
```
> Pegadinha resolvida: `spaces.id` é **text**, não uuid. A FK `space_id` teve que ser text.

### Fase 2 — Ingestão
- **`/api/ingest-session.js`** (Vercel Edge Function): recebe `{ raw_content, title }`, chama Claude **Sonnet 4.6** (`claude-sonnet-4-5-20250929`) com um SYSTEM_PROMPT de "Arquivista" que limpa o transcript e retorna JSON `{ cleaned_content, summary, metadata:{npcs,locais,eventos,loot} }`. **NÃO salva no banco** — devolve pro front revisar (review-before-save).
- **UI "Diário de Bordo"** em `ferramentas.html` (~linha 463): formulário (título + textarea do transcript) → botão "Limpar Transcript" → tela de revisão editável (resumo, chips de NPCs/locais/eventos, conteúdo limpo) → botão "Arquivar no Diário" salva em `sessions`.
- Validações: tamanho mín 50 chars, review obrigatório antes de salvar.

### Outras coisas dessa mesma sessão (já no ar)
- **Scanner de Ficha** (`/api/scan-ficha.js`): Claude Vision lê ficha manuscrita (commit `4f234e2`), depois upgrade pra Opus 4.8 + prompt caching + multi-notação (`844280f`).
- **Home cinematográfica**: botões viram painéis verticais "sparkle" com animação de abertura (linha→sparkle→3 painéis). Commits `abe43db`, `e171981`, `a0bb096`.
- **Fix spaces**: espaço deletado ressuscitava ao recarregar (faltava filtro `deleted_at=is.null` no load). Commit `1258e06`.

---

## 5. O que FALTA fazer (onde o chat parou)

A última pergunta do Daniel (sem resposta — chat morreu no limite):
> "dentro de forja vai ter um painel ou botão que permite qualquer jogador fazer as perguntas para os documentos que foram upados, correto?"

**Resposta: SIM, esse é o plano.** E é exatamente a **Fase 3** que não começou:

### Fase 3 — O Navegador (consulta pública) — NÃO IMPLEMENTADO
1. **`/api/navegador.js`** (ou nome similar): endpoint que recebe a pergunta do jogador, monta prompt com TODAS as `sessions` (cleaned_content) + prompt caching, chama **Opus 4.8**, retorna resposta. Deve contar tokens antes (guard de 150K).
2. **Painel de perguntas** visível pros jogadores (na Forja `ferramentas.html` ou na home): campo de texto + histórico de Q&A.
3. **Mover o Diário** de `ferramentas.html` → `diario.html` separado (não-linkado) + toggle Ativo/Inativo.

### Pendências de segurança (adiadas a pedido dele — "chato mas importante")
- RLS continua off (anon pode DELETE de verdade via console — só a app usa soft delete).
- Endpoint de ingestão está numa página pública hoje; mover pra `diario.html` é a mitigação combinada.

---

## 6. Pegadinhas / decisões técnicas a lembrar

- **Modelos**: Sonnet 4.6 (`claude-sonnet-4-5-20250929`) pra limpeza (4× mais barato); Opus 4.8 pro Navegador (qualidade nas respostas) e pro Scanner.
- **`ANTHROPIC_API_KEY`** está nas env vars da Vercel (não no código). O endpoint lê `process.env.ANTHROPIC_API_KEY`.
- **Custo "1M context"**: o chat anterior morreu com `API Error: Usage credits required for 1M context`. Isso é do Claude Code (a ferramenta), não do app. Sem relação com a arquitetura do Navegador.
- **Sempre preservar `raw_content`** original no banco — `cleaned_content` é separado. Se a limpeza comer algo importante, o original está salvo.
- **vercel.json** já tem `Cache-Control: no-cache` pra `.html`/`.js` (resolveu bug de cache servindo JS velho).
- **Realtime** está ligado só na tabela `personagens`. Pra `tramas` (e futuramente `sessions` se quiser realtime) precisa rodar: `alter publication supabase_realtime add table <tabela>;` — isso é uma frente PARALELA, ver `MEMORY.md`.

---

## 7. Arquivos-chave dessa frente

| Arquivo | Papel |
|---|---|
| `api/ingest-session.js` | Edge function: limpa transcript via Sonnet 4.6 |
| `api/scan-ficha.js` | Edge function: lê ficha manuscrita via Opus Vision |
| `ferramentas.html` (~L463) | UI "Diário de Bordo" (ingestão) — a mover pra diario.html |
| Tabela `sessions` (Supabase) | Armazena transcrições raw + cleaned + metadata |
| `diario.html` | **NÃO EXISTE AINDA** — destino planejado do Diário |
| `api/navegador.js` | **NÃO EXISTE AINDA** — endpoint de consulta (Fase 3) |

---

## 8. Como retomar (prompt sugerido pro chat novo)

> "Lê o `CONTEXTO-NAVEGADOR.md` na raiz do projeto. Estamos na frente da Navegação (RAG de sessões). Fases 1 e 2 (tabela `sessions` + ingestão via Diário de Bordo) estão prontas. Quero seguir pra Fase 3: o Navegador — painel onde os jogadores fazem perguntas às sessões. Antes, confirma comigo o plano de mover o Diário pra `diario.html` privado."
