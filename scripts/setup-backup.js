// Ativa o backup da pasta cerebro/ com Git (e GitHub, se você passar a URL).
//   npm run backup                                   -> só histórico local
//   npm run backup -- https://github.com/voce/cortex-cerebro.git   -> histórico + GitHub
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const store = require("../lib/store");

const url = process.argv[2];
const run = (args, opts = {}) => execFileSync("git", args, { cwd: store.ROOT, encoding: "utf8", windowsHide: true, ...opts }).trim();
const tryRun = args => { try { return run(args, { stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } };

try { execFileSync("git", ["--version"], { stdio: "ignore" }); }
catch {
  console.error("\n  Git não encontrado. Instale em https://git-scm.com/downloads, feche e abra o terminal, e rode de novo.\n");
  process.exit(1);
}

console.log("\n  Pasta do cérebro: " + store.ROOT);
store.reindex();

if (!fs.existsSync(path.join(store.ROOT, ".git"))) {
  run(["init", "-q"]);
  tryRun(["checkout", "-q", "-b", "main"]);
  console.log("  ✓ Repositório Git criado");
}
if (!tryRun(["config", "user.name"])) run(["config", "user.name", "Córtex"]);
if (!tryRun(["config", "user.email"])) run(["config", "user.email", "cortex@localhost"]);

run(["add", "-A"]);
if (spawnSync("git", ["diff", "--cached", "--quiet"], { cwd: store.ROOT }).status !== 0) {
  run(["commit", "-q", "-m", "córtex: backup inicial"]);
  console.log("  ✓ Primeiro commit feito");
}

if (url) {
  if (tryRun(["remote", "get-url", "origin"])) run(["remote", "set-url", "origin", url]);
  else run(["remote", "add", "origin", url]);
  console.log("  ✓ Repositório remoto: " + url);
  console.log("  Enviando para o GitHub (pode abrir uma janela de login na primeira vez)…\n");
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const push = spawnSync("git", ["push", "-u", "origin", branch], { cwd: store.ROOT, stdio: "inherit" });
  if (push.status !== 0) {
    console.error("\n  O envio falhou. Confira se o repositório existe, é seu e está vazio, e se você fez login no Git.\n  Depois rode de novo este comando.\n");
    process.exit(1);
  }
  console.log("\n  ✓ Backup no GitHub ativo.");
}

console.log(`
  Pronto. Com o servidor rodando (npm start), cada mudança vira um commit
  ${url || tryRun(["remote", "get-url", "origin"]) ? "e é enviada ao GitHub " : ""}uns 20 segundos depois.
  Reinicie o servidor se ele já estava aberto.
`);
