import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentActionsApi } from "../../../api/agentActions";
import { ApiError } from "../../../api/client";
import { queryKeys } from "../../../api/queryKeys";
import type { AgentDetail, RenameComputerResponse } from "../../../api/types";
import { parseDomainMembership } from "../agentData";

interface RenameComputerModalProps {
  agent: AgentDetail;
  opened: boolean;
  onClose: () => void;
}

/** Mesmas regras do servidor e do script: NetBIOS (15) e DNS. */
function computerNameError(value: string): string | null {
  const name = value.trim();
  if (!name) return "Informe o novo nome";
  if (name.length > 15) return "Use no máximo 15 caracteres";
  if (!/^[A-Za-z0-9-]+$/.test(name))
    return "Use só letras sem acento, números e hífen";
  if (name.startsWith("-") || name.endsWith("-"))
    return "O nome não pode começar nem terminar com hífen";
  if (/^[0-9]+$/.test(name)) return "O nome não pode ser só números";
  return null;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "Falha ao renomear o computador";
  const fields = Object.values(error.problem.errors ?? {}).flat();
  return fields[0] ?? error.title;
}

export function RenameComputerModal({
  agent,
  opened,
  onClose,
}: RenameComputerModalProps) {
  const membership = parseDomainMembership(agent.wmi);
  const [name, setName] = useState("");
  const [restart, setRestart] = useState(true);
  const [domainUser, setDomainUser] = useState("");
  const [domainPassword, setDomainPassword] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const close = () => {
    setName("");
    setRestart(true);
    setDomainUser("");
    setDomainPassword("");
    setSubmitted(false);
    setFailure(null);
    onClose();
  };

  const rename = useMutation({
    mutationFn: () =>
      agentActionsApi.renameComputer(
        agent.id,
        {
          newName: name.trim(),
          restart,
          ...(domainUser.trim()
            ? { domainUser: domainUser.trim(), domainPassword }
            : {}),
        },
        { silent: true },
      ),
    onSuccess: (response: RenameComputerResponse) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agentHistory(agent.id),
      });
      if (response.retcode === 0 || response.retcode === 3010) {
        notifications.show({
          color: "teal",
          title:
            response.retcode === 3010
              ? "Renomeado; falta reiniciar"
              : "Computador renomeado",
          message: response.result,
        });
        close();
      } else if (response.retcode === 1) {
        notifications.show({
          color: "orange",
          title: "Renomear computador",
          message: response.result,
        });
        close();
      } else {
        setFailure(response.result);
      }
    },
    onError: (error) => setFailure(errorMessage(error)),
  });

  const nameError = submitted ? computerNameError(name) : null;
  const needsCredential = membership.kind === "domain";
  // No domínio a credencial é obrigatória; fora dele, usuário e senha vão juntos ou nenhum dos dois.
  const credentialMissing =
    (needsCredential || domainUser.trim() !== "" || domainPassword !== "") &&
    (domainUser.trim() === "" || domainPassword === "");
  const credentialError =
    submitted && credentialMissing
      ? "Informe o usuário e a senha do domínio"
      : null;

  return (
    <Modal opened={opened} onClose={close} title="Renomear computador" centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          setFailure(null);
          if (!computerNameError(name) && !credentialMissing) rename.mutate();
        }}
      >
        <Stack>
          <Text size="sm">
            Nome atual: <b>{agent.hostname}</b>. O nome novo só passa a valer
            depois do reinício
            {membership.kind === "domain"
              ? ", e o computador também é renomeado no Active Directory"
              : ""}
            .
          </Text>
          <TextInput
            label="Novo nome"
            description="Até 15 caracteres: letras sem acento, números e hífen."
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            error={nameError}
            maxLength={15}
            autoComplete="off"
            data-autofocus
            withAsterisk
          />
          <Checkbox
            label="Reiniciar em 5 minutos para concluir"
            description="Quem estiver usando a máquina recebe um aviso. Sem reiniciar, o nome muda no próximo reinício."
            checked={restart}
            onChange={(e) => setRestart(e.currentTarget.checked)}
          />
          {membership.kind !== "workgroup" && (
            <>
              <Text size="sm" c="dimmed">
                {membership.kind === "domain"
                  ? `Máquina no domínio ${membership.domain || ""}: informe uma conta com permissão para renomear o computador no AD.`
                  : "Se a máquina estiver em um domínio, informe uma conta com permissão para renomear o computador no AD."}
              </Text>
              <TextInput
                label="Usuário do domínio"
                placeholder="EMPRESA\usuario"
                value={domainUser}
                onChange={(e) => setDomainUser(e.currentTarget.value)}
                error={credentialError}
                autoComplete="off"
                withAsterisk={needsCredential}
              />
              <PasswordInput
                label="Senha do domínio"
                value={domainPassword}
                onChange={(e) => setDomainPassword(e.currentTarget.value)}
                autoComplete="new-password"
                withAsterisk={needsCredential}
              />
            </>
          )}
          {failure && (
            <Alert color="red" title="O computador não foi renomeado">
              {failure}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" loading={rename.isPending}>
              Renomear
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
