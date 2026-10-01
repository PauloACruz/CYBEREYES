using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace WinCare.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase8LogsSnmp : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LogMaxPerCycle",
                table: "core_settings",
                type: "integer",
                nullable: false,
                defaultValue: 500);

            migrationBuilder.AddColumn<string>(
                name: "LogMinLevel",
                table: "core_settings",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "warning");

            migrationBuilder.AddColumn<int>(
                name: "LogRetentionDays",
                table: "core_settings",
                type: "integer",
                nullable: false,
                defaultValue: 30);

            migrationBuilder.AddColumn<List<string>>(
                name: "LogWindowsLogs",
                table: "core_settings",
                type: "text[]",
                nullable: false,
                defaultValueSql: "ARRAY['System','Application']::text[]");

            migrationBuilder.AddColumn<bool>(
                name: "LogsEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AlterColumn<int>(
                name: "AgentId",
                table: "alerts",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<int>(
                name: "SnmpDeviceId",
                table: "alerts",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SubjectKey",
                table: "alerts",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SnmpCollector",
                table: "agents",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "log_alert_rules",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ClientId = table.Column<int>(type: "integer", nullable: true),
                    MinLevel = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SourceContains = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    MessageContains = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Threshold = table.Column<int>(type: "integer", nullable: false),
                    WindowMinutes = table.Column<int>(type: "integer", nullable: false),
                    Severity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_log_alert_rules", x => x.Id);
                    table.ForeignKey(
                        name: "FK_log_alert_rules_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "snmp_devices",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ClientId = table.Column<int>(type: "integer", nullable: false),
                    SiteId = table.Column<int>(type: "integer", nullable: true),
                    CollectorAgentId = table.Column<int>(type: "integer", nullable: true),
                    AssetId = table.Column<int>(type: "integer", nullable: true),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Host = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Port = table.Column<int>(type: "integer", nullable: false),
                    Version = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    CommunityEncrypted = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    V3Username = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    V3SecurityLevel = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    V3AuthProtocol = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    V3AuthPasswordEncrypted = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    V3PrivProtocol = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    V3PrivPasswordEncrypted = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Interval = table.Column<int>(type: "integer", nullable: false),
                    Timeout = table.Column<int>(type: "integer", nullable: false),
                    Retries = table.Column<int>(type: "integer", nullable: false),
                    PollInterfaces = table.Column<bool>(type: "boolean", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    TrapSeverity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    LastPolledAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    FailCount = table.Column<int>(type: "integer", nullable: false),
                    SysName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    SysDescr = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    SysObjectId = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    SysLocation = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    SysContact = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    UptimeSeconds = table.Column<long>(type: "bigint", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_snmp_devices", x => x.Id);
                    table.ForeignKey(
                        name: "FK_snmp_devices_agents_CollectorAgentId",
                        column: x => x.CollectorAgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_snmp_devices_assets_AssetId",
                        column: x => x.AssetId,
                        principalTable: "assets",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_snmp_devices_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_snmp_devices_sites_SiteId",
                        column: x => x.SiteId,
                        principalTable: "sites",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            // Tabelas particionadas por mes: o EF nao gera PARTITION BY, entao vao em SQL.
            // As particoes sao criadas pelo LogPartitionService (mes atual e o proximo); a padrao recebe o que cair fora.
            migrationBuilder.Sql("""
                CREATE TABLE snmp_samples (
                    "DeviceId" integer NOT NULL,
                    "Metric" character varying(64) NOT NULL,
                    "Time" timestamp with time zone NOT NULL,
                    "Value" double precision NOT NULL,
                    CONSTRAINT "PK_snmp_samples" PRIMARY KEY ("DeviceId", "Metric", "Time")
                ) PARTITION BY RANGE ("Time");
                CREATE TABLE snmp_samples_default PARTITION OF snmp_samples DEFAULT;

                CREATE TABLE system_logs (
                    "Id" bigint GENERATED BY DEFAULT AS IDENTITY,
                    "Time" timestamp with time zone NOT NULL,
                    "ReceivedAt" timestamp with time zone NOT NULL,
                    "AgentId" integer NULL,
                    "SnmpDeviceId" integer NULL,
                    "ClientId" integer NOT NULL,
                    "Level" character varying(16) NOT NULL,
                    "Source" character varying(200) NOT NULL,
                    "Log" character varying(64) NOT NULL,
                    "EventId" bigint NULL,
                    "Message" character varying(8000) NOT NULL,
                    "Host" character varying(255) NULL,
                    CONSTRAINT "PK_system_logs" PRIMARY KEY ("Id", "Time")
                ) PARTITION BY RANGE ("Time");
                CREATE TABLE system_logs_default PARTITION OF system_logs DEFAULT;
                """);

            migrationBuilder.CreateTable(
                name: "snmp_interfaces",
                columns: table => new
                {
                    DeviceId = table.Column<int>(type: "integer", nullable: false),
                    Index = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Descr = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Alias = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Type = table.Column<int>(type: "integer", nullable: false),
                    SpeedBps = table.Column<long>(type: "bigint", nullable: false),
                    AdminStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    OperStatus = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    LastIn = table.Column<decimal>(type: "numeric(20,0)", precision: 20, scale: 0, nullable: true),
                    LastOut = table.Column<decimal>(type: "numeric(20,0)", precision: 20, scale: 0, nullable: true),
                    LastAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    InBps = table.Column<double>(type: "double precision", nullable: true),
                    OutBps = table.Column<double>(type: "double precision", nullable: true),
                    InErrors = table.Column<long>(type: "bigint", nullable: false),
                    OutErrors = table.Column<long>(type: "bigint", nullable: false),
                    Monitored = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_snmp_interfaces", x => new { x.DeviceId, x.Index });
                    table.ForeignKey(
                        name: "FK_snmp_interfaces_snmp_devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "snmp_devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "snmp_sensors",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DeviceId = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Oid = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Unit = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    WarnAbove = table.Column<double>(type: "double precision", nullable: true),
                    CritAbove = table.Column<double>(type: "double precision", nullable: true),
                    WarnBelow = table.Column<double>(type: "double precision", nullable: true),
                    CritBelow = table.Column<double>(type: "double precision", nullable: true),
                    LastValue = table.Column<double>(type: "double precision", nullable: true),
                    LastText = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    LastAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_snmp_sensors", x => x.Id);
                    table.ForeignKey(
                        name: "FK_snmp_sensors_snmp_devices_DeviceId",
                        column: x => x.DeviceId,
                        principalTable: "snmp_devices",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_alerts_SnmpDeviceId_Resolved",
                table: "alerts",
                columns: new[] { "SnmpDeviceId", "Resolved" });

            migrationBuilder.CreateIndex(
                name: "IX_log_alert_rules_ClientId",
                table: "log_alert_rules",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_devices_AssetId",
                table: "snmp_devices",
                column: "AssetId");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_devices_ClientId",
                table: "snmp_devices",
                column: "ClientId");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_devices_CollectorAgentId",
                table: "snmp_devices",
                column: "CollectorAgentId");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_devices_Host",
                table: "snmp_devices",
                column: "Host");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_devices_SiteId",
                table: "snmp_devices",
                column: "SiteId");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_samples_Time",
                table: "snmp_samples",
                column: "Time");

            migrationBuilder.CreateIndex(
                name: "IX_snmp_sensors_DeviceId",
                table: "snmp_sensors",
                column: "DeviceId");

            migrationBuilder.CreateIndex(
                name: "IX_system_logs_AgentId_Time",
                table: "system_logs",
                columns: new[] { "AgentId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_system_logs_ClientId_Time",
                table: "system_logs",
                columns: new[] { "ClientId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_system_logs_Level_Time",
                table: "system_logs",
                columns: new[] { "Level", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_system_logs_SnmpDeviceId_Time",
                table: "system_logs",
                columns: new[] { "SnmpDeviceId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_system_logs_Time",
                table: "system_logs",
                column: "Time");

            migrationBuilder.AddForeignKey(
                name: "FK_alerts_snmp_devices_SnmpDeviceId",
                table: "alerts",
                column: "SnmpDeviceId",
                principalTable: "snmp_devices",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_alerts_snmp_devices_SnmpDeviceId",
                table: "alerts");

            migrationBuilder.DropTable(
                name: "log_alert_rules");

            migrationBuilder.DropTable(
                name: "snmp_interfaces");

            migrationBuilder.DropTable(
                name: "snmp_samples");

            migrationBuilder.DropTable(
                name: "snmp_sensors");

            migrationBuilder.DropTable(
                name: "system_logs");

            migrationBuilder.DropTable(
                name: "snmp_devices");

            migrationBuilder.DropIndex(
                name: "IX_alerts_SnmpDeviceId_Resolved",
                table: "alerts");

            migrationBuilder.DropColumn(
                name: "LogMaxPerCycle",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogMinLevel",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogRetentionDays",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogWindowsLogs",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "LogsEnabled",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "SnmpDeviceId",
                table: "alerts");

            migrationBuilder.DropColumn(
                name: "SubjectKey",
                table: "alerts");

            migrationBuilder.DropColumn(
                name: "SnmpCollector",
                table: "agents");

            migrationBuilder.AlterColumn<int>(
                name: "AgentId",
                table: "alerts",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);
        }
    }
}
