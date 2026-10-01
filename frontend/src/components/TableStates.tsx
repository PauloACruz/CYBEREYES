import { Alert, Button, Skeleton, Table, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { ApiError } from '../api/client';

interface RowsProps {
  columns: number;
}

export function LoadingRows({ columns, rows = 5 }: RowsProps & { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <Table.Tr key={row} aria-hidden>
          {Array.from({ length: columns }, (_, col) => (
            <Table.Td key={col}>
              <Skeleton height={14} radius="sm" />
            </Table.Td>
          ))}
        </Table.Tr>
      ))}
    </>
  );
}

export function EmptyRow({ columns, message }: RowsProps & { message: string }) {
  return (
    <Table.Tr>
      <Table.Td colSpan={columns}>
        <Text c="dimmed" ta="center" py="lg">
          {message}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

interface LoadErrorProps {
  error: unknown;
  onRetry: () => void;
}

export function LoadError({ error, onRetry }: LoadErrorProps) {
  const title = error instanceof ApiError ? error.title : 'Não foi possível carregar os dados';
  return (
    <Alert color="red" icon={<IconAlertCircle size={18} />} title={title} mb="md">
      <Button size="xs" variant="light" color="red" onClick={onRetry}>
        Tentar novamente
      </Button>
    </Alert>
  );
}
