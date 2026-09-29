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

	"github.com/druckheil/Kaordo/services/mediaauth"
	"github.com/druckheil/Kaordo/services/nodo/internal/upload"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	directory := os.Getenv("NODO_DATA_DIR")
	kernoURL := os.Getenv("KERNO_INTERNAL_URL")
	origins := os.Getenv("NODO_ALLOWED_ORIGINS")
	key, err := mediaauth.ParseKey(os.Getenv("NODO_MEDIA_SIGNING_KEY"))
	if directory == "" || kernoURL == "" || origins == "" || err != nil {
		return errors.New("NODO_DATA_DIR, KERNO_INTERNAL_URL, NODO_ALLOWED_ORIGINS and NODO_MEDIA_SIGNING_KEY are required")
	}
	handler, err := upload.NewHandler(upload.Config{
		Directory: directory, KernoURL: kernoURL, AllowedOrigins: strings.Split(origins, ","), MediaKey: key,
	})
	if err != nil {
		return err
	}
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8082"
	}
	server := &http.Server{
		Addr: address, Handler: handler, ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("Nodo listening on %s", address)
	err = server.ListenAndServe()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
