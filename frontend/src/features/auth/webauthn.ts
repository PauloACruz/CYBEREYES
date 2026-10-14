import { authApi } from '../../api/auth';
import type { LoginResponse, PasskeyCreationOptionsJson, PasskeyDto, PasskeyRequestOptionsJson } from '../../api/types';

/** Credencial cadastrada neste aparelho: so ele mostra "Entrar com biometria" no login. */
const DEVICE_PASSKEY_KEY = 'cybereyes:biometria';

export function devicePasskeyId(): string | null {
  try {
    return localStorage.getItem(DEVICE_PASSKEY_KEY);
  } catch {
    return null;
  }
}

export function setDevicePasskeyId(id: string | null): void {
  try {
    if (id) localStorage.setItem(DEVICE_PASSKEY_KEY, id);
    else localStorage.removeItem(DEVICE_PASSKEY_KEY);
  } catch {
    // Armazenamento bloqueado (aba privada): a biometria continua cadastrada, so o atalho do login nao aparece.
  }
}

/** O navegador fala WebAuthn (a API existe). */
export function webAuthnSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials;
}

/** Existe biometria (ou PIN) do proprio aparelho para usar como autenticador. */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!webAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** O usuario fechou o pedido de biometria (ou ele expirou): nao e erro para mostrar. */
export function isBiometricsCancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

export function base64UrlToBuffer(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toDescriptor(d: { id: string; type: string; transports?: string[] }): PublicKeyCredentialDescriptor {
  return { type: d.type as PublicKeyCredentialType, id: base64UrlToBuffer(d.id), transports: d.transports as AuthenticatorTransport[] | undefined };
}

export function toCreationOptions(json: PasskeyCreationOptionsJson): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: base64UrlToBuffer(json.challenge),
    user: { ...json.user, id: base64UrlToBuffer(json.user.id) },
    excludeCredentials: json.excludeCredentials?.map(toDescriptor),
  } as PublicKeyCredentialCreationOptions;
}

export function toRequestOptions(json: PasskeyRequestOptionsJson): PublicKeyCredentialRequestOptions {
  return {
    ...json,
    challenge: base64UrlToBuffer(json.challenge),
    allowCredentials: json.allowCredentials?.map(toDescriptor),
  } as PublicKeyCredentialRequestOptions;
}

/** PublicKeyCredential no formato JSON do WebAuthn (binarios em base64url), como a API espera. */
export function credentialToJson(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response;
  const common = {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  if ('attestationObject' in response) {
    const attestation = response as AuthenticatorAttestationResponse;
    return {
      ...common,
      response: {
        clientDataJSON: bufferToBase64Url(attestation.clientDataJSON),
        attestationObject: bufferToBase64Url(attestation.attestationObject),
        transports: typeof attestation.getTransports === 'function' ? attestation.getTransports() : [],
      },
    };
  }
  const assertion = response as AuthenticatorAssertionResponse;
  return {
    ...common,
    response: {
      clientDataJSON: bufferToBase64Url(assertion.clientDataJSON),
      authenticatorData: bufferToBase64Url(assertion.authenticatorData),
      signature: bufferToBase64Url(assertion.signature),
      userHandle: assertion.userHandle ? bufferToBase64Url(assertion.userHandle) : undefined,
    },
  };
}

/** Cadastra a biometria deste aparelho na conta e guarda o id para o atalho do login. */
export async function registerDevicePasskey(): Promise<PasskeyDto> {
  const options = await authApi.passkeyRegisterOptions();
  const credential = (await navigator.credentials.create({ publicKey: toCreationOptions(options) })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('Biometria cancelada', 'NotAllowedError');
  const passkey = await authApi.passkeyRegister({ credential: credentialToJson(credential) });
  setDevicePasskeyId(passkey.id);
  return passkey;
}

/** Entra com a biometria: o aparelho escolhe a credencial guardada para este endereco. */
export async function signInWithPasskey(rememberMe: boolean): Promise<LoginResponse> {
  const options = await authApi.passkeyLoginOptions();
  const credential = (await navigator.credentials.get({ publicKey: toRequestOptions(options) })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException('Biometria cancelada', 'NotAllowedError');
  return authApi.passkeyLogin({ credential: credentialToJson(credential), rememberMe });
}
