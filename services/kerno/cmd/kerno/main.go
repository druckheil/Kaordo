package main

import (
	"context"
	"errors"
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
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	dsn := os.Getenv("DATABASE_URL")
	issuer := os.Getenv("OIDC_ISSUER")
	audience := os.Getenv("OIDC_AUDIENCE")
	originList := os.Getenv("KAORDO_ALLOWED_ORIGINS")
	nodoInternalURL := os.Getenv("NODO_INTERNAL_URL")
	nodoPublicURL := os.Getenv("NODO_PUBLIC_URL")
	mediaKey, keyError := mediaauth.ParseKey(os.Getenv("NODO_MEDIA_SIGNING_KEY"))
	if dsn == "" || issuer == "" || audience == "" || originList == "" ||
		nodoInternalURL == "" || nodoPublicURL == "" || keyError != nil {
		return errors.New("DATABASE_URL, OIDC_ISSUER, OIDC_AUDIENCE, KAORDO_ALLOWED_ORIGINS, NODO_INTERNAL_URL, NODO_PUBLIC_URL and NODO_MEDIA_SIGNING_KEY are required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := postgres.Open(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	var usersTableExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.users') IS NOT NULL").Scan(&usersTableExists); err != nil {
		return err
	}
	if !usersTableExists {
		return errors.New("users table is missing; apply deploy/postgres/001_users.sql")
	}
	var postsTableExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.fluo_posts') IS NOT NULL").Scan(&postsTableExists); err != nil {
		return err
	}
	if !postsTableExists {
		return errors.New("Fluo tables are missing; apply deploy/postgres/002_fluo.sql")
	}
	var conversationsTableExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.ligo_conversations') IS NOT NULL").Scan(&conversationsTableExists); err != nil {
		return err
	}
	if !conversationsTableExists {
		return errors.New("Ligo tables are missing; apply deploy/postgres/007_ligo.sql")
	}
	var rondoTableExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.rondo_servers') IS NOT NULL").Scan(&rondoTableExists); err != nil {
		return err
	}
	if !rondoTableExists {
		return errors.New("Rondo tables are missing; apply deploy/postgres/010_rondo.sql")
	}
	var adminTableExists bool
	if err := pool.QueryRow(ctx, "SELECT to_regclass('public.admin_audit') IS NOT NULL").Scan(&adminTableExists); err != nil {
		return err
	}
	if !adminTableExists {
		return errors.New("Regado tables are missing; apply deploy/postgres/011_regado.sql")
	}

	provider, err := identity.NewProviderWithBackchannel(ctx, issuer, os.Getenv("OIDC_BACKCHANNEL_URL"))
	if err != nil {
		return err
	}
	verifier := provider.Verifier(&oidc.Config{ClientID: audience})
	verify := func(ctx context.Context, raw string) (identity.Claims, error) {
		return identity.Verify(ctx, verifier, raw)
	}

	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8081"
	}
	ligoStore := postgres.NewLigo(pool)
	ligoEvents := ligoevents.New(ctx, dsn, ligoStore)
	voiceURL := os.Getenv("LIVEKIT_URL")
	voicePublicURL := os.Getenv("LIVEKIT_PUBLIC_URL")
	voiceKey := os.Getenv("LIVEKIT_API_KEY")
	voiceSecret := os.Getenv("LIVEKIT_API_SECRET")
	var voice httpapi.RondoVoice
	if voiceURL != "" && voicePublicURL != "" && voiceKey != "" && voiceSecret != "" {
		voice = rondovoice.New(voiceURL, voiceKey, voiceSecret)
	}
	server := &http.Server{
		Addr: address,
		Handler: httpapi.NewRouterWithAdmin(verify, postgres.NewUsers(pool), httpapi.FluoDependencies{
			Store:        postgres.NewFluo(pool),
			Media:        httpapi.NodoClient{BaseURL: nodoInternalURL, InternalKey: mediaKey},
			MediaBaseURL: nodoPublicURL,
			MediaSignKey: mediaKey,
		}, httpapi.LigoDependencies{
			Store:        ligoStore,
			Events:       ligoEvents,
			Media:        httpapi.NodoClient{BaseURL: nodoInternalURL, InternalKey: mediaKey},
			MediaBaseURL: nodoPublicURL,
			MediaSignKey: mediaKey,
		}, httpapi.RondoDependencies{
			Store: postgres.NewRondo(pool), Voice: voice, VoiceURL: voicePublicURL,
		}, httpapi.AdminDependencies{
			Store:        postgres.NewAdmin(pool),
			System:       regado.NewSystemClient("/run/regado-agent/agent.sock"),
			Metrics:      regado.NewMetricsClient("http://127.0.0.1:9090"),
			MediaBaseURL: nodoPublicURL,
			MediaSignKey: mediaKey,
		}, strings.Split(originList, ",")),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("Kerno listening on %s", address)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
