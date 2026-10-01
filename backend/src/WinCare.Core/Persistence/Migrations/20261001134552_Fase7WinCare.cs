using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace WinCare.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase7WinCare : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "SelfServiceEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<List<string>>(
                name: "SelfServiceTasks",
                table: "core_settings",
                type: "text[]",
                nullable: false,
                defaultValueSql: "ARRAY[]::text[]");

            migrationBuilder.CreateTable(
                name: "agent_health",
                columns: table => new
                {
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Score = table.Column<int>(type: "integer", nullable: false),
                    Grade = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Report = table.Column<string>(type: "jsonb", nullable: false),
                    CollectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_health", x => x.AgentId);
                    table.ForeignKey(
                        name: "FK_agent_health_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "wincare_runs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RunId = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Module = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Tasks = table.Column<List<string>>(type: "text[]", nullable: false),
                    Params = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RequestedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RebootRequired = table.Column<bool>(type: "boolean", nullable: false),
                    Error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_wincare_runs", x => x.Id);
                    table.UniqueConstraint("AK_wincare_runs_RunId", x => x.RunId);
                    table.ForeignKey(
                        name: "FK_wincare_runs_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "wincare_run_events",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RunId = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Seq = table.Column<int>(type: "integer", nullable: false),
                    Type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Data = table.Column<string>(type: "jsonb", nullable: false),
                    ReceivedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_wincare_run_events", x => x.Id);
                    table.ForeignKey(
                        name: "FK_wincare_run_events_wincare_runs_RunId",
                        column: x => x.RunId,
                        principalTable: "wincare_runs",
                        principalColumn: "RunId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_wincare_run_events_RunId_Seq",
                table: "wincare_run_events",
                columns: new[] { "RunId", "Seq" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_wincare_runs_AgentId_StartedAt",
                table: "wincare_runs",
                columns: new[] { "AgentId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_wincare_runs_RunId",
                table: "wincare_runs",
                column: "RunId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_wincare_runs_Status",
                table: "wincare_runs",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_health");

            migrationBuilder.DropTable(
                name: "wincare_run_events");

            migrationBuilder.DropTable(
                name: "wincare_runs");

            migrationBuilder.DropColumn(
                name: "SelfServiceEnabled",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "SelfServiceTasks",
                table: "core_settings");
        }
    }
}
