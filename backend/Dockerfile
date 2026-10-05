# Interface do app de bandeja (eyes-tray), embutida no executavel do Windows.
FROM --platform=$BUILDPLATFORM node:22-alpine AS tray-ui
WORKDIR /ui
COPY --from=agent tray/frontend/package.json tray/frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --from=agent tray/frontend/ ./
RUN npm run build

# EYES (agente) para todas as plataformas e eyes-tray do Windows, a partir da pasta agent/ (contexto adicional "agent").
FROM --platform=$BUILDPLATFORM golang:1.26 AS eyes
WORKDIR /src
COPY --from=agent go.mod go.sum ./
RUN go mod download
COPY --from=agent tray/go.mod tray/go.sum ./tray/
RUN cd tray && go mod download
COPY --from=agent . .
COPY --from=tray-ui /ui/dist ./tray/frontend/dist
RUN ./build.sh /out

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
COPY --from=eyes /out ./agents
ENV ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_gcServer=0
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["dotnet", "Cybereyes.Api.dll", "--healthcheck-probe"]
ENTRYPOINT ["dotnet", "Cybereyes.Api.dll"]
