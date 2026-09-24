# RUNBOOK — Esteira de PROCESSO (.spec/) rodada autonomamente

> **Duas esteiras, não confunda (GAP-I):** ESTE é o RUNBOOK da esteira de
> **PROCESSO** — move o produto pelas disciplinas 00→40 por sprint, dirigido pelo
> cursor `.spec/esteira-state.yaml`. A esteira de **QUALIDADE de código** (stages
> `Q00-check…Q30-review`) é outra: vive em `.opennjord/esteira/RUNBOOK.md` e valida
> a saúde de um diff. Um `/loop` que abre "o RUNBOOK" precisa saber qual é qual.

## Fonte de estado (precedência)

- **Cursor — fonte ÚNICA de decisão do tick:** `.spec/esteira-state.yaml`.
- **Diário humano (append):** `.spec/STATE.md` — espelho narrativo, não decide.
- **Espelhos write-only:** `✅` no `plano-de-sprints-NN.md`, `Status:` nas tasks.
  O tick ESCREVE neles; **nunca decide por eles**. Reconciliação `plano/task →
  yaml` só no **bootstrap** (yaml ausente). Depois disso, o yaml vence.

## Execução e ordem

Use o comando `tick-esteira` fornecido pelo harness. A tabela efetiva é `.spec/treadmill.yaml`, quando existir, ou `esteira/pipeline.yaml` da instalação Treadmill. Sua ordem, etapas habilitadas e dependências prevalecem sobre diagramas ilustrativos.

O cursor é a fonte de decisão para etapa, sprint, backlog e tasks. Não derive progresso de marcas do plano ou Status narrativo. `awaiting` bloqueia até a resolução correspondente; FAIL exige correção e revalidação. Etapas desligadas são registradas como puladas, sem PASS fictício; consumidores de dependências desligadas também são pulados. Encerrar o fluxo exige validar a sprint e reconciliar seu cursor, mesmo quando Deploy estiver desligado.

Discovery da sprint antecede o Design de Arquitetura; desenvolvimento antecede o Review de Código, que fornece evidências para o Review de Arquitetura. QA consolida verificações aplicáveis sem repetir evidências válidas. Red Team fornece os resultados do gate de Segurança; a segurança estática permanece no review de código. Cada etapa executa somente o trabalho não coberto por evidências válidas da mesma revisão e ambiente.

## Paradas humanas (awaiting)

| Gate | awaiting |
|---|---|
| H0 scaffold-mode ausente | `humano:scaffold-mode` |
| H1 Plano de Sprints aprovado | `humano:plano` (abre o loop) |
| H2 10a design (veredito autoral) | `humano:10a` |
| H3 dev não convergiu (max-rounds) | `humano:dev-convergencia` |
| H4 aplicar correções da 25 | no `/loop` os achados FAIL viram tasks; edição direta só FORA do loop |
| H5 aceite de risco no 40 | `humano:aceite-risco` |
| H6 deploy produção | `humano:deploy-prod` |
| gate reprovado 2× | `humano:<etapa>-2x` |
| ambiente indisponível (qa/seg) | `ambiente:qa` / `ambiente:seg` |

## Versionamento

Commits e pushes seguem a autorização do usuário e as regras do projeto. O tick atualiza cursor, recibos e espelhos, mas não obtém autorização de versionamento ao encerrar uma etapa. A etapa Commit/push é independente de Deploy.

## Comandos reais por etapa

Os comandos concretos (build/lint/test/RPA, subir `dev_server`, alvo do redteam)
vivem no `.spec/MANIFEST.md` (*Maquinário de validação* + campos `dev_server` e
`redteam_target`). O tick consulta o MANIFEST antes de executar cada etapa.
