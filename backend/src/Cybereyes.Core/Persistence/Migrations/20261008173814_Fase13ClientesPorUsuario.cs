using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase13ClientesPorUsuario : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ClientId",
                table: "report_schedules",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ClientId",
                table: "report_runs",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AllClients",
                table: "AspNetUsers",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "user_clients",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    ClientId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_clients", x => new { x.UserId, x.ClientId });
                    table.ForeignKey(
                        name: "FK_user_clients_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_user_clients_clients_ClientId",
                        column: x => x.ClientId,
                        principalTable: "clients",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_user_clients_ClientId",
                table: "user_clients",
                column: "ClientId");

            // Relatorios ja gerados e agendados: o cliente vem do filtro gravado em Params.
            migrationBuilder.Sql("""
                UPDATE report_runs SET "ClientId" = ("Params"::jsonb ->> 'clientId')::integer WHERE "Params"::jsonb ->> 'clientId' IS NOT NULL;
                UPDATE report_schedules SET "ClientId" = ("Params"::jsonb ->> 'clientId')::integer WHERE "Params"::jsonb ->> 'clientId' IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "user_clients");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "report_schedules");

            migrationBuilder.DropColumn(
                name: "ClientId",
                table: "report_runs");

            migrationBuilder.DropColumn(
                name: "AllClients",
                table: "AspNetUsers");
        }
    }
}
