using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace WinCare.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase2Acoes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Command = table.Column<string>(type: "text", nullable: false),
                    Username = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ScriptId = table.Column<int>(type: "integer", nullable: true),
                    ScriptName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    Results = table.Column<string>(type: "text", nullable: true),
                    ScriptResults = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_history", x => x.Id);
                    table.ForeignKey(
                        name: "FK_agent_history_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "global_keys",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Value = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_global_keys", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "script_snippets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Shell = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Code = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_script_snippets", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "scripts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Shell = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Body = table.Column<string>(type: "text", nullable: false),
                    DefaultArgs = table.Column<List<string>>(type: "text[]", nullable: false),
                    EnvVars = table.Column<List<string>>(type: "text[]", nullable: false),
                    DefaultTimeout = table.Column<int>(type: "integer", nullable: false),
                    RunAsUser = table.Column<bool>(type: "boolean", nullable: false),
                    Platforms = table.Column<List<string>>(type: "text[]", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_scripts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "url_actions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Pattern = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_url_actions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_agent_history_AgentId_Time",
                table: "agent_history",
                columns: new[] { "AgentId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_global_keys_Name",
                table: "global_keys",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_script_snippets_Name",
                table: "script_snippets",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_scripts_Name",
                table: "scripts",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_url_actions_Name",
                table: "url_actions",
                column: "Name",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_history");

            migrationBuilder.DropTable(
                name: "global_keys");

            migrationBuilder.DropTable(
                name: "script_snippets");

            migrationBuilder.DropTable(
                name: "scripts");

            migrationBuilder.DropTable(
                name: "url_actions");
        }
    }
}
