const ESC = String.fromCharCode(27);
// Sequencias CSI (cores, cursor) e OSC (titulo da janela) do terminal.
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
const OSC = new RegExp(`${ESC}\\][^${String.fromCharCode(7)}${ESC}]*(${String.fromCharCode(7)}|${ESC}\\\\)`, 'g');

/**
 * Texto legivel da saida de um comando: tira codigos de cor e de cursor e, nas linhas com \r (barras de
 * progresso do docker, npm, git), mostra so o ultimo estado da linha.
 */
export function cleanTerminalText(text: string): string {
  return text
    .replace(OSC, '')
    .replace(CSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const last = line.lastIndexOf('\r');
      return last >= 0 ? line.slice(last + 1) : line;
    })
    .join('\n');
}
