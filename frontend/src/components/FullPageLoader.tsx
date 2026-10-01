import { Center, Loader } from '@mantine/core';

export function FullPageLoader() {
  return (
    <Center h="100vh" role="status" aria-label="Carregando">
      <Loader />
    </Center>
  );
}
