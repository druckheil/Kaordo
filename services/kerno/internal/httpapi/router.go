package httpapi

// Composes configured feature routes with shared browser origin policy
import (
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/go-chi/chi/v5"
)

type Modules struct {
	Vault      VaultDependencies
	Fluo       FluoDependencies
	Ligo       LigoDependencies
	Rondo      RondoDependencies
	Admin      AdminDependencies
	Encryption EncryptionDependencies
	Memoro     MemoroDependencies
}

func NewRouter(verify VerifyFunc, users account.Store, modules Modules, allowedOrigins []string) http.Handler {
	social, messaging, communities, admin := modules.Fluo, modules.Ligo, modules.Rondo, modules.Admin
	router := chi.NewRouter()
	router.Use(corsMiddleware(allowedOrigins))
	mountAccountRoutes(router, verify, users)
	if social.Store != nil {
		mountFluo(router, verify, users, social)
	}
	if messaging.Store != nil {
		mountLigo(router, verify, users, messaging)
	}
	if communities.Store != nil {
		mountRondo(router, verify, users, communities)
	}
	if admin.Store != nil {
		mountAdmin(router, verify, users, admin)
	}
	mountLingvo(router, verify, users)
	if modules.Encryption.Store != nil {
		mountEncryption(router, verify, users, modules.Encryption)
	}
	if modules.Vault.Store != nil {
		mountVault(router, verify, users, modules.Vault)
	}
	if modules.Memoro.Store != nil {
		mountMemoro(router, verify, users, modules.Memoro)
	}
	return router
}
