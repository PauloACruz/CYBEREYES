import { ApiError } from '../api/client';

interface FormWithErrors {
  setFieldError: (path: string, error: string) => void;
}

/** Copia os erros de validacao (400) do ProblemDetails para os campos do formulario. */
export function applyServerErrors(form: FormWithErrors, error: unknown): void {
  if (!(error instanceof ApiError) || error.status !== 400) return;
  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const first = messages[0];
    if (!first) continue;
    form.setFieldError(field.charAt(0).toLowerCase() + field.slice(1), first);
  }
}
