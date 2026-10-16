// Regras de comparação (sem dependências: dá para testar isoladamente)

export const CORTADO = "CORTADO - NÃO DÁ PARA LER";

/** "1 1/2 POL" -> 1.5 | "1,500 POL" -> 1.5 | "0.5POL" -> 0.5 | sem POL -> null */
export function polegada(t) {
  if (t == null) return null;
  const m = String(t).toUpperCase().match(/(\d+)(?:[.,](\d+))?(?:\s+(\d+)\/(\d+))?\s*POL/);
  if (!m) return null;
  let v = parseFloat(m[1] + "." + (m[2] || "0"));
  if (m[3]) v += parseInt(m[3], 10) / parseInt(m[4], 10);
  return v;
}
export const fmtPol = v => v.toFixed(3).replace(".", ",") + " POL";

/** devolve [resultado, descrição do portal, observação] */
export function classificar(alvo, polPlanilha, r) {
  if (!r || r.status !== "OK") return ["VERIFICAR", "", `Registro não encontrado no portal (${r ? r.status : "sem resposta"})`];
  const desc = r.desc || "";
  const [ped, ln] = alvo.split("/");
  if (r.pedido !== ped || r.linha !== String(parseInt(ln, 10)))
    return ["VERIFICAR", desc, `Registro diferente no portal (${r.pedido}/${r.linha})`];
  if (!desc) return ["VERIFICAR", "", "Registro sem descrição de matéria-prima no portal"];
  const pPortal = polegada(desc);
  if (pPortal == null) {
    if (/\d+\s*MM\b/i.test(desc)) return ["VERIFICAR", desc, "Portal sem polegada (medida em MM)"];
    return ["VERIFICAR", desc, CORTADO];
  }
  const pPlan = polegada(polPlanilha);
  if (pPlan == null) return ["VERIFICAR", desc, "Planilha sem polegada"];
  if (Math.abs(pPlan - pPortal) < 1e-6) return ["MP OK", desc, ""];
  return [fmtPol(pPortal), desc, ""];
}

