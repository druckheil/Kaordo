package postgres

// Verifies the installed schema before starting application dependencies
import (
	"context"
	"fmt"

	jetpg "github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

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
	{name: "fluo_settings", missing: "Fluo settings table is missing", migration: "deploy/postgres/015_fluo_settings.sql"},
	{name: "fluo_profiles", missing: "Fluo profiles table is missing", migration: "deploy/postgres/018_fluo_profiles.sql"},
	{name: "fluo_profile_images", missing: "Fluo profile images table is missing", migration: "deploy/postgres/018_fluo_profiles.sql"},
	{name: "users_username_unique_idx", missing: "Unique account usernames are not installed", migration: "deploy/postgres/018_fluo_profiles.sql"},
	{name: "ligo_conversations", missing: "Ligo tables are missing", migration: "deploy/postgres/007_ligo.sql"},
	{name: "rondo_servers", missing: "Rondo tables are missing", migration: "deploy/postgres/010_rondo.sql"},
	{name: "lingvo_dictionaries", missing: "Lingvo tables are missing", migration: "deploy/postgres/016_lingvo.sql"},
	{name: "lingvo_cards_due_idx", missing: "Lingvo review queue index is missing", migration: "deploy/postgres/016_lingvo.sql"},
	{name: "admin_audit", missing: "Regado tables are missing", migration: "deploy/postgres/011_regado.sql"},
}

func VerifySchema(ctx context.Context, pool *pgxpool.Pool) error {
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
	if err := jetQueryRow(ctx, pool, query).Scan(&exists); err != nil {
		return fmt.Errorf("check schema relation %q: %w", requirement.name, err)
	}
	if !exists {
		return fmt.Errorf("%s; apply %s", requirement.missing, requirement.migration)
	}
	return nil
}
