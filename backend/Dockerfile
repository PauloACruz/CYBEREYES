FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props .editorconfig WinCare.slnx ./
COPY src/WinCare.Core/WinCare.Core.csproj src/WinCare.Core/
COPY src/WinCare.Api/WinCare.Api.csproj src/WinCare.Api/
RUN dotnet restore src/WinCare.Api/WinCare.Api.csproj
COPY src/ src/
RUN dotnet publish src/WinCare.Api/WinCare.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["dotnet", "WinCare.Api.dll", "--healthcheck-probe"]
ENTRYPOINT ["dotnet", "WinCare.Api.dll"]
