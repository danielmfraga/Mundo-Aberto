// Vercel Serverless Function: /api/navegador
// Recebe uma pergunta do jogador, busca TODAS as sessões arquivadas no Supabase,
// monta prompt com prompt caching e responde via Claude Opus 4.8.
//
// Arquitetura "full-context" (sem embeddings):
//   - Opus 4.8 tem 200K tokens de contexto (~15 sessões de 1h)
//   - Guard de 150K tokens antes de enviar (erro claro se ultrapassar)
//   - Cache do corpus entre perguntas (~90% de economia no token repetido)

import Anthropic from '@anthropic-ai/sdk';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' }
  },
  maxDuration: 60
};

const SUPABASE_URL = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';

const TOKEN_LIMIT = 150_000;

const SYSTEM_PROMPT = `Você é o Navegador — memória coletiva da campanha de RPG Mundo Aberto.

Responda perguntas dos jogadores com base EXCLUSIVAMENTE nas sessões que foram arquivadas.

REGRAS:
1. Responda em português, de forma direta e clara.
2. Se a informação estiver nas sessões, cite qual sessão (ex: "Na sessão 3, ...").
3. Se a informação NÃO estiver nas sessões arquivadas, diga explicitamente: "Não encontrei registro disso nas sessões arquivadas."
4. NUNCA invente, suponha ou extrapole além do que está escrito.
5. Para perguntas sobre NPCs, locais ou itens: mencione TODAS as ocorrências relevantes encontradas.
6. Seja conciso mas completo. Se houver muito conteúdo relevante, organize em parágrafos curtos.`;

function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

async function fetchSessions() {
  const url = `${SUPABASE_URL}/rest/v1/sessions` +
    `?select=title,session_number,session_date,cleaned_content,summary` +
    `&deleted_at=is.null` +
    `&cleaned_content=not.is.null` +
    `&order=session_number.asc.nullslast,session_date.asc.nullslast`;

  const resp = await fetch(url, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => resp.statusText);
    throw new Error(`Supabase error ${resp.status}: ${err}`);
  }

  return resp.json();
}

function buildCorpus(sessions) {
  return sessions.map((s, i) => {
    const num = s.session_number != null ? `#${s.session_number}` : `Sessão ${i + 1}`;
    const date = s.session_date ? ` (${s.session_date})` : '';
    const summary = s.summary ? `\nResumo: ${s.summary}` : '';
    return `=== ${num}: ${s.title}${date} ===${summary}\n\n${s.cleaned_content}`;
  }).join('\n\n---\n\n');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY não configurada na Vercel.' });
  }

  const { question } = req.body || {};
  if (!question || !String(question).trim()) {
    return res.status(400).json({ error: 'Pergunta é obrigatória.' });
  }
  if (String(question).length > 2000) {
    return res.status(400).json({ error: 'Pergunta muito longa (máx 2000 caracteres).' });
  }

  try {
    const sessions = await fetchSessions();

    if (!sessions || sessions.length === 0) {
      return res.status(200).json({
        answer: 'Não há sessões arquivadas no banco ainda. Assim que as primeiras sessões forem ingeridas pelo Diário de Bordo, poderei responder perguntas sobre a campanha.',
        sessionsUsed: 0
      });
    }

    const corpus = buildCorpus(sessions);
    const corpusHeader = `REGISTRO DE SESSÕES DA CAMPANHA (${sessions.length} sessão${sessions.length > 1 ? 'ões' : ''} arquivada${sessions.length > 1 ? 's' : ''}):\n\n`;
    const fullCorpus = corpusHeader + corpus;

    const estimatedTokens = estimateTokens(SYSTEM_PROMPT + fullCorpus + question);

    if (estimatedTokens > TOKEN_LIMIT) {
      return res.status(400).json({
        error: `Corpus de sessões muito grande (~${estimatedTokens.toLocaleString('pt-BR')} tokens estimados, limite ${TOKEN_LIMIT.toLocaleString('pt-BR')}). É hora de migrar para embeddings + pgvector.`,
        sessionsCount: sessions.length,
        estimatedTokens
      });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: fullCorpus,
              cache_control: { type: 'ephemeral' }
            },
            {
              type: 'text',
              text: `PERGUNTA DO JOGADOR:\n${question}`
            }
          ]
        }
      ]
    });

    return res.status(200).json({
      answer: response.content[0].text,
      sessionsUsed: sessions.length,
      estimatedTokens,
      usage: response.usage,
      model: response.model
    });

  } catch (error) {
    console.error('[navegador] error:', error);
    return res.status(500).json({
      error: error.message || 'Erro desconhecido ao consultar o Navegador.',
      details: error.error || null
    });
  }
}
