import { api } from './client';
import type {
  AssistantAgentDto,
  AssistantSettingsDto,
  FaqEntryDto,
  ListFaqParams,
  LogInsightDetailDto,
  LogInsightListDto,
  SaveAssistantSettingsRequest,
  SaveFaqRequest,
  SuccessMessage,
} from './types';

export const assistantApi = {
  settings: () => api.get<AssistantSettingsDto>('/api/assistant/settings'),
  saveSettings: (body: SaveAssistantSettingsRequest) => api.put<AssistantSettingsDto>('/api/assistant/settings', body),
  /** Sem apiKey testa a chave gravada; com model 'agent', o modelo do agente informado. */
  test: (apiKey: string | null, model: string, agentId: string | null) =>
    api.post<SuccessMessage>('/api/assistant/test', { apiKey, model, agentId }),
  /** Agentes da conta da chave gravada; o erro aparece no campo, sem aviso. */
  agents: () => api.get<AssistantAgentDto[]>('/api/assistant/agents', undefined, { silent: true }),
  createAgent: (name: string, model: string | null) => api.post<AssistantAgentDto>('/api/assistant/agents', { name, model }),
  insights: () => api.get<LogInsightListDto>('/api/assistant/insights'),
  insight: (id: number) => api.get<LogInsightDetailDto>(`/api/assistant/insights/${id}`),
  runInsights: () => api.post('/api/assistant/insights/run'),
};

export const faqApi = {
  list: (params: ListFaqParams) => api.get<FaqEntryDto[]>('/api/faq', { ...params }),
  create: (body: SaveFaqRequest) => api.post<FaqEntryDto>('/api/faq', body),
  update: (id: number, body: SaveFaqRequest) => api.put<FaqEntryDto>(`/api/faq/${id}`, body),
  remove: (id: number) => api.delete(`/api/faq/${id}`),
};
