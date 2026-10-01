import type { CommandShell } from '../../../api/types';

export interface ShellOption {
  value: CommandShell;
  label: string;
}

const WINDOWS_SHELLS: readonly ShellOption[] = [
  { value: 'cmd', label: 'cmd' },
  { value: 'powershell', label: 'PowerShell' },
];

const UNIX_SHELLS: readonly ShellOption[] = [
  { value: '/bin/bash', label: '/bin/bash' },
  { value: '/bin/sh', label: '/bin/sh' },
  { value: '/bin/zsh', label: '/bin/zsh' },
];

export function isWindows(plat: string): boolean {
  return plat === 'windows';
}

export function shellsFor(plat: string): readonly ShellOption[] {
  return isWindows(plat) ? WINDOWS_SHELLS : UNIX_SHELLS;
}

export function defaultShell(plat: string): CommandShell {
  return isWindows(plat) ? 'cmd' : '/bin/bash';
}
