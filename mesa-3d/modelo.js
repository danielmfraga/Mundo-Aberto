// Modelo da mesa: só dados, sem nada de 3D. O desenho (main.js) apenas lê isto.
// Cada célula tem no máximo UMA base (terreno ou muro) e UMA criatura flutuando por cima.

export const CORES = [
  0x5fa35a, // grama
  0x8b8d9a, // pedra
  0xd9b86c, // areia
  0x4a8fd8, // água
  0xb5523b, // tijolo
  0x8a5a34, // madeira
  0x7b5ac8, // roxo
  0xe8e2cf  // osso
];
export const NOMES_CORES = ['Grama', 'Pedra', 'Areia', 'Água', 'Tijolo', 'Madeira', 'Roxo', 'Osso'];

// altura do topo de cada coisa (em células) e quanto a criatura flutua acima do topo da base
export const ALT = { terreno: 0.1, muro: 1, criatura: 0.7 };
export const TIPOS = ['terreno', 'muro', 'criatura'];
export const N_MIN = 6, N_MAX = 48;

const chave = (x, z) => x + ',' + z;

export class Mesa {
  constructor(n = 20) {
    this.n = n;
    this.bases = new Map();      // chave → {tipo:'terreno'|'muro', x, z, cor}
    this.criaturas = new Map();  // chave → {tipo:'criatura', x, z, cor}
  }

  dentro(x, z) { return Number.isInteger(x) && Number.isInteger(z) && x >= 0 && z >= 0 && x < this.n && z < this.n; }

  /** o que há na célula */
  get(x, z) { const k = chave(x, z); return { base: this.bases.get(k) || null, criatura: this.criaturas.get(k) || null }; }

  /** altura do topo da base (onde a criatura se apoia) */
  topo(x, z) { const b = this.bases.get(chave(x, z)); return b ? ALT[b.tipo] : 0; }

  /** coloca; devolve true se algo mudou */
  poe(tipo, x, z, cor) {
    if (!TIPOS.includes(tipo) || !this.dentro(x, z)) return false;
    const mapa = tipo === 'criatura' ? this.criaturas : this.bases;
    const k = chave(x, z), atual = mapa.get(k);
    if (atual && atual.tipo === tipo && atual.cor === cor) return false;
    mapa.set(k, { tipo, x, z, cor });
    return true;
  }

  /** tira a criatura da célula; se não houver, a base. Devolve o tipo tirado ou null */
  tira(x, z) {
    const k = chave(x, z);
    if (this.criaturas.delete(k)) return 'criatura';
    const b = this.bases.get(k);
    if (b) { this.bases.delete(k); return b.tipo; }
    return null;
  }

  limpa() { this.bases.clear(); this.criaturas.clear(); }

  contagem() {
    let terreno = 0, muro = 0;
    for (const b of this.bases.values()) { if (b.tipo === 'muro') muro++; else terreno++; }
    return { terreno, muro, criatura: this.criaturas.size };
  }

  redimensiona(n) {
    n = Math.max(N_MIN, Math.min(N_MAX, Math.round(n)));
    this.n = n;
    for (const mapa of [this.bases, this.criaturas]) {
      for (const [k, i] of mapa) if (i.x >= n || i.z >= n) mapa.delete(k);
    }
  }

  paraJSON() {
    const itens = [];
    for (const i of this.bases.values()) itens.push({ tipo: i.tipo, x: i.x, z: i.z, cor: i.cor });
    for (const i of this.criaturas.values()) itens.push({ tipo: i.tipo, x: i.x, z: i.z, cor: i.cor });
    return { v: 1, n: this.n, itens };
  }

  /** troca todo o conteúdo; lança Error se o objeto não presta (e então não muda nada) */
  carrega(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('arquivo inválido');
    const n = obj.n;
    if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) throw new Error('tamanho de tabuleiro inválido');
    if (!Array.isArray(obj.itens)) throw new Error('faltam os itens');
    const tmp = new Mesa(n);
    for (const i of obj.itens) {
      if (!i || !TIPOS.includes(i.tipo)) throw new Error('tipo de item desconhecido');
      if (!tmp.dentro(i.x, i.z)) throw new Error('item fora do tabuleiro');
      const cor = Number.isInteger(i.cor) && i.cor >= 0 && i.cor < CORES.length ? i.cor : 0;
      tmp.poe(i.tipo, i.x, i.z, cor);
    }
    this.n = tmp.n; this.bases = tmp.bases; this.criaturas = tmp.criaturas;
  }
}

/** células de a até b, por Bresenham (para arrastar sem deixar buracos) */
export function caminho(a, b) {
  const out = [];
  let x = a.x, z = a.z;
  const dx = Math.abs(b.x - x), dz = Math.abs(b.z - z), sx = x < b.x ? 1 : -1, sz = z < b.z ? 1 : -1;
  let e = dx - dz;
  for (;;) {
    out.push({ x, z });
    if (x === b.x && z === b.z) break;
    const e2 = 2 * e;
    if (e2 > -dz) { e -= dz; x += sx; }
    if (e2 < dx) { e += dx; z += sz; }
  }
  return out;
}

/** a linha reta de células de a até b, presa ao eixo em que o arrasto foi mais longe */
export function linhaEixo(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const fim = Math.abs(dx) >= Math.abs(dz) ? { x: b.x, z: a.z } : { x: a.x, z: b.z };
  return caminho(a, fim);
}
