// Córtex — interface do mapa orbital
const TYPES = {
  ideia:   { label: "Ideias",   one: "Ideia" },
  plano:   { label: "Planos",   one: "Plano" },
  projeto: { label: "Projetos", one: "Projeto" }
};
const STATUS = { semente: "Semente", ativo: "Ativo", pausado: "Pausado", feito: "Feito" };
const PALETTE = ["#8052ff", "#ffb829", "#2fbf9c", "#ff6fb1", "#5b8cff", "#ff8a2a", "#c9f27a", "#b46bff", "#4fd6e8"];
const $ = s => document.querySelector(s);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let nodes = new Map(), selected = null, selectedArea = null, coreOpen = false, hovered = null, query = "", status = { apiKey: false };

/* ---------- API ---------- */
async function api(p, opts = {}) {
  const r = await fetch("/api/" + p, { method: opts.method || "GET", headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || "Erro " + r.status), { code: d.code, status: r.status });
  return d;
}
async function load() {
  const list = await api("nodes");
  nodes = new Map(list.map(n => [n.id, n]));
  if (selected && !nodes.has(selected)) selected = null;
  counts(); renderPanel();
}
const live = new EventSource("/api/events");
let liveT;
live.onmessage = e => { if (e.data === "changed") { clearTimeout(liveT); liveT = setTimeout(() => load().catch(() => {}), 120); } };
live.onerror = () => $("#conn").textContent = "servidor offline";

async function save(id, patch) {
  try { const n = await api("nodes/" + id, { method: "PUT", body: patch }); nodes.set(id, n); }
  catch { toast("Não consegui salvar. O servidor está rodando?"); }
}
async function link(a, b, on = true) {
  await api("link", { method: "POST", body: { a, b, on } }).catch(() => toast("Não consegui conectar."));
  await load();
}

/* ---------- geometria ---------- */
const cv = $("#cv"), ctx = cv.getContext("2d");
let W = 0, H = 0, dpr = 1, pos = new Map(), areaPos = new Map(), t0 = performance.now();
/* altura real do topo: no celular ele quebra em três linhas e cobriria o alto do cérebro */
let hudH = 70;
function resize() { hudH = $(".hud-top").offsetHeight; const r = $("#stage").getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr; }
new ResizeObserver(resize).observe($("#stage"));

const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const areaColor = a => a === "Inbox" ? "#e8e4d8" : PALETTE[Math.max(areasList().filter(x => x !== "Inbox").indexOf(a), 0) % PALETTE.length];
const areasList = () => [...new Set([...nodes.values()].map(n => n.area))].sort((a, b) => a.localeCompare(b, "pt-BR"));

function geometry() {
  const heroW = W >= 1300 ? 340 : 0, top = Math.max(70, hudH - 8);
  const cx = heroW + (W - heroW) / 2;
  const cy = top + (H - top - 90) / 2;
  const R = Math.min(W - heroW - 40, H - top - 100) / 2;
  return { cx, cy, R: Math.max(R, 140) };
}
const matches = n => !query || (n.title + " " + n.area + " " + n.notes).toLowerCase().includes(query.toLowerCase());

/* ---------- o cérebro ----------
   Um cérebro de perfil feito de triângulos vazados, em 3D. Coordenadas em
   unidades do próprio cérebro: x vai da testa (−) à nuca (+), y pra cima,
   z pra fora da tela. Cada quadro gira, projeta em perspectiva e converte
   pra pixels com S. As posições saem de um gerador com semente fixa: o
   cérebro tem sempre o mesmo desenho, só o movimento muda. */
function seeded(a) { return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = seeded(20261022);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(6.2832 * rnd());

/* cores: a borda (de perfil pra quem olha) é âmbar e violeta; a face
   voltada pra tela é clara, com lilás e verde-água — como na referência */
const COLORS = ["#ffc531", "#ffb829", "#ffd96a", "#8052ff", "#a68bff", "#ff6fb1", "#f3efff", "#c9b8ff", "#2fbf9c", "#5b8cff"];
const pickFrom = weights => { let r = rnd() * weights.reduce((s, w) => s + w[1], 0); for (const [c, w] of weights) { if ((r -= w) <= 0) return c; } return weights[0][0]; };
const RIM = [[0, 30], [1, 22], [2, 18], [3, 14], [4, 8], [5, 8]];
const FACE = [[6, 34], [7, 20], [8, 15], [4, 13], [9, 8], [2, 10]];

/* contorno do córtex numa direção: elipsoide com testa mais alta, base
   achatada e o lobo temporal estufando embaixo */
const RX_FRONT = 1.08, RX_BACK = 1.02, RZ = .66;
function cortexRadius(dx, dy, dz) {
  const rx = dx < 0 ? RX_FRONT : RX_BACK;
  const ry = dy > 0 ? .74 * (1 - .07 * dx) : .4 + .2 * Math.exp(-(((dx + .15) / .45) ** 2));
  return 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / RZ) ** 2);
}
/* giros: faixas curvas e contínuas, como minhocas. Um seno sobre um campo
   torcido; os pontos ficam nas cristas e os vales (sulcos) ficam vazios. */
const gyri = (x, y, z) => Math.sin(9.5 * (x + .32 * Math.sin(3.1 * y + 1.7 * z) + .22 * Math.sin(4.3 * z - 2.2 * x))
  + 6.2 * (y + .28 * Math.sin(3.7 * x - 1.3 * z)) * .55 + 2.6 * Math.sin(2.3 * z + 1.1 * y));
const fold = gyri;
/* as fendas que fazem um cérebro parecer um cérebro: a lateral (separa o
   lobo temporal) e a central (frontal × parietal). A do meio, entre os
   hemisférios, fica de fora: vista de lado ela abriria um buraco no contorno. */
const segDist = (px, py, ax, ay, bx, by) => { const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy))); return Math.hypot(px - ax - vx * t, py - ay - vy * t); };
const inFissure = (x, y, z) =>
  segDist(x, y, -.42, -.12, .5, .1) < .028 ||
  segDist(x, y, .02, .74, -.16, .06) < .02;

function particle(x, y, z, nx, ny, nz, inner) {
  const nl = Math.hypot(nx, ny, nz) || 1, far = 2.4 + rnd() * 1.6, d = [gauss(), gauss(), gauss()], dl = Math.hypot(...d) || 1;
  return {
    x, y, z, nx: nx / nl, ny: ny / nl, nz: nz / nl, inner,
    rim: pickFrom(RIM), face: pickFrom(FACE), edge: .42 + rnd() * .2,
    size: 1.7 + rnd() * 1.4, rot: rnd() * 6.283, spin: (rnd() - .5) * .0012, tw: rnd() * 6.283,
    // de onde vem na montagem inicial
    sx: d[0] / dl * far, sy: d[1] / dl * far, sz: d[2] / dl * far, delay: rnd() * 420
  };
}
const brain = [];
// córtex: casca com sulcos
while (brain.length < 7400) {
  const g = [gauss(), gauss(), gauss()], l = Math.hypot(...g), dx = g[0] / l, dy = g[1] / l, dz = g[2] / l;
  const r = cortexRadius(dx, dy, dz), x = dx * r, y = dy * r, z = dz * r, f = fold(x, y, z);
  if (inFissure(x, y, z) || (f < -.35 && rnd() < .6)) continue;
  // a crista do giro fica um pouco pra fora, o sulco um pouco pra dentro
  const k = (1 + .03 * f) * (.98 + rnd() * .02), rx = dx < 0 ? RX_FRONT : RX_BACK;
  const q = particle(x * k, y * k, z * k, x / rx ** 2, y / .55, z / RZ ** 2, false);
  q.sulcus = f < -.1; // no fundo do sulco o ponto acende menos: é isso que desenha as dobras
  brain.push(q);
}
// miolo esparso: dá volume quando o cérebro gira
for (let i = 0; i < 160; i++) {
  const g = [gauss(), gauss(), gauss()], l = Math.hypot(...g), dx = g[0] / l, dy = g[1] / l, dz = g[2] / l, r = cortexRadius(dx, dy, dz) * Math.cbrt(rnd()) * .8;
  brain.push(particle(dx * r, dy * r, dz * r, dx, dy, dz, true));
}
// cerebelo: atrás e embaixo, com estrias horizontais
// cerebelo: lâminas finas e paralelas (as folhas), bem marcadas
const CEREBELO = brain.length + 1100;
while (brain.length < CEREBELO) {
  const g = [gauss(), gauss(), gauss()], l = Math.hypot(...g), dx = g[0] / l, dy = g[1] / l, dz = g[2] / l;
  const x = .55 + dx * .3, y = -.36 + dy * .2, z = dz * .46;
  if (Math.sin(46 * (y + .08 * dx)) < -.35) continue;
  brain.push(particle(x, y, z, dx / .36, dy / .22, dz / .5, false));
}
// tronco: um cilindro que afina descendo
for (let i = 0; i < 300; i++) {
  const s = rnd(), y = -.32 - s * .6, a = rnd() * 6.283, r = .12 - s * .035;
  brain.push(particle(.28 + s * .08 + Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a), 0, Math.sin(a), false));
}
const STEM_BASE = { x: .36, y: -.98, z: 0 };

/* triângulos soltos no espaço em volta; alguns perto da câmera, grandes */
const ambient = Array.from({ length: 130 }, () => {
  const near = rnd() < .12;
  return { x: (rnd() - .5) * 4.6, y: (rnd() - .5) * 2.9, z: near ? 1.2 + rnd() * .9 : (rnd() - .5) * 2, c: pickFrom([[1, 30], [3, 30], [8, 20], [5, 10], [6, 10]]),
    size: near ? 9 + rnd() * 10 : 1.6 + rnd() * 2.2, rot: rnd() * 6.283, spin: (rnd() - .5) * .0006, drift: rnd() * 6.283, a: near ? .3 : .25 + rnd() * .35 };
});

/* giro: balança ±26° num ciclo de ~12s. Para devagar quando o ponteiro
   está sobre algo, pra o alvo não fugir do mouse; para na hora quando
   algo é escolhido, pra a câmera centralizar no lugar certo. */
let swayPhase = 0, swaySpeed = 1, lastT = performance.now();
const assembly = { start: performance.now() };
let corePos = { x: 0, y: 0 }, brainCenter = { x: 0, y: 0, S: 1 };

function project(p, rot, S, bx, by) {
  const x1 = p.x * rot.cy + p.z * rot.sy, z1 = -p.x * rot.sy + p.z * rot.cy;
  const y2 = p.y * rot.cp - z1 * rot.sp, z2 = p.y * rot.sp + z1 * rot.cp, f = 3.4 / (3.4 - z2);
  return { x: bx + x1 * S * f, y: by - y2 * S * f, z: z2, f };
}

/* lugar dos nós: cada área ganha uma região na superfície voltada pra
   tela, num arco por cima do cérebro; os nós da área se espalham em
   espiral em volta dela, projetos no meio. */
const TYPE_ORDER = ["projeto", "plano", "ideia"];
function surfaceZ(x, y) {
  const rx = x < 0 ? RX_FRONT : RX_BACK, ry = y > 0 ? .74 * (1 - .07 * x) : .4 + .2 * Math.exp(-(((x + .15) / .45) ** 2));
  return RZ * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2 - (y / ry) ** 2)) * .96 + .04;
}
function nodeLayout() {
  const areas = areasList(), regions = new Map(), base = new Map(), span = 1.1 * Math.PI;
  areas.forEach((a, i) => {
    const th = 1.05 * Math.PI - (i + .5) * span / Math.max(areas.length, 1);
    const c = { x: Math.cos(th) * .56, y: Math.sin(th) * .34 + .06 };
    regions.set(a, { c, out: { x: Math.cos(th) * 1.18, y: Math.sin(th) * .9 + .1, z: .1 }, th });
    const group = [...nodes.values()].filter(n => n.area === a).sort((p, q) => TYPE_ORDER.indexOf(p.type) - TYPE_ORDER.indexOf(q.type) || p.created.localeCompare(q.created));
    group.forEach((n, j) => {
      const ang = j * 2.39996 + hash(a) * 6.283, rad = j ? .1 + .1 * Math.sqrt(j - 1) : 0;
      let x = c.x + Math.cos(ang) * rad * 1.15, y = c.y + Math.sin(ang) * rad * .85;
      const lim = .9 / Math.hypot(x / RX_FRONT, y / .74); if (lim < 1) { x *= lim; y *= lim; }
      base.set(n.id, { x, y, z: surfaceZ(x, y), rx: c.x, ry: c.y, first: !j });
    });
  });
  return { regions, base };
}

/* ---------- desenho ---------- */
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
/* rótulo com um contorno preto por baixo: o texto passa por cima de
   milhares de triângulos e precisa continuar legível */
function label(text, x, y, align, color, weight = 400, size = 11, mono = false) {
  ctx.font = `${weight} ${size}px ${mono ? "'Geist Mono', monospace" : "Geist, sans-serif"}`;
  ctx.textAlign = align; ctx.lineJoin = "round"; ctx.lineWidth = 3.5; ctx.strokeStyle = "rgba(0,0,0,.85)"; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}
const short = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
const tri = (path, x, y, s, r) => { path.moveTo(x + Math.cos(r) * s, y + Math.sin(r) * s); path.lineTo(x + Math.cos(r + 2.094) * s, y + Math.sin(r + 2.094) * s); path.lineTo(x + Math.cos(r + 4.189) * s, y + Math.sin(r + 4.189) * s); path.closePath(); };
const ALPHAS = [.2, .42, .75], RIM_ALPHAS = [.35, .7, 1];

function frame() {
  const now = performance.now(), t = reduce ? 0 : now - t0, dt = Math.min(now - lastT, 64); lastT = now;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!W) return;
  stepAnim();
  ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);

  /* o cérebro com as áreas em volta ocupa ~3,3 S de largura e ~2,3 S de
     altura, mais os nomes: em tela estreita, quem manda é o espaço livre,
     senão as áreas saem do palco e o CLAUDE.MD some atrás da captura */
  const { cx, cy, R } = geometry(), S = Math.min(R, (W - (W >= 1300 ? 340 : 0)) / 2.95, (H - Math.max(70, hudH - 8) - 150) / 2.05), bx = cx - S * .04, by = cy - 10 - S * .02;
  brainCenter = { x: bx, y: by, S };
  if (!reduce) {
    const target = hovered ? 0 : (selected || selectedArea || coreOpen) ? 0 : 1;
    swaySpeed += (target - swaySpeed) * Math.min(1, dt / 350);
    swayPhase += dt * swaySpeed * .0005;
  }
  const yaw = reduce ? -.2 : Math.sin(swayPhase) * .46 - .12, pitch = -.1;
  const rot = { cy: Math.cos(yaw), sy: Math.sin(yaw), cp: Math.cos(pitch), sp: Math.sin(pitch) };
  const focus = hovered && nodes.get(hovered) ? hovered : selected;
  const near = new Set(focus && nodes.get(focus) ? [focus, ...nodes.get(focus).links] : []);
  const dimmed = n => (query && !matches(n)) || (focus && !near.has(n.id)) || (selectedArea && !focus && n.area !== selectedArea);
  const quiet = focus || selectedArea || query ? .55 : 1;
  const thin = 1 / Math.sqrt(view.k);

  // halo: um respiro violeta atrás do cérebro, quase imperceptível
  const g = ctx.createRadialGradient(bx, by, 0, bx, by, S * 1.5); g.addColorStop(0, "rgba(128,82,255,.10)"); g.addColorStop(1, "rgba(128,82,255,0)");
  ctx.fillStyle = g; ctx.fillRect(bx - S * 1.6, by - S * 1.6, S * 3.2, S * 3.2);

  // triângulos soltos, com paralaxe de metade do giro
  const half = { cy: Math.cos(yaw * .5), sy: Math.sin(yaw * .5), cp: rot.cp, sp: rot.sp };
  ctx.lineWidth = thin;
  ambient.forEach(p => {
    const q = project({ x: p.x + Math.sin(t * .00009 + p.drift) * .05, y: p.y + Math.cos(t * .00007 + p.drift) * .04, z: p.z }, half, S, bx, by);
    const path = new Path2D(); tri(path, q.x, q.y, p.size * q.f * thin, p.rot + t * p.spin);
    ctx.globalAlpha = p.a * quiet; ctx.strokeStyle = COLORS[p.c]; ctx.stroke(path);
  });

  // o cérebro, em lotes por cor e profundidade: ~30 traços por quadro em vez de 3 mil
  const buckets = Array.from({ length: COLORS.length * 6 }, () => null);
  const introAge = now - assembly.start;
  for (const p of brain) {
    let { x, y, z } = p;
    if (!reduce && introAge < 1400) {
      const e = EASE_OUT(Math.min(1, Math.max(0, (introAge - p.delay) / 900)));
      x = p.sx + (x - p.sx) * e; y = p.sy + (y - p.sy) * e; z = p.sz + (z - p.sz) * e;
    }
    const q = project({ x, y, z }, rot, S, bx, by);
    const nzs = p.ny * rot.sp + (-p.nx * rot.sy + p.nz * rot.cy) * rot.cp, nz = Math.abs(nzs);
    // a face de trás fica escondida pelo próprio cérebro: sem ela, a frente
    // mostra os giros limpos em vez de duas camadas de ruído sobrepostas
    if (!p.inner && nzs < -.12) continue;
    const onRim = !p.inner && nz < p.edge, c = onRim ? p.rim : p.face;
    const depth = (q.z + 1.1) / 2.2 + (reduce ? 0 : .12 * Math.sin(t * .0016 + p.tw)), lvl = depth < .38 ? 0 : depth < .66 ? 1 : 2;
    const key = ((onRim ? COLORS.length : 0) + c) * 3 + (p.inner ? Math.min(lvl, 1) : p.sulcus && !onRim ? Math.max(0, lvl - 1) : lvl);
    const path = buckets[key] || (buckets[key] = new Path2D());
    tri(path, q.x, q.y, p.size * q.f * thin * Math.min(1, Math.max(S / 260, .7)), p.rot + t * p.spin);
  }
  ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = thin;
  buckets.forEach((path, key) => {
    if (!path) return;
    const ci = Math.floor(key / 3), rim = ci >= COLORS.length;
    ctx.globalAlpha = (rim ? RIM_ALPHAS : ALPHAS)[key % 3] * quiet; ctx.strokeStyle = COLORS[ci % COLORS.length]; ctx.stroke(path);
  });
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;

  // nós, áreas e núcleo, projetados com o mesmo giro
  const { regions, base } = nodeLayout();
  pos = new Map(); areaPos = new Map();
  /* o rótulo de cada nó sai pra longe do centro da região dele: num grupo,
     os nomes se abrem em leque em vez de se empilharem do mesmo lado. O
     primeiro, no meio do grupo, leva o nome embaixo. */
  base.forEach((b, id) => {
    const q = project(b, rot, S, bx, by), rc = project({ x: b.rx, y: b.ry, z: surfaceZ(b.rx, b.ry) }, rot, S, bx, by);
    pos.set(id, { x: q.x, y: q.y, a: b.first ? Math.PI / 2 : Math.atan2(q.y - rc.y, q.x - rc.x) });
  });
  regions.forEach((r, a) => {
    const o = project(r.out, rot, S, bx, by), c = project({ ...r.c, z: surfaceZ(r.c.x, r.c.y) }, rot, S, bx, by);
    areaPos.set(a, { x: o.x, y: o.y, a: Math.atan2(o.y - by, o.x - bx), cx: c.x, cy: c.y });
  });
  const cq = project(STEM_BASE, rot, S, bx, by); corePos = { x: cq.x, y: cq.y };

  // linhas de chamada: de cada área até a região dela, como num atlas
  areaPos.forEach((p, a) => {
    const dim = selectedArea && selectedArea !== a;
    ctx.globalAlpha = dim ? .15 : .55; ctx.strokeStyle = areaColor(a); ctx.lineWidth = thin;
    ctx.setLineDash([2 * thin, 4 * thin]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.cx, p.cy); ctx.stroke(); ctx.setLineDash([]);
  });
  ctx.globalAlpha = 1;

  // conexões entre nós, curvando pra fora do cérebro
  nodes.forEach(n => n.links.forEach(l => {
    if (l < n.id || !pos.has(l) || !pos.has(n.id)) return;
    const a = pos.get(n.id), b = pos.get(l), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const hot = focus && (n.id === focus || l === focus);
    ctx.strokeStyle = hot ? "#ffb829" : "rgba(166,139,255,.8)"; ctx.globalAlpha = hot ? .95 : (focus || query ? .15 : .5); ctx.lineWidth = hot ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx + (mx - bx) * .35, my + (my - by) * .35, b.x, b.y); ctx.stroke();
  }));
  ctx.globalAlpha = 1;

  // núcleo CLAUDE.md, na base do tronco: é por ali que o Claude entra
  const pulse = reduce ? 0 : Math.sin(t * .002) * 2.5, kx = corePos.x, ky = corePos.y;
  const cg = ctx.createRadialGradient(kx, ky, 0, kx, ky, 40); cg.addColorStop(0, "rgba(255,122,41,.35)"); cg.addColorStop(1, "rgba(255,122,41,0)");
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(kx, ky, 40 + pulse, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(kx, ky, 17, 0, Math.PI * 2); ctx.fillStyle = "#1c0d05"; ctx.fill(); ctx.strokeStyle = coreOpen || hovered === "__core" ? "#ffffff" : "#ff7a29"; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = "#ff9a3c"; ctx.beginPath(); ctx.moveTo(kx, ky - 7); ctx.lineTo(kx + 6.5, ky + 4.5); ctx.lineTo(kx - 6.5, ky + 4.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#1c0d05"; ctx.beginPath(); ctx.moveTo(kx, ky - 2); ctx.lineTo(kx + 3, ky + 3); ctx.lineTo(kx - 3, ky + 3); ctx.closePath(); ctx.fill();
  if ("letterSpacing" in ctx) ctx.letterSpacing = "2px";
  label("CLAUDE.MD", kx, ky + 34, "center", "#ffffff", 600, 11);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  // áreas: um anel pequeno fora do cérebro, com o nome
  const placedAreas = [{ x: kx - 50, y: ky - 22, w: 100, h: 62 }], areaLabels = [];
  areaPos.forEach((p, a) => {
    const col = areaColor(a), on = selectedArea === a || hovered === "area:" + a, dim = selectedArea && selectedArea !== a;
    const ox = Math.cos(p.a), oy = Math.sin(p.a), align = ox > .3 ? "left" : ox < -.3 ? "right" : "center";
    ctx.globalAlpha = dim ? .35 : 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.fillStyle = col + "22"; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke(); }
    if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
    const at = short(a.toUpperCase(), 18);
    let lx = p.x + ox * 20, ly = p.y + oy * 20 + (align === "center" ? (oy < 0 ? -4 : 12) : 4), al = align;
    ctx.font = "600 10px Geist, sans-serif";
    const aw = ctx.measureText(at).width + at.length * 1.5, left = al === "left" ? lx : al === "right" ? lx - aw : lx - aw / 2;
    /* sem espaço do lado (celular, ou os botões de zoom à direita): tenta
       em cima, embaixo e mais acima do anel, e fica com o primeiro lugar
       que não cobre nenhum ícone de nó */
    const zoomW = $(".zoom").offsetParent ? 64 : 8, minX = (8 - view.x) / view.k, maxX = (W - zoomW - view.x) / view.k;
    if (left < minX || left + aw > maxX) {
      const cxl = Math.min(Math.max(p.x, minX + aw / 2), maxX - aw / 2);
      const free = y => ![...pos.entries()].some(([id, q]) => { const r = nodes.get(id)?.type === "projeto" ? 22 : 13; return q.x + r > cxl - aw / 2 && q.x - r < cxl + aw / 2 && q.y + r > y - 11 && q.y - r < y + 4; });
      al = "center"; lx = cxl; ly = [p.y - 18, p.y + 28, p.y - 40].find(free) ?? p.y - 18;
    }
    // o texto vai por último, por cima dos nós: no celular ele pode subir pra cima do círculo de um projeto
    areaLabels.push({ at, lx, ly, al, color: on ? "#fff" : "#e8e4f5", alpha: dim ? .35 : 1 });
    placedAreas.push({ x: al === "left" ? lx : al === "right" ? lx - aw : lx - aw / 2, y: ly - 11, w: aw, h: 15 }, { x: p.x - 13, y: p.y - 13, w: 26, h: 26 });
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  });
  ctx.globalAlpha = 1;

  // nós: primeiro os desenhos, depois os nomes
  const glyphs = [], jobs = [];
  nodes.forEach(n => {
    const p = pos.get(n.id); if (!p) return;
    const col = areaColor(n.area), isSel = n.id === selected, isHov = n.id === hovered, on = isSel || isHov, dim = dimmed(n);
    const ox = Math.cos(p.a), oy = Math.sin(p.a), align = ox > .3 ? "left" : ox < -.3 ? "right" : "center";
    const lift = align === "center" && oy < 0 ? -4 : 4;
    ctx.globalAlpha = dim ? .22 : 1;
    if (n.type === "projeto") {
      circle(p.x, p.y, 21); ctx.fillStyle = "#07040f"; ctx.fill(); ctx.strokeStyle = on ? "#ffffff" : "rgba(232,228,245,.7)"; ctx.lineWidth = 1.4; ctx.stroke();
      circle(p.x, p.y, 15); ctx.strokeStyle = col; ctx.lineWidth = n.status === "pausado" ? .6 : 1.2; ctx.stroke();
      const ini = n.title.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "•";
      label(ini, p.x, p.y + 4, "center", "#ffffff", 600, 11);
      if (n.status === "feito") { ctx.beginPath(); ctx.arc(p.x + 15, p.y - 15, 4, 0, Math.PI * 2); ctx.fillStyle = "#2fbf9c"; ctx.fill(); }
      glyphs.push({ id: n.id, x: p.x - 21, y: p.y - 21, w: 42, h: 42 });
      jobs.push({ id: n.id, rank: on ? 0 : 1, dim, text: short(n.title, on ? 40 : 20), x: p.x + ox * 32, y: p.y + oy * 32 + lift, align, color: on ? "#fff" : "#ece8f8", weight: on ? 600 : 400, size: 12 });
    } else if (n.type === "plano") {
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fillStyle = "#000"; ctx.fill(); ctx.strokeStyle = "#ff8a2a"; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fillStyle = n.status === "feito" ? "#2fbf9c" : col; ctx.fill();
      if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke(); }
      glyphs.push({ id: n.id, x: p.x - 12, y: p.y - 12, w: 24, h: 24 });
      jobs.push({ id: n.id, rank: on ? 0 : 2, dim, text: short(n.title, on ? 40 : 22), x: p.x + ox * 20, y: p.y + oy * 20 + lift, align, color: on ? "#fff" : "#ffcf9e", weight: on ? 600 : 400, size: 11 });
    } else {
      const r = 5.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 6, 0, Math.PI * 2); ctx.fillStyle = col + "30"; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      if (n.status === "feito") { ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke(); } else { ctx.fillStyle = n.status === "pausado" ? col + "77" : col; ctx.fill(); }
      if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.stroke(); }
      glyphs.push({ id: n.id, x: p.x - 11, y: p.y - 11, w: 22, h: 22 });
      jobs.push({ id: n.id, rank: on ? 0 : 3, dim, text: short(n.title, on ? 40 : 22), x: p.x + ox * 16, y: p.y + oy * 16 + lift, align, color: on ? "#fff" : "#d6d2e4", weight: on ? 600 : 400, size: 11 });
    }
  });
  ctx.globalAlpha = 1;

  /* nomes: cada um só entra se não cobrir outro nome nem o desenho de outro
     nó. O que está em foco entra sempre; o resto, por ordem de importância.
     Quem ficou de fora aparece ao passar o mouse ou ao aproximar. */
  const taken = [...placedAreas], hit2 = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  jobs.sort((a, b) => (a.rank + (a.dim ? 10 : 0)) - (b.rank + (b.dim ? 10 : 0))).forEach(j => {
    if (j.rank > 0 && query && j.dim) return;
    ctx.font = `${j.weight} ${j.size}px Geist, sans-serif`;
    const w = ctx.measureText(j.text).width, x0 = j.align === "left" ? j.x : j.align === "right" ? j.x - w : j.x - w / 2;
    const box = { x: x0 - 3, y: j.y - j.size, w: w + 6, h: j.size + 5 };
    if (j.rank > 0 && (taken.some(b => hit2(box, b)) || glyphs.some(g => g.id !== j.id && hit2(box, g)))) return;
    taken.push(box);
    ctx.globalAlpha = j.dim ? .22 : 1;
    label(j.text, j.x, j.y, j.align, j.color, j.weight, j.size);
  });
  if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
  areaLabels.forEach(l => { ctx.globalAlpha = l.alpha; label(l.at, l.lx, l.ly, l.al, l.color, 600, 10); });
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.globalAlpha = 1;
  ctx.globalAlpha = 1;
}
function loop() { frame(); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

/* ---------- interação no mapa ---------- */
/* zoom e arrastar: view = deslocamento (x, y) e escala (k) do mapa */
const view = { k: 1, x: 0, y: 0 }, K_MIN = .5, K_MAX = 4;
let anim = null;
const local = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const toWorld = p => ({ x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k });
const clampK = k => Math.min(K_MAX, Math.max(K_MIN, k));

/* curva cúbica de Bézier como no CSS: x é o tempo, y o progresso */
function bezier(x1, y1, x2, y2) {
  const at = (t, a, b) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  const slope = (t, a, b) => 3 * (1 - 3 * b + 3 * a) * t * t + 2 * (3 * b - 6 * a) * t + 3 * a;
  return x => {
    if (x <= 0 || x >= 1) return x;
    let t = x;
    for (let i = 0; i < 8; i++) { const err = at(t, x1, x2) - x, s = slope(t, x1, x2); if (Math.abs(err) < 1e-5 || Math.abs(s) < 1e-6) break; t -= err / s; }
    return at(Math.min(1, Math.max(0, t)), y1, y2);
  };
}
/* a mesma --ease-out do CSS: a câmera responde ao clique na hora e assenta devagar */
const EASE_OUT = bezier(.23, 1, .32, 1);

function zoomAt(sx, sy, factor) {
  anim = null;
  const k = clampK(view.k * factor), f = k / view.k;
  view.x = sx - (sx - view.x) * f; view.y = sy - (sy - view.y) * f; view.k = k;
}
/* quem pediu menos movimento vê a câmera chegar direto, sem viajar */
function animateTo(to, dur = 400) {
  if (reduce || !dur) { anim = null; Object.assign(view, to); return; }
  anim = { from: { ...view }, to, start: performance.now(), dur };
}
function stepAnim() {
  if (!anim) return;
  const p = Math.min(1, (performance.now() - anim.start) / anim.dur), e = EASE_OUT(p);
  ["k", "x", "y"].forEach(key => view[key] = anim.from[key] + (anim.to[key] - anim.from[key]) * e);
  if (p === 1) anim = null;
}
/* botões + e −: cliques seguidos somam a partir do destino em curso, não do quadro atual */
function zoomStep(factor) {
  const b = anim ? anim.to : view, k = clampK(b.k * factor), f = k / b.k;
  animateTo({ k, x: W / 2 - (W / 2 - b.x) * f, y: H / 2 - (H / 2 - b.y) * f }, 240);
}
const resetView = (dur = 400) => animateTo({ k: 1, x: 0, y: 0 }, dur);
/* leva o ponto clicado ao centro do mapa e aproxima. Nunca afasta: se já
   está mais perto que o alvo, só centraliza. */
const FOCUS_K = { node: 2.2, area: 1.8, core: 1.6 };
function focusOn(p, kind) {
  if (!p) return;
  const { cx, cy } = geometry(), k = clampK(Math.max(view.k, FOCUS_K[kind]));
  animateTo({ k, x: cx - p.x * k, y: cy - p.y * k });
}
function centerOn(id) { focusOn(pos.get(id), "node"); }

function hit(e) {
  const { x, y } = toWorld(local(e)), min = 10 / view.k;
  let best = null, bd = Infinity;
  const test = (id, p, rad) => { const d = Math.hypot(p.x - x, p.y - y); if (d < Math.max(rad, min) && d < bd) { bd = d; best = id; } };
  pos.forEach((p, id) => test(id, p, nodes.get(id)?.type === "projeto" ? 24 : 16));
  areaPos.forEach((p, a) => test("area:" + a, p, 22));
  test("__core", corePos, 24);
  return best;
}
/* zoom: false quando a escolha veio do teclado (Esc), que nunca anima */
function pick(h, zoom = true) {
  selected = null; selectedArea = null; coreOpen = false;
  if (h === "__core") coreOpen = true;
  else if (h && h.startsWith("area:")) selectedArea = h.slice(5);
  else selected = h;
  swaySpeed = 0; showTab("node"); renderPanel(true, zoom);
  if (!zoom || !h) return;
  if (h === "__core") focusOn(corePos, "core");
  else if (selectedArea) focusOn(areaPos.get(selectedArea), "area");
  else centerOn(h);
}

const pointers = new Map();
let drag = null;
cv.addEventListener("pointerdown", e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  anim = null;
  const pts = [...pointers.values()];
  drag = pts.length === 1
    ? { mode: "pan", start: pts[0], vx: view.x, vy: view.y, moved: false }
    : { mode: "pinch", dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), moved: true };
});
cv.addEventListener("pointermove", e => {
  const p = local(e);
  if (!pointers.has(e.pointerId)) { hovered = hit(e); cv.style.cursor = hovered ? "pointer" : "grab"; return; }
  pointers.set(e.pointerId, p);
  const pts = [...pointers.values()];
  if (drag && drag.mode === "pan" && pts.length === 1) {
    const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; cv.style.cursor = "grabbing"; hovered = null; }
  }
  if (drag && drag.mode === "pinch" && pts.length >= 2) {
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / drag.dist);
    drag.dist = d;
  }
});
function endPointer(e) {
  const wasTap = drag && !drag.moved && pointers.size === 1 && e.type === "pointerup";
  pointers.delete(e.pointerId);
  if (wasTap) pick(hit(e));
  if (pointers.size === 0) drag = null;
  if (pointers.size === 1 && drag) { const p = [...pointers.values()][0]; drag = { mode: "pan", start: p, vx: view.x, vy: view.y, moved: true }; }
  cv.style.cursor = "grab";
}
cv.addEventListener("pointerup", endPointer);
cv.addEventListener("pointercancel", endPointer);
cv.addEventListener("pointerleave", () => { if (!pointers.size) hovered = null; });
cv.addEventListener("wheel", e => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015))); }, { passive: false });
cv.addEventListener("dblclick", e => { const p = local(e); if (!hit(e)) { const k = clampK(view.k * 1.8), r = k / view.k; animateTo({ k, x: p.x - (p.x - view.x) * r, y: p.y - (p.y - view.y) * r }, 300); } });
$("#z-in").onclick = () => zoomStep(1.35);
$("#z-out").onclick = () => zoomStep(1 / 1.35);
$("#z-reset").onclick = () => resetView();
/* atalhos de teclado são repetidos o tempo todo: respondem sem animação */
document.addEventListener("keydown", e => {
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "") || e.metaKey || e.ctrlKey || e.altKey) return;
  const keys = { "+": () => zoomAt(W / 2, H / 2, 1.35), "=": () => zoomAt(W / 2, H / 2, 1.35), "-": () => zoomAt(W / 2, H / 2, 1 / 1.35), "0": () => resetView(0), "Escape": () => pick(null, false) };
  if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
});
$("#search").addEventListener("input", e => query = e.target.value.trim());

function counts() {
  Object.keys(TYPES).forEach(k => $("#c-" + k).textContent = [...nodes.values()].filter(n => n.type === k).length);
  $("#c-area").textContent = areasList().length;
  $("#stage-empty").hidden = nodes.size > 0;
}

/* ---------- painel ---------- */
function showTab(which) {
  $("#tab-node").setAttribute("aria-selected", which === "node"); $("#tab-claude").setAttribute("aria-selected", which === "claude");
  $("#pane-node").hidden = which !== "node"; $("#pane-claude").hidden = which !== "claude";
}
$("#tab-node").onclick = () => showTab("node");
$("#tab-claude").onclick = () => { showTab("claude"); $("#ask").focus(); };

function el(tag, props = {}, kids = []) { const e = Object.assign(document.createElement(tag), props); kids.forEach(k => k != null && e.append(k)); return e; }
const dotEl = color => el("i", { className: "dot", style: "background:" + color });
function nodeList(list) {
  const ul = el("ul", { className: "list" });
  list.forEach(m => {
    const b = el("button", { type: "button" }, [dotEl(areaColor(m.area)), el("span", { className: "lt", textContent: m.title }), el("span", { className: "la", textContent: TYPES[m.type].one + " · " + m.area })]);
    b.onclick = () => { selected = m.id; selectedArea = null; coreOpen = false; renderPanel(true); centerOn(m.id); };
    ul.append(el("li", {}, [b]));
  });
  return ul;
}

let saveTimer = null;
/* o painel troca de conteúdo num salto; um desvanecer curto mostra que é
   outro nó. Só quando a troca veio de um clique: as recargas ao vivo (a cada
   arquivo salvo) e o Esc redesenham sem animar. */
function fadeIn(pane) {
  if (reduce || !pane.animate) return;
  pane.animate([{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "cubic-bezier(.23, 1, .32, 1)" });
}
function renderPanel(force, animate = force) {
  const pane = $("#pane-node");
  const n = selected && nodes.get(selected);
  if (!force && n && pane.dataset.id === n.id && pane.contains(document.activeElement)) { refreshLinks(n); return; }
  if (animate) fadeIn(pane);
  pane.dataset.id = n ? n.id : "";
  pane.replaceChildren();
  if (coreOpen) return renderCore(pane);
  if (selectedArea) return renderArea(pane, selectedArea);
  if (!n) {
    pane.append(el("p", { className: "eyebrow", textContent: "Rede" }), el("h2", { className: "big", textContent: "Clique em qualquer ponto do mapa." }),
      el("p", { className: "muted", textContent: "A base do cérebro (CLAUDE.MD) mostra como o Claude se conecta. As áreas ficam em volta, ligadas à região delas. Círculos grandes com iniciais são projetos, anéis laranja são planos, pontos são ideias. Mais recentes:" }),
      nodeList([...nodes.values()].sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8)));
    return;
  }
  const ed = el("div", { className: "editor" });
  const eyebrow = el("p", { className: "eyebrow", style: "margin:0;color:" + areaColor(n.area), textContent: TYPES[n.type].one + " · " + n.area });
  const title = el("textarea", { className: "title-in", id: "f-title", rows: 1, value: n.title }); title.setAttribute("aria-label", "Título");
  const fit = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
  const sel = (id, opts, val) => { const s = el("select", { id }); Object.entries(opts).forEach(([k, v]) => s.append(el("option", { value: k, textContent: v }))); s.value = val; return s; };
  const fType = sel("f-type", Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.one])), n.type);
  const fStatus = sel("f-status", STATUS, n.status);
  const dl = el("datalist", { id: "areas" }); areasList().forEach(a => dl.append(el("option", { value: a })));
  const fArea = el("input", { id: "f-area", value: n.area }); fArea.setAttribute("list", "areas");
  const fNotes = el("textarea", { id: "f-notes", value: n.notes, placeholder: "Detalhes, contexto, próximos passos… (Markdown)" });
  const saved = el("span", { className: "saved", textContent: "Salvo" });
  const commit = () => {
    clearTimeout(saveTimer); saved.textContent = "Salvando…";
    saveTimer = setTimeout(async () => {
      const patch = { title: title.value.trim() || "Sem título", type: fType.value, status: fStatus.value, area: fArea.value.trim() || "Inbox", notes: fNotes.value };
      await save(n.id, patch);
      eyebrow.textContent = TYPES[patch.type].one + " · " + patch.area; eyebrow.style.color = areaColor(patch.area);
      saved.textContent = "Salvo"; counts();
    }, 600);
  };
  [title, fType, fStatus, fArea, fNotes].forEach(f => f.addEventListener("input", commit));
  title.addEventListener("input", fit);
  const field = (lbl, input) => { const l = el("label", { textContent: lbl }); l.htmlFor = input.id; return el("div", { className: "field" }, [l, input]); };
  const del = el("button", { className: "ghost danger", textContent: "Apagar", type: "button" });
  del.onclick = async () => {
    if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "Clique de novo para apagar"; setTimeout(() => { if (del.isConnected) { del.textContent = "Apagar"; delete del.dataset.armed; } }, 3000); return; }
    await api("nodes/" + n.id, { method: "DELETE" }).catch(() => toast("Não consegui apagar."));
    selected = null; await load();
  };
  const askBtn = el("button", { className: "ghost", textContent: "Perguntar ao Claude", type: "button" });
  askBtn.onclick = () => { showTab("claude"); const a = $("#ask"); a.value = `Sobre "${n.title}" (id ${n.id}): `; a.focus(); };
  const close = el("button", { className: "ghost", textContent: "Fechar", type: "button" });
  close.onclick = () => { selected = null; renderPanel(true); };
  ed.append(eyebrow, title, el("div", { className: "grid2" }, [field("Tipo", fType), field("Status", fStatus)]), field("Área", fArea), dl, field("Notas", fNotes),
    el("div", { className: "field", id: "links-box" }), el("p", { className: "file", textContent: "cerebro/nos/" + n.id + ".md" }),
    el("div", { className: "row-actions" }, [askBtn, del, close, saved]));
  pane.append(ed); requestAnimationFrame(fit); refreshLinks(n);
}
function refreshLinks(n) {
  const box = $("#links-box"); if (!box) return;
  box.replaceChildren(el("span", { className: "label", textContent: "Conexões (" + n.links.length + ")" }));
  const chips = el("div", { className: "chips" });
  n.links.map(id => nodes.get(id)).filter(Boolean).forEach(o => {
    const go = el("button", { className: "go", type: "button", textContent: o.title }); go.onclick = () => { selected = o.id; renderPanel(true); centerOn(o.id); };
    const x = el("button", { className: "x", type: "button", textContent: "×" }); x.setAttribute("aria-label", "Desconectar " + o.title); x.onclick = () => link(n.id, o.id, false);
    chips.append(el("span", { className: "chip" }, [el("i", { style: "background:" + areaColor(o.area) }), go, x]));
  });
  const add = el("select", { id: "f-link" }); add.setAttribute("aria-label", "Conectar a outro nó");
  add.append(el("option", { value: "", textContent: "+ Conectar a…" }));
  [...nodes.values()].filter(o => o.id !== n.id && !n.links.includes(o.id)).sort((a, b) => a.title.localeCompare(b.title)).forEach(o => add.append(el("option", { value: o.id, textContent: TYPES[o.type].one + " · " + o.title })));
  add.onchange = () => add.value && link(n.id, add.value, true);
  box.append(chips, el("div", { className: "field" }, [add]));
}
function renderArea(pane, a) {
  const list = [...nodes.values()].filter(n => n.area === a);
  const add = el("button", { className: "pill", type: "button", textContent: "Nova ideia nesta área" });
  add.onclick = () => createAndOpen({ title: "Nova ideia", type: "ideia", area: a });
  pane.append(el("p", { className: "eyebrow", style: "color:" + areaColor(a), textContent: "Área" }), el("h2", { className: "big", textContent: a }),
    el("p", { className: "muted", textContent: `${list.filter(n => n.type === "projeto").length} projetos · ${list.filter(n => n.type === "plano").length} planos · ${list.filter(n => n.type === "ideia").length} ideias` }),
    nodeList(list.sort((x, y) => Object.keys(TYPES).indexOf(y.type) - Object.keys(TYPES).indexOf(x.type))), el("div", { style: "margin-top:22px" }, [add]));
}
let coreSeq = 0;
async function renderCore(pane) {
  const seq = ++coreSeq;
  const { text, path } = await api("claude-md").catch(() => ({ text: "", path: "" }));
  const fresh = await api("status").catch(() => null);
  if (fresh) status = fresh;
  const bk = status.backup || {};
  if (seq !== coreSeq || !coreOpen) return;
  pane.replaceChildren();
  const mcpPath = path.replace(/[\\/]cerebro[\\/]CLAUDE\.md$/, "").replace(/\\/g, "/") + "/mcp.js";
  const dirPath = path.replace(/[\\/]CLAUDE\.md$/, "");
  const step = (color, h, body) => el("div", { className: "step" }, [el("h3", {}, [el("i", { style: "background:" + color }), h]), ...body]);
  pane.append(el("p", { className: "eyebrow", textContent: "Núcleo" }), el("h2", { className: "big", textContent: "Como o Claude lê seu cérebro" }),
    el("p", { className: "muted", textContent: "Cada nó é um arquivo Markdown. O índice CLAUDE.md é refeito a cada mudança. São três caminhos, e qualquer edição feita pelo Claude aparece aqui no mapa na hora." }),
    el("div", { className: "steps" }, [
      step(status.apiKey ? "#2fbf9c" : "#9a9a9a", "Chat nesta página", [el("p", { className: "muted", textContent: status.apiKey ? `Ativo com ${status.model}. Use a aba Claude.` : "Desligado. Coloque sua chave da API no arquivo .env e reinicie o servidor:" }), status.apiKey ? null : el("pre", { className: "code", textContent: "ANTHROPIC_API_KEY=sk-ant-..." })]),
      step("#8052ff", "Claude Desktop e Claude Code (MCP)", [el("p", { className: "muted", textContent: "Num segundo terminal, dentro da pasta do Córtex, rode uma vez e depois reinicie o Claude Desktop:" }), el("pre", { className: "code", textContent: "npm run setup-claude" }), el("p", { className: "muted", style: "margin-top:10px", textContent: "Servidor usado: " + mcpPath })]),
      step(bk.enabled ? (bk.error ? "#ff5d6c" : "#2fbf9c") : "#9a9a9a", "Backup no Git", bk.enabled
        ? [el("p", { className: "muted", textContent: (bk.remote ? "Ativo, enviando para " + bk.remote + "." : "Ativo só no computador. Para mandar ao GitHub, rode npm run backup -- <url do repositório>.") + (bk.lastCommit ? " Último commit: " + new Date(bk.lastCommit).toLocaleString("pt-BR") + "." : "") }), bk.error ? el("p", { className: "err", textContent: "Último erro: " + bk.error }) : null]
        : [el("p", { className: "muted", textContent: "Desligado. Crie um repositório privado vazio no GitHub e rode:" }), el("pre", { className: "code", textContent: "npm run backup -- https://github.com/SEU_USUARIO/cortex-cerebro.git" })]),
      step("#ffb829", "Abrir a pasta direto", [el("p", { className: "muted", textContent: "Abra esta pasta no Claude Code e ele lê o CLAUDE.md sozinho:" }), el("pre", { className: "code", textContent: dirPath })]),
      step("#ff8a2a", "CLAUDE.md agora", [el("pre", { className: "code preview", textContent: text })])
    ]));
}
async function createAndOpen(d) {
  const n = await api("nodes", { method: "POST", body: d }).catch(() => null);
  if (!n) return toast("Não consegui criar. O servidor está rodando?");
  nodes.set(n.id, n); selected = n.id; selectedArea = null; coreOpen = false; counts(); showTab("node"); renderPanel(true);
  setTimeout(() => { const t = $("#f-title"); if (t && d.title === "Nova ideia") { t.focus(); t.select(); } }, 30);
}
$("#new-node").onclick = () => createAndOpen({ title: "Nova ideia", type: "ideia", area: selectedArea || "Inbox" });

/* ---------- captura ---------- */
$("#capture").addEventListener("submit", async e => {
  e.preventDefault();
  const inp = $("#cap-text"), text = inp.value.trim(); if (!text) return;
  inp.value = "";
  if (!status.apiKey || !$("#cap-claude").checked) return createAndOpen({ title: text.slice(0, 80), notes: text.length > 80 ? text : "", type: "ideia", area: "Inbox" });
  const btn = $("#cap-send"); btn.disabled = true; btn.textContent = "Organizando…";
  try { const n = await api("organize", { method: "POST", body: { text } }); nodes.set(n.id, n); selected = n.id; counts(); showTab("node"); renderPanel(true); toast("Anexado em " + n.area); }
  catch { await createAndOpen({ title: text.slice(0, 80), notes: text, type: "ideia", area: "Inbox" }); toast("O Claude não respondeu; salvei na Inbox."); }
  finally { btn.disabled = false; btn.textContent = "Anexar"; }
});

/* ---------- chat ---------- */
let turns = [], busy = false;
const msgs = $("#msgs");
function md(s) {
  const esc = s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const inline = x => x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
  let out = "", list = false;
  esc.split("\n").forEach(line => {
    const li = line.match(/^\s*[-*•]\s+(.*)/) || line.match(/^\s*\d+[.)]\s+(.*)/);
    if (li) { out += (list ? "" : "<ul>") + "<li>" + inline(li[1]) + "</li>"; list = true; return; }
    if (list) { out += "</ul>"; list = false; }
    const h = line.match(/^#{1,4}\s+(.*)/);
    if (h) { out += '<span class="h">' + inline(h[1]) + "</span>"; return; }
    if (line.trim()) out += "<p>" + inline(line) + "</p>";
  });
  return out + (list ? "</ul>" : "");
}
function addMsg(kind, text) { const m = el("div", { className: "msg " + kind }); if (kind === "ai") m.innerHTML = md(text); else m.textContent = text; msgs.append(m); msgs.scrollTop = msgs.scrollHeight; return m; }
function intro() {
  msgs.replaceChildren();
  addMsg("ai", status.apiKey
    ? "**Claude conectado ao seu Córtex.** Eu leio a rede inteira e posso criar, editar e conectar ideias, planos e projetos."
    : "**O chat está desligado.** Coloque `ANTHROPIC_API_KEY=...` no arquivo `.env` da pasta do Córtex e reinicie com `npm start`. Sem chave, você ainda pode usar o Claude Desktop ou o Claude Code pelo MCP (clique no núcleo CLAUDE.MD do mapa).");
  if (!status.apiKey) return;
  const box = el("div", { className: "suggest" });
  ["Quais ideias combinam entre si e eu ainda não conectei?", "Monte um plano semana a semana para o projeto mais importante, com entregas concretas.", "O que está parado e qual o próximo passo de cada coisa?", "Organize as ideias soltas da Inbox nas áreas certas."]
    .forEach(q => { const b = el("button", { type: "button", textContent: q }); b.onclick = () => { $("#ask").value = q; send(); }; box.append(b); });
  msgs.append(box);
}
async function send() {
  const box = $("#ask"), text = box.value.trim(); if (!text || busy) return;
  box.value = ""; autosize(); $(".suggest")?.remove();
  addMsg("user", text); turns.push({ role: "user", content: text });
  const bubble = addMsg("think", "Pensando…"); busy = true; $("#ask-send").disabled = true;
  try {
    const r = await api("chat", { method: "POST", body: { messages: turns } });
    r.actions.forEach(a => { const c = el("div", { className: "act", textContent: a }); msgs.insertBefore(c, bubble); });
    bubble.className = "msg ai"; bubble.innerHTML = md(r.text);
    turns.push({ role: "assistant", content: r.text });
  } catch (e) {
    bubble.remove(); turns.pop();
    addMsg("err", e.code === "no_key" ? "Sem chave da API. Veja as instruções no núcleo CLAUDE.MD do mapa." : e.status === 401 ? "A chave da API foi recusada. Confira o .env." : e.status === 429 ? "Limite de uso da API atingido. Espere um pouco." : "Falhou: " + e.message);
  } finally { busy = false; $("#ask-send").disabled = false; msgs.scrollTop = msgs.scrollHeight; }
}
$("#composer").addEventListener("submit", e => { e.preventDefault(); send(); });
const ask = $("#ask");
function autosize() { ask.style.height = "auto"; ask.style.height = Math.min(ask.scrollHeight, 160) + "px"; }
ask.addEventListener("input", autosize);
ask.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });

/* o aviso sobe ao entrar (@starting-style no CSS) e sai descendo pelo mesmo
   caminho; a saída é mais curta que a entrada */
let toastT, toastOutT;
function toast(s) {
  const t = $("#toast"); clearTimeout(toastT); clearTimeout(toastOutT);
  t.textContent = s; t.classList.remove("out"); t.hidden = false;
  toastT = setTimeout(() => { t.classList.add("out"); toastOutT = setTimeout(() => { t.hidden = true; t.classList.remove("out"); }, reduce ? 0 : 160); }, 3200);
}

/* ---------- início ---------- */
(async () => {
  status = await api("status").catch(() => ({ apiKey: false }));
  const c = $("#conn"); c.textContent = status.apiKey ? "Claude on" : "Chat off · MCP"; c.classList.toggle("on", !!status.apiKey);
  if (!status.apiKey) { $("#cap-claude").checked = false; $("#cap-toggle-wrap").hidden = true; }
  intro();
  await load().catch(() => toast("Servidor offline. Rode npm start."));
})();
