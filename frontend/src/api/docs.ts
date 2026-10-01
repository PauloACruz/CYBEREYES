import { api, type RequestOptions } from './client';
import type {
  CredentialDto,
  DiagramDetail,
  DiagramListItem,
  DocAttachmentDto,
  DocOwnerType,
  DocPageDetail,
  DocPageListItem,
  IpRecordDto,
  ListCredentialsParams,
  NetworkDetail,
  NetworkDto,
  RevealedSecretDto,
  SaveCredentialRequest,
  SaveDiagramRequest,
  SaveDocPageRequest,
  SaveIpRecordRequest,
  SaveNetworkRequest,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export const networksApi = {
  list: (clientId?: number) => api.get<NetworkDto[]>('/api/networks', { clientId }),
  get: (id: number) => api.get<NetworkDetail>(`/api/networks/${id}`),
  create: (body: SaveNetworkRequest) => api.post<NetworkDto>('/api/networks', body),
  update: (id: number, body: SaveNetworkRequest) => api.put<NetworkDto>(`/api/networks/${id}`, body),
  remove: (id: number) => api.delete(`/api/networks/${id}`),
  addIp: (id: number, body: SaveIpRecordRequest) => api.post<IpRecordDto>(`/api/networks/${id}/ips`, body),
  updateIp: (id: number, ipId: number, body: SaveIpRecordRequest) => api.put<IpRecordDto>(`/api/networks/${id}/ips/${ipId}`, body),
  removeIp: (id: number, ipId: number) => api.delete(`/api/networks/${id}/ips/${ipId}`),
};

export const diagramsApi = {
  list: (clientId?: number) => api.get<DiagramListItem[]>('/api/diagrams', { clientId }),
  get: (id: number) => api.get<DiagramDetail>(`/api/diagrams/${id}`),
  create: (body: SaveDiagramRequest) => api.post<DiagramDetail>('/api/diagrams', body),
  update: (id: number, body: SaveDiagramRequest) => api.put<DiagramDetail>(`/api/diagrams/${id}`, body),
  remove: (id: number) => api.delete(`/api/diagrams/${id}`),
};

export const credentialsApi = {
  list: (params: ListCredentialsParams, options?: Silent) => api.get<CredentialDto[]>('/api/credentials', { ...params }, options),
  /** Gera auditoria credential.reveal no servidor. */
  reveal: (id: number) => api.post<RevealedSecretDto>(`/api/credentials/${id}/reveal`),
  create: (body: SaveCredentialRequest) => api.post<CredentialDto>('/api/credentials', body),
  update: (id: number, body: SaveCredentialRequest) => api.put<CredentialDto>(`/api/credentials/${id}`, body),
  remove: (id: number) => api.delete(`/api/credentials/${id}`),
};

export const docPagesApi = {
  list: (params: { clientId?: number; search?: string }) => api.get<DocPageListItem[]>('/api/doc-pages', { ...params }),
  get: (id: number) => api.get<DocPageDetail>(`/api/doc-pages/${id}`),
  create: (body: SaveDocPageRequest) => api.post<DocPageDetail>('/api/doc-pages', body),
  update: (id: number, body: SaveDocPageRequest) => api.put<DocPageDetail>(`/api/doc-pages/${id}`, body),
  remove: (id: number) => api.delete(`/api/doc-pages/${id}`),
};

export function docAttachmentUrl(id: number): string {
  return `/api/doc-attachments/${id}`;
}

export const docAttachmentsApi = {
  list: (ownerType: DocOwnerType, ownerId: number) => api.get<DocAttachmentDto[]>('/api/doc-attachments', { ownerType, ownerId }),
  upload: (ownerType: DocOwnerType, ownerId: number, file: File) => {
    const form = new FormData();
    form.append('ownerType', ownerType);
    form.append('ownerId', String(ownerId));
    form.append('file', file);
    return api.post<DocAttachmentDto>('/api/doc-attachments', form);
  },
  remove: (id: number) => api.delete(`/api/doc-attachments/${id}`),
};
