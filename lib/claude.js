// Conversa com o Claude pela API da Anthropic, com as ferramentas da rede.
const tools = require("./tools");
const store = require("./store");
const env = require("./env");

const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const KEY = () => process.env.ANTHROPIC_API_KEY || "";

async function call(body) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": KEY(), "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 4096, ...body })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data?.error?.message || `API respondeu ${res.status}`), { status: res.status });
  return data;
}

function system() {
  return `Você é o Claude conectado ao Córtex, o segundo cérebro ${env.deQuem()}${env.sobre() ? ": " + env.sobre() : ""}.
Cada nó é uma ideia, um plano ou um projeto, agrupado por área. Responda em português do Brasil, direto, prático e honesto (aponte riscos e furos). Prefira passos concretos com exemplos; para planos, estrutura semana a semana com entregas.
Use as ferramentas quando a pessoa pedir mudanças ou quando for claramente útil, e diga o que mudou. Nunca invente ids. Não apague nós.
Hoje: ${new Date().toLocaleDateString("pt-BR")}.

NÓS DA REDE:
${tools.summary() || "(rede vazia)"}`;
}

// messages: [{role:"user"|"assistant", content:string}] — devolve {text, actions}
async function chat(messages) {
  if (!KEY()) throw Object.assign(new Error("Sem ANTHROPIC_API_KEY"), { status: 401, code: "no_key" });
  const convo = messages.filter(m => m && m.content).slice(-16).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) }));
  const toolDefs = tools.defs.map(d => ({ name: d.name, description: d.description, input_schema: d.schema }));
  const actions = [];
  let round = 0, res = await call({ system: system(), messages: convo, tools: toolDefs });
  while (res.stop_reason === "tool_use" && round < 8) {
    round++;
    convo.push({ role: "assistant", content: res.content });
    const results = res.content.filter(b => b.type === "tool_use").map(b => {
      try {
        const out = tools.run(b.name, b.input);
        if (out && out.acao) actions.push(out.acao);
        return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) };
      } catch (e) {
        return { type: "tool_result", tool_use_id: b.id, content: "Erro: " + e.message, is_error: true };
      }
    });
    convo.push({ role: "user", content: results });
    res = await call({ system: system(), messages: convo, tools: toolDefs });
  }
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("\n\n").trim();
  return { text: text || "(sem texto)", actions };
}

// Transforma um texto solto em nó organizado.
async function organize(text) {
  if (!KEY()) return store.create({ title: text.slice(0, 80), notes: text, type: "ideia", area: "Inbox" });
  const areas = [...new Set(store.all().map(n => n.area))].join(", ") || "(nenhuma)";
  const res = await call({
    max_tokens: 1024,
    messages: [{ role: "user", content: `Organize o texto abaixo em UM nó do segundo cérebro ${env.deQuem()}.
Responda só com JSON: {"title": até 60 caracteres, "type": "ideia"|"plano"|"projeto", "area": string, "notes": o texto organizado em frases claras em português, "links": até 3 ids existentes claramente relacionados}
"projeto" = algo em construção; "plano" = cronograma, meta, rotina ou roteiro; senão "ideia". Reaproveite uma área existente se fizer sentido. Áreas: ${areas}
Nós:
${tools.summary(0) || "(nenhum)"}

Texto:
${text}` }]
  });
  const raw = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const d = JSON.parse(json);
  return store.create({ title: d.title || text.slice(0, 80), type: d.type, area: d.area, notes: d.notes || text, links: Array.isArray(d.links) ? d.links.filter(id => store.get(String(id))) : [] });
}

module.exports = { chat, organize, hasKey: () => !!KEY(), model: MODEL };
