using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase9RelatoriosSso : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DisablePasswordLogin",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "oidc_providers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Authority = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ClientId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    ClientSecretEncrypted = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Scopes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    UsernameClaim = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LinkByEmail = table.Column<bool>(type: "boolean", nullable: false),
                    AutoProvision = table.Column<bool>(type: "boolean", nullable: false),
                    DefaultRoleId = table.Column<Guid>(type: "uuid", nullable: true),
                    AllowedDomains = table.Column<List<string>>(type: "text[]", nullable: false),
                    TrustProviderMfa = table.Column<bool>(type: "boolean", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_oidc_providers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_oidc_providers_AspNetRoles_DefaultRoleId",
                        column: x => x.DefaultRoleId,
                        principalTable: "AspNetRoles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "report_schedules",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Params = table.Column<string>(type: "jsonb", nullable: false),
                    Format = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Frequency = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Time = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: false),
                    DayOfWeek = table.Column<int>(type: "integer", nullable: true),
                    DayOfMonth = table.Column<int>(type: "integer", nullable: true),
                    Recipients = table.Column<List<string>>(type: "text[]", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    LastRunAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    NextRunAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report_schedules", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "report_dispatches",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ScheduleId = table.Column<int>(type: "integer", nullable: false),
                    Slot = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report_dispatches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_report_dispatches_report_schedules_ScheduleId",
                        column: x => x.ScheduleId,
                        principalTable: "report_schedules",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "report_runs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Format = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Error = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    FileName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Size = table.Column<long>(type: "bigint", nullable: false),
                    Data = table.Column<byte[]>(type: "bytea", nullable: true),
                    Params = table.Column<string>(type: "jsonb", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    RequestedBy = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ScheduleId = table.Column<int>(type: "integer", nullable: true),
                    EmailedTo = table.Column<List<string>>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_report_runs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_report_runs_report_schedules_ScheduleId",
                        column: x => x.ScheduleId,
                        principalTable: "report_schedules",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_oidc_providers_DefaultRoleId",
                table: "oidc_providers",
                column: "DefaultRoleId");

            migrationBuilder.CreateIndex(
                name: "IX_oidc_providers_Name",
                table: "oidc_providers",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_report_dispatches_ScheduleId_Slot",
                table: "report_dispatches",
                columns: new[] { "ScheduleId", "Slot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_report_runs_CreatedAt",
                table: "report_runs",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_report_runs_ScheduleId_CreatedAt",
                table: "report_runs",
                columns: new[] { "ScheduleId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "oidc_providers");

            migrationBuilder.DropTable(
                name: "report_dispatches");

            migrationBuilder.DropTable(
                name: "report_runs");

            migrationBuilder.DropTable(
                name: "report_schedules");

            migrationBuilder.DropColumn(
                name: "DisablePasswordLogin",
                table: "core_settings");
        }
    }
}
