// Conferidor de MP — planilha Excel x portal web
//
// Para cada linha da planilha: busca o pedido/linha no portal (na aba que você
// deixou aberta e logada), abre o registro, lê a descrição da matéria-prima e
// compara a polegada com a da planilha. No portal ele só lê e navega.
//
// Tudo que é específico do portal (URL, seletores, textos) fica no config.json.
// Compila com Bun em um único .exe (veja o README).

import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { polegada, classificar } from "./regras.js";

// ---------------------------------------------------------------- configuração
const PADRAO = {
  portal: {
    url: "http://localhost:8765/portal-demo.html#/busca",
    urlContem: "localhost:8765",
    rotaBusca: "#/busca",
    porta: 9222,
    pastaPerfil: "NavegadorConferidor",
    seletorCampoBusca: "#campo-busca",
    seletorBotaoVoltar: "[data-acao='voltar']",
    seletorBotaoDetalhe: "[data-acao='detalhe']",
    seletorLinhasResultado: "#resultados tbody tr",
    seletorAreaDetalhe: "main",
    colunaResultadoPedido: 0,
    colunaResultadoLinha: 1,
    regexCabecalhoDetalhe: "PEDIDO\\s*(\\d+)\\s*LINHA\\s*(\\d+)",
    textoInicioDescricao: "DESCRIÇÃO DA MATÉRIA-PRIMA",
    textoFimDescricao: "LOTE",
    nomeTelaBusca: "Busca",
  },
  planilha: {
    abaPreferida: "",
    cabecalhoPedidoLinha: "PEDIDO ?\\/ ?LINHA|OC ?\\/ ?LINHA|PO ?\\/ ?LINHA",
    cabecalhoResultado: ["^RESULTADO"],
    cabecalhoMaterial: ["MATERIA ?-?PRIMA", "^MP\\b", "MATERIAL"],
    nomeColunaResultado: "RESULTADO MP",
    nomeColunaPortal: "MP portal",
    nomeColunaObs: "Obs MP",
    salvarACada: 20,
  },
};

function carregarConfig() {
  const locais = [path.dirname(process.execPath), process.cwd(), path.join(import.meta.dir || ".", "..")];
  for (const d of locais) {
    const f = path.join(d, "config.json");
    if (fs.existsSync(f)) {
      try {
        const c = JSON.parse(fs.readFileSync(f, "utf8"));
        console.log(`Configuração: ${f}`);
        return { portal: { ...PADRAO.portal, ...c.portal }, planilha: { ...PADRAO.planilha, ...c.planilha } };
      } catch (e) { console.log(`!! config.json inválido (${e.message}). Usando o padrão de demonstração.`); }
    }
  }
  console.log("Sem config.json: usando a configuração de demonstração (portal-demo).");
  return PADRAO;
}
const CFG = carregarConfig();
const P = CFG.portal;

// ---------------------------------------------------------------- script na página
// Executado dentro da aba do portal via CDP (Runtime.evaluate).
const JS_UM_REGISTRO = String.raw`async ([alvo, P]) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (fn, t = 15000) => {
    const s = Date.now();
    while (Date.now() - s < t) { try { const v = fn(); if (v) return v; } catch (e) {} await sleep(150); }
    return null;
  };
  const visivel = el => !!(el && el.offsetParent !== null);
  const naBusca = () => visivel(document.querySelector(P.seletorCampoBusca)) && !visivel(document.querySelector(P.seletorBotaoVoltar));
  const voltar = async () => {
    const s = Date.now();
    while (Date.now() - s < 20000) {
      if (naBusca()) return true;
      const b = document.querySelector(P.seletorBotaoVoltar);
      if (b) b.click();
      await sleep(600);
    }
    return false;
  };
  if (!naBusca()) {
    if (!await voltar()) {
      if (P.rotaBusca) location.hash = P.rotaBusca;
      if (!await waitFor(naBusca, 15000)) return { status: 'SEM_TELA_BUSCA' };
    }
  }
  const [ped, ln] = alvo.split('/');
  const lnN = String(parseInt(ln, 10));
  const linhasTabela = () => [...document.querySelectorAll(P.seletorLinhasResultado)];
  const casa = r => {
    const c = r.querySelectorAll('td');
    const a = c[P.colunaResultadoPedido], b = c[P.colunaResultadoLinha];
    return a && b && a.innerText.trim() === ped && String(parseInt(b.innerText.trim(), 10)) === lnN;
  };
  linhasTabela().forEach(r => r.setAttribute('data-antigo', '1'));
  const inp = document.querySelector(P.seletorCampoBusca);
  inp.focus();
  inp.value = alvo;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  inp.dispatchEvent(new Event('change', { bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  inp.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  const achou = await waitFor(() => linhasTabela().filter(x => !x.hasAttribute('data-antigo')).some(casa), 8000);
  if (!achou) return { status: 'NAO_ENCONTRADO' };
  await sleep(150);
  const linhas = linhasTabela().filter(x => !x.hasAttribute('data-antigo')).filter(casa);
  if (linhas.length !== 1) return { status: 'RESULTADOS_' + linhas.length };
  const btn = linhas[0].querySelector(P.seletorBotaoDetalhe);
  if (!btn) return { status: 'SEM_BOTAO_DETALHE' };
  btn.click();
  const re = new RegExp(P.regexCabecalhoDetalhe, 'i');
  const txt = await waitFor(() => {
    const m = document.querySelector(P.seletorAreaDetalhe);
    if (!m) return null;
    const t = m.innerText;
    const h = t.match(re);
    return h && h[1] === ped && String(parseInt(h[2], 10)) === lnN && t.includes(P.textoFimDescricao) ? t : null;
  }, 20000);
  if (!txt) { await voltar(); return { status: 'DETALHE_NAO_ABRIU' }; }
  const h = txt.match(re) || [];
  const desc = (txt.split(P.textoInicioDescricao)[1] || '').split(P.textoFimDescricao)[0].trim();
  await voltar();
  return { status: 'OK', pedido: h[1] || '', linha: h[2] ? String(parseInt(h[2], 10)) : '', desc };
}`;

const JS_TELA_BUSCA = P => `(() => {
  const v = el => !!(el && el.offsetParent !== null);
  return v(document.querySelector(${JSON.stringify(P.seletorCampoBusca)})) &&
         !v(document.querySelector(${JSON.stringify(P.seletorBotaoVoltar)}));
})()`;

// ---------------------------------------------------------------- utilidades
const filaLinhas = [];
let esperando = null, entradaFechada = false;
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", l => { if (esperando) { const f = esperando; esperando = null; f(l); } else filaLinhas.push(l); });
rl.on("close", () => { entradaFechada = true; if (esperando) { const f = esperando; esperando = null; f(""); } });
const perguntar = q => {
  process.stdout.write(q);
  if (filaLinhas.length) return Promise.resolve(filaLinhas.shift());
  if (entradaFechada) return Promise.resolve("");
  return new Promise(r => { esperando = r; });
};
const dormir = ms => new Promise(r => setTimeout(r, ms));

async function sair(msg, codigo = 0) {
  if (msg) console.log("\n" + msg);
  await perguntar("\nPressione ENTER para fechar...");
  rl.close();
  process.exit(codigo);
}

function texto(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map(x => x.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
  }
  return String(v);
}

// ---------------------------------------------------------------- navegador / CDP
async function listarAbas() {
  try { return await (await fetch(`http://127.0.0.1:${P.porta}/json`)).json(); }
  catch { return null; }
}

function acharNavegador() {
  const e = process.env;
  return [
    e.ProgramFiles && path.join(e.ProgramFiles, "Google/Chrome/Application/chrome.exe"),
    e["ProgramFiles(x86)"] && path.join(e["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
    e.LOCALAPPDATA && path.join(e.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    e["ProgramFiles(x86)"] && path.join(e["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
    e.ProgramFiles && path.join(e.ProgramFiles, "Microsoft/Edge/Application/msedge.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean).find(p => fs.existsSync(p));
}

async function abrirNavegador() {
  if (await listarAbas()) { console.log("Navegador com depuração remota já está aberto."); return; }
  const exe = acharNavegador();
  if (!exe) await sair("Não encontrei o Chrome nem o Edge instalados neste computador.", 1);
  // perfil separado: o Chrome não permite depuração remota no perfil padrão
  const perfil = path.join(process.env.LOCALAPPDATA || process.env.HOME || ".", P.pastaPerfil);
  console.log("Abrindo o navegador...");
  spawn(exe, [`--remote-debugging-port=${P.porta}`, "--remote-allow-origins=*", `--user-data-dir=${perfil}`, P.url],
    { detached: true, stdio: "ignore" }).unref();
  let abas = null;
  for (let i = 0; i < 40 && !abas; i++) { await dormir(500); abas = await listarAbas(); }
  if (!abas) await sair(`O navegador abriu, mas não respondeu na porta ${P.porta}. Feche-o e tente de novo.`, 1);
}

class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pend = new Map(); }
  abrir() {
    return new Promise((ok, erro) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => ok();
      this.ws.onerror = e => erro(new Error("WebSocket: " + (e.message || "falhou")));
      this.ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pend.has(m.id)) { this.pend.get(m.id)(m); this.pend.delete(m.id); }
      };
    });
  }
  enviar(method, params, timeout = 60000) {
    const id = ++this.id;
    return new Promise((ok, erro) => {
      const t = setTimeout(() => { this.pend.delete(id); erro(new Error("tempo esgotado")); }, timeout);
      this.pend.set(id, m => { clearTimeout(t); ok(m); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async avaliar(expr) {
    const m = await this.enviar("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.error) throw new Error(m.error.message);
    if (m.result.exceptionDetails) throw new Error(m.result.exceptionDetails.text || "erro no script da página");
    return m.result.result.value;
  }
}

// espera o comando do usuário (ENTER) e só começa se a aba estiver na tela de busca
async function aguardarComando() {
  while (true) {
    console.log(`\n>>> No navegador: faça login e deixe aberta a tela '${P.nomeTelaBusca}'.`);
    await perguntar(">>> Quando estiver na tela certa, pressione ENTER aqui para COMEÇAR... ");
    const abas = (await listarAbas()) || [];
    const candidatas = abas.filter(a => a.type === "page" && a.url.includes(P.urlContem));
    if (!candidatas.length) {
      console.log("!! Não achei nenhuma aba do portal nesse navegador.");
      if (entradaFechada) await sair("Entrada do teclado encerrada.", 1);
      continue;
    }
    for (const aba of candidatas) {
      const cdp = new CDP(aba.webSocketDebuggerUrl);
      try { await cdp.abrir(); } catch { continue; }
      let ok = false;
      try { ok = await cdp.avaliar(JS_TELA_BUSCA(P)); } catch {}
      if (ok) return { aba, cdp };
      try { cdp.ws.close(); } catch {}
    }
    console.log(`!! A aba do portal não está na tela '${P.nomeTelaBusca}' (ou ainda está carregando).`);
    if (entradaFechada) await sair("Entrada do teclado encerrada.", 1);
  }
}

// ---------------------------------------------------------------- planilha
async function escolherPlanilha() {
  const arg = process.argv.slice(2).find(a => a.toLowerCase().endsWith(".xlsx"));
  if (arg) return arg;
  const pasta = path.dirname(process.execPath);
  const lista = fs.readdirSync(pasta).filter(f => f.toLowerCase().endsWith(".xlsx") && !f.includes("_conferido") && !f.startsWith("~$"));
  if (lista.length === 1) return path.join(pasta, lista[0]);
  if (lista.length > 1) {
    console.log("Planilhas encontradas nesta pasta:");
    lista.forEach((f, i) => console.log(`  ${i + 1}) ${f}`));
    const n = parseInt(await perguntar("Número da planilha: "), 10);
    if (lista[n - 1]) return path.join(pasta, lista[n - 1]);
  }
  return (await perguntar("Caminho da planilha .xlsx (pode arrastar o arquivo para esta janela): ")).trim().replace(/^"|"$/g, "");
}

const norm = t => texto(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const letra = n => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const numCol = l => [...l.toUpperCase()].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const RE_ALVO = /^\d{4,}\s*\/\s*\d{1,5}$/;
const lista = v => (Array.isArray(v) ? v : [v]).filter(Boolean).map(s => new RegExp(s, "i"));

function detectarColunas(ws) {
  const C = CFG.planilha;
  const rePL = new RegExp(C.cabecalhoPedidoLinha, "i");
  const reRes = lista(C.cabecalhoResultado);
  const reMat = lista(C.cabecalhoMaterial);

  let hdr = 1;
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++)
    if (ws.getRow(r).values.map(norm).some(v => rePL.test(v) || /\b(OC|PO|PEDIDO)\b/.test(v))) { hdr = r; break; }

  const cab = {};
  const row = ws.getRow(hdr);
  const ultima = Math.max(ws.columnCount, row.cellCount);
  for (let c = 1; c <= ultima; c++) cab[c] = norm(row.getCell(c).value);
  const acha = (...testes) => { for (const t of testes) for (let c = 1; c <= ultima; c++) if (cab[c] && t(cab[c])) return c; return null; };

  const m = { hdr, ultima, cab };
  m.alvo = acha(v => rePL.test(v));
  if (!m.alvo) {
    // procura nos dados uma coluna no formato 123456789/00010
    const cont = {};
    for (let r = hdr + 1; r <= Math.min(ws.rowCount, hdr + 200); r++)
      for (let c = 1; c <= ultima; c++) if (RE_ALVO.test(texto(ws.getRow(r).getCell(c).value).trim())) cont[c] = (cont[c] || 0) + 1;
    const melhor = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
    if (melhor) m.alvo = +melhor[0];
  }
  if (!m.alvo) {
    m.ped = acha(v => /^(OC|PO|PEDIDO|N(UMERO)? ?(OC|PO|PEDIDO))$/.test(v));
    m.linha = acha(v => /^(LINHA|ITEM|LINHA (OC|PO|PEDIDO)|(OC|PO) LINHA)$/.test(v));
  }
  m.res = acha(...reRes.map(re => v => re.test(v)));
  m.pol = acha(v => /\bPOL\b|POLEGADA/.test(v) && !/PORTAL/.test(v));
  m.mp = acha(...reMat.map(re => v => re.test(v) && !/PORTAL/.test(v) && !reRes.some(x => x.test(v))));
  m.mpPortal = acha(v => v === norm(C.nomeColunaPortal) || /MP PORTAL/.test(v));
  m.obs = acha(v => v === norm(C.nomeColunaObs) || /^OBS/.test(v));
  return m;
}

function descreverColunas(m) {
  const l = c => c ? `${letra(c)} ("${m.cab[c] || ""}")` : "-";
  console.log(`\nColunas da planilha (linha ${m.hdr}):`);
  console.log("  " + Object.keys(m.cab).filter(c => m.cab[c]).map(c => `${letra(+c)}=${m.cab[c]}`).join(" | "));
  console.log(`\nColunas que vou usar:`);
  if (m.alvo) console.log(`  PEDIDO/LINHA .... ${l(m.alvo)}`);
  else console.log(`  PEDIDO .......... ${l(m.ped)}\n  LINHA ........... ${l(m.linha)}`);
  console.log(`  Pol planilha .... ${l(m.pol)}${m.pol ? "" : (m.mp ? "  (vou tirar a polegada da coluna " + letra(m.mp) + ")" : "")}`);
  if (!m.pol) console.log(`  MP planilha ..... ${l(m.mp)}`);
  console.log(`  Resultado ....... ${m.res ? l(m.res) : "nova coluna no final"}`);
  console.log(`  MP portal ....... ${m.mpPortal ? l(m.mpPortal) : "nova coluna no final"}`);
  console.log(`  Obs ............. ${m.obs ? l(m.obs) : "nova coluna no final"}`);
}

async function confirmarColunas(ws) {
  const C = CFG.planilha;
  const m = detectarColunas(ws);
  while (true) {
    descreverColunas(m);
    const r = (await perguntar("\nENTER para confirmar, ou corrija (ex.: PL=B POL=D | PED=A LINHA=B MP=G | RES=H): ")).trim().toUpperCase();
    if (!r) break;
    for (const par of r.split(/[\s,;]+/)) {
      const [k, v] = par.split("=");
      if (!v || !/^[A-Z]{1,3}$/.test(v)) continue;
      const n = numCol(v);
      if (k === "PL" || k === "OC") { m.alvo = n; m.ped = null; m.linha = null; }
      if (k === "PED") { m.ped = n; m.alvo = null; }
      if (k === "LINHA") { m.linha = n; if (m.alvo) { m.ped = m.alvo; m.alvo = null; } }
      if (k === "POL") m.pol = n;
      if (k === "MP") m.mp = n;
      if (k === "RES") { m.res = n; m.mpPortal = n + 1; m.obs = n + 2; }
      if (k === "PORTAL") m.mpPortal = n;
      if (k === "OBS") m.obs = n;
    }
  }
  if (!m.alvo && !(m.ped && m.linha)) await sair("Não sei em qual coluna está o pedido/linha. Rode de novo e informe, ex.: PL=B", 1);
  let prox = m.ultima;
  const hdrRow = ws.getRow(m.hdr);
  if (!m.res) { m.res = ++prox; hdrRow.getCell(m.res).value = C.nomeColunaResultado; }
  if (!m.mpPortal) { m.mpPortal = ++prox; hdrRow.getCell(m.mpPortal).value = C.nomeColunaPortal; }
  if (!m.obs) { m.obs = ++prox; hdrRow.getCell(m.obs).value = C.nomeColunaObs; }
  hdrRow.commit();
  const saidas = new Set([m.res, m.mpPortal, m.obs]);
  m.extrasPol = Object.keys(m.cab).map(Number).filter(c => !saidas.has(c) && c !== m.pol && c !== m.mp && /POL|MP|MATERI|DESCRI/.test(m.cab[c] || ""));
  return m;
}

function lerAlvo(r, m) {
  if (m.alvo) {
    const v = texto(r.getCell(m.alvo).value).replace(/\s+/g, "");
    if (!/^\d+\/\d+$/.test(v)) return null;
    const [p, l] = v.split("/");
    return p + "/" + l.padStart(5, "0");
  }
  const p = texto(r.getCell(m.ped).value).replace(/\D/g, "");
  const l = texto(r.getCell(m.linha).value).replace(/\D/g, "");
  if (!p || !l) return null;
  return p + "/" + l.padStart(5, "0");
}

// ---------------------------------------------------------------- principal
async function main() {
  console.log("=== Conferidor de MP — planilha x portal ===\n");
  await abrirNavegador();
  console.log("(Pode fazer o login no navegador enquanto responde as perguntas abaixo.)\n");
  const entrada = await escolherPlanilha();
  if (!entrada || !fs.existsSync(entrada)) await sair(`Planilha não encontrada: ${entrada}`, 1);

  const saida = entrada.replace(/\.xlsx$/i, "_conferido.xlsx");
  if (!fs.existsSync(saida)) fs.copyFileSync(entrada, saida);
  else console.log("Continuando o arquivo _conferido já existente (linhas com resultado serão puladas).");

  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.readFile(saida); }
  catch (e) { await sair(`Não consegui abrir a planilha (está aberta no Excel?): ${e.message}`, 1); }

  const reAba = CFG.planilha.abaPreferida ? new RegExp(CFG.planilha.abaPreferida, "i") : null;
  const idxPref = reAba ? Math.max(0, wb.worksheets.findIndex(w => reAba.test(w.name))) : 0;
  let ws = wb.worksheets[idxPref];
  if (wb.worksheets.length > 1) {
    console.log("Abas da planilha:");
    wb.worksheets.forEach((w, i) => console.log(`  ${i + 1}) ${w.name}`));
    const n = parseInt(await perguntar(`Número da aba [${idxPref + 1}]: `), 10) || idxPref + 1;
    if (wb.worksheets[n - 1]) ws = wb.worksheets[n - 1];
  }
  const col = await confirmarColunas(ws);

  let sug = col.hdr + 1;
  while (sug <= ws.rowCount && texto(ws.getRow(sug).getCell(col.res).value).trim()) sug++;
  const ini = parseInt(await perguntar(`\nLinha inicial [${sug}]: `), 10) || sug;
  const fim = parseInt(await perguntar(`Linha final [${ws.rowCount}]: `), 10) || ws.rowCount;

  const { aba, cdp } = await aguardarComando();
  console.log(`\nComeçando na aba: ${aba.title || aba.url}\n`);

  const salvar = async () => {
    for (let t = 0; t < 5; t++) {
      try { await wb.xlsx.writeFile(saida); return; }
      catch { console.log("!! Não consegui salvar (arquivo aberto no Excel?). Tentando de novo em 5 s..."); await dormir(5000); }
    }
  };

  const t0 = Date.now();
  let feitos = 0, seguidas = 0, semAlvo = 0, jaFeitas = 0;
  const resumo = {};
  for (let row = ini; row <= fim; row++) {
    const r = ws.getRow(row);
    const alvo = lerAlvo(r, col);
    if (!alvo) { semAlvo++; continue; }
    if (texto(r.getCell(col.res).value).trim() && !texto(r.getCell(col.obs).value).startsWith("Registro não encontrado")) { jaFeitas++; continue; }
    let pol = texto(r.getCell(col.pol || col.mp || col.alvo || col.ped).value).trim();
    if (polegada(pol) == null)
      for (const c of col.extrasPol) { const v = texto(r.getCell(c).value).trim(); if (polegada(v) != null) { pol = v; break; } }

    let res = null;
    for (let tent = 0; tent < 3; tent++) {
      try { res = await cdp.avaliar(`(${JS_UM_REGISTRO})(${JSON.stringify([alvo, P])})`); }
      catch (e) { res = { status: "ERRO " + e.message }; }
      if (res && res.status === "OK") break;
      await dormir(/navigat|closed|context/i.test(res.status) ? 4000 : 1000);
    }
    if (!res || res.status !== "OK") {
      if (++seguidas >= 5) {
        console.log("\n!! 5 registros seguidos sem resposta. A sessão do portal pode ter caído.");
        await perguntar(`!! Confira o login no navegador (tela '${P.nomeTelaBusca}') e pressione ENTER para continuar... `);
        seguidas = 0; row--; continue;
      }
    } else seguidas = 0;

    const [e, f, g] = classificar(alvo, pol, res);
    r.getCell(col.res).value = e;
    r.getCell(col.mpPortal).value = f || null;
    r.getCell(col.obs).value = g || null;
    r.commit();
    feitos++;
    const k = e === "MP OK" || e === "VERIFICAR" ? e : "POL DIFERENTE";
    resumo[k] = (resumo[k] || 0) + 1;
    console.log(`[${String(row).padStart(4)}] ${alvo.padEnd(16)} ${pol.padEnd(10)} -> ${e.padEnd(10)} ${f}  ${g}`);
    if (feitos % CFG.planilha.salvarACada === 0) await salvar();
  }
  await salvar();
  try { cdp.ws.close(); } catch {}

  const s = Math.round((Date.now() - t0) / 1000);
  console.log(`\nPronto: ${feitos} linhas em ${Math.floor(s / 60)} min ${s % 60} s`);
  if (semAlvo) console.log(`  (${semAlvo} linhas puladas sem pedido/linha válido na coluna escolhida)`);
  if (jaFeitas) console.log(`  (${jaFeitas} linhas puladas porque já tinham resultado)`);
  console.log(`Arquivo: ${saida}`);
  for (const [k, v] of Object.entries(resumo)) console.log(`  ${k}: ${v}`);
  await sair();
}

if (import.meta.main) main().catch(e => sair("Erro inesperado: " + (e && e.stack || e), 1));
