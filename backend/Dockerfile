FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props .editorconfig Cybereyes.slnx ./
COPY src/Cybereyes.Core/Cybereyes.Core.csproj src/Cybereyes.Core/
COPY src/Cybereyes.Api/Cybereyes.Api.csproj src/Cybereyes.Api/
RUN dotnet restore src/Cybereyes.Api/Cybereyes.Api.csproj
COPY src/ src/
RUN dotnet publish src/Cybereyes.Api/Cybereyes.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["dotnet", "Cybereyes.Api.dll", "--healthcheck-probe"]
ENTRYPOINT ["dotnet", "Cybereyes.Api.dll"]
