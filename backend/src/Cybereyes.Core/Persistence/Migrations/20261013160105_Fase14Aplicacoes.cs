using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase14Aplicacoes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AppServerId",
                table: "credentials",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WebAppId",
                table: "credentials",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WebAppId",
                table: "alerts",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "app_servers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Host = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Port = table.Column<int>(type: "integer", nullable: false),
                    Username = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    AuthMethod = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    PasswordEncrypted = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    PrivateKeyEncrypted = table.Column<string>(type: "character varying(20000)", maxLength: 20000, nullable: true),
                    PassphraseEncrypted = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    HostKeyFingerprint = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    HostKeyAlgorithm = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Provider = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Notes = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: true),
                    LastConnectedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_servers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_app_servers_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "web_apps",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientId = table.Column<int>(type: "integer", nullable: false),
                    ServerId = table.Column<int>(type: "integer", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Environment = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Stack = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Url = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Notes = table.Column<string>(type: "character varying(5000)", maxLength: 5000, nullable: true),
                    MonitorEnabled = table.Column<bool>(type: "boolean", nullable: false),
                    CheckType = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    CheckTarget = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    Method = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    ExpectedStatus = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Keyword = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IntervalSeconds = table.Column<int>(type: "integer", nullable: false),
                    TimeoutSeconds = table.Column<int>(type: "integer", nullable: false),
                    FailuresBeforeAlert = table.Column<int>(type: "integer", nullable: false),
                    AlertSeverity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    IgnoreTlsErrors = table.Column<bool>(type: "boolean", nullable: false),
                    SslWarnDays = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    StatusChangedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastCheckedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastLatencyMs = table.Column<int>(type: "integer", nullable: true),
                    LastStatusCode = table.Column<int>(type: "integer", nullable: true),
                    LastError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ConsecutiveFailures = table.Column<int>(type: "integer", nullable: false),
                    NextCheckAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    SslExpiresAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    DeployPath = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    RepoUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Branch = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    DeployScript = table.Column<string>(type: "character varying(32768)", maxLength: 32768, nullable: true),
                    DeployTimeoutMinutes = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_web_apps", x => x.Id);
                    table.ForeignKey(
                        name: "FK_web_apps_app_servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "app_servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_web_apps_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "app_commands",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ServerId = table.Column<int>(type: "integer", nullable: true),
                    WebAppId = table.Column<int>(type: "integer", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Script = table.Column<string>(type: "character varying(32768)", maxLength: 32768, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Confirm = table.Column<bool>(type: "boolean", nullable: false),
                    TimeoutMinutes = table.Column<int>(type: "integer", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_commands", x => x.Id);
                    table.ForeignKey(
                        name: "FK_app_commands_app_servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "app_servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_app_commands_web_apps_WebAppId",
                        column: x => x.WebAppId,
                        principalTable: "web_apps",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "web_app_checks",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    WebAppId = table.Column<int>(type: "integer", nullable: false),
                    Time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Up = table.Column<bool>(type: "boolean", nullable: false),
                    LatencyMs = table.Column<int>(type: "integer", nullable: true),
                    StatusCode = table.Column<int>(type: "integer", nullable: true),
                    Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_web_app_checks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_web_app_checks_web_apps_WebAppId",
                        column: x => x.WebAppId,
                        principalTable: "web_apps",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "app_runs",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ServerId = table.Column<int>(type: "integer", nullable: false),
                    WebAppId = table.Column<int>(type: "integer", nullable: true),
                    CommandId = table.Column<int>(type: "integer", nullable: true),
                    Kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Script = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    ExitCode = table.Column<int>(type: "integer", nullable: true),
                    Output = table.Column<string>(type: "text", nullable: false),
                    OutputTruncated = table.Column<bool>(type: "boolean", nullable: false),
                    Error = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CancelRequested = table.Column<bool>(type: "boolean", nullable: false),
                    StartedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    StartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    FinishedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_app_runs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_app_runs_app_commands_CommandId",
                        column: x => x.CommandId,
                        principalTable: "app_commands",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_app_runs_app_servers_ServerId",
                        column: x => x.ServerId,
                        principalTable: "app_servers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_app_runs_web_apps_WebAppId",
                        column: x => x.WebAppId,
                        principalTable: "web_apps",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_credentials_AppServerId",
                table: "credentials",
                column: "AppServerId");

            migrationBuilder.CreateIndex(
                name: "IX_credentials_WebAppId",
                table: "credentials",
                column: "WebAppId");

            migrationBuilder.CreateIndex(
                name: "IX_alerts_WebAppId_Resolved",
                table: "alerts",
                columns: new[] { "WebAppId", "Resolved" });

            migrationBuilder.CreateIndex(
                name: "IX_app_commands_ServerId",
                table: "app_commands",
                column: "ServerId");

            migrationBuilder.CreateIndex(
                name: "IX_app_commands_WebAppId",
                table: "app_commands",
                column: "WebAppId");

            migrationBuilder.CreateIndex(
                name: "IX_app_runs_CommandId",
                table: "app_runs",
                column: "CommandId");

            migrationBuilder.CreateIndex(
                name: "IX_app_runs_ServerId_StartedAt",
                table: "app_runs",
                columns: new[] { "ServerId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_app_runs_Status",
                table: "app_runs",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_app_runs_WebAppId_StartedAt",
                table: "app_runs",
                columns: new[] { "WebAppId", "StartedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_app_servers_ClientId",
                table: "app_servers",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_web_app_checks_Time",
                table: "web_app_checks",
                column: "Time");

            migrationBuilder.CreateIndex(
                name: "IX_web_app_checks_WebAppId_Time",
                table: "web_app_checks",
                columns: new[] { "WebAppId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_web_apps_ClientId",
                table: "web_apps",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_web_apps_MonitorEnabled_NextCheckAt",
                table: "web_apps",
                columns: new[] { "MonitorEnabled", "NextCheckAt" });

            migrationBuilder.CreateIndex(
                name: "IX_web_apps_ServerId",
                table: "web_apps",
                column: "ServerId");

            migrationBuilder.AddForeignKey(
                name: "FK_alerts_web_apps_WebAppId",
                table: "alerts",
                column: "WebAppId",
                principalTable: "web_apps",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_credentials_app_servers_AppServerId",
                table: "credentials",
                column: "AppServerId",
                principalTable: "app_servers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_credentials_web_apps_WebAppId",
                table: "credentials",
                column: "WebAppId",
                principalTable: "web_apps",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_alerts_web_apps_WebAppId",
                table: "alerts");

            migrationBuilder.DropForeignKey(
                name: "FK_credentials_app_servers_AppServerId",
                table: "credentials");

            migrationBuilder.DropForeignKey(
                name: "FK_credentials_web_apps_WebAppId",
                table: "credentials");

            migrationBuilder.DropTable(
                name: "app_runs");

            migrationBuilder.DropTable(
                name: "web_app_checks");

            migrationBuilder.DropTable(
                name: "app_commands");

            migrationBuilder.DropTable(
                name: "web_apps");

            migrationBuilder.DropTable(
                name: "app_servers");

            migrationBuilder.DropIndex(
                name: "IX_credentials_AppServerId",
                table: "credentials");

            migrationBuilder.DropIndex(
                name: "IX_credentials_WebAppId",
                table: "credentials");

            migrationBuilder.DropIndex(
                name: "IX_alerts_WebAppId_Resolved",
                table: "alerts");

            migrationBuilder.DropColumn(
                name: "AppServerId",
                table: "credentials");

            migrationBuilder.DropColumn(
                name: "WebAppId",
                table: "credentials");

            migrationBuilder.DropColumn(
                name: "WebAppId",
                table: "alerts");
        }
    }
}
