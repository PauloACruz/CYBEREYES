// Package smoke tem os testes de fumaca do EYES: compilam o binario, sobem um NATS embutido e um
// servidor REST falso que imitam o Cybereyes (docs/agente/contrato-eyes.md) e conferem o agente
// real de ponta a ponta (registro, check-ins, comandos, terminal, checks e, opcionalmente, o servico).
//
// Os testes ficam atras da tag "smoke", entao "go test ./..." nao os executa:
//
//	go test -tags smoke -v -timeout 20m ./smoke/...
//
// Variaveis de ambiente:
//
//	EYES_BIN=caminho         usa um binario ja compilado em vez de compilar ./cmd/eyes
//	EYES_SMOKE_SERVICE=1     executa tambem TestService (instala o servico de verdade; exige admin/root)
package smoke
