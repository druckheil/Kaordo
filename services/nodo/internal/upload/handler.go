package upload

import (
	"github.com/tus/tusd/v2/pkg/filelocker"
	"github.com/tus/tusd/v2/pkg/filestore"
	tusd "github.com/tus/tusd/v2/pkg/handler"
)

// NewHandler prepares a local tus upload handler for a configured directory.
// Authorization, quotas, encryption and file publication are wired in later scopes.
func NewHandler(directory string) (*tusd.Handler, error) {
	composer := tusd.NewStoreComposer()
	filestore.New(directory).UseIn(composer)
	filelocker.New(directory).UseIn(composer)
	return tusd.NewHandler(tusd.Config{BasePath: "/v1/uploads/", StoreComposer: composer})
}
