import { Navigate } from 'react-router';
import { MOBILE_PATHS } from '../../app/paths';
import { wantsApp } from '../mobile/mobileMode';
import { DashboardPage } from './DashboardPage';

/** Pagina inicial: no celular abre o app do tecnico; no computador (ou por escolha do tecnico), o Painel. */
export function HomeRoute() {
  return wantsApp() ? <Navigate to={MOBILE_PATHS.root} replace /> : <DashboardPage />;
}
