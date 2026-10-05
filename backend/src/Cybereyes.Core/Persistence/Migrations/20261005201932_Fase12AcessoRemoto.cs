using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase12AcessoRemoto : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "remote_policies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Scope = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ScopeId = table.Column<int>(type: "integer", nullable: false),
                    Consent = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    ConsentTimeoutSeconds = table.Column<int>(type: "integer", nullable: true),
                    AllowAtLoginScreen = table.Column<bool>(type: "boolean", nullable: true),
                    ClipboardToRemote = table.Column<bool>(type: "boolean", nullable: true),
                    ClipboardToLocal = table.Column<bool>(type: "boolean", nullable: true),
                    FilesUpload = table.Column<bool>(type: "boolean", nullable: true),
                    FilesDownload = table.Column<bool>(type: "boolean", nullable: true),
                    MaxFileMb = table.Column<int>(type: "integer", nullable: true),
                    IdleMinutes = table.Column<int>(type: "integer", nullable: true),
                    MaxHours = table.Column<int>(type: "integer", nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_remote_policies", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "remote_sessions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SessionId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Username = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    TicketId = table.Column<int>(type: "integer", nullable: true),
                    Channels = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ViewOnly = table.Column<bool>(type: "boolean", nullable: false),
                    ConsentMode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ConsentResult = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    State = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FirstFrameAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EndedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EndReason = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    ViewerIp = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    BytesToViewer = table.Column<long>(type: "bigint", nullable: false),
                    BytesToAgent = table.Column<long>(type: "bigint", nullable: false),
                    ClipboardToRemote = table.Column<int>(type: "integer", nullable: false),
                    ClipboardToLocal = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_remote_sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_remote_sessions_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "remote_transfers",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SessionId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Username = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Direction = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RemotePath = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    SizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    Sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Error = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_remote_transfers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_remote_transfers_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_remote_policies_Scope_ScopeId",
                table: "remote_policies",
                columns: new[] { "Scope", "ScopeId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_remote_sessions_AgentId_StartedAt",
                table: "remote_sessions",
                columns: new[] { "AgentId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_remote_sessions_SessionId",
                table: "remote_sessions",
                column: "SessionId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_remote_sessions_State",
                table: "remote_sessions",
                column: "State");

            migrationBuilder.CreateIndex(
                name: "IX_remote_sessions_UserId_StartedAt",
                table: "remote_sessions",
                columns: new[] { "UserId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_remote_transfers_AgentId_StartedAt",
                table: "remote_transfers",
                columns: new[] { "AgentId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_remote_transfers_SessionId",
                table: "remote_transfers",
                column: "SessionId");

            // Quem ja tinha acesso remoto (que incluia arquivos pelo MeshCentral) continua com arquivos.
            migrationBuilder.Sql("""
                UPDATE "AspNetRoles" SET "Permissions" = array_append("Permissions", 'agents.files')
                WHERE 'agents.remote' = ANY("Permissions") AND NOT 'agents.files' = ANY("Permissions");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "AspNetRoles" SET "Permissions" = array_remove("Permissions", 'agents.files')
                WHERE 'agents.files' = ANY("Permissions");
                """);

            migrationBuilder.DropTable(
                name: "remote_policies");

            migrationBuilder.DropTable(
                name: "remote_sessions");

            migrationBuilder.DropTable(
                name: "remote_transfers");
        }
    }
}
