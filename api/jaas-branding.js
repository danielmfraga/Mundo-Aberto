// Vercel Serverless Function: /api/jaas-branding
// Serve o payload de dynamic branding para o JaaS.
// O JaaS chama este endpoint antes de abrir a sala e aplica as preferências.
// Referência: https://developer.8x8.com/jaas/docs/jaas-prefs-advanced-branding/

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache');
  return res.status(200).json({
    defaultTranscriptionLanguage: 'pt-BR'
  });
}
