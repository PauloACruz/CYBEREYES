//go:build windows

package care

import "embed"

// Scripts embutidos: catalogo e modulos PowerShell (o harness _runtime.ps1 entra pelo padrao explicito).
//
//go:embed scripts/catalog.json scripts/windows/*.ps1
var embedded embed.FS
