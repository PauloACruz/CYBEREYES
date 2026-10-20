using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase23FilaRodizio : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "AutoAssigned",
                table: "tickets",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // O rodizio ja comeca ligado; sem ninguem na fila, os chamados seguem abertos sem tecnico como antes.
            migrationBuilder.AddColumn<bool>(
                name: "TicketRotationEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.CreateTable(
                name: "ticket_rotation_members",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Position = table.Column<int>(type: "integer", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    QueueIds = table.Column<List<int>>(type: "integer[]", nullable: false),
                    LastAssignedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ticket_rotation_members", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_ticket_rotation_members_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ticket_rotation_members");

            migrationBuilder.DropColumn(
                name: "AutoAssigned",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "TicketRotationEnabled",
                table: "core_settings");
        }
    }
}
