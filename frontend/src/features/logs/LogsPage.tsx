import { PageHeader } from '../../components/PageHeader';
import { LogsView } from './LogsView';

export function LogsPage() {
  return (
    <>
      <PageHeader title="Logs" description="Eventos de sistema das máquinas e traps dos dispositivos SNMP." />
      <LogsView />
    </>
  );
}
