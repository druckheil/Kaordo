// Command kerno serves the Kaordo application API and coordinates access to encrypted user content.
package main

// Loads and validates Kerno environment configuration
import (
	"fmt"
	"os"
	"strings"

	"github.com/druckheil/Kaordo/services/mediaauth"
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
	// NtfyToken authorizes publishing to protected ntfy topics; public topics need none
	NtfyToken string
	// DeployWorkflow is the GitHub workflow_ref whose push runs may deploy; empty disables deployments
	DeployWorkflow string
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
		NtfyToken:        os.Getenv("KAORDO_NTFY_TOKEN"),
		DeployWorkflow:   os.Getenv("KAORDO_DEPLOY_WORKFLOW"),
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
