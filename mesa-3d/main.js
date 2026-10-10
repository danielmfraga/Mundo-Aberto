import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Mesa, CORES, NOMES_CORES, ALT, H_MIN, H_MAX, TEXTURAS, NOMES_TEXTURAS, SPRITES, S_MIN, S_MAX, caminho, linhaEixo } from './modelo.js';

const $ = (id) => document.getElementById(id);
const CHAVE_SALVA = 'mesa3d:v1';

/* ───────── estado ───────── */
const mesa = new Mesa(20);
let ferramenta = 'terreno';
const corPor = { terreno: 0, muro: 1, criatura: 6 };
let alturaMuro = 2;                   // altura dos próximos muros, em células
let texMuro = 'pedra';                // textura dos próximos muros
let spriteCria = null;                // forma das próximas criaturas: null = losango, ou o nome de um sprite
let tamCria = 1.5;                    // largura do sprite, em células
let escala = 3;                       // cada pixel do desenho vira escala×escala pixels da tela
const desfazer = [];                  // fotos (JSON) do tabuleiro antes de cada ação
let golpe = null;                     // a ação em andamento (um arrasto)
const ponteiros = new Set();
let hover = null;

try {
  const s = localStorage.getItem(CHAVE_SALVA);
  if (s) mesa.carrega(JSON.parse(s));
} catch (_) { /* sem memória do navegador, ou arquivo estragado: começa vazio */ }

/* ───────── renderizador em baixa resolução ───────── */
const cena = $('cena');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setClearColor(0x1b1830);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;   // sombra de borda dura: combina com o pixel
const cv = renderer.domElement;
cena.appendChild(cv);

const scene = new THREE.Scene();
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
cam.position.set(1, 1.1, 1).normalize().multiplyScalar(80);

const luzAmbiente = new THREE.AmbientLight(0xffffff, 1.15);
const sol = new THREE.DirectionalLight(0xfff3dc, 2.6);
sol.castShadow = true;
sol.shadow.mapSize.set(2048, 2048);
sol.shadow.bias = -0.0008;
sol.shadow.normalBias = 0.02;
scene.add(luzAmbiente, sol, sol.target);

const controles = new OrbitControls(cam, cv);
controles.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };   // o esquerdo é da ferramenta
controles.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };                               // 1 dedo = ferramenta
controles.enableDamping = true;
controles.dampingFactor = 0.14;
controles.minPolarAngle = 0.25;
controles.maxPolarAngle = 1.42;
controles.minZoom = 0.45;
controles.maxZoom = 4;

function ajustaCamera() {
  const asp = cv.width / cv.height || 1;
  const H = Math.max(mesa.n * 0.5, mesa.n * 0.75 / asp);
  cam.left = -H * asp; cam.right = H * asp; cam.top = H; cam.bottom = -H;
  cam.updateProjectionMatrix();
}

function ajustaTamanho() {
  const w = Math.max(64, Math.floor(cena.clientWidth / escala));
  const h = Math.max(64, Math.floor(cena.clientHeight / escala));
  renderer.setSize(w, h, false);
  cv.style.width = w * escala + 'px';
  cv.style.height = h * escala + 'px';
  ajustaCamera();
}

/* ───────── geometria e materiais compartilhados ───────── */
const geoBloco = new THREE.BoxGeometry(1, 1, 1);
const geoCorpo = new THREE.OctahedronGeometry(0.5, 0);
const matCache = new Map();
function clareia(hex, f) { return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), f); }
function mat(cor, tom = 0, fantasma = false) {
  const k = cor + '/' + tom + '/' + fantasma;
  if (!matCache.has(k)) {
    const m = new THREE.MeshLambertMaterial({ color: clareia(CORES[cor], tom) });
    if (fantasma) { m.transparent = true; m.opacity = 0.55; m.depthWrite = false; }
    matCache.set(k, m);
  }
  return matCache.get(k);
}
/* texturas de muro: cada uma vira um ladrilho pequeno (1 célula de largura × 2 de altura), amostrado sem suavizar */
const TEX_W = 32, TEX_H = 64;
const TEX_CEL_W = 2, TEX_CEL_H = 4;   // o ladrilho cobre 2 células de largura × 4 de altura (as pedras ficam do tamanho de uma casa)
const texCache = new Map();
function textura(nome) {
  if (!TEXTURAS[nome]) return null;
  if (texCache.has(nome)) return texCache.get(nome);
  const c = document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b6a58'; ctx.fillRect(0, 0, TEX_W, TEX_H);          // cor provisória até a imagem chegar
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, TEX_W, TEX_H); t.needsUpdate = true; t.userData.pronta = true; };
  img.src = TEXTURAS[nome];
  texCache.set(nome, t);
  return t;
}
const geoMuroCache = new Map();
/** caixa 0.98 × h × 0.98. A textura segue as coordenadas do MUNDO (x%2, z%2), então muros vizinhos emendam sem salto */
function geoMuro(h, x, z) {
  const key = h + '/' + (x % 2) + '/' + (z % 2);
  if (!geoMuroCache.has(key)) {
    const g = new THREE.BoxGeometry(0.98, h, 0.98);
    const uv = g.attributes.uv;
    const x0 = x % 2, z0 = z % 2;
    for (let i = 0; i < uv.count; i++) {
      const face = Math.floor(i / 4), u = uv.getX(i), v = uv.getY(i);
      if (face > 1 && face < 4) continue;                                   // topo e fundo: sem textura
      let U;
      if (face === 4) U = x0 + 0.01 + 0.98 * u;                             // +z: u cresce para +x
      else if (face === 5) U = x0 + 0.99 - 0.98 * u;                        // -z: u cresce para -x
      else if (face === 0) U = z0 + 0.99 - 0.98 * u;                        // +x: u cresce para -z
      else U = z0 + 0.01 + 0.98 * u;                                        // -x: u cresce para +z
      uv.setXY(i, U / TEX_CEL_W, v * h / TEX_CEL_H);
    }
    geoMuroCache.set(key, g);
  }
  return geoMuroCache.get(key);
}
function matMuro(cor, tex, fant) {     // lados com a textura (se houver), topo e fundo na cor
  const t = textura(tex);
  if (!t) return mat(cor, 0, fant);
  const k = 'muro/' + tex + '/' + cor + '/' + fant;
  if (!matCache.has(k)) {
    const lado = new THREE.MeshLambertMaterial({ map: t, color: new THREE.Color(1.5, 1.5, 1.5) });   // realça: o lado sem sol fica escuro demais
    if (fant) { lado.transparent = true; lado.opacity = 0.55; lado.depthWrite = false; }
    matCache.set(k, [lado, lado, mat(cor, 0.1, fant), mat(cor, 0, fant), lado, lado]);
  }
  return matCache.get(k);
}
/* sprites: desenhos 2D que ficam em pé e viram sempre para a câmera. Sem o arquivo, a forma some da lista. */
const spriteCache = new Map();
function spriteTex(nome) {
  if (!spriteCache.has(nome)) {
    const t = new THREE.TextureLoader().load(SPRITES[nome].arq, () => { t.userData.pronta = true; montaFormas(); }, undefined, () => { t.userData.falhou = true; montaFormas(); });
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;      // ao encolher, mistura (sem falhar pixels); ao ampliar, fica seco
    t.colorSpace = THREE.SRGBColorSpace;
    spriteCache.set(nome, t);
  }
  return spriteCache.get(nome);
}
function matSprite(nome, fant) {
  const k = 'sprite/' + nome + '/' + fant;
  if (!matCache.has(k)) {
    const m = new THREE.MeshBasicMaterial({ map: spriteTex(nome), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
    if (fant) { m.opacity = 0.6; m.depthWrite = false; }
    matCache.set(k, m);
  }
  return matCache.get(k);
}
const geoPlano = new THREE.PlaneGeometry(1, 1);
const geoSombra = new THREE.CircleGeometry(0.5, 14);
const matSombra = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
const matSondaOculta = new THREE.MeshBasicMaterial({ visible: false });
const matOlho = new THREE.MeshBasicMaterial({ color: 0x14111f });
const matApaga = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.5, depthWrite: false });
const matApagaVazio = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.22, depthWrite: false });

const cx = (x) => x - mesa.n / 2 + 0.5;
const cz = (z) => z - mesa.n / 2 + 0.5;

function pedaco(geo, material, fant) {
  const m = new THREE.Mesh(geo, material);
  if (fant) m.raycast = () => {}; else { m.castShadow = true; m.receiveShadow = true; }
  return m;
}

/** monta o desenho de um item. `fant` = versão translúcida (prévia), que não pode ser clicada */
function constroi(item, fant = false) {
  const { tipo, x, z, cor } = item;
  const g = new THREE.Group();
  g.position.set(cx(x), 0, cz(z));
  if (tipo === 'terreno') {
    const a = pedaco(geoBloco, mat(cor, 0, fant), fant);
    a.scale.set(0.995, ALT.terreno, 0.995); a.position.y = ALT.terreno / 2;
    g.add(a);
  } else if (tipo === 'muro') {
    const h = item.h || 1, hc = h - 0.08;
    const corpo = pedaco(geoMuro(hc, x, z), matMuro(cor, item.tex, fant), fant);
    corpo.position.y = hc / 2;
    const topo = pedaco(geoBloco, mat(cor, 0.22, fant), fant);        // coroa mais clara no alto
    topo.scale.set(1, 0.08, 1); topo.position.y = h - 0.04;
    g.add(corpo, topo);
  } else if (item.sprite) {
    const def = SPRITES[item.sprite], s = item.s || def.larg;
    g.position.y = mesa.topo(x, z);
    const pivo = new THREE.Group();                                       // gira para a câmera; os pés ficam na origem
    pivo.position.y = def.voo;
    const plano = new THREE.Mesh(geoPlano, matSprite(item.sprite, fant));
    plano.scale.set(s, s, 1); plano.position.y = s / 2; plano.raycast = () => {};
    pivo.add(plano);
    const sombra = new THREE.Mesh(geoSombra, matSombra);
    sombra.rotation.x = -Math.PI / 2; sombra.position.y = 0.03; sombra.scale.set(s * 0.7, s * 0.7, 1); sombra.raycast = () => {};
    g.add(pivo, sombra);
    if (!fant) {                                                          // área clicável: a coluna da célula, do chão à cabeça
      const alt = def.voo + s * 0.85;
      const sonda = new THREE.Mesh(geoBloco, matSondaOculta);
      sonda.scale.set(0.8, alt, 0.8); sonda.position.y = alt / 2;
      g.add(sonda);
    }
    g.userData.pivo = pivo; g.userData.voo = def.voo; g.userData.fase = (x * 7 + z * 13) % 6.28;
    pivo.quaternion.copy(cam.quaternion);
  } else {
    const y0 = mesa.topo(x, z) + ALT.criatura;
    const corpo = new THREE.Group();
    const c = pedaco(geoCorpo, mat(cor, 0, fant), fant);
    c.scale.set(1, 1.2, 1);
    corpo.add(c);
    for (const lado of [-1, 1]) {
      const olho = pedaco(geoBloco, matOlho, fant);
      olho.scale.set(0.13, 0.13, 0.13); olho.position.set(lado * 0.17, 0.1, 0.38);
      corpo.add(olho);
    }
    corpo.rotation.y = Math.PI / 4;                                     // olhos viram para a câmera inicial
    g.add(corpo);
    g.position.y = y0;
    g.userData.y0 = y0; g.userData.fase = (x * 7 + z * 13) % 6.28;
  }
  return g;
}

/* ───────── o tabuleiro (chão + mesa) ───────── */
const itens = new THREE.Group();     // o que existe de verdade (e pode ser clicado)
const fantasmas = new THREE.Group(); // prévias
const palco = new THREE.Group();     // chão e mesa
scene.add(palco, itens, fantasmas);
let chao = null;
const celulas = new Map();           // "x,z" → { base, cria }

function constroiChao() {
  palco.clear();
  const n = mesa.n;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    ctx.fillStyle = (x + z) % 2 ? '#322d48' : '#463f62';
    ctx.fillRect(x, z, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
  chao = new THREE.Mesh(new THREE.PlaneGeometry(n, n), new THREE.MeshLambertMaterial({ map: tex }));
  chao.rotation.x = -Math.PI / 2;
  chao.receiveShadow = true;
  chao.userData.chao = true;
  const madeira = new THREE.Mesh(new THREE.BoxGeometry(n + 1, 0.8, n + 1), new THREE.MeshLambertMaterial({ color: 0x5b3a29 }));
  madeira.position.y = -0.4 - 0.01;
  madeira.receiveShadow = true; madeira.raycast = () => {};
  palco.add(madeira, chao);

  const r = n * 0.9;
  sol.position.set(-n * 0.55, n * 1.1, n * 0.3);
  sol.shadow.camera.left = -r; sol.shadow.camera.right = r; sol.shadow.camera.top = r; sol.shadow.camera.bottom = -r;
  sol.shadow.camera.near = 1; sol.shadow.camera.far = n * 3;
  sol.shadow.camera.updateProjectionMatrix();
  controles.target.set(0, 0, 0);
}

const k = (x, z) => x + ',' + z;
const criaturasVivas = new Set();    // grupos que balançam

function redesenha(x, z) {
  const ant = celulas.get(k(x, z));
  if (ant) {
    if (ant.base) itens.remove(ant.base);
    if (ant.cria) { itens.remove(ant.cria); criaturasVivas.delete(ant.cria); }
  }
  const { base, criatura } = mesa.get(x, z);
  const novo = { base: null, cria: null };
  if (base) { novo.base = constroi(base); novo.base.userData.cel = { x, z }; itens.add(novo.base); }
  if (criatura) { novo.cria = constroi(criatura); novo.cria.userData.cel = { x, z }; itens.add(novo.cria); criaturasVivas.add(novo.cria); }
  celulas.set(k(x, z), novo);
}

function reconstroi() {
  itens.clear(); celulas.clear(); criaturasVivas.clear();
  constroiChao();
  for (const i of mesa.bases.values()) redesenha(i.x, i.z);
  for (const i of mesa.criaturas.values()) redesenha(i.x, i.z);
  ajustaCamera();
  hud();
}

/* ───────── prévias ───────── */
function limpaFantasmas() { fantasmas.clear(); }

function fantasmaApagar(x, z) {
  const { base, criatura } = mesa.get(x, z);
  const topo = mesa.topo(x, z);
  const h = criatura ? topo + 1.3 : Math.max(topo, 0.12);
  const m = new THREE.Mesh(geoBloco, base || criatura ? matApaga : matApagaVazio);
  m.scale.set(1.02, h, 1.02); m.position.set(cx(x), h / 2, cz(z)); m.raycast = () => {};
  fantasmas.add(m);
}

function previa() {
  limpaFantasmas();
  if (!hover && !(golpe && golpe.ult)) return;
  const alvo = (golpe && golpe.ult) || hover;
  if (!alvo) return;
  if (ferramenta === 'apagar') { fantasmaApagar(alvo.x, alvo.z); return; }
  const cor = corPor[ferramenta];
  let celulasPrev = [alvo];
  if (golpe && ferramenta === 'muro' && golpe.ini) celulasPrev = linhaEixo(golpe.ini, alvo);
  for (const c of celulasPrev) fantasmas.add(constroi({ tipo: ferramenta, x: c.x, z: c.z, cor, h: alturaMuro, tex: texMuro, sprite: ferramenta === 'criatura' ? spriteCria : null, s: tamCria }, true));
}

/* ───────── escolher a célula com o mouse ───────── */
const raio = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function celulaSob(e) {
  const r = cv.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  raio.setFromCamera(ndc, cam);
  const hits = raio.intersectObjects([itens, chao], true);
  for (const h of hits) {
    let o = h.object;
    while (o && !o.userData.cel && !o.userData.chao) o = o.parent;
    if (!o) continue;
    if (o.userData.cel) return o.userData.cel;
    const x = Math.floor(h.point.x + mesa.n / 2), z = Math.floor(h.point.z + mesa.n / 2);
    return mesa.dentro(x, z) ? { x, z } : null;
  }
  return null;
}

/* ───────── ferramentas ───────── */
function aplica(c) {
  if (!c) return false;
  let mudou;
  if (ferramenta === 'apagar') mudou = mesa.tira(c.x, c.z) !== null;
  else mudou = mesa.poe(ferramenta, c.x, c.z, corPor[ferramenta], { h: alturaMuro, tex: texMuro, sprite: spriteCria, s: tamCria });
  if (mudou) { redesenha(c.x, c.z); if (golpe) golpe.mudou = true; }
  return mudou;
}

function cancelaGolpe() {
  if (!golpe) return;
  if (golpe.mudou) { mesa.carrega(JSON.parse(golpe.antes)); reconstroi(); }
  golpe = null; limpaFantasmas();
}

cv.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  ponteiros.add(e.pointerId);
  if (ponteiros.size > 1) { cancelaGolpe(); return; }       // segundo dedo = gesto de câmera
  cv.setPointerCapture(e.pointerId);
  const c = celulaSob(e);
  golpe = { ini: c, ult: c, mudou: false, antes: JSON.stringify(mesa.paraJSON()) };
  hover = c;
  if (ferramenta === 'terreno' || ferramenta === 'apagar') aplica(c);
  previa(); hud();
});

cv.addEventListener('pointermove', (e) => {
  const c = celulaSob(e);
  hover = c;
  if (golpe && ponteiros.has(e.pointerId) && c && (ferramenta === 'terreno' || ferramenta === 'apagar')) {
    const de = golpe.ult || c;
    for (const p of caminho(de, c)) aplica(p);
  }
  if (golpe && c) golpe.ult = c;
  if (golpe && !golpe.ini) golpe.ini = c;
  previa(); hud();
});

function termina(e, cancelado) {
  ponteiros.delete(e.pointerId);
  if (!golpe) return;
  if (cancelado) { cancelaGolpe(); return; }
  const c = celulaSob(e) || golpe.ult;
  if (c) golpe.ult = c;
  if (ferramenta === 'muro' && golpe.ini && golpe.ult) for (const p of linhaEixo(golpe.ini, golpe.ult)) aplica(p);
  if (ferramenta === 'criatura' && golpe.ult) aplica(golpe.ult);
  if (golpe.mudou) { desfazer.push(golpe.antes); if (desfazer.length > 100) desfazer.shift(); guarda(); }
  golpe = null;
  previa(); hud();
}
cv.addEventListener('pointerup', (e) => termina(e, false));
cv.addEventListener('pointercancel', (e) => termina(e, true));
cv.addEventListener('pointerleave', () => { if (!golpe) { hover = null; limpaFantasmas(); hud(); } });

function desfaz() {
  if (golpe) cancelaGolpe();
  const f = desfazer.pop();
  if (!f) return;
  mesa.carrega(JSON.parse(f));
  reconstroi(); guarda();
}

/* ───────── guardar no navegador ───────── */
let tGuarda = 0;
function guarda() {
  clearTimeout(tGuarda);
  tGuarda = setTimeout(() => { try { localStorage.setItem(CHAVE_SALVA, JSON.stringify(mesa.paraJSON())); } catch (_) {} }, 250);
  hud();
}

/* ───────── interface ───────── */
function hud() {
  const c = mesa.contagem();
  $('contagem').textContent = `${c.terreno} terrenos · ${c.muro} muros · ${c.criatura} criaturas`;
  let dentro = 'fora do tabuleiro';
  if (hover) {
    const { base, criatura } = mesa.get(hover.x, hover.z);
    const partes = [];
    if (base) partes.push(base.tipo === 'muro' ? 'muro' : 'terreno');
    if (criatura) partes.push('criatura');
    dentro = `célula ${hover.x + 1}, ${hover.z + 1}` + (partes.length ? ' · ' + partes.join(' + ') : ' · vazia');
  }
  $('celula').textContent = dentro;
  $('desfazerBt').disabled = desfazer.length === 0;
}

function selecionaFerramenta(t) {
  ferramenta = t;
  $('opMuro').hidden = t !== 'muro';
  $('opCria').hidden = t !== 'criatura';
  document.querySelectorAll('.ferr').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  desenhaCores();
  previa();
}

function desenhaCores() {
  const box = $('cores');
  box.innerHTML = '';
  box.classList.toggle('apagado', ferramenta === 'apagar');
  CORES.forEach((hex, i) => {
    const b = document.createElement('button');
    b.className = 'cor' + (ferramenta !== 'apagar' && corPor[ferramenta] === i ? ' on' : '');
    b.style.background = '#' + hex.toString(16).padStart(6, '0');
    b.title = NOMES_CORES[i];
    b.dataset.cor = i;
    b.addEventListener('click', () => { if (ferramenta === 'apagar') return; corPor[ferramenta] = i; desenhaCores(); previa(); });
    box.appendChild(b);
  });
}

document.querySelectorAll('.ferr').forEach((b) => b.addEventListener('click', () => selecionaFerramenta(b.dataset.t)));

/* altura e textura dos próximos muros */
function desenhaOpcoesMuro() {
  $('altVal').textContent = alturaMuro;
  $('altM').textContent = `(${(alturaMuro * 1.5).toString().replace('.', ',')} m)`;
  $('altMenos').disabled = alturaMuro <= H_MIN;
  $('altMais').disabled = alturaMuro >= H_MAX;
  document.querySelectorAll('.tex').forEach((b) => b.classList.toggle('on', b.dataset.tex === texMuro));
}
function mudaAltura(d) { alturaMuro = Math.max(H_MIN, Math.min(H_MAX, alturaMuro + d)); desenhaOpcoesMuro(); previa(); }
$('altMenos').addEventListener('click', () => mudaAltura(-1));
$('altMais').addEventListener('click', () => mudaAltura(1));
for (const nome of Object.keys(TEXTURAS)) {
  const b = document.createElement('button');
  b.className = 'tex'; b.dataset.tex = nome; b.textContent = NOMES_TEXTURAS[nome] || nome;
  b.addEventListener('click', () => { texMuro = nome; desenhaOpcoesMuro(); previa(); });
  $('texs').appendChild(b);
}
desenhaOpcoesMuro();

/* forma e tamanho da próxima criatura */
function montaFormas() {
  const box = $('formas');
  if (!box) return;
  box.innerHTML = '';
  const novo = (rotulo, nome, titulo) => {
    const b = document.createElement('button');
    b.className = 'forma' + (spriteCria === nome ? ' on' : '');
    b.title = titulo; b.dataset.forma = nome || '';
    if (rotulo instanceof Node) b.appendChild(rotulo); else b.textContent = rotulo;
    b.addEventListener('click', () => {
      spriteCria = nome;
      if (nome) tamCria = SPRITES[nome].larg;
      montaFormas(); desenhaTamCria(); previa();
    });
    box.appendChild(b);
  };
  novo('◆', null, 'Losango flutuante');
  for (const [nome, def] of Object.entries(SPRITES)) {
    const t = spriteCache.get(nome);
    if (!t || !t.userData.pronta) continue;                               // arquivo ausente (ou ainda chegando): sem botão
    const img = document.createElement('img');
    img.src = def.arq; img.alt = def.nome; img.className = 'mini';
    novo(img, nome, def.nome);
  }
}
function desenhaTamCria() {
  $('tamVal').textContent = String(tamCria).replace('.', ',');
  $('tamMenos').disabled = !spriteCria || tamCria <= S_MIN;
  $('tamMais').disabled = !spriteCria || tamCria >= S_MAX;
}
function mudaTamCria(d) { if (!spriteCria) return; tamCria = Math.max(S_MIN, Math.min(S_MAX, tamCria + d)); desenhaTamCria(); previa(); }
$('tamMenos').addEventListener('click', () => mudaTamCria(-0.5));
$('tamMais').addEventListener('click', () => mudaTamCria(0.5));
for (const nome of Object.keys(SPRITES)) spriteTex(nome);                // começa a carregar já (e descobre quais existem)
montaFormas(); desenhaTamCria();
$('desfazerBt').addEventListener('click', desfaz);
$('limparBt').addEventListener('click', () => {
  if (mesa.bases.size + mesa.criaturas.size === 0) return;
  desfazer.push(JSON.stringify(mesa.paraJSON()));
  mesa.limpa(); reconstroi(); guarda();
});
$('pixel').addEventListener('change', (e) => { escala = +e.target.value; ajustaTamanho(); });
$('tam').addEventListener('change', (e) => {
  desfazer.push(JSON.stringify(mesa.paraJSON()));
  mesa.redimensiona(+e.target.value);
  reconstroi(); guarda();
});
$('encaixe').addEventListener('change', () => { if ($('encaixe').checked) alvoAz = alvoMaisPerto(); });

$('exportaBt').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(mesa.paraJSON(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'mesa-3d.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('importaBt').addEventListener('click', () => $('arquivo').click());
$('arquivo').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const antes = JSON.stringify(mesa.paraJSON());
  try {
    mesa.carrega(JSON.parse(await f.text()));
    desfazer.push(antes);
    $('tam').value = mesa.n;
    reconstroi(); guarda();
    aviso('Tabuleiro aberto.');
  } catch (err) { aviso('Não deu para abrir: ' + err.message, true); }
});
let tAviso = 0;
function aviso(t, erro) {
  const el = $('aviso');
  el.textContent = t; el.classList.toggle('erro', !!erro); el.hidden = false;
  clearTimeout(tAviso); tAviso = setTimeout(() => { el.hidden = true; }, 3500);
}

addEventListener('keydown', (e) => {
  if (e.target.matches && e.target.matches('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); desfaz(); return; }
  if (e.key === '[') { mudaAltura(-1); return; }
  if (e.key === ']') { mudaAltura(1); return; }
  const t = { 1: 'terreno', 2: 'muro', 3: 'criatura', 4: 'apagar' }[e.key];
  if (t) selecionaFerramenta(t);
});

/* ───────── ângulos encaixados (opcional) ───────── */
let alvoAz = null;
const PASSO = Math.PI / 4;
const alvoMaisPerto = () => Math.round(controles.getAzimuthalAngle() / PASSO) * PASSO;
controles.addEventListener('start', () => { alvoAz = null; });
controles.addEventListener('end', () => { if ($('encaixe').checked) alvoAz = alvoMaisPerto(); });
const eixoY = new THREE.Vector3(0, 1, 0);
function passoEncaixe() {
  if (alvoAz === null) return;
  let d = alvoAz - controles.getAzimuthalAngle();
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const passo = Math.abs(d) < 0.003 ? d : d * 0.22;
  const off = cam.position.clone().sub(controles.target).applyAxisAngle(eixoY, passo);
  cam.position.copy(controles.target).add(off);
  if (Math.abs(d) < 0.003) alvoAz = null;
}

/* ───────── laço de desenho ───────── */
function orientaSprite(g, s) {         // vira para a câmera; quem voa balança
  const p = g.userData.pivo;
  p.quaternion.copy(cam.quaternion);
  if (g.userData.voo > 0) p.position.y = g.userData.voo + Math.sin(s * 2.2 + g.userData.fase) * 0.06;
}
function quadro(t) {
  passoEncaixe();
  controles.update();
  const s = t / 1000;
  for (const g of criaturasVivas) {
    if (g.userData.pivo) { orientaSprite(g, s); continue; }
    g.position.y = g.userData.y0 + Math.sin(s * 2.2 + g.userData.fase) * 0.07;
  }
  for (const g of fantasmas.children) if (g.userData.pivo) orientaSprite(g, s);
  renderer.render(scene, cam);
  requestAnimationFrame(quadro);
}

/* ───────── gancho para os testes: só leitura ───────── */
window.mesa3d = {
  json: () => mesa.paraJSON(),
  escala: () => escala,
  canvas: () => ({ w: cv.width, h: cv.height }),
  ferramenta: () => ferramenta,
  azimute: () => controles.getAzimuthalAngle(),
  alturaMuro: () => alturaMuro,
  sprites: () => Object.fromEntries([...spriteCache].map(([n, t]) => [n, !!t.userData.pronta])),
  tamCria: () => tamCria,
  y0Criatura: (x, z) => { const c = celulas.get(k(x, z)); return c && c.cria ? c.cria.userData.y0 : null; },
  texturaPronta: (n) => !!(texCache.get(n) && texCache.get(n).userData.pronta),
  /** onde, na tela (px da janela), fica o centro da célula (x,z) à altura y */
  tela: (x, z, y = 0) => {
    const v = new THREE.Vector3(cx(x), y, cz(z)).project(cam);
    const r = cv.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }
};

addEventListener('resize', ajustaTamanho);
$('tam').value = mesa.n;
reconstroi();
ajustaTamanho();
selecionaFerramenta('terreno');
hud();
requestAnimationFrame(quadro);
