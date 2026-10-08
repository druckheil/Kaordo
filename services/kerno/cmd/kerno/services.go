package main

// Wires Kerno adapters and domain services at the composition root
import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/druckheil/Kaordo/services/kerno/internal/httpapi"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligoevents"
	"github.com/druckheil/Kaordo/services/kerno/internal/nodoclient"
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

	router := httpapi.NewRouter(
		verify,
		postgres.NewUsers(pool),
		httpapi.Modules{
			Fluo:       fluoDependencies(cfg, pool, mediaClient),
			Ligo:       ligoDependencies(cfg, mediaClient, ligoStore, ligoEvents),
			Rondo:      rondoDependencies(cfg, pool, voice),
			Admin:      adminDependencies(cfg, pool),
			Encryption: httpapi.EncryptionDependencies{Store: postgres.NewEncryption(pool)},
			Vault:      httpapi.VaultDependencies{Store: postgres.NewVault(pool)},
			Memoro: httpapi.MemoroDependencies{Store: postgres.NewMemoro(pool), Media: mediaClient,
				MediaBaseURL: cfg.NodoPublicURL, MediaSignKey: cfg.MediaSigningKey},
		},
		cfg.AllowedOrigins,
	)
	return router, ligoEvents.Close
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
	return httpapi.AdminDependencies{
		Store:       postgres.NewAdmin(pool),
		System:      regado.NewSystemClient(regadoAgentSocket),
		Metrics:     regado.NewMetricsClient(metricsEndpoint),
		Maintenance: nodoclient.Client{BaseURL: cfg.NodoInternalURL, InternalKey: cfg.MediaSigningKey},
	}
}

func newRondoVoice(cfg config) httpapi.RondoVoice {
	if cfg.LiveKitURL == "" || cfg.LiveKitPublicURL == "" || cfg.LiveKitAPIKey == "" || cfg.LiveKitAPISecret == "" {
		return nil
	}
	return rondovoice.New(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
}
