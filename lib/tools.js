// Ferramentas que o Claude usa para ler e mexer na rede.
// Compartilhadas pelo chat da página (API Anthropic) e pelo servidor MCP (Claude Desktop / Claude Code).
const store = require("./store");

const NODE_FIELDS = {
  title: { type: "string" },
  type: { type: "string", enum: store.TYPES },
  area: { type: "string", description: "Área da vida/negócio, ex.: Trabalho, Estudos, Saúde" },
  status: { type: "string", enum: store.STATUS },
  notes: { type: "string", description: "Notas em Markdown (substitui as notas inteiras)" }
};

const defs = [
  { name: "listar_nos", description: "Lista todos os nós da rede (id, título, tipo, área, status, conexões), sem as notas.", schema: { type: "object", properties: {} } },
  { name: "ler_no", description: "Lê um nó completo pelo id, incluindo as notas inteiras e os títulos das conexões.", schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "buscar", description: "Busca nós cujo título, área ou notas contenham o texto. Retorna id, título e um trecho.", schema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"] } },
  { name: "criar_no", description: "Cria um nó novo (ideia, plano ou projeto). Retorna o id criado.", schema: { type: "object", properties: { ...NODE_FIELDS, links: { type: "array", items: { type: "string" }, description: "ids de nós para conectar" } }, required: ["title", "type", "area"] } },
  { name: "atualizar_no", description: "Altera só os campos enviados de um nó existente.", schema: { type: "object", properties: { id: { type: "string" }, ...NODE_FIELDS }, required: ["id"] } },
  { name: "conectar_nos", description: "Conecta (ou desconecta, com desconectar=true) dois nós pelos ids.", schema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, desconectar: { type: "boolean" } }, required: ["a", "b"] } }
];

const brief = n => ({ id: n.id, title: n.title, type: n.type, area: n.area, status: n.status, links: n.links });

function run(name, input = {}) {
  const need = n => { if (!n) throw new Error("Nó não encontrado: " + input.id); return n; };
  const handlers = {
    listar_nos: () => store.all().map(brief),
    ler_no: () => {
      const n = need(store.get(String(input.id)));
      return { ...n, links: n.links.map(id => ({ id, title: store.get(id)?.title })) };
    },
    buscar: () => {
      const q = String(input.texto || "").toLowerCase();
      return store.all().filter(n => (n.title + " " + n.area + " " + n.notes).toLowerCase().includes(q))
        .map(n => ({ id: n.id, title: n.title, area: n.area, trecho: n.notes.slice(0, 200) }));
    },
    criar_no: () => {
      const n = store.create({ ...input, links: Array.isArray(input.links) ? input.links : [] });
      return { id: n.id, acao: `Criou: ${n.title}` };
    },
    atualizar_no: () => {
      const n = need(store.update(String(input.id), input));
      return { id: n.id, acao: `Atualizou: ${n.title}` };
    },
    conectar_nos: () => {
      const on = !input.desconectar;
      if (!store.link(String(input.a), String(input.b), on)) throw new Error("ids inválidos");
      const t = id => store.get(id).title;
      return { acao: `${on ? "Conectou" : "Desconectou"}: ${t(String(input.a))} ↔ ${t(String(input.b))}` };
    }
  };
  if (!handlers[name]) throw new Error("Ferramenta desconhecida: " + name);
  return handlers[name]();
}

function summary(noteChars = 240) {
  return store.all().map(n =>
    `- id:${n.id} | ${n.type} | área:${n.area} | ${n.status} | ${n.title}` +
    (noteChars ? ` | notas: ${n.notes.replace(/\s+/g, " ").slice(0, noteChars)}` : "") +
    (n.links.length ? ` | liga:${n.links.join(",")}` : "")).join("\n").slice(0, 80000);
}

module.exports = { defs, run, summary };
