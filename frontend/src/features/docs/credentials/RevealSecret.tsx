import { useEffect, useState } from 'react';
import { ActionIcon, Button, Code, CopyButton, Group, Text, Tooltip } from '@mantine/core';
import { IconCheck, IconCopy, IconEye, IconEyeOff } from '@tabler/icons-react';
import { useMutation } from '@tanstack/react-query';
import { credentialsApi } from '../../../api/docs';

/** Tempo, em segundos, que o segredo fica visivel depois de revelado. */
const REVEAL_SECONDS = 30;

interface RevealSecretProps {
  credentialId: number;
  name: string;
}

/** Botao Revelar: busca o segredo (gera auditoria no servidor) e o mostra por 30 s, sem guardar em cache. */
export function RevealSecret({ credentialId, name }: RevealSecretProps) {
  const [secret, setSecret] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(0);

  const reveal = useMutation({
    mutationFn: async () => {
      const { secret: value } = await credentialsApi.reveal(credentialId);
      return { value, revealedAt: Date.now() };
    },
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

  if (secret === null) {
    return (
      <Button
        size="compact-sm"
        variant="light"
        leftSection={<IconEye size={14} />}
        loading={reveal.isPending}
        onClick={() => reveal.mutate()}
        aria-label={`Revelar senha de ${name}`}
      >
        Revelar
      </Button>
    );
  }

  return (
    <Group gap={6} wrap="nowrap" role="group" aria-label={`Senha de ${name}`}>
      <Code fz="sm" style={{ wordBreak: 'break-all' }} data-testid="revealed-secret">
        {secret}
      </Code>
      <CopyButton value={secret} timeout={2000}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? 'Copiado' : 'Copiar'} withArrow>
            <ActionIcon color={copied ? 'teal' : 'gray'} variant="subtle" onClick={copy} aria-label="Copiar senha">
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
      <Tooltip label="Ocultar" withArrow>
        <ActionIcon color="gray" variant="subtle" onClick={() => setSecret(null)} aria-label="Ocultar senha">
          <IconEyeOff size={16} />
        </ActionIcon>
      </Tooltip>
      <Text size="xs" c="dimmed" aria-live="polite">
        {remaining} s
      </Text>
    </Group>
  );
}
