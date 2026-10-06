using Cybereyes.Api.Infrastructure;

namespace Cybereyes.Api.Tests;

public sealed class EmailTemplatesTests
{
    private const string Link = "https://console.exemplo.com.br/convite?uid=3f6c1a2e-8b4d-4c1e-9a7f-2d5e6b8c9a10&token=abc%2Bdef";

    [Fact]
    public void Convite_tem_texto_e_html_com_link_usuario_e_emblema()
    {
        var mail = EmailTemplates.Invite("João Souza", "joao.tecnico", Link, 72, "https://console.exemplo.com.br/");

        Assert.Equal("[CYBEREYES] Convite para o console", mail.Subject);
        Assert.Contains("Seu usuário: joao.tecnico", mail.Text, StringComparison.Ordinal);
        Assert.Contains(Link, mail.Text, StringComparison.Ordinal);
        Assert.Contains("válido por 72 horas", mail.Text, StringComparison.Ordinal);
        Assert.Contains("Criar minha senha", mail.Html, StringComparison.Ordinal);
        Assert.Contains("href=\"https://console.exemplo.com.br/convite?uid=3f6c1a2e-8b4d-4c1e-9a7f-2d5e6b8c9a10&amp;token=abc%2Bdef\"", mail.Html, StringComparison.Ordinal);
        Assert.Contains("src=\"https://console.exemplo.com.br/brand/cybereyes-emblema-branco.png\"", mail.Html, StringComparison.Ordinal);
    }

    [Fact]
    public void Html_escapa_o_texto_variavel()
    {
        var mail = EmailTemplates.Alert(true, "erro", "<script>alert(1)</script> & \"x\"", DateTimeOffset.Parse("2026-10-01T12:15:00Z"), "Agente",
            "https://console.exemplo.com.br/agentes/12", "https://console.exemplo.com.br");

        Assert.DoesNotContain("<script>", mail.Html, StringComparison.Ordinal);
        Assert.Contains("&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;", mail.Html, StringComparison.Ordinal);
        Assert.Equal("[CYBEREYES] Alerta erro: <script>alert(1)</script> & \"x\"", mail.Subject);
        Assert.Contains("Criado em: 01/10/2026 12:15 UTC", mail.Text, StringComparison.Ordinal);
        Assert.Contains("Agente: https://console.exemplo.com.br/agentes/12", mail.Text, StringComparison.Ordinal);
    }

    [Fact]
    public void Alerta_resolvido_usa_o_assunto_de_resolucao()
    {
        var mail = EmailTemplates.Alert(false, "aviso", "Interface Gi0/1 de SW caiu", DateTimeOffset.Parse("2026-10-01T12:15:00Z"), "Dispositivo",
            "https://console.exemplo.com.br/snmp/3", null);

        Assert.Equal("[CYBEREYES] Resolvido: Interface Gi0/1 de SW caiu", mail.Subject);
        Assert.StartsWith("Alerta resolvido (aviso)", mail.Text, StringComparison.Ordinal);
        Assert.Contains("RESOLVIDO", mail.Html, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("/relativo")]
    public void Sem_endereco_publico_absoluto_o_emblema_fica_de_fora(string? publicUrl)
    {
        Assert.Null(EmailTemplates.EmblemUrl(publicUrl));
        Assert.DoesNotContain("<img", EmailTemplates.SmtpTest(publicUrl).Html, StringComparison.Ordinal);
    }

    [Fact]
    public void Relatorio_lista_periodo_resumo_e_anexo()
    {
        var mail = EmailTemplates.Report("Alertas", "24/09/2026 08:00 a 01/10/2026 08:00", [("Total", "12")], "relatorio-alertas-20261001-0800.pdf", null);

        Assert.Equal("[CYBEREYES] Relatório Alertas", mail.Subject);
        Assert.Equal("Segue em anexo o relatório Alertas.\nPeríodo: 24/09/2026 08:00 a 01/10/2026 08:00\nTotal: 12", mail.Text);
        Assert.Contains("relatorio-alertas-20261001-0800.pdf", mail.Html, StringComparison.Ordinal);
    }
}
