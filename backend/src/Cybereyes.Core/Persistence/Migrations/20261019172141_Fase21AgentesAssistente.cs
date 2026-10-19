using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Cybereyes.Core.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class Fase21AgentesAssistente : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Os dois agentes comecam ligados: quem ja usa o assistente continua com o mesmo comportamento.
            migrationBuilder.AddColumn<bool>(
                name: "AssistantAgentEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "AssistantInstructions",
                table: "core_settings",
                type: "character varying(20000)",
                maxLength: 20000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "AssistantNativeEnabled",
                table: "core_settings",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AssistantAgentEnabled",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantInstructions",
                table: "core_settings");

            migrationBuilder.DropColumn(
                name: "AssistantNativeEnabled",
                table: "core_settings");
        }
    }
}
