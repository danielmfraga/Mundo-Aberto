// Vercel Serverless Function: /api/jaas-token
// Gera um JWT (RS256) para autenticar a Mesa no JaaS (Jitsi as a Service).
// Só a CHAVE PRIVADA é segredo (env JAAS_PRIVATE_KEY). App ID e Key ID não são
// segredos (vão no cliente de qualquer forma), então ficam hardcoded aqui.
// Sem dependências: usa o módulo crypto nativo do Node pra assinar o token.

import crypto from 'crypto';

const APP_ID = 'vpaas-magic-cookie-cacc35dda8be41dbbf0a769952e2df2c';
const KID    = 'vpaas-magic-cookie-cacc35dda8be41dbbf0a769952e2df2c/cf7227';

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let pk = process.env.JAAS_PRIVATE_KEY;
  if (!pk) {
    return res.status(500).json({ error: 'JAAS_PRIVATE_KEY não configurada na Vercel.' });
  }
  pk = pk.replace(/\\n/g, '\n'); // aceita PEM com \n escapado ou com quebras reais

  const name = String(req.query.name || 'Jogador').slice(0, 50);
  const userId = 'u-' + Math.random().toString(36).slice(2, 10);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const payload = {
    aud: 'jitsi',
    iss: 'chat',
    sub: APP_ID,
    room: '*',                 // token vale pra qualquer sala deste app
    exp: now + 4 * 60 * 60,    // expira em 4h
    nbf: now - 10,
    context: {
      user: { id: userId, name: name, avatar: '', email: '', moderator: 'true' },
      features: {
        livestreaming: 'false',
        recording: 'false',
        transcription: 'true',
        'outbound-call': 'false'
      }
    }
  };

  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = b64url(signer.sign(pk));
    return res.status(200).json({ token: signingInput + '.' + signature, appId: APP_ID });
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao assinar o token: ' + (e.message || e) });
  }
}
