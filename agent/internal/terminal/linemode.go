package terminal

import "unicode/utf8"

// lineMode e uma disciplina de linha minima para o modo sem PTY (Windows sem ConPTY): o shell le
// stdin por pipe, sem eco nem edicao, entao o agente ecoa o que e digitado, trata backspace,
// Ctrl+C e Ctrl+U e entrega a linha inteira ao shell no Enter. Sequencias de escape do xterm
// (setas, teclas de funcao) sao descartadas.
type lineMode struct {
	line    []byte
	esc     int  // 0 fora de escape; 1 depois de ESC; 2 dentro de CSI; 3 depois de ESC O
	lastCR  bool // o ultimo byte foi \r (um \n logo depois e ignorado)
	newline string
}

func newLineMode(newline string) *lineMode { return &lineMode{newline: newline} }

// feed processa a entrada e devolve o eco para a tela e as linhas completas para o shell.
func (l *lineMode) feed(data []byte) (echo []byte, lines []byte) {
	for _, b := range data {
		switch l.esc {
		case 1:
			switch b {
			case '[':
				l.esc = 2
			case 'O':
				l.esc = 3
			default:
				l.esc = 0
			}
			continue
		case 2:
			if b >= 0x40 && b <= 0x7e {
				l.esc = 0
			}
			continue
		case 3:
			l.esc = 0
			continue
		}
		cr := l.lastCR
		l.lastCR = false
		switch {
		case b == 0x1b:
			l.esc = 1
		case b == '\r' || b == '\n':
			if b == '\n' && cr {
				continue
			}
			l.lastCR = b == '\r'
			echo = append(echo, '\r', '\n')
			lines = append(lines, l.line...)
			lines = append(lines, l.newline...)
			l.line = l.line[:0]
		case b == 0x7f || b == 0x08:
			if len(l.line) > 0 {
				_, n := utf8.DecodeLastRune(l.line)
				l.line = l.line[:len(l.line)-n]
				echo = append(echo, '\b', ' ', '\b')
			}
		case b == 0x03: // Ctrl+C: descarta a linha (sem console, nao da para interromper o comando)
			l.line = l.line[:0]
			echo = append(echo, '^', 'C', '\r', '\n')
		case b == 0x15: // Ctrl+U: apaga a linha
			for len(l.line) > 0 {
				_, n := utf8.DecodeLastRune(l.line)
				l.line = l.line[:len(l.line)-n]
				echo = append(echo, '\b', ' ', '\b')
			}
		case b == '\t' || b >= 0x20:
			l.line = append(l.line, b)
			echo = append(echo, b)
		}
	}
	return echo, lines
}
