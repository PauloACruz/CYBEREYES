using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase26TesteVelocidade : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "agent_speed_tests",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Mode = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Phase = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    Progress = table.Column<int>(type: "integer", nullable: false),
                    LiveMbps = table.Column<double>(type: "double precision", nullable: true),
                    RequestedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PlanDownloadMbps = table.Column<double>(type: "double precision", nullable: true),
                    PlanUploadMbps = table.Column<double>(type: "double precision", nullable: true),
                    DownloadMbps = table.Column<double>(type: "double precision", nullable: true),
                    UploadMbps = table.Column<double>(type: "double precision", nullable: true),
                    LatencyMs = table.Column<double>(type: "double precision", nullable: true),
                    JitterMs = table.Column<double>(type: "double precision", nullable: true),
                    LossPct = table.Column<double>(type: "double precision", nullable: true),
                    Report = table.Column<string>(type: "jsonb", nullable: true),
                    Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_agent_speed_tests", x => x.Id);
                    table.ForeignKey(
                        name: "FK_agent_speed_tests_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_agent_speed_tests_AgentId_CreatedAt",
                table: "agent_speed_tests",
                columns: new[] { "AgentId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "agent_speed_tests");
        }
    }
}
