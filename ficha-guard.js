// ficha-guard.js — uma ficha nunca vira outra, nunca some em silêncio.
//
// Carregue ANTES de qualquer script que escreva em `personagens`
// (fichas, lista, NPCs, ferramentas, modo mestre). Faz quatro coisas:
//
//  1. TIPO É IMUTÁVEL. Toda escrita de `sheet_data` confere o tipo (dnd,
//     vampiro, cacador, ...) contra o que já está no banco. Tipo diferente
//     = escrita recusada. Foi assim que a ficha D&D do Astrael virou Caçador.
//  2. ERRO NÃO PASSA EM SILÊNCIO. Os `sbFetch` das páginas não olham o status
//     HTTP — um save recusado aparecia como "✓ Salvo!". Aqui toda escrita que
//     o servidor recusar vira exceção + aviso vermelho na tela.
//  3. NÃO GRAVA POR CIMA DO QUE NÃO LEU. A ficha que declara `exigeCarga`
//     só escreve depois de abrir o personagem com sucesso (senão um template
//     em branco sobrescreve a ficha cheia).
//  4. NÃO APAGA DE VERDADE. DELETE em `personagens` é recusado; apagar é
//     marcar `deleted_at`. Ficha apagada fica só-leitura, e código repetido
//     (POST de char_id que já existe) é recusado.
//
// O banco tem as mesmas regras em gatilho (personagens-protecao.sql): este
// arquivo é o aviso bonito e rápido, o gatilho é a trava que não depende
// de nenhuma página.
//
// Sistema novo no futuro: acrescente em PAGINAS e grave `sheet_type` no
// sheet_data. Nada mais.
(function(global) {
  'use strict';
  if (global.FichaGuard) return;

  var SB_URL = 'https://mxyqqfsyybluavwlrhsa.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14eXFxZnN5eWJsdWF2d2xyaHNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwOTM4MzEsImV4cCI6MjA5MzY2OTgzMX0.b0Ij7UGzbMLpqZjLYxoPEu2kGwEW52U_2NSDtpMGUPM';

  // sistema → página da ficha
  var PAGINAS = { cacador: 'ficha.html', vampiro: 'ficha-vampiro.html', dnd: 'ficha-dnd.html' };

  // Mesma regra do gatilho do banco (personagens_tipo): sheet_type manda; sem
  // ele, `vtmFields` marca Vampiro antigo; o resto é Caçador (que nunca grava tipo).
  function tipoDe(sd) {
    if (!sd || typeof sd !== 'object' || Array.isArray(sd)) return null;
    if (sd.sheet_type) return String(sd.sheet_type);
    if (sd.vtmFields) return 'vampiro';
    return 'cacador';
  }
  function paginaDoTipo(tipo) { return PAGINAS[tipo] || null; }

  var realFetch = global.fetch ? global.fetch.bind(global) : null;
  if (!realFetch) return;

  // ── aviso na tela ──────────────────────────────────────────────────
  function aviso(txt, fixo) {
    try {
      if (global.console) console.error('[FichaGuard] ' + txt);
      if (typeof document === 'undefined' || !document.body) return;
      var el = document.getElementById('__ficha-guard-aviso');
      if (!el) {
        el = document.createElement('div');
        el.id = '__ficha-guard-aviso';
        el.setAttribute('role', 'alert');
        el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483647;padding:10px 40px 10px 14px;' +
          'background:#7a1020;color:#fff;font:600 13px/1.4 system-ui,sans-serif;text-align:center;' +
          'box-shadow:0 4px 18px rgba(0,0,0,.6);cursor:pointer';
        el.title = 'Clique para dispensar';
        el.addEventListener('click', function() { el.remove(); });
        document.body.appendChild(el);
      }
      el.textContent = '⚠ ' + txt;
      clearTimeout(el.__t);
      if (!fixo) el.__t = setTimeout(function() { if (el.parentNode) el.remove(); }, 15000);
    } catch (e) {}
  }

  // ── o que o banco sabe de cada char_id (inclui ficha apagada) ─────
  var consultas = {};
  function consulta(charId) {
    if (!consultas[charId]) {
      consultas[charId] = realFetch(
        SB_URL + '/rest/v1/personagens?char_id=eq.' + encodeURIComponent(charId) +
        '&select=deleted_at,tipo:sheet_data->>sheet_type,vtm:sheet_data->vtmFields&order=deleted_at.desc.nullsfirst',
        { headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store' }
      ).then(function(r) {
        if (!r.ok) throw new Error('consulta HTTP ' + r.status);
        return r.json();
      }).then(function(linhas) {
        if (!Array.isArray(linhas) || !linhas.length) return { existe: false };
        var vivas = linhas.filter(function(l) { return !l.deleted_at; });
        var l = vivas[0] || linhas[0];
        return {
          existe: true,
          apagado: !vivas.length,
          tipo: l.tipo ? String(l.tipo) : (l.vtm ? 'vampiro' : 'cacador')
        };
      }).catch(function(e) { delete consultas[charId]; throw e; });
    }
    return consultas[charId];
  }

  // ── a página aberta ────────────────────────────────────────────────
  var pagina = null;   // { tipo, charId, exigeCarga, pronta, ok, falha }
  function init(opt) {
    if (pagina) return;
    pagina = { tipo: opt.tipo, charId: opt.charId, exigeCarga: !!opt.exigeCarga, apagada: false, bloqueio: null };
    pagina.pronta = new Promise(function(ok, no) { pagina.ok = ok; pagina.falha = no; });
    pagina.pronta.catch(function() {});   // rejeição tratada na escrita, não aqui
    if (!pagina.exigeCarga) pagina.ok();
    if (!opt.charId || opt.charId === 'default') return;
    consulta(opt.charId).then(function(info) {
      if (!info.existe) return;
      if (info.tipo !== pagina.tipo) {
        var destino = paginaDoTipo(info.tipo);
        pagina.bloqueio = 'Esta ficha é de outro sistema (' + info.tipo + ').';
        pagina.falha(new Error(pagina.bloqueio));
        if (destino && typeof location !== 'undefined') {
          aviso('Esta ficha é de outro sistema — abrindo a ficha certa…', true);
          location.replace(destino + location.search);
        } else {
          aviso(pagina.bloqueio + ' Edição bloqueada.', true);
        }
      } else if (info.apagado) {
        pagina.apagada = true;
        aviso('Esta ficha foi apagada. Edição bloqueada (nada será gravado).', true);
      }
    }).catch(function(e) {
      // sem saber o que existe no banco, não se escreve
      aviso('Não consegui conferir esta ficha no servidor. Edição bloqueada — recarregue a página.', true);
      if (pagina.exigeCarga) pagina.falha(e);
    });
  }
  function carregou() { if (pagina) pagina.ok(); }
  function falhouCarga(msg) {
    if (!pagina) return;
    pagina.falha(new Error(msg || 'ficha não carregou'));
    aviso('A ficha não carregou. Edição bloqueada para não sobrescrever o que está salvo — recarregue a página.', true);
  }

  // ── escrita em `personagens` ──────────────────────────────────────
  function charIdDaUrl(url) {
    var m = /[?&]char_id=eq\.([^&]+)/.exec(url);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function recusa(txt) {
    aviso(txt, true);
    return Promise.reject(new Error(txt));
  }

  function confere(url, metodo, corpo) {
    var charId = charIdDaUrl(url) || (corpo && corpo.char_id) || null;
    var temSheet = corpo && corpo.sheet_data !== undefined;

    if (temSheet && (corpo.sheet_data === null || tipoDe(corpo.sheet_data) === null)) {
      return recusa('Gravação recusada: a ficha veio vazia/inválida.');
    }
    if (temSheet && !charId) {
      return recusa('Gravação recusada: escrita de ficha sem código (char_id).');
    }
    if (!charId) return Promise.resolve();   // ex.: tirar personagens de um espaço (sem sheet_data)

    var doCorpo = temSheet ? tipoDe(corpo.sheet_data) : null;
    var daPagina = pagina && pagina.charId === charId;

    var espera = daPagina ? pagina.pronta : Promise.resolve();
    return espera.then(null, function() {
      return recusa(pagina.bloqueio || 'Gravação bloqueada: a ficha não foi carregada com sucesso.');
    }).then(function() {
      if (daPagina && pagina.apagada) return recusa('Esta ficha foi apagada: gravação bloqueada.');
      if (temSheet && daPagina && doCorpo !== pagina.tipo) {
        return recusa('Gravação recusada: esta página é de ficha ' + pagina.tipo + ' e tentou gravar ' + doCorpo + '.');
      }
      return consulta(charId).then(function(info) {
        if (metodo === 'POST') {
          if (info.existe) return recusa('Gravação recusada: já existe uma ficha com esse código (' + charId + ').');
          consultas[charId] = Promise.resolve({ existe: true, apagado: false, tipo: doCorpo || (pagina && pagina.tipo) || 'cacador' });
          return;
        }
        if (info.existe && temSheet && info.tipo !== doCorpo) {
          return recusa('Gravação recusada: a ficha salva é ' + info.tipo + ' e a gravação era ' + doCorpo + '. Uma ficha não vira outra.');
        }
      }, function(e) {
        if (temSheet || metodo === 'POST') return recusa('Gravação recusada: não consegui conferir a ficha no servidor (' + e.message + ').');
      });
    });
  }

  global.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var metodo = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (!/\/rest\/v1\/personagens(\?|$)/.test(url) || !/^(POST|PATCH|PUT|DELETE)$/.test(metodo)) {
      return realFetch(input, init);
    }
    if (metodo === 'DELETE' || metodo === 'PUT') {
      return recusa('Apagar ficha de verdade está bloqueado. Apagar = marcar deleted_at.');
    }
    var corpo = null;
    try { corpo = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (e) {}

    return confere(url, metodo, corpo).then(function() {
      return realFetch(input, init);
    }).then(function(res) {
      if (res.ok) return res;
      return res.clone().text().then(function(t) {
        var msg = t;
        try { var j = JSON.parse(t); msg = j.message || j.hint || t; } catch (e) {}
        aviso('NÃO SALVOU — o servidor recusou: ' + String(msg).slice(0, 220), true);
        throw new Error('HTTP ' + res.status + ' ' + String(msg).slice(0, 220));
      });
    });
  };

  global.FichaGuard = {
    init: init, carregou: carregou, falhouCarga: falhouCarga,
    tipoDe: tipoDe, paginaDoTipo: paginaDoTipo, aviso: aviso, PAGINAS: PAGINAS,
    _consulta: consulta
  };
})(typeof window !== 'undefined' ? window : globalThis);
