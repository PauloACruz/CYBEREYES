using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Rmm : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "clients",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_clients", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "installer_tokens",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_installer_tokens", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "sites",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_sites", x => x.Id);
                    table.ForeignKey(
                        name: "FK_sites_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "agents",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Hostname = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    SiteId = table.Column<int>(type: "integer", nullable: false),
                    MonitoringType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Description = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    MeshNodeId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    GoArch = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Plat = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OperatingSystem = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    LastSeen = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PublicIp = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    TotalRam = table.Column<int>(type: "integer", nullable: true),
                    BootTime = table.Column<double>(type: "double precision", nullable: true),
                    LoggedInUsername = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    LastLoggedInUser = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    NeedsReboot = table.Column<bool>(type: "boolean", nullable: false),
                    ChocoInstalled = table.Column<bool>(type: "boolean", nullable: false),
                    Disks = table.Column<string>(type: "jsonb", nullable: true),
                    Services = table.Column<string>(type: "jsonb", nullable: true),
                    WmiDetail = table.Column<string>(type: "jsonb", nullable: true),
                    CheckInterval = table.Column<int>(type: "integer", nullable: false),
                    OfflineTime = table.Column<int>(type: "integer", nullable: false),
                    OverdueTime = table.Column<int>(type: "integer", nullable: false),
                    TokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    NatsPasswordHash = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agents", x => x.Id);
                    table.ForeignKey(
                        name: "FK_agents_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "deployments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Uid = table.Column<Guid>(type: "uuid", nullable: false),
                    SiteId = table.Column<int>(type: "integer", nullable: false),
                    MonitoringType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    GoArch = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    InstallerTokenId = table.Column<int>(type: "integer", nullable: false),
                    ProtectedToken = table.Column<string>(type: "text", nullable: false),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_deployments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_deployments_installer_tokens_InstallerTokenId",
                        column: x => x.InstallerTokenId,
                        principalTable: "installer_tokens",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_deployments_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "agent_software",
                columns: table => new
                {
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Software = table.Column<string>(type: "jsonb", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_software", x => x.AgentId);
                    table.ForeignKey(
                        name: "FK_agent_software_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_agents_AgentId",
                table: "agents",
                column: "AgentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_agents_SiteId",
                table: "agents",
                column: "SiteId");

            migrationBuilder.CreateIndex(
                name: "IX_agents_Status",
                table: "agents",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_agents_TokenHash",
                table: "agents",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_clients_Name",
                table: "clients",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_deployments_InstallerTokenId",
                table: "deployments",
                column: "InstallerTokenId");

            migrationBuilder.CreateIndex(
                name: "IX_deployments_SiteId",
                table: "deployments",
                column: "SiteId");

            migrationBuilder.CreateIndex(
                name: "IX_deployments_Uid",
                table: "deployments",
                column: "Uid",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_installer_tokens_TokenHash",
                table: "installer_tokens",
                column: "TokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_sites_ClientId_Name",
                table: "sites",
                columns: new[] { "ClientId", "Name" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_software");

            migrationBuilder.DropTable(
                name: "deployments");

            migrationBuilder.DropTable(
                name: "agents");

            migrationBuilder.DropTable(
                name: "installer_tokens");

            migrationBuilder.DropTable(
                name: "sites");

            migrationBuilder.DropTable(
                name: "clients");
        }
    }
}
