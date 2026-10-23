// Conecta o Córtex ao Claude Desktop (e ao Claude Code, se estiver instalado).
//   npm run setup-claude
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const MCP = path.resolve(__dirname, "..", "mcp.js");
const NODE = process.execPath; // caminho absoluto do Node: o Claude Desktop nem sempre enxerga o PATH
const entry = { command: NODE, args: [MCP] };

function configPaths() {
  const home = os.homedir();
  if (process.platform === "darwin") return [path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")];
  if (process.platform === "win32") {
    const list = [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json")];
    // Versão da Microsoft Store guarda a configuração dentro do pacote
    const pkgs = path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "Packages");
    if (fs.existsSync(pkgs)) fs.readdirSync(pkgs).filter(d => /^Claude_/i.test(d))
      .forEach(d => list.push(path.join(pkgs, d, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json")));
    return list;
  }
  return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Claude", "claude_desktop_config.json")];
}

console.log("\n  Servidor MCP: " + MCP);
console.log("  Node:         " + NODE + "\n");

let wrote = 0;
configPaths().forEach((file, i) => {
  const exists = fs.existsSync(file);
  if (!exists && i > 0) return;
  let cfg = {};
  if (exists) {
    const raw = fs.readFileSync(file, "utf8");
    try { cfg = raw.trim() ? JSON.parse(raw) : {}; }
    catch { console.error("  ✗ Não consegui ler " + file + " (JSON inválido). Corrija o arquivo e rode de novo."); return; }
    fs.writeFileSync(file + ".bak", raw);
  }
  cfg.mcpServers = { ...(cfg.mcpServers || {}), cortex: entry };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  wrote++;
  console.log("  ✓ Claude Desktop configurado: " + file + (exists ? "  (cópia em .bak)" : ""));
});

const win = process.platform === "win32";
const q = a => (win && /\s/.test(a) ? `"${a}"` : a); // no Windows o comando passa pelo shell
const cli = args => spawnSync("claude", args.map(q), { stdio: "ignore", shell: win });
if (cli(["--version"]).status === 0) {
  cli(["mcp", "remove", "--scope", "user", "cortex"]);
  const add = cli(["mcp", "add", "--scope", "user", "cortex", "--", NODE, MCP]);
  console.log(add.status === 0 ? "  ✓ Claude Code configurado (todas as pastas)" : "  • Claude Code: rode manualmente  claude mcp add cortex -- node \"" + MCP + "\"");
}

console.log(wrote ? `
  Agora feche o Claude Desktop por completo (no Windows: clique com o botão
  direito no ícone perto do relógio e escolha Sair) e abra de novo.

  Teste pedindo: "Lista os nós do meu Córtex".
` : "\n  Nada foi configurado.\n");
