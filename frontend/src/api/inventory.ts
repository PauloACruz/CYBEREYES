import { api, type RequestOptions } from './client';
import type {
  AgentAssetDto,
  AssetListItem,
  AssetSheet,
  ListAssetsParams,
  ListPeopleParams,
  Paged,
  PersonDetail,
  PersonListItem,
  SaveAssetRequest,
  SavePersonRequest,
  SetResponsibleRequest,
} from './types';

type Silent = Pick<RequestOptions, 'silent'>;

export const assetsApi = {
  list: (params: ListAssetsParams) => api.get<Paged<AssetListItem>>('/api/assets', { ...params }),
  get: (id: number) => api.get<AssetSheet>(`/api/assets/${id}`),
  create: (body: SaveAssetRequest) => api.post<AssetSheet>('/api/assets', body),
  update: (id: number, body: SaveAssetRequest) => api.put<AssetSheet>(`/api/assets/${id}`, body),
  remove: (id: number, options?: Silent) => api.delete(`/api/assets/${id}`, options),
  setResponsible: (id: number, body: SetResponsibleRequest) => api.put<AssetSheet>(`/api/assets/${id}/responsible`, body),
  /** O servidor cria o ativo do agente se ainda nao existir. */
  forAgent: (agentId: number) => api.get<AgentAssetDto>(`/api/agents/${agentId}/asset`),
};

export const peopleApi = {
  list: (params: ListPeopleParams) => api.get<Paged<PersonListItem>>('/api/people', { ...params }),
  get: (id: number) => api.get<PersonDetail>(`/api/people/${id}`),
  create: (body: SavePersonRequest) => api.post<PersonDetail>('/api/people', body),
  update: (id: number, body: SavePersonRequest) => api.put<PersonDetail>(`/api/people/${id}`, body),
  remove: (id: number, options?: Silent) => api.delete(`/api/people/${id}`, options),
};
