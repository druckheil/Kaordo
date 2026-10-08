package postgres

// Stores application user records in PostgreSQL
import (
	"context"
	"errors"

	"github.com/druckheil/Kaordo/services/kerno/internal/account"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	"github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Users struct {
	pool *pgxpool.Pool
}

func NewUsers(pool *pgxpool.Pool) *Users {
	return &Users{pool: pool}
}

func scanUser(row pgx.Row) (account.User, error) {
	var user account.User
	err := row.Scan(
		&user.ID,
		&user.Username,
		&user.DisplayName,
		&user.CreatedAt,
		&user.IsAdmin,
		&user.DisabledAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return user, account.ErrNotFound
	}
	return user, err
}

func (store *Users) Upsert(ctx context.Context, subject, username, displayName string) (account.User, error) {
	query := table.Users.INSERT(table.Users.KeycloakSub, table.Users.Username, table.Users.DisplayName).
		VALUES(postgres.String(subject), postgres.String(username), postgres.String(displayName)).
		ON_CONFLICT(table.Users.KeycloakSub).
		DO_UPDATE(postgres.SET(
			table.Users.Username.SET(postgres.String(username)),
			table.Users.DisplayName.SET(postgres.String(displayName)),
			table.Users.UpdatedAt.SET(postgres.RawTimestampz("now()")),
		)).
		RETURNING(
			postgres.CAST(table.Users.ID).AS_TEXT(),
			table.Users.Username,
			table.Users.DisplayName,
			table.Users.CreatedAt,
			postgres.RawBool("EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = users.id AND r.role = 'admin')"),
			table.Users.DisabledAt,
		)
	return scanUser(jetQueryRow(ctx, store.pool, query))
}

func (store *Users) BySubject(ctx context.Context, subject string) (account.User, error) {
	users := table.Users.AS("u")
	query := postgres.SELECT(
		postgres.RawString("u.id::text"),
		users.Username,
		users.DisplayName,
		users.CreatedAt,
		postgres.RawBool("EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role = 'admin')"),
		users.DisabledAt,
	).FROM(users).WHERE(users.KeycloakSub.EQ(postgres.String(subject)))
	return scanUser(jetQueryRow(ctx, store.pool, query))
}
