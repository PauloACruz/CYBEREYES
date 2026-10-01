import Editor from '@monaco-editor/react';
import { Center, Loader, useComputedColorScheme } from '@mantine/core';
import './monacoSetup';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  readOnly?: boolean;
  height?: number | string;
  ariaLabel: string;
}

export function CodeEditor({ value, onChange, language, readOnly = false, height = 420, ariaLabel }: CodeEditorProps) {
  const scheme = useComputedColorScheme('light');
  return (
    <div style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-sm)', overflow: 'hidden' }}>
      <Editor
        height={height}
        language={language}
        value={value}
        theme={scheme === 'dark' ? 'vs-dark' : 'vs'}
        onChange={(next) => onChange(next ?? '')}
        loading={
          <Center h="100%">
            <Loader size="sm" aria-label="Carregando editor" />
          </Center>
        }
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
          ariaLabel,
        }}
      />
    </div>
  );
}
