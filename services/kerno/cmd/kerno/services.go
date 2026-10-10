package main

// Wires Kerno adapters and domain services at the composition root
import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/druckheil/Kaordo/services/kerno/internal/admin"
	"github.com/druckheil/Kaordo/services/kerno/internal/httpapi"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligoevents"
	"github.com/druckheil/Kaordo/services/kerno/internal/nodoclient"
	"github.com/druckheil/Kaordo/services/kerno/internal/ntfy"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/kerno/internal/regado"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondovoice"
	"github.com/jackc/pgx/v5/pgxpool"
)

type tokenVerifier = httpapi.VerifyFunc

func newTokenVerifier(ctx context.Context, cfg config) (tokenVerifier, error) {
	provider, err := identity.NewProviderWithBackchannel(ctx, cfg.OIDCIssuer, cfg.OIDCBackchannel)
	if err != nil {
		return nil, fmt.Errorf("initialize OIDC provider: %w", err)
	}

	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.OIDCAudience})
	return func(ctx context.Context, raw string) (identity.Claims, error) {
		return identity.Verify(ctx, verifier, raw)
	}, nil
}

func newHTTPServer(ctx context.Context, cfg config, pool *pgxpool.Pool, verify tokenVerifier) (*http.Server, func()) {
	router, closeDependencies := newHTTPRouter(ctx, cfg, pool, verify)
	return &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}, closeDependencies
}

func newHTTPRouter(ctx context.Context, cfg config, pool *pgxpool.Pool, verify tokenVerifier) (http.Handler, func()) {
	ligoStore := postgres.NewLigo(pool)
	ligoEvents := ligoevents.New(ctx, cfg.DatabaseURL, ligoStore)
	mediaClient := nodoclient.Client{BaseURL: cfg.NodoInternalURL, InternalKey: cfg.MediaSigningKey}
	voice := newRondoVoice(cfg)
	admins := adminDependencies(cfg, pool)

	// Alert delivery writes notices through the pool, so it stops before the pool closes
	deliveryCtx, stopDelivery := context.WithCancel(ctx)
	var workers sync.WaitGroup
	workers.Go(func() { admins.Alerts.Run(deliveryCtx, alertInterval) })

	router := httpapi.NewRouter(
		verify,
		postgres.NewUsers(pool),
		httpapi.Modules{
			Fluo:       fluoDependencies(cfg, pool, mediaClient),
			Ligo:       ligoDependencies(cfg, mediaClient, ligoStore, ligoEvents),
			Rondo:      rondoDependencies(cfg, pool, voice),
			Admin:      admins,
			Encryption: httpapi.EncryptionDependencies{Store: postgres.NewEncryption(pool)},
			Vault:      httpapi.VaultDependencies{Store: postgres.NewVault(pool)},
			Memoro: httpapi.MemoroDependencies{Store: postgres.NewMemoro(pool), Media: mediaClient,
				MediaBaseURL: cfg.NodoPublicURL, MediaSignKey: cfg.MediaSigningKey},
			Deployments: deploymentDependencies(ctx, cfg, admins.Hosts),
		},
		cfg.AllowedOrigins,
	)
	return router, func() {
		stopDelivery()
		workers.Wait()
		ligoEvents.Close()
	}
}

func fluoDependencies(cfg config, pool *pgxpool.Pool, media nodoclient.Client) httpapi.FluoDependencies {
	store := postgres.NewFluo(pool)
	return httpapi.FluoDependencies{
		Store:         store,
		Notifications: store,
		Settings:      store,
		Profiles:      store,
		Media:         media,
		MediaBaseURL:  cfg.NodoPublicURL,
		MediaSignKey:  cfg.MediaSigningKey,
	}
}

func ligoDependencies(cfg config, media nodoclient.Client, store *postgres.Ligo, events *ligoevents.Hub) httpapi.LigoDependencies {
	return httpapi.LigoDependencies{
		Store:        store,
		Events:       events,
		Media:        media,
		MediaBaseURL: cfg.NodoPublicURL,
		MediaSignKey: cfg.MediaSigningKey,
	}
}

func rondoDependencies(cfg config, pool *pgxpool.Pool, voice httpapi.RondoVoice) httpapi.RondoDependencies {
	return httpapi.RondoDependencies{
		Store:    postgres.NewRondo(pool),
		Voice:    voice,
		VoiceURL: cfg.LiveKitPublicURL,
	}
}

func adminDependencies(cfg config, pool *pgxpool.Pool) httpapi.AdminDependencies {
	store := postgres.NewAdmin(pool)
	agent := regado.NewSystemClient(regadoAgentSocket)
	// The local agent is the first host; remote agents join this registry
	hosts := admin.NewHosts(map[string]admin.HostAgent{"local": agent}, store)
	push := ntfy.Client{Token: cfg.NtfyToken, Link: cfg.AllowedOrigins[0] + "/regado/?view=storage"}
	return httpapi.AdminDependencies{
		Store:   store,
		System:  agent,
		Metrics: regado.NewMetricsClient(metricsEndpoint),
		Media:   nodoclient.Client{BaseURL: cfg.NodoInternalURL, InternalKey: cfg.MediaSigningKey},
		Hosts:   hosts,
		Alerts:  admin.NewAlertDelivery(hosts, store, push, time.Now),
	}
}

// GitHub Actions tokens are issued for Kerno's public origin, the first allowed origin
func deploymentDependencies(ctx context.Context, cfg config, hosts *admin.Hosts) httpapi.DeploymentDependencies {
	if cfg.DeployWorkflow == "" || len(cfg.AllowedOrigins) == 0 {
		return httpapi.DeploymentDependencies{}
	}
	return httpapi.DeploymentDependencies{
		Verify: identity.NewGitHubVerifier(ctx, cfg.AllowedOrigins[0], cfg.DeployWorkflow),
		Hosts:  hosts,
	}
}

func newRondoVoice(cfg config) httpapi.RondoVoice {
	if cfg.LiveKitURL == "" || cfg.LiveKitPublicURL == "" || cfg.LiveKitAPIKey == "" || cfg.LiveKitAPISecret == "" {
		return nil
	}
	return rondovoice.New(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
}
