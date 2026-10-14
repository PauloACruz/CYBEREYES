using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase15Procedimentos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_procedures",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: true),
                    ClientId = table.Column<int>(type: "integer", nullable: false),
                    Hostname = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Kind = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Title = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Detail = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: true),
                    UserName = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DurationSeconds = table.Column<int>(type: "integer", nullable: true),
                    TicketId = table.Column<int>(type: "integer", nullable: true),
                    TimeEntryId = table.Column<long>(type: "bigint", nullable: true),
                    RefType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    RefId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_procedures", x => x.Id);
                    table.ForeignKey(
                        name: "FK_agent_procedures_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_agent_procedures_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_agent_procedures_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_agent_procedures_tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_agent_procedures_time_entries_TimeEntryId",
                        column: x => x.TimeEntryId,
                        principalTable: "time_entries",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_agent_procedures_AgentId_StartedAt",
                table: "agent_procedures",
                columns: new[] { "AgentId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_agent_procedures_ClientId_StartedAt",
                table: "agent_procedures",
                columns: new[] { "ClientId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_agent_procedures_RefType_RefId",
                table: "agent_procedures",
                columns: new[] { "RefType", "RefId" });

            migrationBuilder.CreateIndex(
                name: "IX_agent_procedures_TicketId",
                table: "agent_procedures",
                column: "TicketId");

            migrationBuilder.CreateIndex(
                name: "IX_agent_procedures_TimeEntryId",
                table: "agent_procedures",
                column: "TimeEntryId");

            migrationBuilder.CreateIndex(
                name: "IX_agent_procedures_UserId_StartedAt",
                table: "agent_procedures",
                columns: new[] { "UserId", "StartedAt" });

            // Carga inicial com o que ja estava registrado, para os indicadores nao comecarem do zero. Nada entra em chamado:
            // incluir mexeria no tempo de servico de chamados antigos. Sessoes ainda abertas ficam "running" e sao concluidas no fim.
            migrationBuilder.Sql("""
                INSERT INTO agent_procedures ("AgentId", "ClientId", "Hostname", "Kind", "Title", "Status", "Source", "UserId", "UserName",
                    "StartedAt", "FinishedAt", "DurationSeconds", "RefType", "RefId")
                SELECT s."AgentId", si."ClientId", a."Hostname",
                    CASE WHEN s."Channels" = 'files' THEN 'files' ELSE 'remote' END,
                    upper(left(t.title, 1)) || substr(t.title, 2) || CASE WHEN s."ViewOnly" THEN ' (somente visualização)' ELSE '' END,
                    CASE WHEN s."State" <> 'ended' THEN 'running'
                         WHEN s."FirstFrameAt" IS NOT NULL OR s."Channels" = 'files' THEN 'ok' ELSE 'cancelled' END,
                    'console', s."UserId", COALESCE(NULLIF(u."FullName", ''), s."Username"),
                    s."StartedAt", s."EndedAt",
                    CASE WHEN s."EndedAt" IS NULL THEN NULL ELSE GREATEST(0, round(extract(epoch FROM s."EndedAt" - s."StartedAt")))::int END,
                    'remote_session', s."SessionId"
                FROM remote_sessions s
                JOIN agents a ON a."Id" = s."AgentId"
                JOIN sites si ON si."Id" = a."SiteId"
                LEFT JOIN "AspNetUsers" u ON u."Id" = s."UserId"
                CROSS JOIN LATERAL (SELECT replace(replace(replace(replace(s."Channels", 'desktop', 'tela'), 'rdp', 'RDP'), 'files', 'arquivos'), ',', ' e ')
                    AS title) t;

                INSERT INTO agent_procedures ("AgentId", "ClientId", "Hostname", "Kind", "Title", "Detail", "Status", "Source", "UserId", "UserName",
                    "StartedAt", "FinishedAt", "DurationSeconds", "RefType", "RefId")
                SELECT r."AgentId", si."ClientId", a."Hostname", 'care',
                    CASE r."Module"
                        WHEN 'maintenance' THEN 'Manutenção do sistema'
                        WHEN 'windows_update' THEN 'Windows Update'
                        WHEN 'bug_fixer' THEN 'Correção de bugs'
                        WHEN 'office' THEN 'Office, Teams, OneDrive e SharePoint'
                        WHEN 'registry' THEN 'Registro do Windows'
                        WHEN 'app_remover' THEN 'Desinstalador de aplicativos'
                        WHEN 'component_test' THEN 'Testes de componentes'
                        WHEN 'winget' THEN 'Winget'
                        ELSE r."Module" END
                    || CASE WHEN cardinality(r."Tasks") = 1 THEN ' (1 tarefa)' ELSE ' (' || cardinality(r."Tasks") || ' tarefas)' END,
                    left(array_to_string(r."Tasks", ', '), 2000),
                    r."Status",
                    CASE WHEN r."Source" = 'tray' THEN 'tray' ELSE 'console' END,
                    CASE WHEN r."Source" = 'tray' THEN NULL ELSE (SELECT u."Id" FROM "AspNetUsers" u
                        WHERE u."FullName" = r."RequestedBy" OR u."UserName" = r."RequestedBy" ORDER BY u."Id" LIMIT 1) END,
                    left(CASE WHEN r."RequestedBy" LIKE 'tray:%' THEN substr(r."RequestedBy", 6) ELSE r."RequestedBy" END, 256),
                    r."StartedAt", r."FinishedAt",
                    CASE WHEN r."FinishedAt" IS NULL THEN NULL ELSE GREATEST(0, round(extract(epoch FROM r."FinishedAt" - r."StartedAt")))::int END,
                    'care_run', r."RunId"
                FROM care_runs r
                JOIN agents a ON a."Id" = r."AgentId"
                JOIN sites si ON si."Id" = a."SiteId";

                INSERT INTO agent_procedures ("AgentId", "ClientId", "Hostname", "Kind", "Title", "Detail", "Status", "Source", "UserId", "UserName",
                    "StartedAt", "FinishedAt", "DurationSeconds", "RefType", "RefId")
                SELECT h."AgentId", si."ClientId", a."Hostname", k.kind,
                    left(CASE k.kind
                        WHEN 'command' THEN btrim(regexp_replace(h."Command", '\s+', ' ', 'g'))
                        WHEN 'rename' THEN COALESCE('para ' || substring(h."Command" FROM '-NovoNome (\S+)'), '')
                        ELSE COALESCE(h."ScriptName", '') END, 500),
                    CASE WHEN k.kind = 'script' AND h."Command" <> '' THEN left(h."Command", 2000) ELSE NULL END,
                    CASE WHEN h."Type" = 'cmd_run' THEN CASE WHEN h."Results" IS NULL THEN 'timeout' ELSE 'ok' END
                         WHEN h."ScriptResults" IS NULL THEN 'timeout'
                         WHEN (h."ScriptResults" ->> 'Retcode') = '0' THEN 'ok' ELSE 'error' END,
                    'console', u."Id", COALESCE(NULLIF(u."FullName", ''), h."Username"),
                    h."Time", h."Time" + make_interval(secs => d.secs), round(d.secs)::int,
                    'agent_history', h."Id"::text
                FROM agent_history h
                JOIN agents a ON a."Id" = h."AgentId"
                JOIN sites si ON si."Id" = a."SiteId"
                LEFT JOIN "AspNetUsers" u ON u."NormalizedUserName" = upper(h."Username")
                CROSS JOIN LATERAL (SELECT CASE WHEN h."Type" = 'cmd_run' THEN 'command'
                    WHEN h."ScriptName" = 'Renomear computador' AND h."ScriptId" IS NULL THEN 'rename' ELSE 'script' END AS kind) k
                CROSS JOIN LATERAL (SELECT COALESCE((h."ScriptResults" ->> 'ExecutionTime')::double precision, 0) AS secs) d
                WHERE h."Type" IN ('cmd_run', 'script_run');

                INSERT INTO agent_procedures ("AgentId", "ClientId", "Hostname", "Kind", "Title", "Status", "Source", "UserId", "UserName",
                    "StartedAt", "FinishedAt", "DurationSeconds")
                SELECT a."Id", si."ClientId", a."Hostname", k.kind, left(COALESCE(l."Message", ''), 500),
                    'ok',
                    'console', u."Id", COALESCE(NULLIF(u."FullName", ''), l."Username"),
                    l."Timestamp", l."Timestamp", NULL
                FROM audit_logs l
                JOIN agents a ON a."Id"::text = l."ObjectId"
                JOIN sites si ON si."Id" = a."SiteId"
                LEFT JOIN "AspNetUsers" u ON u."NormalizedUserName" = upper(l."Username")
                CROSS JOIN LATERAL (SELECT CASE l."Action"
                    WHEN 'agent.rebootnow' THEN 'reboot'
                    WHEN 'agent.shutdown' THEN 'shutdown'
                    WHEN 'agent.service-action' THEN 'service'
                    WHEN 'agent.service-start-type' THEN 'service'
                    WHEN 'agent.process-killed' THEN 'process'
                    WHEN 'agent.registry' THEN 'registry'
                    WHEN 'agent.terminal-opened' THEN 'terminal'
                    WHEN 'agent.wake' THEN 'wake'
                    WHEN 'agent.update' THEN 'agent_update'
                    WHEN 'software.install' THEN 'software'
                    WHEN 'update.install' THEN 'updates'
                    WHEN 'task.run' THEN 'task' END AS kind) k
                WHERE l."ObjectType" = 'agent' AND k.kind IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_procedures");
        }
    }
}
