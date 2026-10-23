// Armazenamento do Córtex: cada nó é um arquivo Markdown em cerebro/nos/<id>.md
// O índice cerebro/CLAUDE.md é regenerado a cada mudança, para o Claude ler a rede inteira.
const fs = require("fs");
const path = require("path");
const env = require("./env");

const ROOT = process.env.CORTEX_DIR ? path.resolve(process.env.CORTEX_DIR) : path.join(__dirname, "..", "cerebro");
const DIR = path.join(ROOT, "nos");
const TYPES = ["ideia", "plano", "projeto"];
const STATUS = ["semente", "ativo", "pausado", "feito"];
fs.mkdirSync(DIR, { recursive: true });

const slug = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "no";
const iso = () => new Date().toISOString();
const clean = s => String(s ?? "").replace(/[\r\n]+/g, " ").trim();

function parse(text, file) {
  const m = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  (m ? m[1] : "").split("\n").forEach(line => {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  const links = (meta.links || "").replace(/^\[|\]$/g, "").split(",").map(s => s.trim()).filter(Boolean);
  return {
    id: path.basename(file, ".md"),
    title: meta.title || path.basename(file, ".md"),
    type: TYPES.includes(meta.type) ? meta.type : "ideia",
    area: meta.area || "Inbox",
    status: STATUS.includes(meta.status) ? meta.status : "semente",
    links,
    created: meta.created || iso(),
    updated: meta.updated || iso(),
    notes: (m ? m[2] : text).trim()
  };
}

function serialize(n) {
  return `---\ntitle: ${clean(n.title)}\ntype: ${n.type}\narea: ${clean(n.area)}\nstatus: ${n.status}\nlinks: [${n.links.join(", ")}]\ncreated: ${n.created}\nupdated: ${n.updated}\n---\n\n${(n.notes || "").trim()}\n`;
}

function all() {
  return fs.readdirSync(DIR).filter(f => f.endsWith(".md")).sort()
    .map(f => parse(fs.readFileSync(path.join(DIR, f), "utf8"), f));
}
const get = id => {
  const f = path.join(DIR, slug(id) === id ? id + ".md" : "__none__");
  return fs.existsSync(f) ? parse(fs.readFileSync(f, "utf8"), f) : null;
};

function write(n) { fs.writeFileSync(path.join(DIR, n.id + ".md"), serialize(n)); }

function create(d) {
  const base = slug(d.title || "ideia");
  let id = base, k = 2;
  while (fs.existsSync(path.join(DIR, id + ".md"))) id = `${base}-${k++}`;
  const n = {
    id, title: clean(d.title) || "Sem título",
    type: TYPES.includes(d.type) ? d.type : "ideia",
    area: clean(d.area) || "Inbox",
    status: STATUS.includes(d.status) ? d.status : "semente",
    links: [], created: iso(), updated: iso(), notes: String(d.notes || "")
  };
  write(n);
  (d.links || []).forEach(l => link(id, String(l), true));
  reindex();
  return get(id);
}

function update(id, patch) {
  const n = get(id);
  if (!n) return null;
  ["title", "area"].forEach(k => { if (typeof patch[k] === "string") n[k] = clean(patch[k]) || n[k]; });
  if (typeof patch.notes === "string") n.notes = patch.notes;
  if (TYPES.includes(patch.type)) n.type = patch.type;
  if (STATUS.includes(patch.status)) n.status = patch.status;
  n.updated = iso();
  write(n);
  reindex();
  return n;
}

function link(a, b, on) {
  const A = get(a), B = get(b);
  if (!A || !B || a === b) return false;
  [[A, b], [B, a]].forEach(([n, other]) => {
    const has = n.links.includes(other);
    if (on && !has) n.links.push(other);
    if (!on && has) n.links = n.links.filter(x => x !== other);
    n.updated = iso();
    write(n);
  });
  reindex();
  return true;
}

function remove(id) {
  const n = get(id);
  if (!n) return false;
  n.links.forEach(l => link(id, l, false));
  fs.unlinkSync(path.join(DIR, id + ".md"));
  reindex();
  return true;
}

function reindex() {
  const nodes = all();
  const byArea = {};
  nodes.forEach(n => (byArea[n.area] = byArea[n.area] || []).push(n));
  const label = { projeto: "Projeto", plano: "Plano", ideia: "Ideia" };
  const sections = Object.keys(byArea).sort().map(a =>
    `## ${a}\n` + byArea[a].map(n => `- [${n.title}](nos/${n.id}.md) — ${label[n.type]}, ${n.status}` +
      (n.links.length ? ` · liga: ${n.links.join(", ")}` : "")).join("\n")).join("\n\n");
  const md = `# Córtex — segundo cérebro${env.dono() ? " de " + env.dono() : ""}

Este diretório é a memória de ideias, projetos e planejamentos ${env.deQuem()}.${env.sobre() ? "\nSobre: " + env.sobre() : ""}
Claude: leia este índice primeiro e abra os arquivos em \`nos/\` quando precisar dos detalhes.

## Como a rede funciona
- Cada nó é um arquivo \`nos/<id>.md\` com frontmatter: title, type (ideia | plano | projeto), area, status (semente | ativo | pausado | feito), links (ids de outros nós), created, updated.
- O corpo do arquivo são as notas, em Markdown.
- Conexões são bidirecionais: se A liga B, B também liga A.
- Ao criar ou editar nós, mantenha esse formato. O mapa em http://localhost:3333 atualiza sozinho.
- Responda em português do Brasil, direto e prático. Para planos, prefira estrutura semana a semana com entregas concretas.

> Gerado automaticamente. Não edite este arquivo; edite os nós.

# Rede (${nodes.length} nós)

${sections || "_Rede vazia._"}
`;
  fs.writeFileSync(path.join(ROOT, "CLAUDE.md"), md);
  return md;
}

module.exports = { ROOT, DIR, TYPES, STATUS, all, get, create, update, link, remove, reindex };
