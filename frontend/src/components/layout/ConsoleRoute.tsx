import { Navigate, useLocation } from 'react-router';
import { appPathFor, wantsApp } from '../../features/mobile/mobileMode';
import { AppLayout } from './AppLayout';

/**
 * Console completo. No celular, agentes, chamados e aplicacoes abertos direto pelo endereco (aba antiga,
 * favorito, link recebido) vao para a mesma tela no app do tecnico, como a pagina inicial.
 */
export function ConsoleRoute() {
  const location = useLocation();
  const target = wantsApp() ? appPathFor(location.pathname, location.search, location.state) : null;
  return target ? <Navigate to={target} replace /> : <AppLayout />;
}
