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
	if dsn == "" || issuer == "" || audience == "" || originList == "" {
		return errors.New("DATABASE_URL, OIDC_ISSUER, OIDC_AUDIENCE and KAORDO_ALLOWED_ORIGINS are required")
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
		Addr:              address,
		Handler:           httpapi.NewRouter(verify, postgres.NewUsers(pool), strings.Split(originList, ",")),
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
