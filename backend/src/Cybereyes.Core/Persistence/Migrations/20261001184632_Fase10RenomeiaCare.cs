using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase10RenomeiaCare : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_wincare_run_events_wincare_runs_RunId",
                table: "wincare_run_events");

            migrationBuilder.DropForeignKey(
                name: "FK_wincare_runs_agents_AgentId",
                table: "wincare_runs");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_wincare_runs_RunId",
                table: "wincare_runs");

            migrationBuilder.DropPrimaryKey(
                name: "PK_wincare_runs",
                table: "wincare_runs");

            migrationBuilder.DropPrimaryKey(
                name: "PK_wincare_run_events",
                table: "wincare_run_events");

            migrationBuilder.RenameTable(
                name: "wincare_runs",
                newName: "care_runs");

            migrationBuilder.RenameTable(
                name: "wincare_run_events",
                newName: "care_run_events");

            migrationBuilder.RenameIndex(
                name: "IX_wincare_runs_Status",
                table: "care_runs",
                newName: "IX_care_runs_Status");

            migrationBuilder.RenameIndex(
                name: "IX_wincare_runs_RunId",
                table: "care_runs",
                newName: "IX_care_runs_RunId");

            migrationBuilder.RenameIndex(
                name: "IX_wincare_runs_AgentId_StartedAt",
                table: "care_runs",
                newName: "IX_care_runs_AgentId_StartedAt");

            migrationBuilder.RenameIndex(
                name: "IX_wincare_run_events_RunId_Seq",
                table: "care_run_events",
                newName: "IX_care_run_events_RunId_Seq");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_care_runs_RunId",
                table: "care_runs",
                column: "RunId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_care_runs",
                table: "care_runs",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_care_run_events",
                table: "care_run_events",
                column: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_care_run_events_care_runs_RunId",
                table: "care_run_events",
                column: "RunId",
                principalTable: "care_runs",
                principalColumn: "RunId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_care_runs_agents_AgentId",
                table: "care_runs",
                column: "AgentId",
                principalTable: "agents",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            // O RenameTable nao renomeia as sequencias identity das colunas "Id".
            migrationBuilder.Sql("""
                ALTER SEQUENCE "wincare_runs_Id_seq" RENAME TO "care_runs_Id_seq";
                ALTER SEQUENCE "wincare_run_events_Id_seq" RENAME TO "care_run_events_Id_seq";
                """);

            // Dados gravados com os nomes antigos do modulo: permissao dos papeis e acoes de auditoria (ADR-019).
            // Papel que ja tenha as duas chaves fica so com a nova, sem duplicar.
            migrationBuilder.Sql("""
                UPDATE "AspNetRoles" SET "Permissions" = CASE
                    WHEN 'care.run' = ANY("Permissions") THEN array_remove("Permissions", 'wincare.run')
                    ELSE array_replace("Permissions", 'wincare.run', 'care.run') END
                WHERE 'wincare.run' = ANY("Permissions");
                UPDATE audit_logs SET "Action" = 'agent.care-run' WHERE "Action" = 'agent.wincare-run';
                UPDATE audit_logs SET "Action" = 'agent.care-cancel' WHERE "Action" = 'agent.wincare-cancel';
                UPDATE audit_logs SET "Action" = 'care.self-service' WHERE "Action" = 'wincare.self-service';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "AspNetRoles" SET "Permissions" = CASE
                    WHEN 'wincare.run' = ANY("Permissions") THEN array_remove("Permissions", 'care.run')
                    ELSE array_replace("Permissions", 'care.run', 'wincare.run') END
                WHERE 'care.run' = ANY("Permissions");
                UPDATE audit_logs SET "Action" = 'agent.wincare-run' WHERE "Action" = 'agent.care-run';
                UPDATE audit_logs SET "Action" = 'agent.wincare-cancel' WHERE "Action" = 'agent.care-cancel';
                UPDATE audit_logs SET "Action" = 'wincare.self-service' WHERE "Action" = 'care.self-service';
                """);

            migrationBuilder.Sql("""
                ALTER SEQUENCE "care_runs_Id_seq" RENAME TO "wincare_runs_Id_seq";
                ALTER SEQUENCE "care_run_events_Id_seq" RENAME TO "wincare_run_events_Id_seq";
                """);

            migrationBuilder.DropForeignKey(
                name: "FK_care_run_events_care_runs_RunId",
                table: "care_run_events");

            migrationBuilder.DropForeignKey(
                name: "FK_care_runs_agents_AgentId",
                table: "care_runs");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_care_runs_RunId",
                table: "care_runs");

            migrationBuilder.DropPrimaryKey(
                name: "PK_care_runs",
                table: "care_runs");

            migrationBuilder.DropPrimaryKey(
                name: "PK_care_run_events",
                table: "care_run_events");

            migrationBuilder.RenameTable(
                name: "care_runs",
                newName: "wincare_runs");

            migrationBuilder.RenameTable(
                name: "care_run_events",
                newName: "wincare_run_events");

            migrationBuilder.RenameIndex(
                name: "IX_care_runs_Status",
                table: "wincare_runs",
                newName: "IX_wincare_runs_Status");

            migrationBuilder.RenameIndex(
                name: "IX_care_runs_RunId",
                table: "wincare_runs",
                newName: "IX_wincare_runs_RunId");

            migrationBuilder.RenameIndex(
                name: "IX_care_runs_AgentId_StartedAt",
                table: "wincare_runs",
                newName: "IX_wincare_runs_AgentId_StartedAt");

            migrationBuilder.RenameIndex(
                name: "IX_care_run_events_RunId_Seq",
                table: "wincare_run_events",
                newName: "IX_wincare_run_events_RunId_Seq");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_wincare_runs_RunId",
                table: "wincare_runs",
                column: "RunId");

            migrationBuilder.AddPrimaryKey(
                name: "PK_wincare_runs",
                table: "wincare_runs",
                column: "Id");

            migrationBuilder.AddPrimaryKey(
                name: "PK_wincare_run_events",
                table: "wincare_run_events",
                column: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_wincare_run_events_wincare_runs_RunId",
                table: "wincare_run_events",
                column: "RunId",
                principalTable: "wincare_runs",
                principalColumn: "RunId",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_wincare_runs_agents_AgentId",
                table: "wincare_runs",
                column: "AgentId",
                principalTable: "agents",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
