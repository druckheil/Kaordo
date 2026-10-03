package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/druckheil/Kaordo/services/kerno/internal/fluo"
	"github.com/druckheil/Kaordo/services/kerno/internal/postgres/jetdb/table"
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
	for _, query := range []string{"hello", "HELLO", " HeLlO "} {
		search, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "latest", Search: query, Limit: 20})
		if err != nil || len(search.Items) != 1 || search.Items[0].ID != public.ID {
			t.Fatalf("search %q missed the public post or exposed private data: %+v, %v", query, search, err)
		}
	}
	if err := store.SetSaved(ctx, b.ID, public.ID, true); err != nil {
		t.Fatal(err)
	}
	saved, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "saved", Limit: 20})
	if err != nil || len(saved.Items) != 1 || saved.Items[0].ID != public.ID || !saved.Items[0].Saved {
		t.Fatalf("saved list = %+v, %v", saved, err)
	}
	privateSaved, err := store.List(ctx, fluo.ListOptions{ViewerID: a.ID, Feed: "saved", Limit: 20})
	if err != nil || len(privateSaved.Items) != 0 {
		t.Fatalf("saved list leaked to another user: %+v, %v", privateSaved, err)
	}
	if err := store.SetSaved(ctx, b.ID, public.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := store.SetSaved(ctx, b.ID, private.ID, true); !errors.Is(err, fluo.ErrNotFound) {
		t.Fatalf("private post was saved by another user: %v", err)
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
	mediaQuote := makePost(b.ID, "public", nil, &withMedia.ID, nil)
	if mediaQuote.Quote == nil || len(mediaQuote.Quote.Media) != 1 || mediaQuote.Quote.Media[0].ID != attachment.ID {
		t.Fatalf("quote omitted original media: %+v", mediaQuote.Quote)
	}
	reusedMedia := makePost(a.ID, "public", nil, nil, []fluo.Media{attachment})
	if len(reusedMedia.Media) != 1 || reusedMedia.Media[0].ID != attachment.ID {
		t.Fatalf("reused post media = %+v", reusedMedia.Media)
	}
	if _, err := store.Create(ctx, b.ID, fluo.NewPost{Content: content, Visibility: "public"}, "hello", []fluo.Media{attachment}); !errors.Is(err, fluo.ErrMediaOwner) {
		t.Fatalf("another owner's media was accepted: %v", err)
	}
	referenced, err := store.MediaReferenced(ctx, attachment.ID)
	if err != nil || !referenced {
		t.Fatalf("media reference = %t, %v", referenced, err)
	}
	removedMedia, err := store.Delete(ctx, a.ID, withMedia.ID)
	if err != nil || len(removedMedia) != 0 {
		t.Fatalf("deleted media IDs = %v, %v", removedMedia, err)
	}
	withoutOriginal, err := store.Get(ctx, b.ID, mediaQuote.ID)
	if err != nil || withoutOriginal.QuoteID != nil || withoutOriginal.Quote != nil {
		t.Fatalf("deleted quoted post retained its preview: %+v, %v", withoutOriginal, err)
	}
	referenced, err = store.MediaReferenced(ctx, attachment.ID)
	if err != nil || !referenced {
		t.Fatalf("media with a remaining post reference = %t, %v", referenced, err)
	}
	removedMedia, err = store.Delete(ctx, a.ID, reusedMedia.ID)
	if err != nil || len(removedMedia) != 1 || removedMedia[0] != attachment.ID {
		t.Fatalf("deleted reused media IDs = %v, %v", removedMedia, err)
	}
	referenced, err = store.MediaReferenced(ctx, attachment.ID)
	if err != nil || referenced {
		t.Fatalf("deleted media reference = %t, %v", referenced, err)
	}
	if _, err := store.Create(ctx, a.ID, fluo.NewPost{Content: content, Visibility: "public"}, "hello", []fluo.Media{attachment}); !errors.Is(err, fluo.ErrMediaOwner) {
		t.Fatalf("retired media was reused after its last reference was deleted: %v", err)
	}
	var retired bool
	claims := table.NodoUploadClaims
	if err := jetQueryRow(ctx, pool, claims.SELECT(claims.RetiredAt.IS_NOT_NULL()).
		WHERE(claims.UploadID.EQ(jetUUID(attachment.ID)))).Scan(&retired); err != nil || !retired {
		t.Fatalf("unreferenced media claim was not retired: %t, %v", retired, err)
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
	literal, err := store.Create(ctx, a.ID, fluo.NewPost{Content: content, Visibility: "public"}, `literal %_\ marker`, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"%", "_", `\`} {
		matches, err := store.List(ctx, fluo.ListOptions{ViewerID: b.ID, Feed: "latest", Search: query, Limit: 20})
		if err != nil || len(matches.Items) != 1 || matches.Items[0].ID != literal.ID {
			t.Fatalf("literal search for %q = %+v, %v", query, matches, err)
		}
	}
	// The final delete and a new reference can commit in either order. Both
	// outcomes must be safe: a successful creation retains the bytes, while a
	// retired claim rejects creation before Nodo can purge them.
	concurrentMedia := fluo.Media{ID: "01999111-2222-7333-8444-555555555553", Kind: "image", MimeType: "image/png", Width: 8, Height: 6, Size: 80}
	first := makePost(a.ID, "public", nil, nil, []fluo.Media{concurrentMedia})
	start := make(chan struct{})
	deleted := make(chan error, 1)
	type createResult struct {
		post fluo.Post
		err  error
	}
	created := make(chan createResult, 1)
	go func() {
		<-start
		_, err := store.Delete(ctx, a.ID, first.ID)
		deleted <- err
	}()
	go func() {
		<-start
		post, err := store.Create(ctx, a.ID, fluo.NewPost{Content: content, Visibility: "public"}, "hello", []fluo.Media{concurrentMedia})
		created <- createResult{post, err}
	}()
	close(start)
	if err := <-deleted; err != nil {
		t.Fatalf("concurrent delete failed: %v", err)
	}
	result := <-created
	referenced, err = store.MediaReferenced(ctx, concurrentMedia.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result.err == nil {
		if !referenced || len(result.post.Media) != 1 {
			t.Fatalf("committed concurrent post lost its media: %+v, referenced=%t", result.post, referenced)
		}
	} else if !errors.Is(result.err, fluo.ErrMediaOwner) || referenced {
		t.Fatalf("unsafe concurrent media outcome: create=%v, referenced=%t", result.err, referenced)
	}
}
