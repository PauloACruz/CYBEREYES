using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase18SolucaoChamados : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Resolution",
                table: "tickets",
                type: "character varying(20000)",
                maxLength: 20000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ResolutionKind",
                table: "tickets",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "ResolvedById",
                table: "tickets",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_tickets_ResolvedById",
                table: "tickets",
                column: "ResolvedById");

            migrationBuilder.AddForeignKey(
                name: "FK_tickets_AspNetUsers_ResolvedById",
                table: "tickets",
                column: "ResolvedById",
                principalTable: "AspNetUsers",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tickets_AspNetUsers_ResolvedById",
                table: "tickets");

            migrationBuilder.DropIndex(
                name: "IX_tickets_ResolvedById",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "Resolution",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "ResolutionKind",
                table: "tickets");

            migrationBuilder.DropColumn(
                name: "ResolvedById",
                table: "tickets");
        }
    }
}
