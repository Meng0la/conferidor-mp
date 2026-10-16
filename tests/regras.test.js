import { test, expect } from "bun:test";
import { polegada, classificar, CORTADO } from "../src/regras.js";

test("polegada: formatos aceitos", () => {
  expect(polegada("PLACA 1,250 POL")).toBe(1.25);
  expect(polegada("PLACA 1 1/2 POL")).toBe(1.5);
  expect(polegada("ESPUMA 0.5POL")).toBe(0.5);
  expect(polegada("BARRA 2 POL")).toBe(2);
  expect(polegada("BARRA 20MM")).toBeNull();
  expect(polegada("PLACA TIPO II 1,")).toBeNull();
});

const ok = desc => ({ status: "OK", pedido: "100", linha: "10", desc });

test("classificar", () => {
  expect(classificar("100/00010", "1,500 POL", ok("X 1 1/2 POL"))).toEqual(["MP OK", "X 1 1/2 POL", ""]);
  expect(classificar("100/00010", "2,250 POL", ok("X 2,500 POL"))[0]).toBe("2,500 POL");
  expect(classificar("100/00010", "1,500 POL", ok("X TIPO II 1,"))[2]).toBe(CORTADO);
  expect(classificar("100/00010", "", ok("NYLON 20MM"))[2]).toMatch(/MM/);
  expect(classificar("100/00010", "1 POL", ok(""))[2]).toMatch(/sem descrição/);
  expect(classificar("100/00010", "1 POL", { status: "NAO_ENCONTRADO" })[0]).toBe("VERIFICAR");
  expect(classificar("100/00010", "1 POL", { status: "OK", pedido: "100", linha: "20", desc: "1 POL" })[2]).toMatch(/diferente/);
});
