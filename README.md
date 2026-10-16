# Conferidor de MP

Automação que confere a **matéria-prima (MP)** de uma planilha Excel contra um **portal web**. Para cada pedido/linha, ela busca o registro no portal, lê a descrição da MP e compara a **polegada** com a da planilha. O resultado é gravado de volta na planilha.

Foi feita para substituir uma conferência manual de centenas de linhas. Na mão, era abrir registro por registro e comparar a medida a olho. Com a automação, leva de 1 a 3 segundos por linha, sem ninguém clicando.

```
=== Conferidor de MP — planilha x portal ===
[   2] 100000101/00010  PLACA ALUMINIO 7075-T651 1,250 POL        -> MP OK      PLACA ALUMINIO 7075-T651 1,250 POL
[   3] 100000102/00010  PLACA ALUMINIO 7075-T651 TIPO II 1,500 POL -> VERIFICAR  PLACA ALUMINIO 7075-T651 TIPO II 1,  CORTADO - NÃO DÁ PARA LER
[   4] 100000103/00020  PLACA ALUMINIO 6061-T6 2,250 POL          -> 1,500 POL  PLACA ALUMINIO 6061-T6 1 1/2 POL
[   5] 100000104/00010  BARRA NYLON 6.6 20MM                      -> VERIFICAR  BARRA NYLON 6.6 20MM  Portal sem polegada (medida em MM)

Pronto: 7 linhas em 0 min 36 s
```

## Destaques

- **Um `.exe` único, sem instalação.** O executável é compilado com [Bun](https://bun.sh), então o computador de quem usa não precisa de Python, Node nem dependência nenhuma.
- **Usa a sessão que você já abriu.** O programa se conecta ao Chrome/Edge pelo **Chrome DevTools Protocol (CDP)**. Ele não guarda nem digita senha: você faz o login, deixa a tela de busca aberta e aperta ENTER para começar.
- **Só leitura no portal.** Ele busca, abre o detalhe e volta, sem alterar nenhum dado.
- **A planilha original fica intacta.** O resultado vai para uma cópia `_conferido.xlsx`, com formatação, fórmulas e filtros preservados.
- **Reconhece as colunas sozinho.** Ele identifica pelo cabeçalho onde estão o pedido/linha (juntos ou separados), a polegada ou a descrição da MP e a coluna de resultado, e pede sua confirmação.
- **Retoma de onde parou.** O progresso é salvo a cada 20 linhas. Ao rodar de novo, ele pula as linhas já feitas e tenta outra vez as que deram "não encontrado".
- **Percebe quando a sessão cai.** Depois de 5 falhas seguidas, ele pausa e pede que você confira o login.
- **Portal configurável.** URL, seletores CSS e textos ficam no `config.json`; o código não depende de nenhum sistema específico.

## Como funciona

```
┌──────────────┐   lê pedido/linha + MP    ┌──────────────────┐
│ planilha.xlsx│ ────────────────────────▶ │  conferidor.exe  │
└──────────────┘ ◀──────────────────────── │  (Bun + ExcelJS) │
   _conferido.xlsx   grava resultado        └────────┬─────────┘
                                                     │ CDP (WebSocket, porta 9222)
                                                     │ Runtime.evaluate
                                            ┌────────▼─────────┐
                                            │ Chrome/Edge logado│  busca → detalhe → lê → voltar
                                            │  (aba do portal)  │
                                            └──────────────────┘
```

1. O programa abre o Chrome/Edge com `--remote-debugging-port`, usando um perfil separado, porque o Chrome não permite depuração remota no perfil padrão.
2. Você faz o login e deixa a tela de busca aberta. O programa só começa depois do seu ENTER, e só se reconhecer a tela certa.
3. Para cada linha, ele injeta na página um script (`Runtime.evaluate`) que:
   - preenche o campo de busca, dispara ENTER e espera o resultado novo (marca as linhas antigas para não confundir);
   - clica no detalhe da linha certa e espera o cabeçalho `PEDIDO x / LINHA y` bater;
   - extrai o texto entre `textoInicioDescricao` e `textoFimDescricao` e clica em Voltar.
4. A comparação é feita fora da página (`src/regras.js`).

## Regras de comparação

A polegada é comparada **pelo valor**: `1 1/2 POL` = `1,500 POL` = `1.5POL`.

| Situação | Resultado | Obs |
|---|---|---|
| Polegada igual | `MP OK` | — |
| Polegada diferente | polegada do portal, ex. `1,500 POL` | — |
| Descrição cortada no portal (sem "POL") | `VERIFICAR` | `CORTADO - NÃO DÁ PARA LER` |
| Medida em MM | `VERIFICAR` | `Portal sem polegada (medida em MM)` |
| Campo de MP vazio | `VERIFICAR` | `Registro sem descrição de matéria-prima no portal` |
| Registro não encontrado / pedido-linha diferente | `VERIFICAR` | motivo |

## Testar sem nenhum sistema real (demo)

O repositório traz um **portal falso** (`demo/portal-demo.html`) e uma **planilha de exemplo** com todos os casos acima.

```bash
bun install
bun run demo:portal        # sobe http://localhost:8765/portal-demo.html#/busca
bun run start demo/planilha-exemplo.xlsx
```

Sem `config.json`, o programa usa a configuração da demo. Ele abre o navegador no portal falso; aperte ENTER nas perguntas e de novo para começar.

```bash
bun test                   # testes das regras de polegada
```

## Usar com o seu portal

1. Copie `config.example.json` para `config.json`, na mesma pasta do `.exe`.
2. Ajuste a URL e os seletores. No navegador, use **F12 → Inspecionar** sobre o campo de busca, o botão de detalhe e o botão Voltar.

| Chave | O que é |
|---|---|
| `url` / `urlContem` | endereço inicial e trecho que identifica a aba do portal |
| `seletorCampoBusca` | campo onde se digita `pedido/linha` |
| `seletorLinhasResultado` | linhas da tabela de resultados |
| `colunaResultadoPedido` / `colunaResultadoLinha` | índice (base 0) das colunas pedido e linha nessa tabela |
| `seletorBotaoDetalhe` | botão/ícone que abre o detalhe, dentro da linha |
| `seletorAreaDetalhe` | elemento que contém o texto do detalhe |
| `regexCabecalhoDetalhe` | regex com 2 grupos (pedido, linha) para confirmar que abriu o registro certo |
| `textoInicioDescricao` / `textoFimDescricao` | rótulos entre os quais está a descrição da MP |
| `seletorBotaoVoltar` | botão que volta para a busca |
| `planilha.cabecalhoResultado` / `cabecalhoMaterial` | regex dos cabeçalhos da coluna de resultado e da coluna de MP |

O `config.json` está no `.gitignore`, então a configuração de um sistema real não vai para o repositório.

## Compilar o `.exe`

```bash
bun install
bun run build:win      # dist/ConferidorMP.exe (Windows x64, sem dependências)
bun run build:linux    # dist/conferidor-mp
```

O build é cruzado: o `.exe` de Windows sai de uma máquina Linux. O alvo `baseline` funciona em CPUs mais antigas (sem AVX2).

Para distribuir, mande o `.exe` e o `config.json` juntos. O executável não tem assinatura digital, então o Windows SmartScreen ou o antivírus podem pedir confirmação.

## Estrutura

```
src/conferidor.js     fluxo principal: navegador/CDP, planilha, loop
src/regras.js         polegada() e classificar(), sem dependências
tests/                testes (bun test)
demo/                 portal falso, servidor estático e planilha de exemplo
config.example.json   modelo de configuração
```

## Limitações

- Ainda não funciona em portais que abrem o detalhe em outra aba ou janela.
- O portal precisa mostrar a descrição como texto na página; PDF e imagem não funcionam.
- Rode uma planilha por pessoa. Duas pessoas no mesmo arquivo duplicam o trabalho.

## Licença

MIT
