# Contexto de handoff — Mundo Aberto (chat de 2026-07 · Mesa de Som + linha do tempo + fichas + integração escritório)

> Gerado no fim de um chat longo, pra o próximo continuar sem perder contexto.
> Stack: **vanilla HTML/CSS/JS + Supabase + Vercel**, zero frameworks. Repo `danielmfraga/Mundo-Aberto`.
> Supabase do projeto: `mxyqqfsyybluavwlrhsa` (nome **mundo-aberto**, região sa-east-1). Anon key vai no client (é público de propósito); a proteção real seria RLS (hoje as policies são permissivas — ver "Visão SaaS").
> Deploy Vercel: domínio de produção que responde = `project-1opl1.vercel.app` (o `programacao-mundo-aberto.vercel.app` está MORTO).

---

## 1. Mesa de Som (o grosso do chat) — `mesa.html`

Soundboard de ambientação. Drawer violeta que desliza da borda direita (botão "🎵 Mesa de Som" no rail), **não-modal** e **redimensionável** (arrasta a borda esquerda; largura salva em `localStorage mesaSomW`).

- **5 pads** no topo (atalhos por usuário, `localStorage mesaSomPads:<sala>`). Cada pad mostra a **1ª TAG** do áudio (não o nome) → viram "botões de clima". Tem **fader de volume individual por pad**, sincronizado com a mesa (evento `som-gain`; ganho por faixa em `somGain`/`localStorage mesaSomGain`; volume efetivo = master × ganho).
- **Busca** por nome OU por tag/metadado.
- **Lista** com, por linha: 🎧 prévia (só quem clicou), 📢 compartilhar (toca pra todos), 📌 fixar no pad, ✏️ editar. **Arrastar** um áudio (pela `.som-row-main`) até um pad também atribui.
- **Camadas:** 🎧 e 📢 empilham até `SOM_MAX_LAYERS=5` por modo.
- **Upload:** botão único "＋ Adicionar áudio" → escolhe arquivo → botão fica **verde "Enviar"** → envia. Aceita **multi-upload**. Limite: **5 MB por arquivo** (`SOM_MAX_KB=5120`), **sem teto de quantidade** (o cap de 50 foi removido).
- **Renomear** nome+tags e **excluir** (linha + arquivo do Storage) pelo ✏️ → 🗑️.
- **Sync:** Realtime broadcast no canal `mesa:<sala>`, eventos `som-play/som-stop/som-state/som-state-req/som-lib/som-gain`. Canal usa `broadcast:{self:true}` → clique só faz `send()`, o `dispatch` executa (um caminho só p/ mim e p/ todos).

**Supabase (setup em `mesa-som-setup.sql`, JÁ RODADO):** tabela `mesa_som` (id, nome, tags text[], url, criado_em) com policies select/insert/**update**/**delete** anon; bucket público `mesa-som` com `file_size_limit=5242880` (5 MB) + `allowed_mime_types=audio/*`; policies de insert e delete anon em `storage.objects`.
⚠️ **Pendência a confirmar:** o `update storage.buckets set file_size_limit=5242880 where id='mesa-som'` (subir o teto do bucket de 1→5 MB) — se ainda não rodou, o servidor rejeita >1 MB.

**Caveat:** cliente remoto só toca áudio compartilhado se já teve interação na página (entrar na mesa/Jitsi já basta). A exclusão do arquivo no Storage é best-effort (se a policy falhar, some do banco mas fica órfão o arquivo).

## 2. Linha do tempo / histórico do contexto — `mesa.html`

A "data da ficção" no topo (`#mesaBrand`, editável) **agora persiste no Supabase** (antes era só localStorage → se perdia). Cada mudança do texto vira uma linha na tabela **`mesa_ctx_hist`**. Ao lado da data tem um **🕘** que abre a "Linha do tempo" (lista das mudanças, quem/quando), com **✕ no hover** pra apagar entrada errada — e se apagar a mais recente, a data volta pra anterior e sincroniza.

**Supabase (setup em `mesa-historico-setup.sql`, JÁ RODADO):** tabela `mesa_ctx_hist` (id, sala, texto, autor, criado_em) + índice (sala, criado_em desc) + policies select/insert/**delete** anon.

## 3. Dados 3D — `mesa.html` (correções)

- **Tray zera após rolar** (pronto pra próxima jogada; só zera se a rolagem aconteceu; é local, não mexe nos outros).
- **d100 corrigido:** a lib (`@3d-dice/dice-box-threejs`) renderiza d100 como "Ten-Sided Dice (Tens Digit)" (só dezenas). Agora o resultado vira **par percentil** (dezena d100 + unidade d10) pra mostrar o número exato batendo com o chat.
- **Bug maior descoberto na lib:** ela faz `notation.split('@')` e usa só a 1ª parte → juntar tipos com `+` (ex: `1d100@80+1d10@5`, ou `2d10@..+2d6@..`) fazia o **2º dado sumir**. Corrigido: **um passo (`roll`/`add`) por grupo de dado**, cada um com um único `@`.
- ⚠️ **Não testei WebGL aqui** — a lógica das notações está validada, mas falta confirmar visualmente se a face "00"/"0" aparece como esperado.

## 4. Fichas — Cosmologia → **SYNESIS** (renome + migração)

Trocado o rótulo do stat transversal em `ficha.html`, `ficha-vampiro.html`, `mestre-view.html`, `ferramentas.html` (preview do import) e nos prompts do `api/scan-ficha.js`.
**Crítico:** a ficha casa dots pelo TEXTO do nome — então migrei os dados: `dots[].name` "Cosmologia" → "SYNESIS" em **44 personagens** (0 falhas), valor preservado. `mestre-view` e o scan aceitam os DOIS nomes (compat com fichas antigas). Sobrou "Cosmologia" só em comentários/CSS (proposital).

## 5. Bug da vitalidade nas fichas importadas — RESOLVIDO pontual

O nº de quadradinhos de Vitalidade/Força de Vontade = o valor lido no **scan** (import por IA/PDF). Personagens escaneados vinham com contagem errada (Luciano 2/5, LEANDRO 6/5). O **padrão do sistema é trilha fixa de 10/10** (confirmado pela ficha do Daniel Fraga: Vigor 2 mas Vitalidade 10 — NÃO é derivado de atributo). Corrigi **Luciano e LEANDRO → 10/10** (valor de dano preservado). **Gap ainda aberto:** a ficha não tem UI pra editar a contagem de boxes; hoje só o scan define. Se quiser, a solução de raiz é (a) o import gravar 10/10 fixo, e/ou (b) um campo "Máx" editável na ficha.

## 6. Backup — ATENÇÃO

O "sistema de backup" (`supabase/functions/daily-backup/index.ts`) **NÃO está rodando** (Edge Function não deployada; bucket `backups` não existe) e cobria só 4 tabelas. Criei **`backup-dados.mjs`** (`node backup-dados.mjs`): snapshot **read-only** de todas as tabelas via anon key → `backups/<data>/` (pasta **gitignorada** — repo é PÚBLICO). `.gitignore` passou a cobrir `backups/` e `node_modules/`. Plano free do Supabase = 1 GB, **sem backup automático**.

## 7. Transcrição JaaS — mudou a UI (2026-07)

Liga/desliga via env **`JAAS_TRANSCRIPTION=1`** na Vercel + **redeploy** (verificar no token: `/api/jaas-token` → `context.features.transcription`). **A UI do Jitsi mudou:**
- **Idioma** não é mais no dropdown do CC (sumiu) — agora segue o idioma da APLICAÇÃO de quem liga; setar em **Configurações → "Mais" → Português (Brasil)** ANTES de ligar as legendas. Se a interface está em inglês, sai `en-US` (fala PT vira inglês sem sentido).
- **Liga/desliga** é um balão com **chavinha + OK**.
- **No fim, esperar ~30s de silêncio antes de parar** (o transcritor tem latência; parar na hora corta o final que ainda está no buffer).
- Runbook completo na memória `jaas-transcricao-setup.md`.

## 8. Visão SaaS multi-tenant (discutida, NÃO implementada)

Objetivo futuro: Mundo Aberto como plataforma com dados isolados por grupo + assinatura. O caminho: sair de "anon key + RLS permissiva" para **Supabase Auth + RLS por space** (`memberships`, `space_id` em tudo, policies `space_id in (meus spaces)`) + **Stripe** pra assinatura. Modelo pooled (um banco, isolado por RLS) recomendado. Open-source + hosted convivem (open-core). É o pré-requisito pra qualquer produto público.

---

## Projeto irmão: Escritório Virtual "Bardos" — `C:\Users\dani0\Desktop\Nebula\Programação\escritorio_`

Vanilla + Supabase + Vercel, **mesmo projeto Supabase** (`mxyqqfsyybluavwlrhsa`, mesma anon key). É o **HUB do grupo** (esqueleto v0.1). Arquivos: `index.html`, `styles.css`, `app.js`, `README.md`. Funcionalidades:
- **Recepção com chat ao vivo** (Realtime broadcast, canal `recepcao:geral`, não gravado) — mesmo padrão do chat da mesa.
- **Quadro branco** (pincel/borracha/seta/círculo/quadrado/texto/cores) que envia o desenho como imagem no chat; **upload de imagem** pro bucket `personagens`; **galeria/lightbox** com zoom e navegação — todos derivados dos padrões da `mesa.html`.
- **Presença** ("no escritório agora" — mock em `pessoasOnline`, falta presença real).
- **Tema claro/escuro** (persistido, `localStorage bardos-tema`), **entrada animada** (bater na porta), **sidebar** com marcador de seção (IntersectionObserver).
- **Salas com chave** (Sala 1/2 — `prompt` de chave, aceita qualquer valor, não é segurança). Seções: recepção/salas/mesa/escola/departamentos. Muitos boxes com `data-soon` (toast "em breve").
- **Pendências (README):** links reais (Drive/Trello/chamadas), chaves de verdade, presença real, Escola e Sala de Estar.

**A próxima tarefa é integrar/aplicar as funcionalidades entre os dois** — ver o prompt separado.
