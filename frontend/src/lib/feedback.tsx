import { Text } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';

export function notifySuccess(message: string, title = 'Pronto'): void {
  notifications.show({ color: 'teal', title, message });
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function confirmAction({ title, message, confirmLabel, danger = false, onConfirm }: ConfirmOptions): void {
  modals.openConfirmModal({
    title,
    centered: true,
    children: <Text size="sm">{message}</Text>,
    labels: { confirm: confirmLabel, cancel: 'Cancelar' },
    confirmProps: { color: danger ? 'red' : undefined },
    onConfirm,
  });
}
