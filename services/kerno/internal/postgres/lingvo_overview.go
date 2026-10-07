package postgres

// Aggregates dictionary progress and local-day activity and manages personal folders
import (
	"context"
	"time"

	"github.com/druckheil/Kaordo/services/kerno/internal/lingvo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
	jetpg "github.com/go-jet/jet/v2/postgres"
)

func (s *Lingvo) Overview(ctx context.Context, actorID, dictionaryID string) (lingvo.Overview, error) {
	d, err := getLingvoDictionary(ctx, s.pool, actorID, dictionaryID, false)
	if err != nil {
		return lingvo.Overview{}, err
	}
	view := lingvo.Overview{Dictionary: d, Counts: make([]lingvo.Counts, 0, 2), Folders: make([]lingvo.Folder, 0), Activity: make([]lingvo.Activity, 0)}
	c := table.LingvoCards
	now := time.Now().UTC()
	rows, err := jetQuery(ctx, s.pool, c.SELECT(c.Kind, jetpg.COUNT(c.ID),
		jetpg.RawInt("count(*) FILTER (WHERE status = 'active' AND due_at <= #now)", jetpg.RawArgs{"#now": now}),
		jetpg.RawInt("count(*) FILTER (WHERE status = 'active' AND schedule->>'state' = '0')"),
		jetpg.RawInt("count(*) FILTER (WHERE status = 'active' AND schedule->>'state' IN ('1', '3'))"),
		jetpg.RawInt("count(*) FILTER (WHERE status = 'active' AND schedule->>'state' = '2')"),
		jetpg.RawInt("count(*) FILTER (WHERE status = 'known')"),
		jetpg.RawInt("count(*) FILTER (WHERE status = 'suspended')"),
		jetpg.RawTimestampz("min(due_at) FILTER (WHERE status = 'active' AND due_at > #now)", jetpg.RawArgs{"#now": now})).
		WHERE(c.DictionaryID.EQ(jetUUID(dictionaryID))).GROUP_BY(c.Kind))
	if err != nil {
		return view, err
	}
	for rows.Next() {
		var counts lingvo.Counts
		if err := rows.Scan(&counts.Kind, &counts.Total, &counts.Due, &counts.New, &counts.Learning, &counts.Review, &counts.Known, &counts.Suspended, &counts.NextDue); err != nil {
			rows.Close()
			return view, err
		}
		view.Counts = append(view.Counts, counts)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return view, err
	}
	view.Folders, err = s.lingvoFolders(ctx, dictionaryID)
	if err != nil {
		return view, err
	}
	return view, s.lingvoActivity(ctx, &view, now)
}

func (s *Lingvo) lingvoActivity(ctx context.Context, view *lingvo.Overview, now time.Time) error {
	r := table.LingvoReviews
	day := jetpg.RawString("to_char(reviewed_at AT TIME ZONE #zone, 'YYYY-MM-DD')", jetpg.RawArgs{"#zone": view.Dictionary.TimeZone})
	// The projected alias keeps Jet from binding the time zone separately in GROUP BY
	dayColumn := jetpg.StringColumn("review_day")
	rows, err := jetQuery(ctx, s.pool, r.SELECT(day.AS("review_day"), jetpg.COUNT(r.ID)).
		WHERE(jetpg.AND(r.DictionaryID.EQ(jetUUID(view.Dictionary.ID)), r.UndoneAt.IS_NULL())).
		GROUP_BY(dayColumn).ORDER_BY(dayColumn.DESC()))
	if err != nil {
		return err
	}
	defer rows.Close()
	location, err := time.LoadLocation(view.Dictionary.TimeZone)
	if err != nil {
		return err
	}
	local := now.In(location)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, location)
	view.Today = today.Format(time.DateOnly)
	expected := today
	first := true
	continuing := true
	for rows.Next() {
		var activity lingvo.Activity
		if err := rows.Scan(&activity.Day, &activity.Reviews); err != nil {
			return err
		}
		view.TotalReviews += activity.Reviews
		if activity.Day == today.Format(time.DateOnly) {
			view.StudiedToday = activity.Reviews
		}
		if activity.Day >= today.AddDate(0, 0, -13).Format(time.DateOnly) {
			view.Activity = append(view.Activity, activity)
		}
		if first && activity.Day != expected.Format(time.DateOnly) {
			expected = expected.AddDate(0, 0, -1)
		}
		first = false
		if continuing && activity.Day == expected.Format(time.DateOnly) {
			view.Streak++
			expected = expected.AddDate(0, 0, -1)
		} else {
			continuing = false
		}
	}
	return rows.Err()
}

func (s *Lingvo) lingvoFolders(ctx context.Context, dictionaryID string) ([]lingvo.Folder, error) {
	f := table.LingvoFolders
	rows, err := jetQuery(ctx, s.pool, f.SELECT(f.ID, f.DictionaryID, f.Name).
		WHERE(f.DictionaryID.EQ(jetUUID(dictionaryID))).ORDER_BY(f.Name.ASC(), f.ID.ASC()))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	folders := make([]lingvo.Folder, 0)
	for rows.Next() {
		var folder lingvo.Folder
		if err := rows.Scan(&folder.ID, &folder.DictionaryID, &folder.Name); err != nil {
			return nil, err
		}
		folders = append(folders, folder)
	}
	return folders, rows.Err()
}

func (s *Lingvo) CreateFolder(ctx context.Context, actorID, dictionaryID, name string) (lingvo.Folder, error) {
	if !lingvo.ValidText(name, 1, 60) {
		return lingvo.Folder{}, lingvo.ErrInvalid
	}
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return lingvo.Folder{}, err
	}
	defer tx.Rollback(ctx)
	f := table.LingvoFolders
	var count int
	if err := jetQueryRow(ctx, tx, f.SELECT(jetpg.COUNT(f.ID)).WHERE(f.DictionaryID.EQ(jetUUID(dictionaryID)))).Scan(&count); err != nil {
		return lingvo.Folder{}, err
	}
	if count >= 100 {
		return lingvo.Folder{}, lingvo.ErrLimit
	}
	var folder lingvo.Folder
	err = jetQueryRow(ctx, tx, f.INSERT(f.DictionaryID, f.Name).VALUES(jetUUID(dictionaryID), name).
		RETURNING(f.ID, f.DictionaryID, f.Name)).Scan(&folder.ID, &folder.DictionaryID, &folder.Name)
	if isUniqueViolation(err) {
		return folder, lingvo.ErrExists
	}
	if err != nil {
		return folder, err
	}
	return folder, tx.Commit(ctx)
}

func (s *Lingvo) DeleteFolder(ctx context.Context, actorID, dictionaryID, folderID string) error {
	tx, _, err := s.beginDictionary(ctx, actorID, dictionaryID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := checkLingvoFolder(ctx, tx, dictionaryID, &folderID); err != nil {
		return err
	}
	c, f := table.LingvoCards, table.LingvoFolders
	if _, err := jetExec(ctx, tx, c.UPDATE(c.FolderID, c.Revision, c.UpdatedAt).SET(jetpg.NULL, c.Revision.ADD(jetpg.Int(1)), time.Now().UTC()).
		WHERE(jetpg.AND(c.DictionaryID.EQ(jetUUID(dictionaryID)), c.FolderID.EQ(jetUUID(folderID))))); err != nil {
		return err
	}
	if _, err := jetExec(ctx, tx, f.DELETE().WHERE(jetpg.AND(f.DictionaryID.EQ(jetUUID(dictionaryID)), f.ID.EQ(jetUUID(folderID))))); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
