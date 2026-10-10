package postgres

// Executes Jet statements through pgx and provides PostgreSQL helpers
import (
	"context"
	"errors"

	"github.com/go-jet/jet/v2/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// jetStatement keeps query construction in Jet while retaining pgx's pool,
// transactions, error types, and efficient row scanning.
type jetStatement interface {
	Sql() (string, []interface{})
}

type jetExecutor interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func jetSQL(statement jetStatement) (string, []interface{}) {
	return statement.Sql()
}

func jetQuery(ctx context.Context, executor jetExecutor, statement jetStatement) (pgx.Rows, error) {
	query, args := jetSQL(statement)
	return executor.Query(ctx, query, args...)
}

func jetQueryRow(ctx context.Context, executor jetExecutor, statement jetStatement) pgx.Row {
	query, args := jetSQL(statement)
	return executor.QueryRow(ctx, query, args...)
}

func jetExec(ctx context.Context, executor jetExecutor, statement jetStatement) (pgconn.CommandTag, error) {
	query, args := jetSQL(statement)
	return executor.Exec(ctx, query, args...)
}

// notifyLigoActivity wakes conversation subscribers; ligoevents listens on the same channel
func notifyLigoActivity(ctx context.Context, executor jetExecutor, conversationID string) error {
	_, err := jetExec(ctx, executor, postgres.SELECT(postgres.RawString("pg_notify('ligo_activity', #conversation)", postgres.RawArgs{
		"#conversation": conversationID,
	})))
	return err
}

func jetAdvisoryLock(ctx context.Context, executor jetExecutor, expression postgres.Expression) error {
	_, err := jetExec(ctx, executor, postgres.SELECT(expression))
	return err
}

// uuidString gives Jet's UUID literal helper the fmt.Stringer it requires,
// preserving PostgreSQL's uuid parameter type instead of comparing uuid to text.
type uuidString string

func (value uuidString) String() string { return string(value) }

func jetUUID(value string) postgres.StringExpression {
	return postgres.UUID(uuidString(value))
}

func nullableUUID(value *string) postgres.Expression {
	if value == nil {
		return postgres.NULL
	}
	return jetUUID(*value)
}

func jetUUIDList(values []string) []postgres.Expression {
	result := make([]postgres.Expression, len(values))
	for index, value := range values {
		result[index] = jetUUID(value)
	}
	return result
}
