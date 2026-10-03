package postgres

// Escapes user search text for SQL LIKE patterns
import "strings"

func escapeLikeLiteral(value string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(value)
}
