//go:build !windows && !linux

package devices

// List ainda nao tem implementacao fora do Windows e do Linux (o app do macOS nao e distribuido pelo
// EYES); a interface faz os testes sem a lista de dispositivos.
func List() Snapshot {
	return Snapshot{Supported: false, Devices: []Device{}}
}

// KeyboardLayout nao le o layout fora do Windows e do Linux; a interface deduz pelo que e digitado.
func KeyboardLayout() Layout {
	return Layout{Error: "Leitura do layout não disponível neste sistema."}
}
