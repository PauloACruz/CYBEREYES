using System.Globalization;
using System.Reflection;
using System.Text;
using MigraDoc.DocumentObjectModel;
using MigraDoc.DocumentObjectModel.Tables;
using MigraDoc.Rendering;
using PdfSharp.Fonts;

namespace Cybereyes.Api.Reports;

public static class ReportFormatter
{
    private static readonly CultureInfo PtBr = ReportCulture.PtBr;

    public static string Value(object? value, string kind, TimeZoneInfo zone) => value switch
    {
        null => string.Empty,
        DateTimeOffset dt => TimeZoneInfo.ConvertTime(dt, zone).ToString(kind == ColumnKind.Date ? "dd/MM/yyyy" : "dd/MM/yyyy HH:mm", PtBr),
        DateOnly d => d.ToString("dd/MM/yyyy", PtBr),
        long or int when kind == ColumnKind.Duration => Duration(Convert.ToInt64(value, CultureInfo.InvariantCulture)),
        double pct when kind == ColumnKind.Percent => pct.ToString("0.00", PtBr) + "%",
        double n => n.ToString("0.##", PtBr),
        int or long => Convert.ToInt64(value, CultureInfo.InvariantCulture).ToString(PtBr),
        bool b => b ? "Sim" : "Nao",
        _ => Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty,
    };

    public static string Duration(long seconds)
    {
        if (seconds < 60)
        {
            return $"{Math.Max(0, seconds)}s";
        }
        var span = TimeSpan.FromSeconds(seconds);
        return span.TotalDays >= 1 ? $"{(int)span.TotalDays}d {span.Hours}h {span.Minutes:00}min"
            : span.TotalHours >= 1 ? $"{span.Hours}h {span.Minutes:00}min"
            : $"{span.Minutes}min";
    }

    public static string Period(ReportData data, TimeZoneInfo zone) => data.PeriodFrom is { } f && data.PeriodTo is { } t
        ? $"{Value(f, ColumnKind.DateTime, zone)} a {Value(t, ColumnKind.DateTime, zone)}"
        : string.Empty;

    public static string FileName(ReportData data, string format, TimeZoneInfo zone) =>
        $"relatorio-{data.Type.Replace('_', '-')}-{TimeZoneInfo.ConvertTime(data.GeneratedAt, zone):yyyyMMdd-HHmm}.{format}";
}

/// <summary>CSV para Excel em portugues: separador ";", BOM UTF-8 e protecao contra injecao de formula.</summary>
public static class CsvRenderer
{
    public static byte[] Render(ReportData data, TimeZoneInfo zone)
    {
        var sb = new StringBuilder();
        sb.AppendJoin(';', data.Columns.Select(c => Escape(c.Label))).Append("\r\n");
        foreach (var row in data.Rows)
        {
            sb.AppendJoin(';', data.Columns.Select(c => Escape(ReportFormatter.Value(row.GetValueOrDefault(c.Key), c.Kind, zone)))).Append("\r\n");
        }
        return [.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(sb.ToString())];
    }

    public static string Escape(string value)
    {
        if (value.Length > 0 && value[0] is '=' or '+' or '-' or '@' or '\t' or '\r')
        {
            value = "'" + value;
        }
        return value.IndexOfAny([';', '"', '\n', '\r']) >= 0 ? "\"" + value.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"" : value;
    }
}

/// <summary>Fonte DejaVu embutida no assembly: o PDF sai igual em qualquer imagem, sem depender das fontes do sistema.</summary>
public sealed class EmbeddedFontResolver : IFontResolver
{
    private static readonly Lock Gate = new();
    private static bool installed;

    public static void Install()
    {
        lock (Gate)
        {
            if (!installed)
            {
                GlobalFontSettings.FontResolver = new EmbeddedFontResolver();
                installed = true;
            }
        }
    }

    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
        new(bold ? "DejaVuSans-Bold" : "DejaVuSans");

    public byte[]? GetFont(string faceName)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"Cybereyes.Fonts.{faceName}.ttf");
        if (stream is null)
        {
            return null;
        }
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    }
}

public static class PdfRenderer
{
    private const double UsableWidthCm = 27.3;

    public static byte[] Render(ReportData data, TimeZoneInfo zone)
    {
        EmbeddedFontResolver.Install();
        var doc = new Document();
        doc.Info.Title = data.Title;
        doc.Styles[StyleNames.Normal]!.Font.Name = "DejaVu Sans";
        doc.Styles[StyleNames.Normal]!.Font.Size = 8;

        var section = doc.AddSection();
        section.PageSetup = doc.DefaultPageSetup.Clone();
        // A4 paisagem por largura e altura explicitas: com PageFormat + Orientation o PDFsharp 6 gerava a pagina em retrato.
        section.PageSetup.PageWidth = Unit.FromCentimeter(29.7);
        section.PageSetup.PageHeight = Unit.FromCentimeter(21);
        section.PageSetup.LeftMargin = Unit.FromCentimeter(1.2);
        section.PageSetup.RightMargin = Unit.FromCentimeter(1.2);
        section.PageSetup.TopMargin = Unit.FromCentimeter(1.2);
        section.PageSetup.BottomMargin = Unit.FromCentimeter(1.5);

        var footer = section.Footers.Primary.AddParagraph();
        footer.Format.Alignment = ParagraphAlignment.Right;
        footer.Format.Font.Size = 7;
        footer.AddText($"Cybereyes - {data.Title} - gerado em {ReportFormatter.Value(data.GeneratedAt, ColumnKind.DateTime, zone)} - pagina ");
        footer.AddPageField();
        footer.AddText(" de ");
        footer.AddNumPagesField();

        var title = section.AddParagraph(data.Title);
        title.Format.Font.Size = 16;
        title.Format.Font.Bold = true;
        title.Format.SpaceAfter = Unit.FromPoint(4);
        var meta = new List<string>();
        if (ReportFormatter.Period(data, zone) is { Length: > 0 } period)
        {
            meta.Add("Periodo: " + period);
        }
        meta.AddRange(data.FiltersText);
        meta.Add($"Gerado em {ReportFormatter.Value(data.GeneratedAt, ColumnKind.DateTime, zone)} ({zone.Id})");
        var metaParagraph = section.AddParagraph(string.Join("  |  ", meta));
        metaParagraph.Format.Font.Size = 8;
        metaParagraph.Format.Font.Color = Colors.DimGray;
        metaParagraph.Format.SpaceAfter = Unit.FromPoint(8);

        if (data.Summary.Count > 0)
        {
            var summary = section.AddTable();
            summary.Borders.Width = 0.5;
            summary.Borders.Color = Colors.LightGray;
            var perRow = Math.Min(6, data.Summary.Count);
            for (var i = 0; i < perRow; i++)
            {
                summary.AddColumn(Unit.FromCentimeter(UsableWidthCm / perRow));
            }
            foreach (var chunk in data.Summary.Chunk(perRow))
            {
                var row = summary.AddRow();
                row.TopPadding = 3;
                row.BottomPadding = 3;
                for (var i = 0; i < chunk.Length; i++)
                {
                    var p = row.Cells[i].AddParagraph();
                    p.AddFormattedText(chunk[i].Label + "\n", new Font { Size = 7, Color = Colors.DimGray });
                    p.AddFormattedText(chunk[i].Value, new Font { Size = 11, Bold = true });
                }
            }
            section.AddParagraph().Format.SpaceAfter = Unit.FromPoint(6);
        }

        var table = section.AddTable();
        table.Borders.Width = 0.25;
        table.Borders.Color = Colors.LightGray;
        var weights = data.Columns.Select(Weight).ToList();
        var total = weights.Sum();
        foreach (var w in weights)
        {
            table.AddColumn(Unit.FromCentimeter(UsableWidthCm * w / total));
        }
        var header = table.AddRow();
        header.HeadingFormat = true;
        header.Shading.Color = Color.FromRgb(230, 238, 247);
        header.Format.Font.Bold = true;
        for (var i = 0; i < data.Columns.Count; i++)
        {
            header.Cells[i].AddParagraph(data.Columns[i].Label);
        }
        var index = 0;
        foreach (var source in data.Rows)
        {
            var row = table.AddRow();
            if (index++ % 2 == 1)
            {
                row.Shading.Color = Color.FromRgb(248, 249, 251);
            }
            for (var i = 0; i < data.Columns.Count; i++)
            {
                var column = data.Columns[i];
                var paragraph = row.Cells[i].AddParagraph(ReportFormatter.Value(source.GetValueOrDefault(column.Key), column.Kind, zone));
                if (column.Kind is ColumnKind.Number or ColumnKind.Percent or ColumnKind.Duration)
                {
                    paragraph.Format.Alignment = ParagraphAlignment.Right;
                }
            }
        }
        if (data.Rows.Count == 0)
        {
            var empty = table.AddRow();
            empty.Cells[0].MergeRight = data.Columns.Count - 1;
            empty.Cells[0].AddParagraph("Nenhum registro encontrado com estes filtros.");
        }

        var renderer = new PdfDocumentRenderer { Document = doc };
        renderer.RenderDocument();
        using var output = new MemoryStream();
        renderer.PdfDocument.Save(output, false);
        return output.ToArray();
    }

    private static double Weight(ReportColumn c) => c.Kind switch
    {
        ColumnKind.Number or ColumnKind.Percent => 1,
        ColumnKind.Date or ColumnKind.Duration => 1.4,
        ColumnKind.DateTime => 1.8,
        _ => c.Key is "message" or "title" or "problems" ? 4.5 : 2,
    };
}
