#!/usr/bin/env node
// Servidor MCP do Córtex (stdio). Conecta a rede ao Claude Desktop ou ao Claude Code.
// Claude Code:   claude mcp add cortex -- node /caminho/para/cortex/mcp.js
// Claude Desktop: veja o README (claude_desktop_config.json)
const env = require("./lib/env"); // primeiro: CORTEX_DIR vem do .env
const readline = require("readline");
const tools = require("./lib/tools");
const store = require("./lib/store");

const out = msg => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const log = (...a) => process.stderr.write("[cortex-mcp] " + a.join(" ") + "\n");

const methods = {
  initialize: p => ({
    protocolVersion: (p && p.protocolVersion) || "2025-06-18",
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "cortex", version: "1.0.0" },
    instructions: `Córtex é o segundo cérebro ${env.deQuem()}${env.sobre() ? " (" + env.sobre() + ")" : ""}: ideias, planos e projetos conectados. Quando a pessoa contar uma ideia, plano ou projeto, use buscar antes (pra não duplicar), depois criar_no e conectar_nos. Comece por listar_nos ou leia o recurso cortex://CLAUDE.md.`
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: tools.defs.map(d => ({ name: d.name, description: d.description, inputSchema: d.schema })) }),
  "tools/call": p => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(tools.run(p.name, p.arguments || {}), null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: "Erro: " + e.message }], isError: true };
    }
  },
  "resources/list": () => ({ resources: [{ uri: "cortex://CLAUDE.md", name: "Índice do Córtex", mimeType: "text/markdown" }] }),
  "resources/read": () => ({ contents: [{ uri: "cortex://CLAUDE.md", mimeType: "text/markdown", text: store.reindex() }] })
};

readline.createInterface({ input: process.stdin }).on("line", line => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return out({ id: null, error: { code: -32700, message: "JSON inválido" } }); }
  if (msg.id === undefined) return; // notificação
  const fn = methods[msg.method];
  if (!fn) return out({ id: msg.id, error: { code: -32601, message: "Método não suportado: " + msg.method } });
  try { out({ id: msg.id, result: fn(msg.params) }); }
  catch (e) { out({ id: msg.id, error: { code: -32603, message: e.message } }); }
});
log("pronto — pasta:", store.ROOT);
