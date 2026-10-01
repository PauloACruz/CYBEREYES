// Tipos espelhando docs/api/fase0-auth.md. Datas sao strings ISO 8601 UTC.

export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: ErrorCode;
  errors?: Record<string, string[]>;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_CODE'
  | 'MFA_REQUIRED'
  | 'FORBIDDEN'
  | 'LOCKED_OUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// Sessao

export type LoginStatus = 'ok' | 'requires2fa' | 'requires2faSetup';

export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface LoginResponse {
  status: LoginStatus;
}

export interface LoginTwoFactorRequest {
  code: string;
  rememberMe?: boolean;
}

export interface LoginRecoveryRequest {
  recoveryCode: string;
}

export interface StatusOkResponse {
  status: 'ok';
}

export interface TwoFactorSetupDto {
  sharedKey: string;
  otpauthUri: string;
}

export interface EnableTwoFactorRequest {
  code: string;
}

export interface EnableTwoFactorResponse {
  status: 'ok';
  recoveryCodes: string[];
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface MeDto {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isSuperuser: boolean;
  roles: string[];
  permissions: string[];
  twoFactorEnabled: boolean;
  mfaSatisfied: boolean;
}

// Usuarios

export interface RoleRef {
  id: string;
  name: string;
}

export interface UserDto {
  id: string;
  username: string;
  email: string;
  fullName: string;
  isActive: boolean;
  twoFactorEnabled: boolean;
  roles: RoleRef[];
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ListUsersParams {
  page: number;
  pageSize: number;
  search?: string;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  fullName: string;
  password: string;
  roleIds: string[];
  isActive: boolean;
}

export interface UpdateUserRequest {
  email: string;
  fullName: string;
  roleIds: string[];
  isActive: boolean;
}

export interface ResetPasswordRequest {
  newPassword: string;
}

// Papeis

export interface RoleDto {
  id: string;
  name: string;
  isSuperuser: boolean;
  permissions: string[];
  userCount: number;
}

export interface PermissionDto {
  key: string;
  group: string;
  description: string;
}

export interface SaveRoleRequest {
  name: string;
  isSuperuser: boolean;
  permissions: string[];
}

// Chaves de API

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  username: string;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateApiKeyRequest {
  name: string;
  expiresAt?: string;
}

export type CreatedApiKeyDto = ApiKeyDto & { key: string };

// Auditoria

export interface AuditDto {
  id: string;
  timestamp: string;
  username: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  message: string | null;
  ipAddress: string | null;
}

export interface ListAuditParams {
  page: number;
  pageSize: number;
  username?: string;
  action?: string;
  from?: string;
  to?: string;
}

// Clientes e sites (docs/api/fase1-agente.md, secao 7)

export interface SiteDto {
  id: number;
  clientId: number;
  name: string;
  agentCount: number;
}

export interface ClientDto {
  id: number;
  name: string;
  agentCount: number;
  sites: SiteDto[];
}

export interface CreateClientRequest {
  name: string;
  siteName: string;
}

export interface NameRequest {
  name: string;
}

// Agentes

export type AgentStatus = 'online' | 'offline' | 'overdue';
export type MonitoringType = 'server' | 'workstation';
export type AgentPlat = 'windows' | 'linux' | 'darwin';
export type InstallerAgentType = 'auto' | MonitoringType;
export type GoArch = 'amd64' | '386' | 'arm64' | 'arm';

export interface AgentListItem {
  id: number;
  agentId: string;
  hostname: string;
  clientId: number;
  clientName: string;
  siteId: number;
  siteName: string;
  monitoringType: MonitoringType;
  plat: string;
  operatingSystem: string | null;
  status: AgentStatus;
  lastSeen: string | null;
  version: string;
  loggedInUsername: string | null;
  lastLoggedInUser: string | null;
  publicIp: string | null;
  needsReboot: boolean;
  description: string | null;
}

export interface AgentDetail extends AgentListItem {
  // O contrato escreve "goarch"; o backend serializa "goArch". Aceitar os dois.
  goArch?: string | null;
  goarch?: string | null;
  /** Em GB. */
  totalRam: number | null;
  bootTime: string | null;
  meshNodeId: string | null;
  /** JSON enviado pelo agente; validar antes de usar. */
  disks: unknown;
  services: unknown;
  wmi: unknown;
  checkInterval: number;
  offlineTime: number;
  overdueTime: number;
  createdAt: string;
}

export interface ListAgentsParams {
  page: number;
  pageSize: number;
  clientId?: number;
  siteId?: number;
  status?: AgentStatus;
  search?: string;
}

export interface PingResponse {
  status: 'online' | 'offline';
}

// Instalacao e implantacoes

export interface InstallerRequest {
  siteId: number;
  agentType: InstallerAgentType;
  plat: AgentPlat;
  goarch?: GoArch;
  expiresHours: number;
}

export interface InstallerResponse {
  command: string;
  expiresAt: string;
  plat: AgentPlat;
}

export interface DeploymentDto {
  id: number;
  uid: string;
  clientId: number;
  clientName: string;
  siteId: number;
  siteName: string;
  agentType: InstallerAgentType;
  // O contrato escreve "goarch"; o backend serializa "goArch". Aceitar os dois.
  goArch?: string;
  goarch?: string;
  expiresAt: string;
  createdAt: string;
  createdBy: string;
  commands: Partial<Record<AgentPlat, string>>;
}

export interface CreateDeploymentRequest {
  siteId: number;
  agentType: InstallerAgentType;
  goarch?: GoArch;
  expiresAt: string;
}

// Tempo real (hub /hubs/console)

export interface AgentStatusChangedEvent {
  /** Identificador do agente (campo agentId), nao o id numerico. */
  agentId: string;
  status: AgentStatus;
  lastSeen: string | null;
}

// Catalogo de permissoes

export const PERMISSIONS = {
  usersView: 'users.view',
  usersManage: 'users.manage',
  rolesManage: 'roles.manage',
  apiKeysManage: 'apikeys.manage',
  auditView: 'audit.view',
  settingsManage: 'settings.manage',
  clientsView: 'clients.view',
  clientsManage: 'clients.manage',
  agentsView: 'agents.view',
  agentsManage: 'agents.manage',
  agentsInstall: 'agents.install',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
