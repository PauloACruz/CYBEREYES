import type { PackageManager } from '../../../api/types';

/** Nome de cada gerenciador de pacotes na tela. */
export const MANAGER_LABEL: Record<PackageManager, string> = { choco: 'Chocolatey', winget: 'winget' };
