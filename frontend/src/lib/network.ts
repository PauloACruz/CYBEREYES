// Validacoes de enderecos usadas nos formularios de inventario e redes (espelham as regras do servidor).

export interface ParsedIp {
  version: 4 | 6;
  value: bigint;
}

export interface ParsedCidr {
  version: 4 | 6;
  /** Endereco da rede (bits de host zerados). */
  network: bigint;
  prefix: number;
}

const IPV4_OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

function parseIpv4(text: string): bigint | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseIpv6Groups(text: string, allowIpv4Tail: boolean): bigint[] | null {
  if (text === '') return [];
  const groups: bigint[] = [];
  const parts = text.split(':');
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? '';
    if (allowIpv4Tail && i === parts.length - 1 && part.includes('.')) {
      const v4 = parseIpv4(part);
      if (v4 === null) return null;
      groups.push(v4 >> 16n, v4 & 0xffffn);
    } else if (IPV6_GROUP.test(part)) {
      groups.push(BigInt(`0x${part}`));
    } else {
      return null;
    }
  }
  return groups;
}

function parseIpv6(text: string): bigint | null {
  if (!/^[0-9a-fA-F:.]+$/.test(text)) return null;
  const halves = text.split('::');
  if (halves.length > 2) return null;
  let groups: bigint[];
  if (halves.length === 2) {
    const head = parseIpv6Groups(halves[0] ?? '', false);
    const tail = parseIpv6Groups(halves[1] ?? '', true);
    if (!head || !tail || head.length + tail.length > 7) return null;
    groups = [...head, ...Array<bigint>(8 - head.length - tail.length).fill(0n), ...tail];
  } else {
    const all = parseIpv6Groups(text, true);
    if (!all || all.length !== 8) return null;
    groups = all;
  }
  return groups.reduce((acc, g) => (acc << 16n) | g, 0n);
}

export function parseIp(text: string): ParsedIp | null {
  const value = text.trim();
  if (value.includes(':')) {
    const v6 = parseIpv6(value);
    return v6 === null ? null : { version: 6, value: v6 };
  }
  const v4 = parseIpv4(value);
  return v4 === null ? null : { version: 4, value: v4 };
}

export function isValidIp(text: string): boolean {
  return parseIp(text) !== null;
}

function bitsOf(version: 4 | 6): number {
  return version === 4 ? 32 : 128;
}

export function parseCidr(text: string): ParsedCidr | null {
  const [address, prefixText, extra] = text.trim().split('/');
  if (address === undefined || prefixText === undefined || extra !== undefined || !/^\d{1,3}$/.test(prefixText)) return null;
  const ip = parseIp(address);
  if (!ip) return null;
  const bits = bitsOf(ip.version);
  const prefix = Number(prefixText);
  if (prefix > bits) return null;
  const hostBits = BigInt(bits - prefix);
  const network = (ip.value >> hostBits) << hostBits;
  return { version: ip.version, network, prefix };
}

export function isValidCidr(text: string): boolean {
  return parseCidr(text) !== null;
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join('.');
}

/** Forma normalizada que o servidor grava (somente IPv4; IPv6 volta como digitado). */
export function normalizeCidr(text: string): string | null {
  const parsed = parseCidr(text);
  if (!parsed) return null;
  if (parsed.version === 6) return text.trim();
  return `${formatIpv4(parsed.network)}/${parsed.prefix}`;
}

export function cidrContains(cidr: string, address: string): boolean {
  const net = parseCidr(cidr);
  const ip = parseIp(address);
  if (!net || !ip || net.version !== ip.version) return false;
  const hostBits = BigInt(bitsOf(net.version) - net.prefix);
  return ip.value >> hostBits === net.network >> hostBits;
}

/** Ordena enderecos pelo valor numerico (IPv4 antes de IPv6; invalidos no fim). */
export function compareIp(a: string, b: string): number {
  const pa = parseIp(a);
  const pb = parseIp(b);
  if (!pa || !pb) return pa ? -1 : pb ? 1 : a.localeCompare(b);
  if (pa.version !== pb.version) return pa.version - pb.version;
  return pa.value < pb.value ? -1 : pa.value > pb.value ? 1 : 0;
}

const MAC = /^[0-9A-Fa-f]{2}([:-][0-9A-Fa-f]{2}){5}$/;

export function isValidMac(text: string): boolean {
  return MAC.test(text.trim());
}

/** AA-BB-CC-DD-EE-FF ou aa:bb:... vira AA:BB:CC:DD:EE:FF (formato gravado pelo servidor). */
export function normalizeMac(text: string): string {
  return text.trim().replace(/-/g, ':').toUpperCase();
}
