using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase19AssistenteIa : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AssistantState",
                table: "tickets",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AssistantTurns",
                table: "tickets",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "Insights",
                table: "push_subscriptions",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "AnthropicKeyHint",
                table: "core_settings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AnthropicKeyProtected",
                table: "core_settings",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AssistantAgentId",
                table: "core_settings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AssistantChatEffort",
                table: "core_settings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "low");

            migrationBuilder.AddColumn<bool>(
                name: "AssistantChatEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "AssistantLogEffort",
                table: "core_settings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "medium");

            migrationBuilder.AddColumn<string>(
                name: "AssistantModel",
                table: "core_settings",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "claude-opus-5-5");

            migrationBuilder.AddColumn<string>(
                name: "AssistantName",
                table: "core_settings",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "Assistente Cybereyes");

            migrationBuilder.AddColumn<bool>(
                name: "LogInsightsEmail",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "LogInsightsEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "LogInsightsIntervalHours",
                table: "core_settings",
                type: "integer",
                nullable: false,
                defaultValue: 24);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LogInsightsLastRunAt",
                table: "core_settings",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LogInsightsMinLevel",
                table: "core_settings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "error");

            migrationBuilder.AddColumn<bool>(
                name: "LogInsightsPush",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "faq_entries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientId = table.Column<int>(type: "integer", nullable: true),
                    Question = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Answer = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    Tags = table.Column<List<string>>(type: "text[]", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_faq_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_faq_entries_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "log_insight_reports",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WindowStart = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    WindowEnd = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Manual = table.Column<bool>(type: "boolean", nullable: false),
                    Model = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Summary = table.Column<string>(type: "character varying(8000)", maxLength: 8000, nullable: false),
                    Content = table.Column<string>(type: "jsonb", nullable: false),
                    EventCount = table.Column<int>(type: "integer", nullable: false),
                    GroupCount = table.Column<int>(type: "integer", nullable: false),
                    AgentCount = table.Column<int>(type: "integer", nullable: false),
                    InputTokens = table.Column<long>(type: "bigint", nullable: false),
                    OutputTokens = table.Column<long>(type: "bigint", nullable: false),
                    Error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_log_insight_reports", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_faq_entries_ClientId",
                table: "faq_entries",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_log_insight_reports_CreatedAt",
                table: "log_insight_reports",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "faq_entries");

            migrationBuilder.DropTable(
                name: "log_insight_reports");

            migrationBuilder.DropColumn(
                name: "AssistantState",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "AssistantTurns",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "Insights",
                table: "push_subscriptions");

            migrationBuilder.DropColumn(
                name: "AnthropicKeyHint",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AnthropicKeyProtected",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantAgentId",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantChatEffort",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantChatEnabled",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantLogEffort",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantModel",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantName",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogInsightsEmail",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogInsightsEnabled",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogInsightsIntervalHours",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogInsightsLastRunAt",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogInsightsMinLevel",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogInsightsPush",
                table: "core_settings");
        }
    }
}
