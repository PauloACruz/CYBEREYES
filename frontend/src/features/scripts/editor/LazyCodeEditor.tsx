import { lazy, Suspense } from 'react';
import { Center, Loader } from '@mantine/core';
import type { CodeEditorProps } from './CodeEditor';

// O Monaco pesa varios MB: so carrega quando um editor aparece na tela.
const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })));

export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense
      fallback={
        <Center h={typeof props.height === 'number' ? props.height : 420}>
          <Loader size="sm" aria-label="Carregando editor" />
        </Center>
      }
    >
      <CodeEditor {...props} />
    </Suspense>
  );
}
