import { useNavigate } from 'react-router';
import { MOBILE_PATHS, mobileTicketPath } from '../../../app/paths';
import { CreateTicketForm } from '../../tickets/CreateTicketModal';
import { MobileHeader, MobilePage } from '../MobilePage';

/** Novo chamado no app: o mesmo formulario do console, em tela cheia. */
export function MobileNewTicketPage() {
  const navigate = useNavigate();
  return (
    <MobilePage header={<MobileHeader title="Novo chamado" back={{ to: MOBILE_PATHS.tickets, label: 'Chamados' }} />} bottom={null}>
      <CreateTicketForm onClose={() => void navigate(MOBILE_PATHS.tickets)} ticketHref={mobileTicketPath} />
    </MobilePage>
  );
}
