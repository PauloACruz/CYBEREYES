using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase22FaqColaborativo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "faq_entries",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HelpfulCount",
                table: "faq_entries",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NotHelpfulCount",
                table: "faq_entries",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "Public",
                table: "faq_entries",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "faq_entries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "team");

            migrationBuilder.AddColumn<int>(
                name: "SourceTicketId",
                table: "faq_entries",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "faq_entries",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "published");

            migrationBuilder.AddColumn<string>(
                name: "SuggestedBy",
                table: "faq_entries",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "UsedCount",
                table: "faq_entries",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Views",
                table: "faq_entries",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "FaqLearnFromTickets",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            // O passo a passo das entradas com a tag orientar ja vai ao usuario no chat; elas aparecem tambem na ajuda do app.
            migrationBuilder.Sql("UPDATE faq_entries SET \"Public\" = true WHERE 'orientar' = ANY(\"Tags\");");

            migrationBuilder.CreateIndex(
                name: "IX_faq_entries_SourceTicketId",
                table: "faq_entries",
                column: "SourceTicketId");

            migrationBuilder.CreateIndex(
                name: "IX_faq_entries_Status",
                table: "faq_entries",
                column: "Status");

            migrationBuilder.AddForeignKey(
                name: "FK_faq_entries_tickets_SourceTicketId",
                table: "faq_entries",
                column: "SourceTicketId",
                principalTable: "tickets",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_faq_entries_tickets_SourceTicketId",
                table: "faq_entries");

            migrationBuilder.DropIndex(
                name: "IX_faq_entries_SourceTicketId",
                table: "faq_entries");

            migrationBuilder.DropIndex(
                name: "IX_faq_entries_Status",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "Category",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "HelpfulCount",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "NotHelpfulCount",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "Public",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "SourceTicketId",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "SuggestedBy",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "UsedCount",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "Views",
                table: "faq_entries");

            migrationBuilder.DropColumn(
                name: "FaqLearnFromTickets",
                table: "core_settings");
        }
    }
}
