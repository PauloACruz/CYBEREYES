using Microsoft.EntityFrameworkCore;
using WinCare.Api.Infrastructure;
using WinCare.Core.Persistence;
using WinCare.Core.Tickets;

namespace WinCare.Api.Tickets;

public static class Attachments
{
    public const long MaxBytes = 10 * 1024 * 1024;

    private static readonly Dictionary<string, string> InlineImages = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/png"] = "png", ["image/jpeg"] = "jpeg", ["image/gif"] = "gif", ["image/webp"] = "webp",
    };

    public static async Task<(TicketAttachment? Attachment, IResult? Error)> StoreAsync(WinCareDbContext db, int ticketId, long? messageId, IFormFile? file,
        string uploadedBy, bool isInternal, bool imagesOnly, CancellationToken ct)
    {
        if (file is null || file.Length == 0)
        {
            return (null, Problems.Validation("file", "Envie um arquivo"));
        }
        if (file.Length > MaxBytes)
        {
            return (null, Problems.Create(StatusCodes.Status413PayloadTooLarge, "Arquivo maior que 10 MB", ErrorCodes.Validation));
        }

        using var buffer = new MemoryStream((int)file.Length);
        await file.CopyToAsync(buffer, ct);
        var content = buffer.ToArray();
        var image = DetectImage(content);
        if (imagesOnly && image is null)
        {
            return (null, Problems.Validation("screenshot", "A captura deve ser uma imagem PNG, JPEG, GIF ou WEBP"));
        }

        var name = Path.GetFileName(file.FileName);
        var attachment = new TicketAttachment
        {
            TicketId = ticketId,
            MessageId = messageId,
            FileName = string.IsNullOrWhiteSpace(name) ? "arquivo" : name[..Math.Min(name.Length, 255)],
            ContentType = image ?? "application/octet-stream",
            Size = content.Length,
            UploadedBy = uploadedBy,
            Internal = isInternal,
        };
        db.TicketAttachments.Add(attachment);
        await db.SaveChangesAsync(ct);
        db.TicketAttachmentData.Add(new TicketAttachmentData { AttachmentId = attachment.Id, Content = content });
        await db.SaveChangesAsync(ct);
        return (attachment, null);
    }

    public static async Task<IResult> DownloadAsync(WinCareDbContext db, TicketAttachment attachment, CancellationToken ct)
    {
        var content = await db.TicketAttachmentData.AsNoTracking().Where(d => d.AttachmentId == attachment.Id).Select(d => d.Content).FirstOrDefaultAsync(ct);
        if (content is null)
        {
            return Problems.NotFound("Anexo");
        }
        var inline = InlineImages.ContainsKey(attachment.ContentType);
        return inline
            ? Results.File(content, attachment.ContentType, enableRangeProcessing: false)
            : Results.File(content, "application/octet-stream", attachment.FileName);
    }

    public static AttachmentDto ToDto(TicketAttachment a) => new(a.Id, a.FileName, a.ContentType, a.Size);

    /// <summary>Identifica imagens pela assinatura do arquivo, sem confiar no tipo informado pelo cliente.</summary>
    public static string? DetectImage(ReadOnlySpan<byte> data)
    {
        if (data.StartsWith((ReadOnlySpan<byte>)[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
        {
            return "image/png";
        }
        if (data.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xD8, 0xFF]))
        {
            return "image/jpeg";
        }
        if (data.StartsWith("GIF87a"u8) || data.StartsWith("GIF89a"u8))
        {
            return "image/gif";
        }
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data[8..12].SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }
        return null;
    }
}
