package httpapi

// Composes configured feature routes with shared browser origin policy
import (
	"net/http"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/go-chi/chi/v5"
)

type Modules struct {
	Fluo   FluoDependencies
	Ligo   LigoDependencies
	Rondo  RondoDependencies
	Admin  AdminDependencies
	Lingvo LingvoDependencies
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
	if modules.Lingvo.Store != nil {
		mountLingvo(router, verify, users, modules.Lingvo)
	}
	return router
}
