// Vercel Serverless Function: /api/mapa-chave
// Entrega à Mesa a "chave da Mesa" do mapa-múndi (env MAPA_CHAVE_MESA), pra todo mundo que está na Mesa editar o mapa.
// Fica em variável de ambiente (e não no código) pra não aparecer no repositório público.
// Para trocar/desligar: mude a env na Vercel e o SQL do Supabase (tabela mapa_chaves).

export default function handler(req, res) {
  const chave = process.env.MAPA_CHAVE_MESA;
  if (!chave) return res.status(500).json({ error: 'MAPA_CHAVE_MESA não configurada na Vercel.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ chave });
}
