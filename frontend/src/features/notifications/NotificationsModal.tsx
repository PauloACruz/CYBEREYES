import { Modal } from '@mantine/core';
import { NotificationSettings } from './NotificationSettings';

/** Notificacoes do navegador no console (menu do usuario). */
export function NotificationsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <Modal opened={opened} onClose={onClose} title="Notificações" size="lg">
      {opened && <NotificationSettings />}
    </Modal>
  );
}
