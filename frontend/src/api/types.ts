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
  | 'RATE_LIMITED'
  | 'AGENT_TIMEOUT'
  | 'MESH_DISABLED'
  | 'VAULT_DISABLED';

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

// Acoes sobre o agente (docs/api/fase2-acoes.md)

export type CommandShell = 'cmd' | 'powershell' | '/bin/bash' | '/bin/sh' | '/bin/zsh';

export interface CommandRequest {
  shell: CommandShell;
  command: string;
  /** 10 a 3600 segundos. */
  timeout: number;
  runAsUser: boolean;
}

export interface CommandResponse {
  historyId: number;
  output: string;
}

export interface ScriptResults {
  stdout: string;
  stderr: string;
  retcode: number;
  executionTime: number;
}

export type AgentHistoryType = 'cmd_run' | 'script_run';

export interface AgentHistoryDto {
  id: number;
  time: string;
  type: AgentHistoryType;
  command: string | null;
  username: string | null;
  scriptId: number | null;
  scriptName: string | null;
  results: string | null;
  scriptResults: ScriptResults | null;
}

export interface RunScriptRequest {
  scriptId: number;
  args?: string[];
  envVars?: string[];
  timeout?: number;
  runAsUser?: boolean;
}

export type RunScriptResponse = ScriptResults & { historyId: number };

export interface ProcessDto {
  pid: number;
  name: string;
  username: string;
  memBytes: number;
  cpuPercent: number;
}

export interface WindowsServiceDto {
  name: string;
  displayName: string;
  status: string;
  startType: string;
  autodelay: boolean;
  pid: number;
  binpath: string;
  username: string;
  description: string;
}

export type ServiceAction = 'start' | 'stop' | 'restart';
export type ServiceStartType = 'auto' | 'autodelay' | 'manual' | 'disabled';

export interface SuccessMessage {
  success: boolean;
  message: string;
}

export type EventLogName = 'Application' | 'System' | 'Security';

export interface EventLogEntry {
  source: string;
  eventType: string;
  eventId: number;
  message: string;
  time: string;
}

export type RegistryValueType = 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_MULTI_SZ' | 'REG_DWORD' | 'REG_QWORD' | 'REG_BINARY';

export interface RegistrySubkey {
  name: string;
  hasSubkeys: boolean;
}

export interface RegistryValue {
  name: string;
  /** Normalmente um RegistryValueType; o agente pode enviar outros (REG_NONE...). */
  type: string;
  data: string;
}

export interface RegistryListing {
  path: string;
  subkeys: RegistrySubkey[];
  values: RegistryValue[];
  hasMore: boolean;
}

export interface RegistryValueRequest {
  path: string;
  name: string;
  type: RegistryValueType;
  data: string;
}

export interface UrlResponse {
  url: string;
}

// Scripts e snippets

export type ScriptShell = 'powershell' | 'cmd' | 'python' | 'shell' | 'nushell' | 'deno';
export type ScriptPlatform = AgentPlat;

export interface ScriptDto {
  id: number;
  name: string;
  description: string;
  category: string;
  shell: ScriptShell;
  body?: string;
  defaultArgs: string[];
  envVars: string[];
  defaultTimeout: number;
  runAsUser: boolean;
  platforms: ScriptPlatform[];
  createdBy: string;
  updatedAt: string;
}

export interface SaveScriptRequest {
  name: string;
  description: string;
  category: string;
  shell: ScriptShell;
  body: string;
  defaultArgs: string[];
  envVars: string[];
  /** 5 a 86400 segundos. */
  defaultTimeout: number;
  runAsUser: boolean;
  platforms: ScriptPlatform[];
}

export interface SnippetDto {
  id: number;
  name: string;
  description: string;
  shell: ScriptShell;
  code: string;
}

export type SaveSnippetRequest = Omit<SnippetDto, 'id'>;

// Configuracoes

export interface KeyDto {
  id: number;
  name: string;
  value: string;
}

export type SaveKeyRequest = Omit<KeyDto, 'id'>;

export interface UrlActionDto {
  id: number;
  name: string;
  description: string;
  pattern: string;
}

export type SaveUrlActionRequest = Omit<UrlActionDto, 'id'>;

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
  agentsRun: 'agents.run',
  agentsControl: 'agents.control',
  agentsRemote: 'agents.remote',
  scriptsView: 'scripts.view',
  scriptsManage: 'scripts.manage',
  checksManage: 'checks.manage',
  policiesManage: 'policies.manage',
  alertsView: 'alerts.view',
  alertsManage: 'alerts.manage',
  patchesManage: 'patches.manage',
  softwareManage: 'software.manage',
  ticketsView: 'tickets.view',
  ticketsManage: 'tickets.manage',
  inventoryView: 'inventory.view',
  inventoryManage: 'inventory.manage',
  docsView: 'docs.view',
  docsManage: 'docs.manage',
  credentialsReveal: 'credentials.reveal',
  credentialsManage: 'credentials.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

// Monitoramento e automacao (docs/api/fase3-monitoramento.md)

export type Severity = 'info' | 'warning' | 'error';
export type CheckType = 'diskspace' | 'cpuload' | 'memory' | 'ping' | 'script' | 'winsvc' | 'eventlog';
export type CheckStatus = 'passing' | 'failing' | 'pending';
export type EventType = 'INFO' | 'WARNING' | 'ERROR' | 'AUDIT_SUCCESS' | 'AUDIT_FAILURE';
export type FailWhen = 'contains' | 'not_contains';

export interface CheckDto {
  id: number;
  agentId: number | null;
  policyId: number | null;
  checkType: CheckType;
  name: string;
  /** Segundos; 0 usa o intervalo do agente. */
  runInterval: number;
  failsBeforeAlert: number;
  alertSeverity: Severity;
  warningThreshold: number;
  errorThreshold: number;
  disk: string | null;
  ip: string | null;
  scriptId: number | null;
  scriptArgs: string[];
  envVars: string[];
  timeout: number | null;
  infoReturnCodes: number[];
  warningReturnCodes: number[];
  successReturnCodes: number[];
  svcName: string | null;
  passIfStartPending: boolean;
  passIfSvcNotExist: boolean;
  restartIfStopped: boolean;
  logName: EventLogName | null;
  eventId: number | null;
  eventIdIsWildcard: boolean;
  eventType: EventType | null;
  eventSource: string | null;
  eventMessage: string | null;
  failWhen: FailWhen;
  searchLastDays: number;
  numberOfEventsBeforeAlert: number;
  emailAlert: boolean;
  webhookAlert: boolean;
  dashboardAlert: boolean;
}

export type SaveCheckRequest = Omit<CheckDto, 'id'>;

export interface CheckResultDto {
  status: CheckStatus;
  alertSeverity: Severity | null;
  moreInfo: string | null;
  lastRun: string | null;
  failCount: number;
  stdout: string | null;
  stderr: string | null;
  retcode: number | null;
  executionTime: number | null;
  history: number[];
}

export interface AgentCheckDto {
  check: CheckDto;
  inherited: boolean;
  policyName: string | null;
  result: CheckResultDto | null;
}

export interface CheckHistoryPoint {
  time: string;
  value: number;
  status: CheckStatus;
  results: string | null;
}

export type TaskScheduleType = 'manual' | 'once' | 'daily' | 'weekly' | 'monthly' | 'check_failure';

export interface TaskCommandAction {
  type: 'cmd';
  command: string;
  shell: CommandShell;
  timeout: number;
}

export interface TaskScriptAction {
  type: 'script';
  scriptId: number;
  args: string[];
  envVars: string[];
  timeout: number;
  runAsUser: boolean;
}

export type TaskAction = TaskCommandAction | TaskScriptAction;

export interface TaskDto {
  id: number;
  agentId: number | null;
  policyId: number | null;
  name: string;
  enabled: boolean;
  continueOnError: boolean;
  alertSeverity: Severity;
  actions: TaskAction[];
  scheduleType: TaskScheduleType;
  /** ISO, para "once". */
  runAt: string | null;
  /** "HH:mm" no fuso das configuracoes globais. */
  time: string | null;
  /** 0 = domingo. */
  daysOfWeek: number[];
  dayOfMonth: number | null;
  everyDays?: number | null;
  assignedCheckId: number | null;
  emailAlert: boolean;
  webhookAlert: boolean;
  dashboardAlert: boolean;
}

export type SaveTaskRequest = Omit<TaskDto, 'id' | 'everyDays'>;

export interface TaskResultDto {
  status: string;
  retcode: number | null;
  stdout: string | null;
  stderr: string | null;
  executionTime: number | null;
  lastRun: string | null;
}

export interface AgentTaskDto {
  task: TaskDto;
  inherited: boolean;
  policyName: string | null;
  result: TaskResultDto | null;
  nextRun: string | null;
}

export interface PolicyDto {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  checkCount: number;
  taskCount: number;
  appliedTo: { clients: number; sites: number; agents: number };
}

export type PatchRule = 'approve' | 'ignore' | 'manual';
export type RebootAfterInstall = 'never' | 'required' | 'always';

export interface PatchPolicy {
  critical: PatchRule;
  important: PatchRule;
  moderate: PatchRule;
  low: PatchRule;
  other: PatchRule;
  runTimeDays: number[];
  runTimeHour: number;
  rebootAfterInstall: RebootAfterInstall;
}

export interface PolicyDetailDto {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  checks: CheckDto[];
  tasks: TaskDto[];
  patchPolicy: PatchPolicy | null;
}

export interface SavePolicyRequest {
  name: string;
  description: string;
  enabled: boolean;
}

export type AssignmentTarget = 'global' | 'client' | 'site' | 'agent';

export interface PolicyAssignmentRequest {
  target: AssignmentTarget;
  targetId: number | null;
  monitoringType: MonitoringType | null;
  policyId: number | null;
}

export interface PolicyAssignmentsDto {
  globalServer: number | null;
  globalWorkstation: number | null;
  clients: { id: number; name: string; serverPolicyId: number | null; workstationPolicyId: number | null; blockPolicyInheritance: boolean }[];
  sites: { id: number; clientId: number; name: string; serverPolicyId: number | null; workstationPolicyId: number | null; blockPolicyInheritance: boolean }[];
  agents: { id: number; hostname: string; policyId: number | null; blockPolicyInheritance: boolean }[];
}

export interface BlockInheritanceRequest {
  target: Exclude<AssignmentTarget, 'global'>;
  targetId: number;
  block: boolean;
}

export type PolicySource = 'agente' | 'site' | 'cliente' | 'global';

export interface EffectivePolicyDto {
  policyId: number;
  name: string;
  source: PolicySource;
}

export type AlertType = 'availability' | 'check' | 'task';
export type AlertStatusFilter = 'active' | 'resolved' | 'all';

export interface AlertDto {
  id: number;
  agentId: number;
  hostname: string;
  clientName: string;
  siteName: string;
  alertType: AlertType;
  checkId: number | null;
  taskId: number | null;
  severity: Severity;
  message: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  emailSent: boolean;
  webhookSent: boolean;
}

export interface ListAlertsParams {
  status: AlertStatusFilter;
  severity?: Severity;
  clientId?: number;
  agentId?: number;
  page: number;
  pageSize: number;
}

export type BulkAlertRequest = { ids: number[]; action: 'resolve' } | { ids: number[]; action: 'snooze'; until: string };

export interface AlertsChangedEvent {
  activeCount: number;
}

export interface AlertTemplateDto {
  id: number;
  name: string;
  emailRecipients: string[];
  webhookUrl: string | null;
  emailSeverities: Severity[];
  webhookSeverities: Severity[];
  dashboardSeverities: Severity[];
  notifyOnResolved: boolean;
  agentOverdueEmail: boolean;
  agentOverdueWebhook: boolean;
  agentOverdueDashboard: boolean;
}

export type SaveAlertTemplateRequest = Omit<AlertTemplateDto, 'id'>;

export interface TemplateAssignmentRequest {
  target: AssignmentTarget;
  targetId: number | null;
  templateId: number | null;
}

export interface TemplateAssignmentsDto {
  global: number | null;
  clients: { id: number; name: string; alertTemplateId: number | null }[];
  sites: { id: number; clientId: number; name: string; alertTemplateId: number | null }[];
  agents: { id: number; hostname: string; alertTemplateId: number | null }[];
}

export type UpdateAction = 'approve' | 'ignore' | 'nothing';

export interface WinUpdateDto {
  id: number;
  guid: string;
  kb: string;
  title: string;
  severity: string;
  categories: string[];
  installed: boolean;
  downloaded: boolean;
  action: UpdateAction;
  result: string;
  dateInstalled: string | null;
  moreInfoUrls: string[];
}

export interface AgentPatchPolicyDto {
  own: PatchPolicy | null;
  effective: PatchPolicy;
}

export interface SoftwareItem {
  name: string;
  version: string;
  publisher: string;
  installDate: string;
  size: string;
  source: string;
  location: string;
  uninstall: string;
}

export interface SoftwareInventory {
  updatedAt: string | null;
  items: SoftwareItem[];
}

export interface PendingActionDto {
  id: number;
  type: string;
  /** JSON com os detalhes da acao. */
  details: string;
  status: string;
  output: string | null;
  createdAt: string;
}

export interface GlobalSettingsDto {
  smtpHost: string | null;
  smtpPort: number;
  smtpUsername: string | null;
  smtpPasswordSet: boolean;
  smtpFrom: string | null;
  smtpUseTls: boolean;
  defaultWebhookUrl: string | null;
  timeZone: string;
  checkHistoryDays: number;
  agentHistoryDays: number;
}

export interface SaveGlobalSettingsRequest extends Omit<GlobalSettingsDto, 'smtpPasswordSet'> {
  /** Enviada somente quando o usuario digita uma nova senha. */
  smtpPassword?: string;
}

// Acesso remoto com MeshCentral (docs/api/fase4-mesh.md)

export type RemoteView = 'control' | 'terminal' | 'files';

export interface RemoteAccessDto {
  hostname: string;
  control: string;
  terminal: string;
  files: string;
}

export interface MeshSyncResult {
  lastSync: string | null;
  lastError: string | null;
  users: number;
}

export interface MeshStatusDto extends MeshSyncResult {
  enabled: boolean;
  url: string | null;
  deviceGroup: string | null;
  groupId: string | null;
}

// Chamados e incidentes (docs/api/fase5-chamados.md)

export type TicketType = 'request' | 'incident';
export type TicketStatus = 'new' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketSource = 'console' | 'tray' | 'alert';
export type TicketAuthorType = 'technician' | 'requester' | 'system';

export interface TicketListItem {
  id: number;
  type: TicketType;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  queueId: number;
  queueName: string;
  agentId: number | null;
  hostname: string | null;
  clientName: string | null;
  siteName: string | null;
  requesterName: string;
  /** Guid do usuario do console. */
  assignedToId: string | null;
  assignedToName: string | null;
  source: TicketSource;
  createdAt: string;
  updatedAt: string;
  firstResponseDueAt: string | null;
  resolutionDueAt: string | null;
  slaBreached: boolean;
  unreadForTechnician: boolean;
}

export interface TicketAgentDto {
  id: number;
  hostname: string;
  status: AgentStatus;
  plat: string;
  operatingSystem: string | null;
  loggedInUsername: string | null;
  publicIp: string | null;
  meshNodeId: string | null;
}

export interface TicketDetail extends TicketListItem {
  description: string;
  requesterUsername: string | null;
  requesterEmail: string | null;
  alertId: number | null;
  createdByName: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  totalMinutes: number;
  agent: TicketAgentDto | null;
}

export interface ListTicketsParams {
  page: number;
  pageSize: number;
  status?: TicketStatus;
  priority?: TicketPriority;
  type?: TicketType;
  queueId?: number;
  /** "me", "unassigned" ou o id de um usuario. */
  assigned?: string;
  agentId?: number;
  search?: string;
  /** Somente new, in_progress e waiting_user. */
  open?: boolean;
}

export interface TicketSummary {
  open: number;
  unassigned: number;
  mine: number;
  breached: number;
  byStatus: Record<TicketStatus, number>;
}

export interface CreateTicketRequest {
  title: string;
  description: string;
  type: TicketType;
  priority: TicketPriority;
  queueId?: number;
  agentId?: number;
  requesterName?: string;
  requesterEmail?: string;
  assignedToId?: string;
}

export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  type?: TicketType;
  priority?: TicketPriority;
  queueId?: number;
}

export interface ChangeTicketStatusRequest {
  status: TicketStatus;
  message?: string;
}

export interface TicketAssignee {
  id: string;
  name: string;
}

export interface TicketAttachmentDto {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
}

export interface TicketMessageDto {
  id: number;
  ticketId: number;
  authorType: TicketAuthorType;
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
  attachments: TicketAttachmentDto[];
}

export interface CreateTicketMessageRequest {
  body: string;
  internal: boolean;
}

export interface TimeEntryDto {
  id: number;
  userId: string;
  userName: string;
  minutes: number;
  description: string | null;
  /** Data (AAAA-MM-DD). */
  workDate: string;
  createdAt: string;
}

export interface CreateTimeEntryRequest {
  minutes: number;
  description?: string;
  workDate?: string;
}

export interface TicketQueueDto {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  openCount: number;
}

export interface SaveTicketQueueRequest {
  name: string;
  description: string;
}

export interface SlaRuleDto {
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
}

export interface IncidentSettingsDto {
  enabled: boolean;
  severities: Severity[];
  priority: TicketPriority;
  queueId: number | null;
  resolveWithAlert: boolean;
}

export interface TicketsChangedEvent {
  ticketId: number;
}

// Inventario e documentacao de rede (docs/api/fase6-inventario.md)

export type AssetType =
  | 'workstation'
  | 'server'
  | 'laptop'
  | 'printer'
  | 'switch'
  | 'router'
  | 'firewall'
  | 'access_point'
  | 'phone'
  | 'monitor'
  | 'ups'
  | 'other';
export type AssetStatus = 'active' | 'stock' | 'maintenance' | 'retired';
export type IpKind = 'static' | 'reserved' | 'dhcp';
export type DocOwnerType = 'asset' | 'network' | 'page';

export interface PersonRef {
  id: number;
  name: string;
}

export interface AssetListItem {
  id: number;
  clientId: number;
  clientName: string;
  siteId: number | null;
  siteName: string | null;
  agentId: number | null;
  type: AssetType;
  name: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  /** Numero de patrimonio. */
  assetTag: string | null;
  status: AssetStatus;
  ipAddress: string | null;
  responsible: PersonRef | null;
  agentStatus: AgentStatus | null;
  updatedAt: string;
}

export interface ListAssetsParams {
  page: number;
  pageSize: number;
  clientId?: number;
  siteId?: number;
  type?: AssetType;
  status?: AssetStatus;
  personId?: number;
  search?: string;
}

export interface AssetDetail extends AssetListItem {
  /** Data (AAAA-MM-DD). */
  purchaseDate: string | null;
  /** Data (AAAA-MM-DD). */
  warrantyUntil: string | null;
  location: string | null;
  macAddress: string | null;
  notes: string | null;
  createdAt: string;
}

export interface AssetResponsibleDto {
  personId: number;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  assignedAt: string;
  assignedBy: string;
}

export interface AssetHistoryEntry {
  id: number;
  personId: number;
  personName: string;
  assignedAt: string;
  unassignedAt: string | null;
  assignedBy: string;
  notes: string | null;
}

export interface AssetHardwareDto {
  source: 'agent' | 'manual';
  makeModel: string | null;
  serialNumber: string | null;
  cpus: string[];
  gpus: string[];
  ramGb: number | null;
  disks: string[];
  localIps: string[];
  operatingSystem: string | null;
  lastLoggedInUser: string | null;
  bootTime: string | null;
}

export interface AssetAgentDto {
  id: number;
  hostname: string;
  status: AgentStatus;
  plat: string;
  lastSeen: string | null;
}

export interface AssetNetworkEntry {
  networkId: number;
  networkName: string;
  cidr: string;
  vlanId: number | null;
  address: string | null;
  kind: IpKind | null;
}

export interface AssetCredentialRef {
  id: number;
  name: string;
  username: string | null;
  url: string | null;
}

export interface DocAttachmentDto {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
}

export interface AssetTicketRef {
  id: number;
  title: string;
  status: TicketStatus;
  createdAt: string;
}

export interface AssetSheet {
  asset: AssetDetail;
  responsible: AssetResponsibleDto | null;
  suggestedPerson: PersonRef | null;
  history: AssetHistoryEntry[];
  hardware: AssetHardwareDto | null;
  software: { count: number; updatedAt: string | null } | null;
  agent: AssetAgentDto | null;
  network: AssetNetworkEntry[];
  credentials: AssetCredentialRef[];
  attachments: DocAttachmentDto[];
  tickets: { open: number; recent: AssetTicketRef[] };
}

export interface SaveAssetRequest {
  clientId: number;
  siteId?: number;
  type: AssetType;
  name: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  status: AssetStatus;
  purchaseDate?: string;
  warrantyUntil?: string;
  location?: string;
  ipAddress?: string;
  macAddress?: string;
  notes?: string;
}

export interface SetResponsibleRequest {
  personId: number | null;
  notes?: string;
}

export interface AgentAssetDto {
  assetId: number;
}

export interface PersonListItem {
  id: number;
  clientId: number;
  clientName: string;
  name: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  jobTitle: string | null;
  /** Login no sistema operacional. */
  username: string | null;
  active: boolean;
  assetCount: number;
}

export interface ListPeopleParams {
  page: number;
  pageSize: number;
  clientId?: number;
  search?: string;
  active?: boolean;
}

/** Ativo atual de uma pessoa; o contrato nao detalha o formato, so os campos basicos sao lidos. */
export interface PersonAssetRef {
  id: number;
  name: string;
  type: AssetType;
  status?: AssetStatus;
  assetTag?: string | null;
}

export interface PersonHistoryEntry {
  id: number;
  assetId: number;
  assetName: string;
  assignedAt: string;
  unassignedAt: string | null;
  assignedBy: string;
  notes: string | null;
}

export interface PersonDetail extends Omit<PersonListItem, 'clientName' | 'assetCount'> {
  clientName?: string;
  createdAt?: string;
  assets: PersonAssetRef[];
  history: PersonHistoryEntry[];
}

export interface SavePersonRequest {
  clientId: number;
  name: string;
  email?: string;
  phone?: string;
  department?: string;
  jobTitle?: string;
  username?: string;
  active: boolean;
}

export interface NetworkDto {
  id: number;
  clientId: number;
  clientName: string;
  siteId: number | null;
  siteName: string | null;
  name: string;
  cidr: string;
  vlanId: number | null;
  vlanName: string | null;
  gateway: string | null;
  dnsServers: string | null;
  dhcpRange: string | null;
  description: string | null;
  usedCount: number;
  totalHosts: number;
}

export interface IpRecordDto {
  id: number;
  networkId: number;
  address: string;
  assetId: number | null;
  assetName: string | null;
  hostname: string | null;
  macAddress: string | null;
  kind: IpKind;
  description: string | null;
}

export interface DiscoveredIpDto {
  address: string;
  assetId: number | null;
  assetName: string | null;
  source: string;
}

export interface NetworkDetail extends NetworkDto {
  ips: IpRecordDto[];
  discovered: DiscoveredIpDto[];
}

export interface SaveNetworkRequest {
  clientId: number;
  siteId?: number;
  name: string;
  cidr: string;
  vlanId?: number;
  vlanName?: string;
  gateway?: string;
  dnsServers?: string;
  dhcpRange?: string;
  description?: string;
}

export interface SaveIpRecordRequest {
  address: string;
  assetId?: number;
  hostname?: string;
  macAddress?: string;
  kind: IpKind;
  description?: string;
}

export interface DiagramListItem {
  id: number;
  clientId: number;
  clientName: string;
  siteId: number | null;
  name: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DiagramDetail extends DiagramListItem {
  /** JSON do React Flow ({ nodes, edges, viewport }); validar antes de usar. */
  data: unknown;
}

export interface SaveDiagramRequest {
  clientId: number;
  siteId?: number;
  name: string;
  data: unknown;
}

export interface CredentialDto {
  id: number;
  clientId: number;
  clientName: string;
  siteId: number | null;
  assetId: number | null;
  assetName: string | null;
  name: string;
  username: string | null;
  url: string | null;
  notes: string | null;
  updatedAt: string;
  updatedBy: string;
}

export interface ListCredentialsParams {
  clientId?: number;
  assetId?: number;
  search?: string;
}

export interface SaveCredentialRequest {
  clientId: number;
  siteId?: number;
  assetId?: number;
  name: string;
  username?: string;
  /** Obrigatorio na criacao; ausente no PUT mantem o atual. */
  secret?: string;
  url?: string;
  notes?: string;
}

export interface RevealedSecretDto {
  secret: string;
}

export interface DocPageListItem {
  id: number;
  clientId: number;
  clientName?: string;
  siteId: number | null;
  title: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DocPageDetail extends DocPageListItem {
  /** Markdown. */
  body: string;
}

export interface SaveDocPageRequest {
  clientId: number;
  siteId?: number;
  title: string;
  body: string;
}
