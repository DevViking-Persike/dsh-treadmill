---
name: tick-esteira
description: Executa uma etapa habilitada ou fecha etapas finais desligadas, seguindo a tabela efetiva e o cursor da esteira do projeto.
---

# Execução da esteira

## Configuração e estado

Leia a tabela `.spec/treadmill.yaml` do projeto; se ela não existir, use `esteira/pipeline.yaml` na instalação Treadmill indicada pelo harness. Uma tabela presente e inválida é erro: não substitua silenciosamente pela global. A tabela define ordem, skill, argumentos, `enabled`, `gate` e `requires`; não derive a sequência de um diagrama ou de uma lista fixa no RUNBOOK.

`requires` lista etapas anteriores cujas evidências o consumidor utiliza. Uma dependência inexistente ou posterior é configuração inválida. Etapas desligadas e consumidores de dependências desligadas são pulados, inclusive transitivamente. Gate desligado não emite PASS, não representa teste executado e não elimina achados já conhecidos.

O cursor `.spec/esteira-state.yaml` contém etapa, sprint ativa, backlog, tasks, tentativas, pausas e recibos. STATE.md, Status das tasks e marcas do plano são espelhos: nunca decida por eles. Reconcilie documentos para criar o cursor somente no bootstrap, quando ele ainda não existir. Depois, inconsistências exigem reconciliação explícita, preservando o histórico.

## Um tick

1. Leia tabela e cursor. Verifique `awaiting`: uma pausa humana requer a decisão correspondente; uma pausa de ambiente requer evidência de recuperação. Sem liberação, reporte PARK e não execute etapa, avance cursor ou limpe o bloqueio. Alterar um checkbox não resolve uma pausa existente.
2. Resolva a etapa pelo id do cursor na tabela. Id ausente é erro de configuração, não conclusão. Pule etapas desligadas sem executar suas skills; registre que não foram executadas. Uma dependência habilitada exige evidência aprovada da mesma sprint e revisão; relatório ausente ou antigo não equivale a PASS.
3. Execute somente a etapa habilitada atual, ou uma task de desenvolvimento. Use seus argumentos e os comandos reais do MANIFEST/stack do projeto. Para iniciar a próxima sprint, use `backlog` do cursor; dentro dela, use `tasks` e `depends_on`. Não use marcas do plano nem releia Status narrativo para escolher o trabalho.
4. Registre PASS ou FAIL somente quando aplicável e sustentado por evidências. FAIL retorna ao trabalho responsável pela correção; preserve o gate pendente e a tentativa para revalidar. Na segunda reprovação, registre `awaiting: humano:<etapa>-2x`. Não avance para uma etapa de aceitação ou publicação em FAIL. Sem alteração relevante de código, configuração, ambiente ou critérios, reutilize evidências válidas em vez de repetir testes; registre o escopo coberto e as lacunas.
5. Ao concluir uma etapa, avance para a próxima habilitada na ordem efetiva, limpe o veredito da etapa anterior e incremente `revision`. Não execute a próxima etapa no mesmo tick. Gates manuais aguardam ação explícita; produção, ações destrutivas e decisões humanas pendentes mantêm suas autorizações próprias.
6. Quando só restarem etapas desligadas, valide as evidências das etapas obrigatórias já executadas. Achados bloqueantes continuam bloqueantes. Registre skips sem PASS fictício, feche a sprint e selecione a próxima pendente pelo cursor; use `etapa: done` apenas quando o backlog terminar. Deploy desligado ou `deploy: skip` no MANIFEST não autoriza publicação nem commit/push.
7. Persista cursor, recibos e espelhos de forma consistente, preservando os artefatos existentes. Commits e pushes exigem a autorização do usuário e a política do projeto; desligar ou concluir uma etapa não os autoriza. Encerre com GO, PARK ou DONE e a evidência correspondente.

## Responsabilidades e evidências

- Discovery global define o objetivo e o plano; discovery da sprint detalha apenas o incremento. Reaproveite respostas e decisões registradas, perguntando somente lacunas.
- Design de Arquitetura ocorre antes do código. Review de Código inclui segurança estática e produz achados; Review de Arquitetura ocorre depois e julga aderência às decisões usando esse relatório. Mudança pequena sem impacto estrutural admite uma ratificação curta, sem nova investigação idêntica.
- QA RPA executa cenários de UI quando aplicável. Gate de QA consolida evidências de UI, API, CLI ou biblioteca; executa somente lacunas ou verificações invalidadas por mudanças. Sem UI, a ausência de RPA não reprova QA.
- Red Team executa testes dinâmicos autorizados; seu gate de Segurança depende desses resultados. Desligar esse conjunto preserva a revisão estática na etapa de código. Testes de autorização do QA e provas de ataque podem compartilhar evidência válida, mantendo explícitos objetivo, escopo, versão e ambiente.
- Deploy publica o artefato aprovado quando habilitado e autorizado. Commit/push é uma ação separada. Nenhuma dessas etapas refaz automaticamente as revisões anteriores.
