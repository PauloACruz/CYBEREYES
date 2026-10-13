import { useEffect, useState } from 'react';
import { Button, Code, CopyButton, Group, Modal, Stack, Text } from '@mantine/core';
import { IconEye } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import type { RevealedServerSecret } from '../../api/types';
import { appServersApi } from '../../api/webapps';

const REVEAL_SECONDS = 30;

/** Revela a senha ou a chave SSH do servidor por 30 s (o servidor registra na auditoria). */
export function ServerSecretReveal({ serverId, name }: { serverId: number; name: string }) {
  const [secret, setSecret] = useState<RevealedServerSecret | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(0);
  const reveal = useMutation({
    mutationFn: async () => ({ value: await appServersApi.reveal(serverId), revealedAt: Date.now() }),
    onSuccess: ({ value, revealedAt }) => {
      setSecret(value);
      setNow(revealedAt);
      setExpiresAt(revealedAt + REVEAL_SECONDS * 1000);
      // Nao deixa o segredo no cache de mutacoes do React Query.
      reveal.reset();
    },
  });

  useEffect(() => {
    if (secret === null) return undefined;
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt) setSecret(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [secret, expiresAt]);

  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  const field = (label: string, value: string | null) =>
    value ? (
      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <CopyButton value={value} timeout={2000}>
            {({ copied, copy }) => (
              <Button size="compact-xs" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                {copied ? 'Copiado' : 'Copiar'}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 280, overflow: 'auto' }}>
          {value}
        </Code>
      </Stack>
    ) : null;

  return (
    <>
      <Button size="compact-sm" variant="light" leftSection={<IconEye size={14} />} loading={reveal.isPending} onClick={() => reveal.mutate()}>
        Revelar
      </Button>
      <Modal opened={secret !== null} onClose={() => setSecret(null)} title={`Credencial SSH de ${name}`} size="lg" centered>
        {secret && (
          <Stack>
            {field('Senha', secret.password)}
            {field('Chave privada', secret.privateKey)}
            {field('Senha da chave', secret.passphrase)}
            <Text size="xs" c="dimmed" aria-live="polite">
              Fecha sozinho em {remaining} s. A revelação ficou registrada na auditoria.
            </Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}
