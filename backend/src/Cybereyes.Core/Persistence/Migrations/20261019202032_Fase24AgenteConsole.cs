using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase24AgenteConsole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Os dois agentes comecam so com leitura (AssistantExecutors.DefaultPermissions); o resto a equipe libera nas configuracoes.
            const string readOnly = "ARRAY['clients.view','agents.view','alerts.view','tickets.view','logs.view','scripts.view','docs.view','inventory.view']::text[]";
            migrationBuilder.AddColumn<List<string>>(
                name: "AssistantAgentPermissions",
                table: "core_settings",
                type: "text[]",
                nullable: false,
                defaultValueSql: readOnly);

            migrationBuilder.AddColumn<List<string>>(
                name: "AssistantNativePermissions",
                table: "core_settings",
                type: "text[]",
                nullable: false,
                defaultValueSql: readOnly);

            migrationBuilder.AddColumn<string>(
                name: "Agent",
                table: "audit_logs",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "assistant_sessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Executor = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ExecutorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Messages = table.Column<string>(type: "jsonb", nullable: false),
                    Pending = table.Column<string>(type: "jsonb", nullable: true),
                    Error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_assistant_sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_assistant_sessions_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_assistant_sessions_UserId_UpdatedAt",
                table: "assistant_sessions",
                columns: new[] { "UserId", "UpdatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "assistant_sessions");

            migrationBuilder.DropColumn(
                name: "AssistantAgentPermissions",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantNativePermissions",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "Agent",
                table: "audit_logs");
        }
    }
}
