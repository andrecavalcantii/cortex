// .env simples, lido pelo servidor e pelo MCP (que roda sozinho, aberto pelo Claude).
// Variáveis: ANTHROPIC_API_KEY, CLAUDE_MODEL, PORT, CORTEX_DIR, CORTEX_DONO, CORTEX_SOBRE
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, "..", ".env");
if (fs.existsSync(envFile)) fs.readFileSync(envFile, "utf8").split(/\r?\n/).forEach(line => {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
});

/* quem é o dono do cérebro, pra o Claude saber com quem fala. Os dois são
   opcionais: sem eles os textos ficam neutros ("o seu segundo cérebro"). */
const dono = () => (process.env.CORTEX_DONO || "").trim();
const sobre = () => (process.env.CORTEX_SOBRE || "").trim();
const deQuem = () => dono() ? "de " + dono() : "de quem o usa";

module.exports = { dono, sobre, deQuem };
