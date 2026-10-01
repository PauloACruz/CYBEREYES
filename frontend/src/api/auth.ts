import { api } from './client';
import type {
  ChangePasswordRequest,
  EnableTwoFactorRequest,
  EnableTwoFactorResponse,
  LoginRecoveryRequest,
  LoginRequest,
  LoginResponse,
  LoginTwoFactorRequest,
  MeDto,
  StatusOkResponse,
  TwoFactorSetupDto,
} from './types';

export const authApi = {
  login: (body: LoginRequest) => api.post<LoginResponse>('/api/auth/login', body),
  loginTwoFactor: (body: LoginTwoFactorRequest) => api.post<StatusOkResponse>('/api/auth/login/2fa', body),
  loginRecovery: (body: LoginRecoveryRequest) => api.post<StatusOkResponse>('/api/auth/login/recovery', body),
  getTwoFactorSetup: () => api.get<TwoFactorSetupDto>('/api/auth/2fa/setup'),
  enableTwoFactor: (body: EnableTwoFactorRequest) => api.post<EnableTwoFactorResponse>('/api/auth/2fa/enable', body),
  logout: () => api.post<undefined>('/api/auth/logout'),
  me: () => api.get<MeDto>('/api/auth/me'),
  changePassword: (body: ChangePasswordRequest) => api.post<undefined>('/api/auth/password', body),
};
