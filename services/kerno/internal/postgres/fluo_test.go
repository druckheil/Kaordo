package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFluoPostFlow(t *testing.T) {
	dsn := os.Getenv("KAORDO_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set KAORDO_TEST_DATABASE_URL to an isolated migrated test database")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	users := NewUsers(pool)
	a, err := users.Upsert(ctx, "fluo-test-a", "writer", "Writer")
	if err != nil {
		t.Fatal(err)
	}
	b, err := users.Upsert(ctx, "fluo-test-b", "reader", "Reader")
	if err != nil {
		t.Fatal(err)
	}
	store := NewFluo(pool)
	content := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hello"}]}]}`)
	makePost := func(actorID, visibility string, parent, quote *string, media []fluo.Media) fluo.Post {
		t.Helper()
		post, err := store.Create(ctx, actorID, fluo.NewPost{
			Content: content, Visibility: visibility, ParentID: parent, QuoteID: quote,
		}, "hello", media)
		if err != nil {
			t.Fatal(err)
		}
		return post
	}
	public := makePost(a.ID, "public", nil, nil, nil)
	private := makePost(a.ID, "private", nil, nil, nil)
	if _, err := store.Get(ctx, b.ID, private.ID); !errors.Is(err, fluo.ErrNotFound) {
		t.Fatalf("private post leaked: %v", err)
	}
	latest, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "latest", Limit: 20})
	if err != nil || len(latest.Items) != 1 || latest.Items[0].ID != public.ID {
		t.Fatalf("public feed = %+v, %v", latest, err)
	}
	if err := store.Follow(ctx, b.ID, a.ID, true); err != nil {
		t.Fatal(err)
	}
	following, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "following", Limit: 20})
	if err != nil || len(following.Items) != 1 || !following.Items[0].Author.Following {
		t.Fatalf("following feed = %+v, %v", following, err)
	}
	good := "good"
	public, err = store.React(ctx, b.ID, public.ID, &good)
	if err != nil || public.Counts.Good != 1 || public.MyReaction == nil || *public.MyReaction != good {
		t.Fatalf("reaction = %+v, %v", public, err)
	}
	commentAttachment := fluo.Media{ID: "01999111-2222-7333-8444-555555555552", Kind: "image", MimeType: "image/png", Width: 4, Height: 4, Size: 50}
	comment := makePost(b.ID, "public", &public.ID, nil, []fluo.Media{commentAttachment})
	comments, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, ParentID: &public.ID, Feed: "latest", Limit: 20})
	if err != nil || len(comments.Items) != 1 || comments.Items[0].ID != comment.ID {
		t.Fatalf("comments = %+v, %v", comments, err)
	}
	if _, err := store.Create(ctx, b.ID, fluo.NewPost{Content: content, Visibility: "public", ParentID: &private.ID}, "hello", nil); !errors.Is(err, fluo.ErrInvalidRelation) {
		t.Fatalf("private comment was accepted: %v", err)
	}
	quote := makePost(b.ID, "public", nil, &public.ID, nil)
	if quote.Quote == nil || quote.Quote.ID != public.ID {
		t.Fatalf("quote preview = %+v", quote.Quote)
	}
	attachment := fluo.Media{ID: "01999111-2222-7333-8444-555555555551", Kind: "image", MimeType: "image/png", Width: 8, Height: 6, Size: 80}
	withMedia := makePost(a.ID, "public", nil, nil, []fluo.Media{attachment})
	referenced, err := store.MediaReferenced(ctx, attachment.ID)
	if err != nil || !referenced {
		t.Fatalf("media reference = %t, %v", referenced, err)
	}
	if _, err := store.Create(ctx, a.ID, fluo.NewPost{Content: content, Visibility: "public"}, "hello", []fluo.Media{attachment}); !errors.Is(err, fluo.ErrAlreadyClaimed) {
		t.Fatalf("media reused across posts: %v", err)
	}
	removedMedia, err := store.Delete(ctx, a.ID, withMedia.ID)
	if err != nil || len(removedMedia) != 1 || removedMedia[0] != attachment.ID {
		t.Fatalf("deleted media IDs = %v, %v", removedMedia, err)
	}
	referenced, err = store.MediaReferenced(ctx, attachment.ID)
	if err != nil || referenced {
		t.Fatalf("deleted media reference = %t, %v", referenced, err)
	}
	if _, err := store.Create(ctx, a.ID, fluo.NewPost{Content: content, Visibility: "public"}, "hello", []fluo.Media{attachment}); !errors.Is(err, fluo.ErrAlreadyClaimed) {
		t.Fatalf("deleted media was reused: %v", err)
	}
	page, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "latest", Limit: 1})
	if err != nil || len(page.Items) != 1 || page.NextCursor == nil {
		t.Fatalf("first page = %+v, %v", page, err)
	}
	cursor, err := fluo.DecodeCursor(*page.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "latest", Limit: 1, Cursor: cursor})
	if err != nil || len(second.Items) != 1 || second.Items[0].ID == page.Items[0].ID {
		t.Fatalf("second page = %+v, %v", second, err)
	}
	removedWithParent, err := store.Delete(ctx, a.ID, public.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(removedWithParent) != 1 || removedWithParent[0] != commentAttachment.ID {
		t.Fatalf("cascaded media IDs = %v", removedWithParent)
	}
	if _, err := store.Get(ctx, b.ID, comment.ID); !errors.Is(err, fluo.ErrNotFound) {
		t.Fatalf("deleted parent retained comment: %v", err)
	}
	remaining, err := store.Get(ctx, b.ID, quote.ID)
	if err != nil || remaining.QuoteID != nil || remaining.Quote != nil {
		t.Fatalf("deleted quote reference = %+v, %v", remaining, err)
	}
}
