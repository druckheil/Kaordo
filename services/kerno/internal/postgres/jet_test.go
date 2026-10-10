package postgres

// Fails when the generated Jet tables drift from the migrated schema; KAORDO_UPDATE_JET=1 regenerates them
import (
	"maps"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/go-jet/jet/v2/generator/metadata"
	jetgen "github.com/go-jet/jet/v2/generator/postgres"
	"github.com/go-jet/jet/v2/generator/template"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

const jetTablesDir = "jetdb/table"

func TestJetTablesMatchSchema(t *testing.T) {
	testDatabase(t)
	output := t.TempDir()
	tablesOnly := template.Default(jetpg.Dialect).UseSchema(func(schema metadata.Schema) template.Schema {
		return template.DefaultSchema(schema).
			UseModel(template.DefaultModel().ShouldSkip(true)).
			UseSQLBuilder(template.DefaultSQLBuilder().UseTable(func(table metadata.Table) template.TableSQLBuilder {
				if table.Name == "goose_db_version" {
					return template.TableSQLBuilder{Skip: true}
				}
				return template.DefaultTableSQLBuilder(table)
			}))
	})
	if err := jetgen.GenerateDSN(os.Getenv("KAORDO_TEST_DATABASE_URL"), "public", output, tablesOnly); err != nil {
		t.Fatal(err)
	}
	// Jet writes into <output>/<database>/<schema>/table
	matches, err := filepath.Glob(filepath.Join(output, "*", "public", "table"))
	if err != nil || len(matches) != 1 {
		t.Fatalf("generated table directory = %v, %v", matches, err)
	}
	generated := readDir(t, matches[0])

	if os.Getenv("KAORDO_UPDATE_JET") == "1" {
		if err := os.RemoveAll(jetTablesDir); err != nil {
			t.Fatal(err)
		}
		if err := os.CopyFS(jetTablesDir, os.DirFS(matches[0])); err != nil {
			t.Fatal(err)
		}
		return
	}
	committed := readDir(t, jetTablesDir)
	if !slices.Equal(slices.Sorted(maps.Keys(generated)), slices.Sorted(maps.Keys(committed))) {
		t.Fatalf("Jet tables differ from the schema: generated %v, committed %v; run with KAORDO_UPDATE_JET=1",
			slices.Sorted(maps.Keys(generated)), slices.Sorted(maps.Keys(committed)))
	}
	for name, content := range generated {
		if committed[name] != content {
			t.Errorf("%s differs from the schema; run with KAORDO_UPDATE_JET=1", name)
		}
	}
}

func readDir(t *testing.T, dir string) map[string]string {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	files := make(map[string]string, len(entries))
	for _, entry := range entries {
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		files[entry.Name()] = string(content)
	}
	return files
}
