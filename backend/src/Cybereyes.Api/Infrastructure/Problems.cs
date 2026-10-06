using Microsoft.AspNetCore.Identity;

namespace Cybereyes.Api.Infrastructure;

public static class ErrorCodes
{
    public const string Validation = "VALIDATION_ERROR";
    public const string Unauthenticated = "UNAUTHENTICATED";
    public const string InvalidCredentials = "INVALID_CREDENTIALS";
    public const string InvalidCode = "INVALID_CODE";
    public const string InvalidToken = "INVALID_TOKEN";
    public const string MfaRequired = "MFA_REQUIRED";
    public const string Forbidden = "FORBIDDEN";
    public const string LockedOut = "LOCKED_OUT";
    public const string NotFound = "NOT_FOUND";
    public const string Conflict = "CONFLICT";
    public const string RateLimited = "RATE_LIMITED";
    public const string Internal = "INTERNAL_ERROR";
    public const string AgentTimeout = "AGENT_TIMEOUT";
    public const string ChatLocked = "CHAT_LOCKED";
    public const string CatalogUnavailable = "CATALOG_UNAVAILABLE";

    public static string ForStatus(int status) => status switch
    {
        StatusCodes.Status400BadRequest => Validation,
        StatusCodes.Status401Unauthorized => Unauthenticated,
        StatusCodes.Status403Forbidden => Forbidden,
        StatusCodes.Status404NotFound => NotFound,
        StatusCodes.Status409Conflict => Conflict,
        StatusCodes.Status429TooManyRequests => RateLimited,
        _ => Internal,
    };
}

public static class Problems
{
    public static IResult Create(int status, string title, string code) =>
        TypedResults.Problem(title: title, statusCode: status, extensions: new Dictionary<string, object?> { ["code"] = code });

    public static IResult Unauthorized(string title, string code = ErrorCodes.Unauthenticated) =>
        Create(StatusCodes.Status401Unauthorized, title, code);

    public static IResult Forbidden(string title, string code = ErrorCodes.Forbidden) =>
        Create(StatusCodes.Status403Forbidden, title, code);

    public static IResult NotFound(string resource) =>
        Create(StatusCodes.Status404NotFound, $"{resource} nao encontrado", ErrorCodes.NotFound);

    public static IResult AgentTimeout() =>
        Create(StatusCodes.Status504GatewayTimeout, "O agente nao respondeu a tempo", ErrorCodes.AgentTimeout);

    public static IResult BadRequest(string title) => Create(StatusCodes.Status400BadRequest, title, ErrorCodes.Validation);

    public static IResult Conflict(string title) => Create(StatusCodes.Status409Conflict, title, ErrorCodes.Conflict);

    public static IResult Validation(string field, params string[] messages) =>
        Validation(new Dictionary<string, string[]> { [field] = messages });

    public static IResult Validation(IDictionary<string, string[]> errors) =>
        TypedResults.ValidationProblem(errors, title: "Dados invalidos",
            extensions: new Dictionary<string, object?> { ["code"] = ErrorCodes.Validation });

    public static IResult FromIdentity(IdentityResult result, string passwordField = "password")
    {
        var errors = result.Errors.ToList();
        if (errors.Any(e => e.Code is "DuplicateUserName" or "DuplicateEmail" or "DuplicateRoleName"))
        {
            return Conflict(string.Join(" ", errors.Select(e => e.Description)));
        }

        var grouped = errors
            .GroupBy(e => e.Code switch
            {
                var c when c.StartsWith("Password", StringComparison.Ordinal) && c != "PasswordMismatch" => passwordField,
                "PasswordMismatch" => "currentPassword",
                var c when c.Contains("Email", StringComparison.Ordinal) => "email",
                var c when c.Contains("UserName", StringComparison.Ordinal) => "username",
                _ => "general",
            })
            .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray());
        return Validation(grouped);
    }
}
