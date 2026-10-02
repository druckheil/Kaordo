package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/druckheil/Kaordo/services/kerno/internal/ligo"
	"github.com/druckheil/Kaordo/services/kerno/internal/rondo"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Rondo struct{ pool *pgxpool.Pool }

func NewRondo(pool *pgxpool.Pool) *Rondo { return &Rondo{pool: pool} }

const rondoServerSelect = `SELECT s.id::text, s.name, s.description, s.access, s.owner_id::text,
	(SELECT count(*)::int FROM rondo_members m WHERE m.server_id = s.id),
	EXISTS(SELECT 1 FROM rondo_members mine WHERE mine.server_id = s.id AND mine.user_id = $1::uuid),
	s.created_at FROM rondo_servers s`

func scanRondoServer(row pgx.Row) (rondo.Server, error) {
	var item rondo.Server
	err := row.Scan(&item.ID, &item.Name, &item.Description, &item.Access, &item.OwnerID,
		&item.MemberCount, &item.Joined, &item.CreatedAt)
	return item, err
}

func scanRondoServers(rows pgx.Rows) ([]rondo.Server, error) {
	items := make([]rondo.Server, 0)
	for rows.Next() {
		item, err := scanRondoServer(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (store *Rondo) List(ctx context.Context, actorID, search string) ([]rondo.Server, error) {
	literal := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	rows, err := store.pool.Query(ctx, rondoServerSelect+`
		WHERE EXISTS(SELECT 1 FROM rondo_members m WHERE m.server_id = s.id AND m.user_id = $1::uuid)
		AND ($2 = '' OR lower(s.name) LIKE '%' || lower($2) || '%' ESCAPE '\')
		ORDER BY s.created_at DESC, s.id DESC LIMIT 100`, actorID, literal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRondoServers(rows)
}

func (store *Rondo) Discover(ctx context.Context, actorID, search string) ([]rondo.Server, error) {
	literal := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	rows, err := store.pool.Query(ctx, rondoServerSelect+`
		WHERE s.access = 'public'
		AND NOT EXISTS(SELECT 1 FROM rondo_members m WHERE m.server_id = s.id AND m.user_id = $1::uuid)
		AND ($2 = '' OR lower(s.name) LIKE '%' || lower($2) || '%' ESCAPE '\')
		ORDER BY s.created_at DESC, s.id DESC LIMIT 50`, actorID, literal)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanRondoServers(rows)
}

func (store *Rondo) Get(ctx context.Context, actorID, serverID string) (rondo.Detail, error) {
	server, err := scanRondoServer(store.pool.QueryRow(ctx, rondoServerSelect+`
		WHERE s.id = $2::uuid AND EXISTS(SELECT 1 FROM rondo_members m
		WHERE m.server_id = s.id AND m.user_id = $1::uuid)`, actorID, serverID))
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Detail{}, err
	}
	detail := rondo.Detail{Server: server, Channels: make([]rondo.Channel, 0), Members: make([]ligo.User, 0)}
	rows, err := store.pool.Query(ctx, `SELECT id::text, server_id::text, conversation_id::text,
		name, position, created_at FROM rondo_channels WHERE server_id = $1::uuid ORDER BY position`, serverID)
	if err != nil {
		return rondo.Detail{}, err
	}
	for rows.Next() {
		var channel rondo.Channel
		if err := rows.Scan(&channel.ID, &channel.ServerID, &channel.ConversationID,
			&channel.Name, &channel.Position, &channel.CreatedAt); err != nil {
			rows.Close()
			return rondo.Detail{}, err
		}
		detail.Channels = append(detail.Channels, channel)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return rondo.Detail{}, err
	}
	rows.Close()
	rows, err = store.pool.Query(ctx, `SELECT u.id::text, u.username, u.display_name FROM rondo_members m
		JOIN users u ON u.id = m.user_id WHERE m.server_id = $1::uuid
		ORDER BY m.joined_at, u.id LIMIT 100`, serverID)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var member ligo.User
		if err := rows.Scan(&member.ID, &member.Username, &member.DisplayName); err != nil {
			return rondo.Detail{}, err
		}
		detail.Members = append(detail.Members, member)
	}
	return detail, rows.Err()
}

func insertRondoChannel(ctx context.Context, tx pgx.Tx, serverID, ownerID, name string) (rondo.Channel, error) {
	var channel rondo.Channel
	var conversationID string
	err := tx.QueryRow(ctx, `INSERT INTO ligo_conversations (kind, title, created_by)
		VALUES ('channel', $1, $2::uuid) RETURNING id::text`, name, ownerID).Scan(&conversationID)
	if err != nil {
		return channel, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO rondo_channels (server_id, conversation_id, name, position)
		VALUES ($1::uuid, $2::uuid, $3,
			(SELECT count(*)::int FROM rondo_channels WHERE server_id = $1::uuid))
		RETURNING id::text, server_id::text, conversation_id::text, name, position, created_at`,
		serverID, conversationID, name).Scan(&channel.ID, &channel.ServerID, &channel.ConversationID,
		&channel.Name, &channel.Position, &channel.CreatedAt)
	if err != nil {
		return channel, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO ligo_members (conversation_id, user_id, joined_at)
		SELECT $1::uuid, user_id, clock_timestamp() FROM rondo_members WHERE server_id = $2::uuid`, conversationID, serverID)
	return channel, err
}

func (store *Rondo) Create(ctx context.Context, actorID string, input rondo.NewServer) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)
	var locked string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1::uuid FOR UPDATE`, actorID).Scan(&locked); err != nil {
		return rondo.Detail{}, err
	}
	var owned int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM rondo_servers WHERE owner_id = $1::uuid`, actorID).Scan(&owned); err != nil {
		return rondo.Detail{}, err
	}
	if owned >= 20 {
		return rondo.Detail{}, rondo.ErrLimit
	}
	if err := checkRondoUserLimit(ctx, tx, actorID); err != nil {
		return rondo.Detail{}, err
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO rondo_servers (name, description, access, owner_id)
		VALUES ($1, $2, $3, $4::uuid) RETURNING id::text`, input.Name, input.Description, input.Access, actorID).Scan(&id)
	if err != nil {
		return rondo.Detail{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO rondo_members (server_id, user_id)
		VALUES ($1::uuid, $2::uuid)`, id, actorID); err != nil {
		return rondo.Detail{}, err
	}
	if _, err = insertRondoChannel(ctx, tx, id, actorID, "general"); err != nil {
		return rondo.Detail{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, id)
}

func (store *Rondo) Join(ctx context.Context, actorID, serverID string) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)
	var access string
	err = tx.QueryRow(ctx, `SELECT access FROM rondo_servers WHERE id = $1::uuid FOR UPDATE`, serverID).Scan(&access)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Detail{}, err
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rondo_members
		WHERE server_id = $1::uuid AND user_id = $2::uuid)`, serverID, actorID).Scan(&exists); err != nil {
		return rondo.Detail{}, err
	}
	if !exists {
		if access != "public" {
			return rondo.Detail{}, rondo.ErrForbidden
		}
		if err := checkRondoMemberLimit(ctx, tx, serverID); err != nil {
			return rondo.Detail{}, err
		}
		if err := checkRondoUserLimit(ctx, tx, actorID); err != nil {
			return rondo.Detail{}, err
		}
		if err = addRondoMember(ctx, tx, serverID, actorID); err != nil {
			return rondo.Detail{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
}

func checkRondoMemberLimit(ctx context.Context, tx pgx.Tx, serverID string) error {
	var total int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM rondo_members WHERE server_id = $1::uuid`, serverID).Scan(&total); err != nil {
		return err
	}
	if total >= 500 {
		return rondo.ErrLimit
	}
	return nil
}

func checkRondoUserLimit(ctx context.Context, tx pgx.Tx, userID string) error {
	var locked string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id = $1::uuid FOR UPDATE`, userID).Scan(&locked); err != nil {
		return err
	}
	var total int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM rondo_members WHERE user_id = $1::uuid`, userID).Scan(&total); err != nil {
		return err
	}
	if total >= 100 {
		return rondo.ErrLimit
	}
	return nil
}

// Ligo sends lock the conversation before checking membership. Take the same
// locks while changing server membership so message timestamps and join times
// have one consistent order, even when a send runs concurrently.
func lockRondoConversations(ctx context.Context, tx pgx.Tx, serverID string) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT channel.id::text FROM rondo_channels channel
		JOIN ligo_conversations conversation ON conversation.id = channel.conversation_id
		WHERE channel.server_id = $1::uuid ORDER BY conversation.id FOR UPDATE OF conversation`, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	channels := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		channels = append(channels, id)
	}
	return channels, rows.Err()
}

func addRondoMember(ctx context.Context, tx pgx.Tx, serverID, userID string) error {
	_, err := tx.Exec(ctx, `INSERT INTO rondo_members (server_id, user_id)
		VALUES ($1::uuid, $2::uuid)`, serverID, userID)
	if err != nil {
		return err
	}
	if _, err = lockRondoConversations(ctx, tx, serverID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO ligo_members (conversation_id, user_id, joined_at)
		SELECT conversation_id, $2::uuid, clock_timestamp() FROM rondo_channels c
		WHERE c.server_id = $1::uuid`, serverID, userID)
	return err
}

func (store *Rondo) Invite(ctx context.Context, actorID, serverID, userID string) (rondo.Detail, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Detail{}, err
	}
	defer tx.Rollback(ctx)
	var ownerID string
	err = tx.QueryRow(ctx, `SELECT owner_id::text FROM rondo_servers WHERE id = $1::uuid FOR UPDATE`, serverID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Detail{}, err
	}
	if ownerID != actorID {
		return rondo.Detail{}, rondo.ErrForbidden
	}
	var exists bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1::uuid)`, userID).Scan(&exists); err != nil {
		return rondo.Detail{}, err
	}
	if !exists {
		return rondo.Detail{}, rondo.ErrNotFound
	}
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rondo_members WHERE server_id = $1::uuid AND user_id = $2::uuid)`, serverID, userID).Scan(&exists); err != nil {
		return rondo.Detail{}, err
	}
	if !exists {
		if err := checkRondoMemberLimit(ctx, tx, serverID); err != nil {
			return rondo.Detail{}, err
		}
		if err := checkRondoUserLimit(ctx, tx, userID); err != nil {
			return rondo.Detail{}, err
		}
		if err = addRondoMember(ctx, tx, serverID, userID); err != nil {
			return rondo.Detail{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return rondo.Detail{}, err
	}
	return store.Get(ctx, actorID, serverID)
}

func (store *Rondo) Leave(ctx context.Context, actorID, serverID string) ([]string, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var ownerID string
	err = tx.QueryRow(ctx, `SELECT owner_id::text FROM rondo_servers WHERE id = $1::uuid FOR UPDATE`, serverID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, rondo.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if ownerID == actorID {
		return nil, rondo.ErrInvalid
	}
	var member bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM rondo_members WHERE server_id = $1::uuid AND user_id = $2::uuid)`, serverID, actorID).Scan(&member); err != nil {
		return nil, err
	}
	if !member {
		return nil, rondo.ErrNotFound
	}
	channels, err := lockRondoConversations(ctx, tx, serverID)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM ligo_members WHERE user_id = $2::uuid AND conversation_id IN
		(SELECT conversation_id FROM rondo_channels WHERE server_id = $1::uuid)`, serverID, actorID); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM rondo_members WHERE server_id = $1::uuid AND user_id = $2::uuid`, serverID, actorID); err != nil {
		return nil, err
	}
	return channels, tx.Commit(ctx)
}

func (store *Rondo) CreateChannel(ctx context.Context, actorID, serverID, name string) (rondo.Channel, error) {
	tx, err := store.pool.Begin(ctx)
	if err != nil {
		return rondo.Channel{}, err
	}
	defer tx.Rollback(ctx)
	var ownerID string
	err = tx.QueryRow(ctx, `SELECT owner_id::text FROM rondo_servers WHERE id = $1::uuid FOR UPDATE`, serverID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Channel{}, rondo.ErrNotFound
	}
	if err != nil {
		return rondo.Channel{}, err
	}
	if ownerID != actorID {
		return rondo.Channel{}, rondo.ErrForbidden
	}
	var channels int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM rondo_channels WHERE server_id = $1::uuid`, serverID).Scan(&channels); err != nil {
		return rondo.Channel{}, err
	}
	if channels >= 100 {
		return rondo.Channel{}, rondo.ErrLimit
	}
	channel, err := insertRondoChannel(ctx, tx, serverID, actorID, name)
	if isRondoUnique(err) {
		return rondo.Channel{}, rondo.ErrConflict
	}
	if err != nil {
		return rondo.Channel{}, err
	}
	return channel, tx.Commit(ctx)
}

func isRondoUnique(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (store *Rondo) VoiceChannel(ctx context.Context, actorID, channelID string) (rondo.Channel, error) {
	var channel rondo.Channel
	err := store.pool.QueryRow(ctx, `SELECT c.id::text, c.server_id::text, c.conversation_id::text,
		c.name, c.position, c.created_at FROM rondo_channels c
		JOIN rondo_members m ON m.server_id = c.server_id AND m.user_id = $1::uuid
		WHERE c.id = $2::uuid`, actorID, channelID).Scan(&channel.ID, &channel.ServerID,
		&channel.ConversationID, &channel.Name, &channel.Position, &channel.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return rondo.Channel{}, rondo.ErrNotFound
	}
	return channel, err
}
