// Package version guarda a versao do EYES, definida no build com -ldflags.
package version

// Version e substituida no build: -X github.com/pauloacruz/cybereyes/agent/internal/version.Version=3.0.0
var Version = "3.0.2"

// Name e o nome do produto exibido em logs e no servico.
const Name = "EYES"
