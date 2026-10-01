namespace WinCare.Api.Rmm.Nats;

public sealed class NatsSettings
{
    public const string Section = "Nats";

    public string? Url { get; set; }
    public string User { get; set; } = "wincare-api";
    public string? Password { get; set; }
    public string? AuthFile { get; set; }
    public string ResponseExpiration { get; set; } = "1435m";

    public bool Enabled => !string.IsNullOrWhiteSpace(Url);
}
