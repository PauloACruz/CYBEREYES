using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace WinCare.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase3Monitoramento : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "AlertTemplateId",
                table: "sites",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BlockPolicyInheritance",
                table: "sites",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ServerPolicyId",
                table: "sites",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WorkstationPolicyId",
                table: "sites",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AlertTemplateId",
                table: "clients",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BlockPolicyInheritance",
                table: "clients",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "ServerPolicyId",
                table: "clients",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WorkstationPolicyId",
                table: "clients",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "AlertTemplateId",
                table: "agents",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BlockPolicyInheritance",
                table: "agents",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "PolicyId",
                table: "agents",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "alert_templates",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    EmailRecipients = table.Column<List<string>>(type: "text[]", nullable: false),
                    WebhookUrl = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    EmailSeverities = table.Column<List<string>>(type: "text[]", nullable: false),
                    WebhookSeverities = table.Column<List<string>>(type: "text[]", nullable: false),
                    DashboardSeverities = table.Column<List<string>>(type: "text[]", nullable: false),
                    NotifyOnResolved = table.Column<bool>(type: "boolean", nullable: false),
                    AgentOverdueEmail = table.Column<bool>(type: "boolean", nullable: false),
                    AgentOverdueWebhook = table.Column<bool>(type: "boolean", nullable: false),
                    AgentOverdueDashboard = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_alert_templates", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "alerts",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    AlertType = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    CheckId = table.Column<int>(type: "integer", nullable: true),
                    TaskId = table.Column<int>(type: "integer", nullable: true),
                    Severity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Message = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Resolved = table.Column<bool>(type: "boolean", nullable: false),
                    ResolvedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    SnoozedUntil = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    EmailSent = table.Column<bool>(type: "boolean", nullable: false),
                    WebhookSent = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_alerts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_alerts_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "check_history",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CheckId = table.Column<int>(type: "integer", nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Time = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    Value = table.Column<double>(type: "double precision", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Results = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_check_history", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "core_settings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    SmtpHost = table.Column<string>(type: "text", nullable: true),
                    SmtpPort = table.Column<int>(type: "integer", nullable: false),
                    SmtpUsername = table.Column<string>(type: "text", nullable: true),
                    SmtpPasswordProtected = table.Column<string>(type: "text", nullable: true),
                    SmtpFrom = table.Column<string>(type: "text", nullable: true),
                    SmtpUseTls = table.Column<bool>(type: "boolean", nullable: false),
                    DefaultWebhookUrl = table.Column<string>(type: "text", nullable: true),
                    TimeZone = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    CheckHistoryDays = table.Column<int>(type: "integer", nullable: false),
                    AgentHistoryDays = table.Column<int>(type: "integer", nullable: false),
                    DefaultServerPolicyId = table.Column<int>(type: "integer", nullable: true),
                    DefaultWorkstationPolicyId = table.Column<int>(type: "integer", nullable: true),
                    DefaultAlertTemplateId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_core_settings", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "pending_actions",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Details = table.Column<string>(type: "jsonb", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Output = table.Column<string>(type: "text", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_pending_actions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_pending_actions_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "policies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Description = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_policies", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "task_dispatches",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TaskId = table.Column<int>(type: "integer", nullable: false),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    Slot = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_dispatches", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "win_updates",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    UpdateGuid = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Kb = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Title = table.Column<string>(type: "text", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Severity = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Categories = table.Column<List<string>>(type: "text[]", nullable: false),
                    KbArticleIds = table.Column<List<string>>(type: "text[]", nullable: false),
                    MoreInfoUrls = table.Column<List<string>>(type: "text[]", nullable: false),
                    SupportUrl = table.Column<string>(type: "text", nullable: false),
                    RevisionNumber = table.Column<long>(type: "bigint", nullable: false),
                    Installed = table.Column<bool>(type: "boolean", nullable: false),
                    Downloaded = table.Column<bool>(type: "boolean", nullable: false),
                    Action = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Result = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    DateInstalled = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_win_updates", x => x.Id);
                    table.ForeignKey(
                        name: "FK_win_updates_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "checks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: true),
                    PolicyId = table.Column<int>(type: "integer", nullable: true),
                    CheckType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    RunInterval = table.Column<int>(type: "integer", nullable: false),
                    FailsBeforeAlert = table.Column<int>(type: "integer", nullable: false),
                    AlertSeverity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    WarningThreshold = table.Column<int>(type: "integer", nullable: false),
                    ErrorThreshold = table.Column<int>(type: "integer", nullable: false),
                    Disk = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    Ip = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    ScriptId = table.Column<int>(type: "integer", nullable: true),
                    ScriptArgs = table.Column<List<string>>(type: "text[]", nullable: false),
                    EnvVars = table.Column<List<string>>(type: "text[]", nullable: false),
                    Timeout = table.Column<int>(type: "integer", nullable: true),
                    InfoReturnCodes = table.Column<List<long>>(type: "bigint[]", nullable: false),
                    WarningReturnCodes = table.Column<List<long>>(type: "bigint[]", nullable: false),
                    SuccessReturnCodes = table.Column<List<long>>(type: "bigint[]", nullable: false),
                    SvcName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    PassIfStartPending = table.Column<bool>(type: "boolean", nullable: false),
                    PassIfSvcNotExist = table.Column<bool>(type: "boolean", nullable: false),
                    RestartIfStopped = table.Column<bool>(type: "boolean", nullable: false),
                    LogName = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    EventId = table.Column<int>(type: "integer", nullable: true),
                    EventIdIsWildcard = table.Column<bool>(type: "boolean", nullable: false),
                    EventType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    EventSource = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    EventMessage = table.Column<string>(type: "text", nullable: true),
                    FailWhen = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    SearchLastDays = table.Column<int>(type: "integer", nullable: false),
                    NumberOfEventsBeforeAlert = table.Column<int>(type: "integer", nullable: false),
                    EmailAlert = table.Column<bool>(type: "boolean", nullable: false),
                    WebhookAlert = table.Column<bool>(type: "boolean", nullable: false),
                    DashboardAlert = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_checks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_checks_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_checks_policies_PolicyId",
                        column: x => x.PolicyId,
                        principalTable: "policies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_checks_scripts_ScriptId",
                        column: x => x.ScriptId,
                        principalTable: "scripts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "patch_policies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PolicyId = table.Column<int>(type: "integer", nullable: true),
                    AgentId = table.Column<int>(type: "integer", nullable: true),
                    Critical = table.Column<string>(type: "text", nullable: false),
                    Important = table.Column<string>(type: "text", nullable: false),
                    Moderate = table.Column<string>(type: "text", nullable: false),
                    Low = table.Column<string>(type: "text", nullable: false),
                    Other = table.Column<string>(type: "text", nullable: false),
                    RunTimeDays = table.Column<List<int>>(type: "integer[]", nullable: false),
                    RunTimeHour = table.Column<int>(type: "integer", nullable: false),
                    RebootAfterInstall = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_patch_policies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_patch_policies_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_patch_policies_policies_PolicyId",
                        column: x => x.PolicyId,
                        principalTable: "policies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "check_results",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    CheckId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    AlertSeverity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: true),
                    MoreInfo = table.Column<string>(type: "text", nullable: true),
                    LastRun = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    FailCount = table.Column<int>(type: "integer", nullable: false),
                    Stdout = table.Column<string>(type: "text", nullable: true),
                    Stderr = table.Column<string>(type: "text", nullable: true),
                    Retcode = table.Column<long>(type: "bigint", nullable: true),
                    ExecutionTime = table.Column<double>(type: "double precision", nullable: true),
                    History = table.Column<List<int>>(type: "integer[]", nullable: false),
                    ExtraDetails = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_check_results", x => x.Id);
                    table.ForeignKey(
                        name: "FK_check_results_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_check_results_checks_CheckId",
                        column: x => x.CheckId,
                        principalTable: "checks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "tasks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: true),
                    PolicyId = table.Column<int>(type: "integer", nullable: true),
                    Name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    ContinueOnError = table.Column<bool>(type: "boolean", nullable: false),
                    AlertSeverity = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Actions = table.Column<string>(type: "jsonb", nullable: false),
                    ScheduleType = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    RunAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    Time = table.Column<string>(type: "character varying(5)", maxLength: 5, nullable: true),
                    DaysOfWeek = table.Column<List<int>>(type: "integer[]", nullable: false),
                    DayOfMonth = table.Column<int>(type: "integer", nullable: true),
                    AssignedCheckId = table.Column<int>(type: "integer", nullable: true),
                    EmailAlert = table.Column<bool>(type: "boolean", nullable: false),
                    WebhookAlert = table.Column<bool>(type: "boolean", nullable: false),
                    DashboardAlert = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_tasks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_tasks_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_tasks_checks_AssignedCheckId",
                        column: x => x.AssignedCheckId,
                        principalTable: "checks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "FK_tasks_policies_PolicyId",
                        column: x => x.PolicyId,
                        principalTable: "policies",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "task_results",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    AgentId = table.Column<int>(type: "integer", nullable: false),
                    TaskId = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Retcode = table.Column<long>(type: "bigint", nullable: true),
                    Stdout = table.Column<string>(type: "text", nullable: true),
                    Stderr = table.Column<string>(type: "text", nullable: true),
                    ExecutionTime = table.Column<double>(type: "double precision", nullable: true),
                    LastRun = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_task_results", x => x.Id);
                    table.ForeignKey(
                        name: "FK_task_results_agents_AgentId",
                        column: x => x.AgentId,
                        principalTable: "agents",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_task_results_tasks_TaskId",
                        column: x => x.TaskId,
                        principalTable: "tasks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_sites_AlertTemplateId",
                table: "sites",
                column: "AlertTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_sites_ServerPolicyId",
                table: "sites",
                column: "ServerPolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_sites_WorkstationPolicyId",
                table: "sites",
                column: "WorkstationPolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_clients_AlertTemplateId",
                table: "clients",
                column: "AlertTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_clients_ServerPolicyId",
                table: "clients",
                column: "ServerPolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_clients_WorkstationPolicyId",
                table: "clients",
                column: "WorkstationPolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_agents_AlertTemplateId",
                table: "agents",
                column: "AlertTemplateId");

            migrationBuilder.CreateIndex(
                name: "IX_agents_PolicyId",
                table: "agents",
                column: "PolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_alert_templates_Name",
                table: "alert_templates",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_alerts_AgentId_CheckId_TaskId_Resolved",
                table: "alerts",
                columns: new[] { "AgentId", "CheckId", "TaskId", "Resolved" });

            migrationBuilder.CreateIndex(
                name: "IX_alerts_Resolved_CreatedAt",
                table: "alerts",
                columns: new[] { "Resolved", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_check_history_CheckId_AgentId_Time",
                table: "check_history",
                columns: new[] { "CheckId", "AgentId", "Time" });

            migrationBuilder.CreateIndex(
                name: "IX_check_history_Time",
                table: "check_history",
                column: "Time");

            migrationBuilder.CreateIndex(
                name: "IX_check_results_AgentId_CheckId",
                table: "check_results",
                columns: new[] { "AgentId", "CheckId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_check_results_CheckId",
                table: "check_results",
                column: "CheckId");

            migrationBuilder.CreateIndex(
                name: "IX_checks_AgentId",
                table: "checks",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_checks_PolicyId",
                table: "checks",
                column: "PolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_checks_ScriptId",
                table: "checks",
                column: "ScriptId");

            migrationBuilder.CreateIndex(
                name: "IX_patch_policies_AgentId",
                table: "patch_policies",
                column: "AgentId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_patch_policies_PolicyId",
                table: "patch_policies",
                column: "PolicyId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_pending_actions_AgentId_Status",
                table: "pending_actions",
                columns: new[] { "AgentId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_policies_Name",
                table: "policies",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_task_dispatches_Slot",
                table: "task_dispatches",
                column: "Slot");

            migrationBuilder.CreateIndex(
                name: "IX_task_dispatches_TaskId_AgentId_Slot",
                table: "task_dispatches",
                columns: new[] { "TaskId", "AgentId", "Slot" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_task_results_AgentId_TaskId",
                table: "task_results",
                columns: new[] { "AgentId", "TaskId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_task_results_TaskId",
                table: "task_results",
                column: "TaskId");

            migrationBuilder.CreateIndex(
                name: "IX_tasks_AgentId",
                table: "tasks",
                column: "AgentId");

            migrationBuilder.CreateIndex(
                name: "IX_tasks_AssignedCheckId",
                table: "tasks",
                column: "AssignedCheckId");

            migrationBuilder.CreateIndex(
                name: "IX_tasks_PolicyId",
                table: "tasks",
                column: "PolicyId");

            migrationBuilder.CreateIndex(
                name: "IX_win_updates_AgentId_UpdateGuid",
                table: "win_updates",
                columns: new[] { "AgentId", "UpdateGuid" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_agents_alert_templates_AlertTemplateId",
                table: "agents",
                column: "AlertTemplateId",
                principalTable: "alert_templates",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_agents_policies_PolicyId",
                table: "agents",
                column: "PolicyId",
                principalTable: "policies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_clients_alert_templates_AlertTemplateId",
                table: "clients",
                column: "AlertTemplateId",
                principalTable: "alert_templates",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_clients_policies_ServerPolicyId",
                table: "clients",
                column: "ServerPolicyId",
                principalTable: "policies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_clients_policies_WorkstationPolicyId",
                table: "clients",
                column: "WorkstationPolicyId",
                principalTable: "policies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_sites_alert_templates_AlertTemplateId",
                table: "sites",
                column: "AlertTemplateId",
                principalTable: "alert_templates",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_sites_policies_ServerPolicyId",
                table: "sites",
                column: "ServerPolicyId",
                principalTable: "policies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_sites_policies_WorkstationPolicyId",
                table: "sites",
                column: "WorkstationPolicyId",
                principalTable: "policies",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_agents_alert_templates_AlertTemplateId",
                table: "agents");

            migrationBuilder.DropForeignKey(
                name: "FK_agents_policies_PolicyId",
                table: "agents");

            migrationBuilder.DropForeignKey(
                name: "FK_clients_alert_templates_AlertTemplateId",
                table: "clients");

            migrationBuilder.DropForeignKey(
                name: "FK_clients_policies_ServerPolicyId",
                table: "clients");

            migrationBuilder.DropForeignKey(
                name: "FK_clients_policies_WorkstationPolicyId",
                table: "clients");

            migrationBuilder.DropForeignKey(
                name: "FK_sites_alert_templates_AlertTemplateId",
                table: "sites");

            migrationBuilder.DropForeignKey(
                name: "FK_sites_policies_ServerPolicyId",
                table: "sites");

            migrationBuilder.DropForeignKey(
                name: "FK_sites_policies_WorkstationPolicyId",
                table: "sites");

            migrationBuilder.DropTable(
                name: "alert_templates");

            migrationBuilder.DropTable(
                name: "alerts");

            migrationBuilder.DropTable(
                name: "check_history");

            migrationBuilder.DropTable(
                name: "check_results");

            migrationBuilder.DropTable(
                name: "core_settings");

            migrationBuilder.DropTable(
                name: "patch_policies");

            migrationBuilder.DropTable(
                name: "pending_actions");

            migrationBuilder.DropTable(
                name: "task_dispatches");

            migrationBuilder.DropTable(
                name: "task_results");

            migrationBuilder.DropTable(
                name: "win_updates");

            migrationBuilder.DropTable(
                name: "tasks");

            migrationBuilder.DropTable(
                name: "checks");

            migrationBuilder.DropTable(
                name: "policies");

            migrationBuilder.DropIndex(
                name: "IX_sites_AlertTemplateId",
                table: "sites");

            migrationBuilder.DropIndex(
                name: "IX_sites_ServerPolicyId",
                table: "sites");

            migrationBuilder.DropIndex(
                name: "IX_sites_WorkstationPolicyId",
                table: "sites");

            migrationBuilder.DropIndex(
                name: "IX_clients_AlertTemplateId",
                table: "clients");

            migrationBuilder.DropIndex(
                name: "IX_clients_ServerPolicyId",
                table: "clients");

            migrationBuilder.DropIndex(
                name: "IX_clients_WorkstationPolicyId",
                table: "clients");

            migrationBuilder.DropIndex(
                name: "IX_agents_AlertTemplateId",
                table: "agents");

            migrationBuilder.DropIndex(
                name: "IX_agents_PolicyId",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "AlertTemplateId",
                table: "sites");

            migrationBuilder.DropColumn(
                name: "BlockPolicyInheritance",
                table: "sites");

            migrationBuilder.DropColumn(
                name: "ServerPolicyId",
                table: "sites");

            migrationBuilder.DropColumn(
                name: "WorkstationPolicyId",
                table: "sites");

            migrationBuilder.DropColumn(
                name: "AlertTemplateId",
                table: "clients");

            migrationBuilder.DropColumn(
                name: "BlockPolicyInheritance",
                table: "clients");

            migrationBuilder.DropColumn(
                name: "ServerPolicyId",
                table: "clients");

            migrationBuilder.DropColumn(
                name: "WorkstationPolicyId",
                table: "clients");

            migrationBuilder.DropColumn(
                name: "AlertTemplateId",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "BlockPolicyInheritance",
                table: "agents");

            migrationBuilder.DropColumn(
                name: "PolicyId",
                table: "agents");
        }
    }
}
