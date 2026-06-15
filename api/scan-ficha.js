// Vercel Serverless Function: /api/scan-ficha
// Recebe imagem(ns) ou PDF de uma ficha manuscrita do Mundo Aberto,
// chama Claude Vision com schema da ficha e retorna JSON estruturado.

import Anthropic from '@anthropic-ai/sdk';

// ─────────────────────────────────────────────────────────
// Limites de payload pra Vercel (body size).
// Imagens grandes podem estourar o default de 4.5MB.
// ─────────────────────────────────────────────────────────
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb'
    }
  }
};

// ─────────────────────────────────────────────────────────
// Schema da ficha do Mundo Aberto — nomes EXATOS dos campos
// ─────────────────────────────────────────────────────────
const ATRIBUTOS = [
  'Força', 'Destreza', 'Vigor',
  'Carisma', 'Manipulação', 'Autocontrole',
  'Inteligência', 'Raciocínio', 'Determinação'
];

const HABILIDADES = [
  'Armas Brancas', 'Armas de Fogo', 'Atletismo', 'Briga', 'Ciência',
  'Condução', 'Emp. Animais', 'Erudição', 'Etiqueta', 'Finanças',
  'Furtividade', 'Intimidação', 'Investigação', 'Ladroagem',
  'Liderança', 'Manha', 'Medicina', 'Ofícios', 'Ocultismo',
  'Percepção', 'Performance', 'Persuasão', 'Pesquisa', 'Política',
  'Sagacidade', 'Sobrevivência', 'Subterfúgio', 'Tecnologia'
];

const IDENTIDADE = [
  'conceito', 'credo', 'impeto', 'redencao', 'ambicao',
  'desejo', 'celula', 'principio', 'pilar',
  'idade', 'nascimento', 'aparencia'
];

// ─────────────────────────────────────────────────────────
// Prompt de sistema — instruções pra extração
// ─────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um especialista em leitura de fichas de personagem manuscritas do RPG "Mundo Aberto".

# ESTRUTURA DA FICHA

## ATRIBUTOS (cada um vai de 0 a 5)
${ATRIBUTOS.join(', ')}

## HABILIDADES (cada uma de 0 a 5)
${HABILIDADES.join(', ')}

## COSMOLOGIA (de 0 a 10)
Um único valor.

## VITAIS
- Vitalidade (geralmente 5-10, indica resistência física)
- Força de Vontade (geralmente 3-8)
- Desespero (geralmente 0-5, frequentemente em branco)

## XP
- total (número inteiro)
- spent (número inteiro, gasto)

## CAMPOS DE IDENTIDADE (texto livre)
${IDENTIDADE.join(', ')}, name (nome do personagem)

## QUALIDADES E DEFEITOS (lista dinâmica)
Cada item tem nome (texto livre) e valor.
- Qualidades: valor POSITIVO (1 a 5)
- Defeitos: valor NEGATIVO (-1 a -5)
Sinais típicos de defeito: "(-1)", "-2", parênteses, contexto.

## TRUNFOS (lista dinâmica)
Cada trunfo tem key (nome) + val (descrição/valor) + distincts (lista de distinções).
Frequentemente em branco em fichas básicas.

## EQUIPAMENTOS (lista de strings)
Itens livres anotados.

# NOTAÇÕES POSSÍVEIS QUE O JOGADOR PODE USAR

Para indicar valores numéricos de atributos/habilidades:
- **Bolinhas preenchidas vs vazias**: ●●●○○ = 3
- **Números diretos**: 3
- **Sistema de quadrado**: cada lado de um quadradinho vale 1
  - | (1 traço vertical) = 1
  - L (canto) = 2
  - U (3 lados) = 3
  - □ (quadrado fechado) = 4
  - □ com risco no meio = 5
- **Hashes/riscos**: ||| = 3
- **X marcados**: x x x = 3
- **Qualquer outra forma** — interprete pelo contexto

# REGRAS DE EXTRAÇÃO

1. **Mapeie variações de escrita para os nomes oficiais**:
   - "Auto-Controle" / "Autocontrole" → "Autocontrole"
   - "Força Vontade" / "Força de Vontade" / "FdV" → "Força de Vontade"
   - "Empatia Animal" / "Empatia c/ Animais" → "Emp. Animais"
   - Acentos podem estar omitidos — preserve corretos na saída.

2. **Campos não preenchidos**: retorne null. NÃO chute valores.

3. **Confiança baixa**: se não conseguir ler algo com certeza razoável, retorne null e adicione a entrada em "warnings" explicando o que estava ambíguo.

4. **Qualidades vs Defeitos**: use o sinal (positivo/negativo) e o contexto. Itens claramente marcados como "(-N)" ou listados como "defeitos" vão em "defects".

5. **Nomes livres**: para qualidades/defeitos/equipamentos, preserve EXATAMENTE o que o jogador escreveu (não normalize nem corrija).

# FORMATO DE RESPOSTA

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem comentários, sem explicação antes ou depois):

\`\`\`
{
  "name": string | null,
  "fields": {
    "conceito": string | null,
    "credo": string | null,
    "impeto": string | null,
    "redencao": string | null,
    "ambicao": string | null,
    "desejo": string | null,
    "celula": string | null,
    "principio": string | null,
    "pilar": string | null,
    "idade": string | null,
    "nascimento": string | null,
    "aparencia": string | null
  },
  "atributos": {
    "Força": number | null,
    "Destreza": number | null,
    "Vigor": number | null,
    "Carisma": number | null,
    "Manipulação": number | null,
    "Autocontrole": number | null,
    "Inteligência": number | null,
    "Raciocínio": number | null,
    "Determinação": number | null
  },
  "habilidades": {
    "Armas Brancas": number | null,
    "Armas de Fogo": number | null,
    "Atletismo": number | null,
    "Briga": number | null,
    "Ciência": number | null,
    "Condução": number | null,
    "Emp. Animais": number | null,
    "Erudição": number | null,
    "Etiqueta": number | null,
    "Finanças": number | null,
    "Furtividade": number | null,
    "Intimidação": number | null,
    "Investigação": number | null,
    "Ladroagem": number | null,
    "Liderança": number | null,
    "Manha": number | null,
    "Medicina": number | null,
    "Ofícios": number | null,
    "Ocultismo": number | null,
    "Percepção": number | null,
    "Performance": number | null,
    "Persuasão": number | null,
    "Pesquisa": number | null,
    "Política": number | null,
    "Sagacidade": number | null,
    "Sobrevivência": number | null,
    "Subterfúgio": number | null,
    "Tecnologia": number | null
  },
  "cosmologia": number | null,
  "vitals": {
    "Vitalidade": number | null,
    "Força de Vontade": number | null,
    "Desespero": number | null
  },
  "xp": { "total": number | null, "spent": number | null },
  "qualities": [{ "name": string, "value": number }],
  "defects": [{ "name": string, "value": number }],
  "trunfos": [{ "key": string, "val": string, "distincts": [string] }],
  "equipment": [string],
  "warnings": [string]
}
\`\`\`

Liste APENAS qualidades/defeitos/trunfos/equipamentos que estão de fato escritos na ficha. Arrays vazios são OK.`;

// ═════════════════════════════════════════════════════════
// Schema da ficha de VAMPIRO: A MÁSCARA (V5) — sistema paralelo.
// Mesmos atributos do Caçador; habilidades quase iguais (note
// "Emp. c/ Animais"). Tudo abaixo é independente do Caçador.
// ═════════════════════════════════════════════════════════
const HABILIDADES_VTM = [
  // Físicas
  'Armas Brancas', 'Armas de Fogo', 'Atletismo', 'Briga', 'Condução',
  'Furtividade', 'Ladroagem', 'Ofícios', 'Sobrevivência',
  // Sociais
  'Emp. c/ Animais', 'Etiqueta', 'Intimidação', 'Liderança', 'Manha',
  'Performance', 'Persuasão', 'Sagacidade', 'Subterfúgio',
  // Mentais
  'Ciência', 'Erudição', 'Finanças', 'Investigação', 'Medicina',
  'Ocultismo', 'Percepção', 'Política', 'Tecnologia'
];

const SYSTEM_PROMPT_VAMPIRO = `Você é um especialista em leitura de fichas de personagem manuscritas de "Vampiro: A Máscara" (5ª edição / V5), em português.

# ESTRUTURA DA FICHA

## ATRIBUTOS (cada um de 0 a 5)
${ATRIBUTOS.join(', ')}

## HABILIDADES (cada uma de 0 a 5)
${HABILIDADES_VTM.join(', ')}

## POTÊNCIA DE SANGUE (Blood Potency, de 0 a 5)
Um único valor. Vampiros recém-Abraçados costumam ter 1. (Se a ficha indicar mais
de 5, limite a 5.)

## COSMOLOGIA (de 0 a 10)
Um único valor — stat transversal do sistema Mundo Aberto. Pode não constar numa
ficha física de V:tM; se não houver, retorne null.

## VITAIS
- Vitalidade (trilha de saúde; geralmente 3-8 = Vigor + 3)
- Força de Vontade (geralmente Autocontrole + Determinação)
- Fome (Hunger, de 0 a 5; quase sempre 1 em repouso, podendo estar em branco)
- Humanidade (de 0 a 10; padrão inicial costuma ser 7)

## XP (Experiência)
- total (número inteiro)
- spent (número inteiro, gasto)

## CAMPOS DE IDENTIDADE (texto livre)
- cronica (nome da crônica/campanha)
- conceito
- predador (Tipo de Predador — ex: Alcateia, Vira-Lata, Cleaver, Sandman, Sereno…)
- cla (Clã — ex: Brujah, Toreador, Ventrue, Nosferatu, Gangrel, Malkaviano, Tremere, Lasombra, Banu Haqim, Hecata, Ministério, Ravnos, Salubri, Tzimisce, Caitiff, Sangue Ralo)
- geracao (número; ex: 11, 12, 13)
- senhor (Sire — quem o Abraçou)
- ambicao
- desejo
- ressonancia (Ressonância do sangue — Colérica, Melancólica, Fleumática, Sanguínea…)
- name (nome do personagem)
- idade_verdadeira, idade_aparente, data_nascimento, data_morte (do histórico)

## DISCIPLINAS (lista dinâmica)
Poderes sobrenaturais vampíricos. Cada uma tem nome + nível de pontos (0-5) + poderes anotados.
Disciplinas comuns: Animalismo, Auspícios, Domínio, Fortitude, Ofuscação, Potência,
Presença, Protean, Feitiçaria de Sangue (Thaumaturgia), Celeridade, Oblívio, Feitiçaria das Cinzas.
ATENÇÃO: NÃO confunda com "trunfos" — em V:tM são Disciplinas.

## VANTAGENS & DEFEITOS (Merits & Flaws — lista dinâmica)
Cada item tem nome (texto livre) e valor.
- Vantagens (Merits/Antecedentes): valor POSITIVO (1 a 5)
- Defeitos (Flaws): valor NEGATIVO (-1 a -5)
Antecedentes típicos: Aliados, Contatos, Recursos, Refúgio, Rebanho, Status, Influência, Mawla.

## CRÔNICA (texto livre)
- principios (Princípios da Crônica)
- pilares (Convicções / Pilares — valores do personagem)
- perdicao (Toque da Perdição / Bane do Clã, ou Pedra de Toque)

## HISTÓRICO (texto livre)
- aparencia (descrição física)
- tracos (marcas, maneirismos)
- historia (passado e origem)

## NOTAS (texto livre)
Qualquer anotação avulsa que não se encaixe nos campos acima: especializações de
habilidades, contatos, NPCs, rebanho, lembretes do jogador, regras de mesa. Junte
tudo no campo "notes" preservando o texto como escrito.

# NOTAÇÕES POSSÍVEIS QUE O JOGADOR PODE USAR

Para indicar valores numéricos (atributos/habilidades/disciplinas/potência de sangue):
- **Bolinhas preenchidas vs vazias**: ●●●○○ = 3
- **Números diretos**: 3
- **Sistema de quadrado**: cada lado de um quadradinho vale 1 (| = 1, L = 2, U = 3, □ = 4, □ com risco = 5)
- **Hashes/riscos**: ||| = 3
- **X marcados**: x x x = 3
- **Qualquer outra forma** — interprete pelo contexto

Para Fome e Humanidade, a notação costuma ser quadradinhos marcados.

# REGRAS DE EXTRAÇÃO

1. **Mapeie variações de escrita para os nomes oficiais**:
   - "Auto-Controle" → "Autocontrole"
   - "Força Vontade" / "FdV" → na vital "Força de Vontade"
   - "Empatia c/ Animais" / "Empatia com Animais" / "Trato com Animais" → "Emp. c/ Animais"
   - Acentos podem estar omitidos — preserve corretos na saída.

2. **Campos não preenchidos**: retorne null. NÃO chute valores.

3. **Confiança baixa**: se não conseguir ler algo com certeza razoável, retorne null e adicione a entrada em "warnings".

4. **Vantagens vs Defeitos**: use o sinal e o contexto. "(-N)" ou listados como defeitos vão em "defeitos".

5. **Nomes livres** (disciplinas/vantagens/defeitos): preserve EXATAMENTE o que o jogador escreveu.

6. **Disciplinas**: capture o nome, o nível em pontos, e qualquer poder/habilidade anotado junto (em "poderes").

# FORMATO DE RESPOSTA

Retorne APENAS um JSON válido neste formato exato (sem markdown, sem comentários):

\`\`\`
{
  "name": string | null,
  "fields": {
    "cronica": string | null,
    "conceito": string | null,
    "predador": string | null,
    "cla": string | null,
    "geracao": string | null,
    "senhor": string | null,
    "ambicao": string | null,
    "desejo": string | null,
    "ressonancia": string | null,
    "idade_verdadeira": string | null,
    "idade_aparente": string | null,
    "data_nascimento": string | null,
    "data_morte": string | null
  },
  "atributos": {
    "Força": number | null, "Destreza": number | null, "Vigor": number | null,
    "Carisma": number | null, "Manipulação": number | null, "Autocontrole": number | null,
    "Inteligência": number | null, "Raciocínio": number | null, "Determinação": number | null
  },
  "habilidades": {
    "Armas Brancas": number | null, "Armas de Fogo": number | null, "Atletismo": number | null,
    "Briga": number | null, "Condução": number | null, "Furtividade": number | null,
    "Ladroagem": number | null, "Ofícios": number | null, "Sobrevivência": number | null,
    "Emp. c/ Animais": number | null, "Etiqueta": number | null, "Intimidação": number | null,
    "Liderança": number | null, "Manha": number | null, "Performance": number | null,
    "Persuasão": number | null, "Sagacidade": number | null, "Subterfúgio": number | null,
    "Ciência": number | null, "Erudição": number | null, "Finanças": number | null,
    "Investigação": number | null, "Medicina": number | null, "Ocultismo": number | null,
    "Percepção": number | null, "Política": number | null, "Tecnologia": number | null
  },
  "potenciaSangue": number | null,
  "cosmologia": number | null,
  "vitals": {
    "Vitalidade": number | null,
    "Força de Vontade": number | null,
    "Fome": number | null,
    "Humanidade": number | null
  },
  "xp": { "total": number | null, "spent": number | null },
  "disciplinas": [{ "nome": string, "pontos": number, "poderes": string }],
  "vantagens": [{ "name": string, "value": number }],
  "defeitos": [{ "name": string, "value": number }],
  "cronicaFields": {
    "principios": string | null,
    "pilares": string | null,
    "perdicao": string | null
  },
  "historico": {
    "aparencia": string | null,
    "tracos": string | null,
    "historia": string | null
  },
  "notes": string | null,
  "warnings": [string]
}
\`\`\`

Liste APENAS disciplinas/vantagens/defeitos que estão de fato escritos na ficha. Arrays vazios são OK.`;

// Mapa de sistemas → prompt. Default seguro: caçador (comportamento legado).
const SYSTEM_PROMPTS = {
  cacador: SYSTEM_PROMPT,
  vampiro: SYSTEM_PROMPT_VAMPIRO
};

// ─────────────────────────────────────────────────────────
// Handler principal
// ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS — mesma origem, mas previne dor de cabeça
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY não configurada. Adicione a env var na Vercel.'
    });
  }

  try {
    const { files, notation, notations, model, tipo } = req.body || {};

    // Sistema da ficha. Default 'cacador' preserva o comportamento legado.
    const sistema = (tipo === 'vampiro') ? 'vampiro' : 'cacador';
    const systemPrompt = SYSTEM_PROMPTS[sistema];

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    if (files.length > 5) {
      return res.status(400).json({ error: 'Máximo 5 arquivos por análise.' });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Monta o array de content blocks
    const content = [];

    for (const file of files) {
      if (!file?.data || !file?.mediaType) {
        return res.status(400).json({ error: 'Arquivo inválido (faltam data/mediaType).' });
      }

      if (file.mediaType === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file.data }
        });
      } else if (file.mediaType.startsWith('image/')) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: file.mediaType, data: file.data }
        });
      } else {
        return res.status(400).json({ error: `Tipo de arquivo não suportado: ${file.mediaType}` });
      }
    }

    // Notações: aceita array `notations` (multi) OU string `notation` (legacy single).
    // Mesma ficha pode misturar notações (ex: atributos em "quadrado", habilidades em números).
    const notationList = Array.isArray(notations) && notations.length > 0
      ? notations
      : (notation ? [notation] : []);

    const notationHint = notationList.length > 0
      ? `O jogador informou as seguintes notações em uso (potencialmente combinadas na MESMA ficha — interprete cada valor pelo contexto, escolhendo qual notação se aplica a cada caso):\n${notationList.map(n => `  • ${n}`).join('\n')}`
      : 'O jogador NÃO especificou notações — identifique pelo contexto da ficha.';

    content.push({
      type: 'text',
      text: `${notationHint}\n\nExtraia todos os dados da ficha conforme o schema definido no system prompt. Retorne APENAS o JSON.`
    });

    // ─────────────────────────────────────────────────────────
    // Chama Claude Vision com PROMPT CACHING no system prompt.
    // O schema é fixo (~5000 tokens) → cache hit em todas as
    // chamadas seguintes corta ~90% do custo do prompt.
    // ─────────────────────────────────────────────────────────
    const response = await client.messages.create({
      model: model || 'claude-opus-4-8',
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{ role: 'user', content }]
    });

    const text = response.content?.[0]?.text || '';

    // Tenta extrair JSON do texto retornado
    // Claude às vezes envolve em ```json ... ``` ou ``` ... ```
    let jsonText = text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (parseErr) {
      return res.status(502).json({
        error: 'Falha ao interpretar resposta do modelo.',
        rawResponse: text,
        parseError: parseErr.message
      });
    }

    return res.status(200).json({
      data,
      usage: response.usage,
      model: response.model
    });

  } catch (error) {
    console.error('[scan-ficha] error:', error);
    return res.status(500).json({
      error: error.message || 'Erro desconhecido',
      details: error.error || null
    });
  }
}
