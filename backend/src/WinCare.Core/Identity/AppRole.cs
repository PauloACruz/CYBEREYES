using Microsoft.AspNetCore.Identity;

namespace WinCare.Core.Identity;

public sealed class AppRole : IdentityRole<Guid>
{
    public bool IsSuperuser { get; set; }
    public List<string> Permissions { get; set; } = [];
}
