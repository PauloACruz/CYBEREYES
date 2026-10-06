using System.Globalization;
using System.Net;
using System.Text;

namespace Cybereyes.Api.Infrastructure;

/// <summary>E-mail pronto para envio: assunto, versao em texto puro e versao HTML com a identidade visual.</summary>
public sealed record EmailContent(string Subject, string Text, string Html);

/// <summary>Linha de um quadro de dados do e-mail (rotulo e valor ja formatados, sem HTML).</summary>
public sealed record EmailField(string Label, string Value, bool Monospace = false);

/// <summary>
/// Modelos dos e-mails enviados pelo servidor com o design system CYBEREYES: faixa escura com o emblema,
/// corpo claro, botao dourado e rodape da PCruzTI. Todo texto variavel passa por HtmlEncode.
/// </summary>
public static class EmailTemplates
{
    public const string Brand = "CYBEREYES";
    public const string SubjectPrefix = "[CYBEREYES] ";

    /// <summary>Caminho do emblema branco servido pelo frontend (frontend/public/brand).</summary>
    public const string EmblemPath = "/brand/cybereyes-emblema-branco.png";

    private const string Sans = "'Space Grotesk', Arial, Helvetica, sans-serif";
    private const string Mono = "'JetBrains Mono', Consolas, 'Courier New', monospace";

    public static EmailContent Invite(string fullName, string userName, string link, int hours, string? publicUrl)
    {
        var text =
            $"Olá, {fullName}.\n\n" +
            $"Você foi convidado para o console {Brand}.\n" +
            $"Seu usuário: {userName}\n\n" +
            $"Defina sua senha pelo link abaixo (válido por {hours} horas):\n{link}\n\n" +
            "No primeiro acesso será pedida a verificação em duas etapas (Google Authenticator, Microsoft Authenticator ou similar).\n\n" +
            "Se você não esperava este convite, ignore esta mensagem.";
        var body = new StringBuilder()
            .Append(Heading("Você foi convidado para o console"))
            .Append(Paragraph($"Olá, {E(fullName)}. Seu acesso ao console {Brand} está pronto. Crie sua senha para entrar."))
            .Append(Fields([new("Seu usuário", userName, Monospace: true), new("Link válido por", $"{hours} horas")]))
            .Append(Button("Criar minha senha", link))
            .Append(Paragraph("No primeiro acesso, o console pede a verificação em duas etapas (Google Authenticator, Microsoft Authenticator ou similar)."))
            .Append(Fallback(link))
            .ToString();
        return new(SubjectPrefix + "Convite para o console", text,
            Layout($"Defina sua senha em até {hours} horas.", body, "Se você não esperava este convite, ignore esta mensagem.", publicUrl));
    }

    public static EmailContent PasswordReset(string fullName, string userName, string link, int hours, string? publicUrl)
    {
        var text =
            $"Olá, {fullName}.\n\n" +
            $"Recebemos um pedido para redefinir a senha do usuário {userName} no console {Brand}.\n\n" +
            $"Defina uma nova senha pelo link abaixo (válido por {hours} horas e uma única vez):\n{link}\n\n" +
            "A verificação em duas etapas continua sendo pedida no login.\n\n" +
            "Se não foi você, ignore esta mensagem: sua senha atual continua valendo.";
        var body = new StringBuilder()
            .Append(Heading("Redefinição de senha"))
            .Append(Paragraph($"Olá, {E(fullName)}. Recebemos um pedido para redefinir a senha do usuário <b style=\"color: #131418\">{E(userName)}</b> no console {Brand}."))
            .Append(Button("Definir nova senha", link))
            .Append(Fields([new("Validade", $"{hours} horas, uma única vez"), new("Login", "A verificação em duas etapas continua sendo pedida")]))
            .Append(Fallback(link))
            .ToString();
        return new(SubjectPrefix + "Redefinição de senha", text,
            Layout($"O link vale por {hours} horas e uma única vez.", body, "Se não foi você, ignore esta mensagem: sua senha atual continua valendo.", publicUrl));
    }

    public static EmailContent SmtpTest(string? publicUrl)
    {
        const string message = "Se você recebeu esta mensagem, o SMTP está configurado corretamente.";
        var body = Heading("O e-mail está funcionando") + Paragraph(message);
        return new(SubjectPrefix + "Teste de e-mail", message,
            Layout("O SMTP está configurado corretamente.", body, "Mensagem enviada pelo botão de teste em Configurações.", publicUrl));
    }

    /// <param name="created">true para alerta novo, false para alerta resolvido.</param>
    /// <param name="severityName">Nome da severidade em minusculas (erro, aviso, informativo).</param>
    /// <param name="originLabel">"Agente" ou "Dispositivo".</param>
    public static EmailContent Alert(bool created, string severityName, string message, DateTimeOffset createdAt, string originLabel, string link,
        string? publicUrl)
    {
        var createdText = createdAt.ToString("dd/MM/yyyy HH:mm", CultureInfo.InvariantCulture) + " UTC";
        var subject = created ? $"{SubjectPrefix}Alerta {severityName}: {message}" : $"{SubjectPrefix}Resolvido: {message}";
        var text =
            $"{(created ? "Novo alerta" : "Alerta resolvido")} ({severityName})\n\n{message}\n\n" +
            $"Criado em: {createdText}\n{originLabel}: {link}";
        var (chipText, chipColor, chipBackground) = created
            ? (severityName.ToUpperInvariant(), SeverityColor(severityName), SeverityBackground(severityName))
            : ("RESOLVIDO", "#096d5b", "rgba(9, 109, 91, 0.12)");
        var body = new StringBuilder()
            .Append(CultureInfo.InvariantCulture,
                $"<p style=\"margin: 0 0 12px\"><span style=\"display: inline-block; padding: 3px 8px; border-radius: 2px; background: {chipBackground}; color: {chipColor}; font-size: 12px; font-weight: 600; letter-spacing: 0.02em\">{E(chipText)}</span></p>")
            .Append(Heading(created ? "Novo alerta" : "Alerta resolvido"))
            .Append(CultureInfo.InvariantCulture,
                $"<table role=\"presentation\" style=\"width: 100%; border-collapse: collapse; margin: 0 0 24px\"><tr><td style=\"border-left: 4px solid {chipColor}; background: #f8f9f6; padding: 14px 16px; font-size: 15px; line-height: 22px; color: #131418; word-break: break-word\">{E(message)}</td></tr></table>")
            .Append(Fields([new("Severidade", Capitalize(severityName)), new("Criado em", createdText)]))
            .Append(Button("Ver no console", link))
            .Append(Fallback(link))
            .ToString();
        var preheader = created ? $"Novo alerta ({severityName})." : "O alerta foi resolvido.";
        return new(subject, text, Layout(preheader, body, "Você recebe este e-mail pelo template de alerta configurado no console.", publicUrl));
    }

    public static EmailContent Report(string title, string period, IReadOnlyList<(string Label, string Value)> summary, string fileName,
        string? publicUrl)
    {
        var text = $"Segue em anexo o relatório {title}.{(period.Length > 0 ? $"\nPeríodo: {period}" : string.Empty)}\n" +
            string.Join("\n", summary.Select(s => $"{s.Label}: {s.Value}"));
        var fields = new List<EmailField>();
        if (period.Length > 0)
        {
            fields.Add(new("Período", period));
        }
        fields.AddRange(summary.Select(s => new EmailField(s.Label, s.Value)));
        var body = new StringBuilder()
            .Append(Heading($"Relatório {E(title)}"))
            .Append(Paragraph($"Segue em anexo o relatório {E(title)}."))
            .Append(fields.Count > 0 ? Fields(fields) : string.Empty)
            .Append(CultureInfo.InvariantCulture,
                $"<p style=\"margin: 0 0 24px; font-size: 13px; color: #5f656f\">Anexo: <span style=\"font-family: {Mono}; color: #131418\">{E(fileName)}</span></p>")
            .ToString();
        return new(SubjectPrefix + $"Relatório {title}", text,
            Layout($"Segue em anexo o relatório {title}.", body, "Envio agendado em Relatórios, aba Agendamentos.", publicUrl));
    }

    /// <summary>Estrutura comum: faixa escura com o emblema, conteudo e rodape. <paramref name="body"/> ja vem em HTML seguro.</summary>
    private static string Layout(string preheader, string body, string footerNote, string? publicUrl)
    {
        var emblem = EmblemUrl(publicUrl) is { } src
            ? $"<td style=\"padding-right: 12px\"><img src=\"{E(src)}\" alt=\"\" width=\"36\" style=\"display: block; height: auto; border: 0\"></td>"
            : string.Empty;
        return $$"""
            <!doctype html>
            <html lang="pt-BR">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <meta name="color-scheme" content="light">
            <title>{{Brand}}</title>
            </head>
            <body style="margin: 0; padding: 0; background: #eef0ec">
            <div style="display: none; max-height: 0; overflow: hidden; opacity: 0">{{E(preheader)}}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: #eef0ec; border-collapse: collapse">
            <tr><td align="center" style="padding: 24px 12px">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width: 100%; max-width: 600px; border-collapse: collapse; background: #ffffff; border-radius: 8px; overflow: hidden; font-family: {{Sans}}; color: #131418">
            <tr><td style="background: #0a0c0e; padding: 20px 32px; border-bottom: 3px solid #daa916"><table role="presentation" cellpadding="0" cellspacing="0"><tr>{{emblem}}<td style="font-family: {{Sans}}; font-size: 20px; font-weight: 600; letter-spacing: -0.01em; color: #f1f2ee">{{Brand}}</td></tr></table></td></tr>
            <tr><td style="padding: 32px 32px 8px">{{body}}</td></tr>
            <tr><td style="padding: 20px 32px 28px; border-top: 1px solid #dde0e4; font-size: 12px; line-height: 18px; color: #5f656f">{{E(footerNote)}}<br>© {{DateTime.UtcNow.Year.ToString(CultureInfo.InvariantCulture)}} PCruzTI. Todos os direitos reservados.</td></tr>
            </table>
            </td></tr>
            </table>
            </body>
            </html>
            """;
    }

    /// <summary>URL absoluta do emblema; sem endereco publico http(s) o e-mail sai so com o nome.</summary>
    public static string? EmblemUrl(string? publicUrl)
    {
        var baseUrl = publicUrl?.Trim().TrimEnd('/');
        return Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" ? baseUrl + EmblemPath : null;
    }

    private static string Heading(string html) =>
        $"<h1 style=\"margin: 0 0 16px; font-family: {Sans}; font-size: 24px; line-height: 32px; font-weight: 600; letter-spacing: -0.01em; color: #131418\">{html}</h1>";

    private static string Paragraph(string html) =>
        $"<p style=\"margin: 0 0 16px; font-size: 15px; line-height: 24px; color: #555b65\">{html}</p>";

    private static string Button(string label, string href) =>
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin: 8px 0 24px\"><tr><td style=\"background: #daa916; border-radius: 4px\">" +
        $"<a href=\"{E(href)}\" style=\"display: inline-block; padding: 12px 24px; font-family: {Sans}; font-size: 15px; font-weight: 600; color: #131418; text-decoration: none\">{E(label)}</a></td></tr></table>";

    private static string Fallback(string link) =>
        "<p style=\"margin: 0 0 24px; font-size: 12px; line-height: 18px; color: #5f656f\">Se o botão não abrir, copie este endereço no navegador:<br>" +
        $"<span style=\"font-family: {Mono}; color: #7f5f00; word-break: break-all\">{E(link)}</span></p>";

    private static string Fields(IReadOnlyList<EmailField> fields)
    {
        var rows = string.Concat(fields.Select(f =>
            $"<tr><td style=\"padding: 8px 0; font-size: 13px; color: #5f656f; width: 140px; vertical-align: top\">{E(f.Label)}</td>" +
            $"<td style=\"padding: 8px 0; font-size: 14px; color: #131418; font-weight: 500{(f.Monospace ? $"; font-family: {Mono}" : string.Empty)}\">{E(f.Value)}</td></tr>"));
        return "<table role=\"presentation\" style=\"width: 100%; border-collapse: collapse; background: #f8f9f6; border: 1px solid #dde0e4; border-radius: 8px; margin: 0 0 24px\">" +
            $"<tr><td style=\"padding: 8px 16px\"><table role=\"presentation\" style=\"width: 100%; border-collapse: collapse\">{rows}</table></td></tr></table>";
    }

    private static string SeverityColor(string severityName) => severityName switch
    {
        "erro" => "#ae3126",
        "aviso" => "#974a00",
        _ => "#1d5ab0",
    };

    private static string SeverityBackground(string severityName) => severityName switch
    {
        "erro" => "rgba(174, 49, 38, 0.12)",
        "aviso" => "rgba(151, 74, 0, 0.12)",
        _ => "rgba(29, 90, 176, 0.12)",
    };

    private static string Capitalize(string value) =>
        value.Length == 0 ? value : char.ToUpperInvariant(value[0]) + value[1..];

    private static string E(string value) => WebUtility.HtmlEncode(value);
}
