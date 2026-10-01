using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace WinCare.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase5Chamados : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IncidentPriority",
                table: "core_settings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "high");

            migrationBuilder.AddColumn<int>(
                name: "IncidentQueueId",
                table: "core_settings",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IncidentResolveWithAlert",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "IncidentSeverities",
                table: "core_settings",
                type: "text[]",
                nullable: false,
                defaultValueSql: "ARRAY['error']::text[]");

            migrationBuilder.AddColumn<bool>(
                name: "IncidentsEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "sla_rules",
                columns: table => new
                {
                    Priority = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    FirstResponseMinutes = table.Column<int>(type: "integer", nullable: false),
                    ResolutionMinutes = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sla_rules", x => x.Priority);
                });

            migrationBuilder.CreateTable(
                name: "ticket_queues",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsDefault = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_queues", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "tray_tokens",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Username = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tray_tokens", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tray_tokens_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tickets",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Type = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Priority = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    QueueId = table.Column<int>(type: "integer", nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: true),
                    ClientId = table.Column<int>(type: "integer", nullable: true),
                    SiteId = table.Column<int>(type: "integer", nullable: true),
                    RequesterName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    RequesterUsername = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    RequesterEmail = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    AssignedToId = table.Column<Guid>(type: "uuid", nullable: true),
                    AlertId = table.Column<long>(type: "bigint", nullable: true),
                    Source = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FirstResponseAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ResolvedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ClosedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FirstResponseDueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    ResolutionDueAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastMessageAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastMessageAuthor = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tickets", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tickets_AspNetUsers_AssignedToId",
                        column: x => x.AssignedToId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tickets_AspNetUsers_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tickets_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tickets_alerts_AlertId",
                        column: x => x.AlertId,
                        principalTable: "alerts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tickets_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tickets_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tickets_ticket_queues_QueueId",
                        column: x => x.QueueId,
                        principalTable: "ticket_queues",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ticket_messages",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TicketId = table.Column<int>(type: "integer", nullable: false),
                    AuthorType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AuthorUserId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuthorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Body = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    Internal = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_messages", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ticket_messages_tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "time_entries",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TicketId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Minutes = table.Column<int>(type: "integer", nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    WorkDate = table.Column<DateOnly>(type: "date", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_time_entries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_time_entries_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_time_entries_tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ticket_attachments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TicketId = table.Column<int>(type: "integer", nullable: false),
                    MessageId = table.Column<long>(type: "bigint", nullable: true),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    UploadedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Internal = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_attachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ticket_attachments_ticket_messages_MessageId",
                        column: x => x.MessageId,
                        principalTable: "ticket_messages",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_ticket_attachments_tickets_TicketId",
                        column: x => x.TicketId,
                        principalTable: "tickets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ticket_attachment_data",
                columns: table => new
                {
                    AttachmentId = table.Column<long>(type: "bigint", nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_attachment_data", x => x.AttachmentId);
                    table.ForeignKey(
                        name: "FK_ticket_attachment_data_ticket_attachments_AttachmentId",
                        column: x => x.AttachmentId,
                        principalTable: "ticket_attachments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "sla_rules",
                columns: new[] { "Priority", "FirstResponseMinutes", "ResolutionMinutes" },
                values: new object[,]
                {
                    { "critical", 30, 240 },
                    { "high", 60, 480 },
                    { "low", 480, 4320 },
                    { "medium", 240, 1440 }
                });

            migrationBuilder.CreateIndex(
                name: "IX_ticket_attachments_MessageId",
                table: "ticket_attachments",
                column: "MessageId");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_attachments_TicketId",
                table: "ticket_attachments",
                column: "TicketId");

            migrationBuilder.CreateIndex(
                name: "IX_ticket_messages_TicketId_CreatedAt",
                table: "ticket_messages",
                columns: new[] { "TicketId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_ticket_queues_Name",
                table: "ticket_queues",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_tickets_AgentId_RequesterUsername",
                table: "tickets",
                columns: new[] { "AgentId", "RequesterUsername" });

            migrationBuilder.CreateIndex(
                name: "IX_tickets_AlertId",
                table: "tickets",
                column: "AlertId");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_AssignedToId_Status",
                table: "tickets",
                columns: new[] { "AssignedToId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_tickets_ClientId",
                table: "tickets",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_CreatedById",
                table: "tickets",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_QueueId",
                table: "tickets",
                column: "QueueId");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_SiteId",
                table: "tickets",
                column: "SiteId");

            migrationBuilder.CreateIndex(
                name: "IX_tickets_Status_UpdatedAt",
                table: "tickets",
                columns: new[] { "Status", "UpdatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_time_entries_TicketId",
                table: "time_entries",
                column: "TicketId");

            migrationBuilder.CreateIndex(
                name: "IX_time_entries_UserId",
                table: "time_entries",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_tray_tokens_AgentId",
                table: "tray_tokens",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_tray_tokens_ExpiresAt",
                table: "tray_tokens",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_tray_tokens_TokenHash",
                table: "tray_tokens",
                column: "TokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "sla_rules");

            migrationBuilder.DropTable(
                name: "ticket_attachment_data");

            migrationBuilder.DropTable(
                name: "time_entries");

            migrationBuilder.DropTable(
                name: "tray_tokens");

            migrationBuilder.DropTable(
                name: "ticket_attachments");

            migrationBuilder.DropTable(
                name: "ticket_messages");

            migrationBuilder.DropTable(
                name: "tickets");

            migrationBuilder.DropTable(
                name: "ticket_queues");

            migrationBuilder.DropColumn(
                name: "IncidentPriority",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "IncidentQueueId",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "IncidentResolveWithAlert",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "IncidentSeverities",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "IncidentsEnabled",
                table: "core_settings");
        }
    }
}
