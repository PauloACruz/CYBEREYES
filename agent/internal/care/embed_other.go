//go:build !windows

package care

import "embed"

// Scripts embutidos: catalogo e modulos bash para Linux e macOS (o harness _runtime.sh entra pelo padrao explicito).
//
//go:embed scripts/catalog.json scripts/unix/*.sh
var embedded embed.FS
