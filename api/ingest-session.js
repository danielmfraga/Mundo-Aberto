// Vercel Serverless Function: /api/ingest-session
// Recebe transcript bruto de uma sessão de RPG (Google Meet, áudio transcrito etc.)
// Chama Claude pra LIMPAR (remover tagarelice e ruído), retorna JSON com:
//   - cleaned: texto limpo
//   - summary: resumo 1-2 frases
//   - metadata: { npcs, locais, eventos, ... }
//
// IMPORTANTE: este endpoint apenas LIMPA. NÃO salva no banco.
// O frontend recebe o resultado, deixa o usuário REVISAR/editar,
// e só então faz o POST pro Supabase. Padrão "review-before-apply".

import Anthropic from '@anthropic-ai/sdk';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb'  // comporta texto grande + até 1-2 imagens comprimidas
    }
  }
};

const SYSTEM_PROMPT = `Você processa transcripts de sessões de RPG da campanha Mundo Aberto.

INPUT: transcript bruto (Google Meet, áudio transcrito, notas).
Contém RUÍDO: tagarelice off-topic, problemas técnicos, hesitações,
comentários sobre comida/horário, risadas, repetições, conversas paralelas.

TUA TAREFA: produzir versão LIMPA preservando TUDO que é narrativamente relevante.

PRESERVE COM PRIORIDADE MÁXIMA:
- Diálogos em jogo (entre PCs ou com NPCs) — nomes EXATOS
- Descrições/narração do mestre
- Decisões e ações dos jogadores
- Rolagens de dado e suas consequências
- Combates (golpe a golpe se possível)
- Reflexões em jogo dos personagens
- Nomes de NPCs encontrados
- Locais visitados e descritos
- Itens encontrados/trocados/comprados
- Passagem de tempo na ficção (datas, "uma semana depois", etc.)
- Decisões que mudam o rumo da história

REMOVA:
- Conversas paralelas obviamente fora do jogo ("vou pegar uma água",
  "como tá o trampo?", "esqueci de comprar pão")
- Problemas técnicos ("o áudio cortou", "deixa eu reconectar")
- Comentários sobre as regras (a menos que tenham afetado o jogo)
- Hesitações vazias ("uh", "tipo", "sei lá", "então...")
- Risadas e interjeições sem conteúdo
- Repetições sem nova informação
- Comentários sobre horário real, almoço, próximas sessões

REGRAS ABSOLUTAS:
1. NÃO INVENTE NADA. Nunca complete frases ou suposições.
2. Se algo está ambíguo, MANTENHA AMBÍGUO ou marque com [INCERTO: ...].
3. Preserve a ORDEM CRONOLÓGICA dos eventos.
4. Nomes próprios são SAGRADOS — copie EXATAMENTE como aparecem.

FORMATO DE SAÍDA — JSON estrito, sem markdown, sem \`\`\`:

{
  "cleaned": "texto limpo em prosa, narrativo, mantendo cronologia",
  "summary": "1-2 frases resumindo o que aconteceu nessa sessão",
  "metadata": {
    "npcs_mencionados": ["nome1", "nome2"],
    "locais": ["lugar1", "lugar2"],
    "eventos_chave": ["evento curto 1", "evento curto 2"],
    "personagens_presentes": ["nome PC 1", "nome PC 2"],
    "duracao_aproximada_palavras": 0
  }
}

Retorne SOMENTE o JSON. Sem preâmbulo, sem comentário, sem explicação.`;

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY não configurada na Vercel.'
    });
  }

  try {
    const { title, rawContent, imageFiles, model } = req.body || {};

    // Validação básica
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Título é obrigatório.' });
    }
    const hasText  = rawContent && String(rawContent).trim().length > 0;
    const hasImages = Array.isArray(imageFiles) && imageFiles.length > 0;
    if (!hasText && !hasImages) {
      return res.status(400).json({ error: 'Forneça um transcript (texto) ou pelo menos uma imagem (jpg/png).' });
    }

    // Estimativa de tokens do texto (4 chars ≈ 1 token, conservador)
    if (hasText) {
      const inputEstimate = Math.ceil(rawContent.length / 4);
      if (inputEstimate > 80000) {
        return res.status(400).json({
          error: `Transcript muito longo (~${inputEstimate} tokens estimados, limite 80K). Divida a sessão em partes menores.`
        });
      }
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Monta o conteúdo da mensagem (imagens opcionais + texto)
    const userContent = [];

    // Imagens vêm ANTES do texto pra Claude associar bem o conteúdo visual
    if (hasImages) {
      for (const img of imageFiles) {
        if (!img.data || !img.mediaType) continue;
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data }
        });
      }
    }

    const textPrompt = hasText
      ? `Título da sessão: ${title}\n\n--- TRANSCRIPT BRUTO ---\n\n${rawContent}\n\n--- FIM DO TRANSCRIPT ---\n\n${hasImages ? 'As imagens acima também fazem parte do material desta sessão — extraia o texto relevante delas e inclua na limpeza.\n\n' : ''}Limpe e retorne o JSON conforme as instruções.`
      : `Título da sessão: ${title}\n\nAs imagens acima contêm o transcript desta sessão — extraia todo o texto delas, depois limpe e retorne o JSON conforme as instruções.`;

    userContent.push({ type: 'text', text: textPrompt });

    // Chama Claude — Sonnet 4.6 (suficiente pra limpeza, 4x mais barato que Opus)
    const response = await client.messages.create({
      model: model || 'claude-sonnet-4-6',
      max_tokens: 16000,
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
          content: userContent
        }
      ]
    });

    const text = response.content?.[0]?.text || '';

    // Extrai JSON (tolerante a fenced blocks caso o modelo escorregue)
    let jsonText = text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    let cleaned, summary, metadata;
    try {
      const parsed = JSON.parse(jsonText);
      cleaned = parsed.cleaned;
      summary = parsed.summary || null;
      metadata = parsed.metadata || {};
    } catch (parseErr) {
      // Fallback de segurança: se não conseguir parsear, devolve texto bruto
      // como cleaned pra o usuário não perder o trabalho de limpeza do modelo.
      return res.status(502).json({
        error: 'Modelo não retornou JSON válido. Fallback aplicado.',
        rawResponse: text,
        parseError: parseErr.message
      });
    }

    if (!cleaned || typeof cleaned !== 'string') {
      return res.status(502).json({
        error: 'JSON retornado não contém campo "cleaned" válido.',
        rawResponse: text
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        cleaned,
        summary,
        metadata
      },
      usage: response.usage,
      model: response.model
    });

  } catch (error) {
    console.error('[ingest-session] error:', error);
    return res.status(500).json({
      error: error.message || 'Erro desconhecido ao processar transcript.',
      details: error.error || null
    });
  }
}
