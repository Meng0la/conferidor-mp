// Servidor estático mínimo para o portal de demonstração: bun demo/servidor.js
const raiz = import.meta.dir;
Bun.serve({
  port: 8765,
  fetch(req) {
    const p = new URL(req.url).pathname;
    return new Response(Bun.file(raiz + (p === "/" ? "/portal-demo.html" : p)));
  },
});
console.log("Portal de demonstração em http://localhost:8765/portal-demo.html#/busca");
