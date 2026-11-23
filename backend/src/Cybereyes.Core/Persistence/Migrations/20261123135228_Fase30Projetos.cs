using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase30Projetos : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Como as outras opcoes do aparelho, os avisos de projetos vem ligados.
            migrationBuilder.AddColumn<bool>(
                name: "Projects",
                table: "push_subscriptions",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "projects",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    OwnerId = table.Column<Guid>(type: "uuid", nullable: true),
                    Recurrence = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    RecurrenceInterval = table.Column<int>(type: "integer", nullable: false),
                    Cycle = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    CreatedById = table.Column<Guid>(type: "uuid", nullable: true),
                    CreatedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    StartNotifiedCycle = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_projects", x => x.Id);
                    table.ForeignKey(
                        name: "FK_projects_AspNetUsers_CreatedById",
                        column: x => x.CreatedById,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_projects_AspNetUsers_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "project_agents",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: true),
                    ClientId = table.Column<int>(type: "integer", nullable: false),
                    Hostname = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    DoneById = table.Column<Guid>(type: "uuid", nullable: true),
                    DoneByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DoneAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_agents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_project_agents_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_project_agents_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_clients",
                columns: table => new
                {
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    ClientId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_clients", x => new { x.ProjectId, x.ClientId });
                    table.ForeignKey(
                        name: "FK_project_clients_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_project_clients_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_cycles",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    Number = table.Column<int>(type: "integer", nullable: false),
                    StartDate = table.Column<DateOnly>(type: "date", nullable: true),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    ClosedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ClosedById = table.Column<Guid>(type: "uuid", nullable: true),
                    ClosedByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Summary = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    Items = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_cycles", x => x.Id);
                    table.ForeignKey(
                        name: "FK_project_cycles_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_sites",
                columns: table => new
                {
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    SiteId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_sites", x => new { x.ProjectId, x.SiteId });
                    table.ForeignKey(
                        name: "FK_project_sites_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_project_sites_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_tasks",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    Title = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    Description = table.Column<string>(type: "character varying(4000)", maxLength: 4000, nullable: true),
                    AssigneeId = table.Column<Guid>(type: "uuid", nullable: true),
                    DueDate = table.Column<DateOnly>(type: "date", nullable: true),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Note = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    DoneById = table.Column<Guid>(type: "uuid", nullable: true),
                    DoneByName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DoneAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_tasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_project_tasks_AspNetUsers_AssigneeId",
                        column: x => x.AssigneeId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_project_tasks_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_notes",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    Cycle = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ProjectAgentId = table.Column<long>(type: "bigint", nullable: true),
                    ProjectTaskId = table.Column<long>(type: "bigint", nullable: true),
                    Subject = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    ItemStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Body = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: false),
                    AuthorId = table.Column<Guid>(type: "uuid", nullable: true),
                    AuthorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_notes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_project_notes_project_agents_ProjectAgentId",
                        column: x => x.ProjectAgentId,
                        principalTable: "project_agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_project_notes_project_tasks_ProjectTaskId",
                        column: x => x.ProjectTaskId,
                        principalTable: "project_tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_project_notes_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_attachments",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProjectId = table.Column<int>(type: "integer", nullable: false),
                    NoteId = table.Column<long>(type: "bigint", nullable: true),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ContentType = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    UploadedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_attachments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_project_attachments_project_notes_NoteId",
                        column: x => x.NoteId,
                        principalTable: "project_notes",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_project_attachments_projects_ProjectId",
                        column: x => x.ProjectId,
                        principalTable: "projects",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "project_attachment_data",
                columns: table => new
                {
                    AttachmentId = table.Column<long>(type: "bigint", nullable: false),
                    Content = table.Column<byte[]>(type: "bytea", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_project_attachment_data", x => x.AttachmentId);
                    table.ForeignKey(
                        name: "FK_project_attachment_data_project_attachments_AttachmentId",
                        column: x => x.AttachmentId,
                        principalTable: "project_attachments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_project_agents_AgentId",
                table: "project_agents",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_project_agents_ProjectId_AgentId",
                table: "project_agents",
                columns: new[] { "ProjectId", "AgentId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_project_attachments_NoteId",
                table: "project_attachments",
                column: "NoteId");

            migrationBuilder.CreateIndex(
                name: "IX_project_attachments_ProjectId",
                table: "project_attachments",
                column: "ProjectId");

            migrationBuilder.CreateIndex(
                name: "IX_project_clients_ClientId",
                table: "project_clients",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_project_cycles_ProjectId_Number",
                table: "project_cycles",
                columns: new[] { "ProjectId", "Number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_project_notes_ProjectAgentId",
                table: "project_notes",
                column: "ProjectAgentId");

            migrationBuilder.CreateIndex(
                name: "IX_project_notes_ProjectId_CreatedAt",
                table: "project_notes",
                columns: new[] { "ProjectId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_project_notes_ProjectTaskId",
                table: "project_notes",
                column: "ProjectTaskId");

            migrationBuilder.CreateIndex(
                name: "IX_project_sites_SiteId",
                table: "project_sites",
                column: "SiteId");

            migrationBuilder.CreateIndex(
                name: "IX_project_tasks_AssigneeId",
                table: "project_tasks",
                column: "AssigneeId");

            migrationBuilder.CreateIndex(
                name: "IX_project_tasks_ProjectId_Position",
                table: "project_tasks",
                columns: new[] { "ProjectId", "Position" });

            migrationBuilder.CreateIndex(
                name: "IX_projects_CreatedById",
                table: "projects",
                column: "CreatedById");

            migrationBuilder.CreateIndex(
                name: "IX_projects_OwnerId",
                table: "projects",
                column: "OwnerId");

            migrationBuilder.CreateIndex(
                name: "IX_projects_Status",
                table: "projects",
                column: "Status");

            // Quem gerencia chamados passa a gerenciar projetos; quem so ve chamados, ve projetos.
            migrationBuilder.Sql("""
                UPDATE "AspNetRoles" SET "Permissions" = array_append("Permissions", 'projects.manage')
                WHERE 'tickets.manage' = ANY("Permissions") AND NOT 'projects.manage' = ANY("Permissions");
                UPDATE "AspNetRoles" SET "Permissions" = array_append("Permissions", 'projects.view')
                WHERE 'tickets.view' = ANY("Permissions") AND NOT 'projects.view' = ANY("Permissions");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "AspNetRoles" SET "Permissions" = array_remove(array_remove("Permissions", 'projects.view'), 'projects.manage')
                WHERE 'projects.view' = ANY("Permissions") OR 'projects.manage' = ANY("Permissions");
                """);

            migrationBuilder.DropTable(
                name: "project_attachment_data");

            migrationBuilder.DropTable(
                name: "project_clients");

            migrationBuilder.DropTable(
                name: "project_cycles");

            migrationBuilder.DropTable(
                name: "project_sites");

            migrationBuilder.DropTable(
                name: "project_attachments");

            migrationBuilder.DropTable(
                name: "project_notes");

            migrationBuilder.DropTable(
                name: "project_agents");

            migrationBuilder.DropTable(
                name: "project_tasks");

            migrationBuilder.DropTable(
                name: "projects");

            migrationBuilder.DropColumn(
                name: "Projects",
                table: "push_subscriptions");
        }
    }
}
