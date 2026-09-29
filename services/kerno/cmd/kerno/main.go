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
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres"
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

	provider, err := identity.NewProvider(ctx, issuer)
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
	server := &http.Server{
		Addr: address,
		Handler: httpapi.NewRouterWithFluo(verify, postgres.NewUsers(pool), httpapi.FluoDependencies{
			Store:        postgres.NewFluo(pool),
			Media:        httpapi.NodoClient{BaseURL: nodoInternalURL, InternalKey: mediaKey},
			MediaBaseURL: nodoPublicURL,
			MediaSignKey: mediaKey,
		}, strings.Split(originList, ",")),
		ReadHeaderTimeout: 5 * time.Second,
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
