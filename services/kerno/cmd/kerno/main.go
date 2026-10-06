package main

// Starts Kerno by loading configuration, connecting dependencies, and serving HTTP
import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/druckheil/Kaordo/services/kerno/internal/httpapi"
	"github.com/druckheil/Kaordo/services/kerno/internal/identity"
	"github.com/druckheil/Kaordo/services/kerno/internal/ligoevents"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
	"github.com/druckheil/Kaordo/services/kerno/internal/regado"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondovoice"
	"github.com/druckheil/Kaordo/services/mediaauth"
	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

type config struct {
	DatabaseURL      string
	OIDCIssuer       string
	OIDCAudience     string
	OIDCBackchannel  string
	AllowedOrigins   []string
	NodoInternalURL  string
	NodoPublicURL    string
	MediaSigningKey  []byte
	ListenAddress    string
	LiveKitURL       string
	LiveKitPublicURL string
	LiveKitAPIKey    string
	LiveKitAPISecret string
}

type tokenVerifier = httpapi.VerifyFunc

type requiredRelation struct {
	name      string
	missing   string
	migration string
}

var schemaRequirements = []requiredRelation{
	{name: "users", missing: "users table is missing", migration: "deploy/postgres/001_users.sql"},
	{name: "fluo_posts", missing: "Fluo tables are missing", migration: "deploy/postgres/002_fluo.sql"},
	{name: "fluo_notifications", missing: "Fluo notifications table is missing", migration: "deploy/postgres/014_fluo_notifications.sql"},
	{name: "fluo_notifications_event_lookup_idx", missing: "Fluo notification cooldown index is missing", migration: "deploy/postgres/014_fluo_notifications.sql"},
	{name: "ligo_conversations", missing: "Ligo tables are missing", migration: "deploy/postgres/007_ligo.sql"},
	{name: "rondo_servers", missing: "Rondo tables are missing", migration: "deploy/postgres/010_rondo.sql"},
	{name: "admin_audit", missing: "Regado tables are missing", migration: "deploy/postgres/011_regado.sql"},
}

const (
	regadoAgentSocket = "/run/regado-agent/agent.sock"
	metricsEndpoint   = "http://127.0.0.1:9090"
	shutdownTimeout   = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg, err := loadConfig()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := verifySchema(ctx, pool); err != nil {
		return err
	}

	verify, err := newTokenVerifier(ctx, cfg)
	if err != nil {
		return err
	}

	server := newHTTPServer(ctx, cfg, pool, verify)
	return serve(ctx, server)
}

func loadConfig() (config, error) {
	cfg := readConfig()
	if missing := missingConfigValues(cfg); len(missing) > 0 {
		return config{}, fmt.Errorf("required environment variables are missing: %s", strings.Join(missing, ", "))
	}
	mediaKey, err := mediaauth.ParseKey(os.Getenv("NODO_MEDIA_SIGNING_KEY"))
	if err != nil {
		return config{}, fmt.Errorf("invalid NODO_MEDIA_SIGNING_KEY: %w", err)
	}
	cfg.MediaSigningKey = mediaKey
	return cfg, nil
}

func readConfig() config {
	return config{
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		OIDCIssuer:       os.Getenv("OIDC_ISSUER"),
		OIDCAudience:     os.Getenv("OIDC_AUDIENCE"),
		OIDCBackchannel:  os.Getenv("OIDC_BACKCHANNEL_URL"),
		NodoInternalURL:  os.Getenv("NODO_INTERNAL_URL"),
		NodoPublicURL:    os.Getenv("NODO_PUBLIC_URL"),
		ListenAddress:    envOrDefault("LISTEN_ADDR", "127.0.0.1:8081"),
		LiveKitURL:       os.Getenv("LIVEKIT_URL"),
		LiveKitPublicURL: os.Getenv("LIVEKIT_PUBLIC_URL"),
		LiveKitAPIKey:    os.Getenv("LIVEKIT_API_KEY"),
		LiveKitAPISecret: os.Getenv("LIVEKIT_API_SECRET"),
		AllowedOrigins:   splitOrigins(os.Getenv("KAORDO_ALLOWED_ORIGINS")),
	}
}

func missingConfigValues(cfg config) []string {
	var missing []string
	for _, variable := range []struct{ name, value string }{
		{"DATABASE_URL", cfg.DatabaseURL},
		{"OIDC_ISSUER", cfg.OIDCIssuer},
		{"OIDC_AUDIENCE", cfg.OIDCAudience},
		{"NODO_INTERNAL_URL", cfg.NodoInternalURL},
		{"NODO_PUBLIC_URL", cfg.NodoPublicURL},
	} {
		if variable.value == "" {
			missing = append(missing, variable.name)
		}
	}
	if len(cfg.AllowedOrigins) == 0 {
		missing = append(missing, "KAORDO_ALLOWED_ORIGINS")
	}
	return missing
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func splitOrigins(raw string) []string {
	var origins []string
	for _, origin := range strings.Split(raw, ",") {
		if origin = strings.TrimSpace(origin); origin != "" {
			origins = append(origins, origin)
		}
	}
	return origins
}

func verifySchema(ctx context.Context, pool *pgxpool.Pool) error {
	for _, requirement := range schemaRequirements {
		if err := verifyRequiredRelation(ctx, pool, requirement); err != nil {
			return err
		}
	}
	return nil
}

func verifyRequiredRelation(ctx context.Context, pool *pgxpool.Pool, requirement requiredRelation) error {
	var exists bool
	query := jetpg.SELECT(jetpg.RawBool("to_regclass(#relation_name) IS NOT NULL",
		jetpg.RawArgs{"#relation_name": "public." + requirement.name}))
	if err := postgres.JetQueryRow(ctx, pool, query).Scan(&exists); err != nil {
		return fmt.Errorf("check schema relation %q: %w", requirement.name, err)
	}
	if !exists {
		return fmt.Errorf("%s; apply %s", requirement.missing, requirement.migration)
	}
	return nil
}

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

func newHTTPServer(ctx context.Context, cfg config, pool *pgxpool.Pool, verify tokenVerifier) *http.Server {
	return &http.Server{
		Addr:              cfg.ListenAddress,
		Handler:           newHTTPRouter(ctx, cfg, pool, verify),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
}

func newHTTPRouter(ctx context.Context, cfg config, pool *pgxpool.Pool, verify tokenVerifier) http.Handler {
	ligoStore := postgres.NewLigo(pool)
	ligoEvents := ligoevents.New(ctx, cfg.DatabaseURL, ligoStore)
	mediaClient := httpapi.NodoClient{BaseURL: cfg.NodoInternalURL, InternalKey: cfg.MediaSigningKey}
	voice := newRondoVoice(cfg)

	router := httpapi.NewRouterWithAdmin(
		verify,
		postgres.NewUsers(pool),
		fluoDependencies(cfg, pool, mediaClient),
		ligoDependencies(cfg, mediaClient, ligoStore, ligoEvents),
		rondoDependencies(cfg, pool, voice),
		adminDependencies(cfg, pool),
		cfg.AllowedOrigins,
	)
	return router
}

func fluoDependencies(cfg config, pool *pgxpool.Pool, media httpapi.NodoClient) httpapi.FluoDependencies {
	store := postgres.NewFluo(pool)
	return httpapi.FluoDependencies{
		Store:         store,
		Notifications: store,
		Media:         media,
		MediaBaseURL:  cfg.NodoPublicURL,
		MediaSignKey:  cfg.MediaSigningKey,
	}
}

func ligoDependencies(cfg config, media httpapi.NodoClient, store *postgres.Ligo, events *ligoevents.Hub) httpapi.LigoDependencies {
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
		Store:        postgres.NewAdmin(pool),
		System:       regado.NewSystemClient(regadoAgentSocket),
		Metrics:      regado.NewMetricsClient(metricsEndpoint),
		Maintenance:  httpapi.NodoClient{BaseURL: cfg.NodoInternalURL, InternalKey: cfg.MediaSigningKey},
		MediaBaseURL: cfg.NodoPublicURL,
		MediaSignKey: cfg.MediaSigningKey,
	}
}

func newRondoVoice(cfg config) httpapi.RondoVoice {
	if cfg.LiveKitURL == "" || cfg.LiveKitPublicURL == "" || cfg.LiveKitAPIKey == "" || cfg.LiveKitAPISecret == "" {
		return nil
	}
	return rondovoice.New(cfg.LiveKitURL, cfg.LiveKitAPIKey, cfg.LiveKitAPISecret)
}

func serve(ctx context.Context, server *http.Server) error {
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	log.Printf("Kerno listening on %s", server.Addr)

	select {
	case err := <-result:
		return serveError(err)
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return err
		}
		return serveError(<-result)
	}
}

func serveError(err error) error {
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
