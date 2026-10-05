//go:build !windows

package inventory

// chocoSupported e falso fora do Windows: o Chocolatey nao existe nesses sistemas.
const chocoSupported = false

func chocoInstalled() bool { return false }
