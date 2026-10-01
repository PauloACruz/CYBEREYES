import { ActionIcon, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';

interface StringListInputProps {
  label: string;
  description?: string;
  placeholder?: string;
  addLabel: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/** Lista editavel de textos (argumentos, variaveis de ambiente). Cada item pode conter espacos e virgulas. */
export function StringListInput({ label, description, placeholder, addLabel, value, onChange, disabled }: StringListInputProps) {
  const update = (index: number, text: string) => onChange(value.map((item, i) => (i === index ? text : item)));
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  return (
    <Stack gap={6}>
      <div>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        {description && (
          <Text size="xs" c="dimmed">
            {description}
          </Text>
        )}
      </div>
      {value.length === 0 && (
        <Text size="sm" c="dimmed">
          Nenhum item.
        </Text>
      )}
      {value.map((item, index) => (
        <Group key={index} gap="xs" wrap="nowrap">
          <TextInput
            flex={1}
            ff="monospace"
            aria-label={`${label} ${index + 1}`}
            placeholder={placeholder}
            value={item}
            disabled={disabled}
            onChange={(e) => update(index, e.currentTarget.value)}
          />
          <ActionIcon variant="subtle" color="gray" aria-label={`Remover ${label.toLowerCase()} ${index + 1}`} onClick={() => remove(index)} disabled={disabled}>
            <IconX size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button variant="light" size="xs" leftSection={<IconPlus size={14} />} onClick={() => onChange([...value, ''])} disabled={disabled}>
          {addLabel}
        </Button>
      </Group>
    </Stack>
  );
}
