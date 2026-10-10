// Package rondovoice issues LiveKit access tokens for Rondo voice channels.
package rondovoice

// Creates LiveKit join tokens and removes room participants
import (
	"context"
	"errors"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/twitchtv/twirp"
)

const joinTokenLifetime = 2 * time.Minute

type LiveKit struct {
	key    string
	secret string
	rooms  *lksdk.RoomServiceClient
}

func New(url, key, secret string) *LiveKit {
	return &LiveKit{key: key, secret: secret, rooms: lksdk.NewRoomServiceClient(url, key, secret)}
}

func RoomName(channelID string) string { return "rondo-" + channelID }

func (service *LiveKit) JoinToken(channelID, userID, displayName string) (string, error) {
	return auth.NewAccessToken(service.key, service.secret).
		SetVideoGrant(joinGrant(channelID)).SetIdentity(userID).SetName(displayName).
		SetValidFor(joinTokenLifetime).ToJWT()
}

func joinGrant(channelID string) *auth.VideoGrant {
	grant := &auth.VideoGrant{RoomJoin: true, Room: RoomName(channelID)}
	grant.SetCanPublish(true)
	grant.SetCanPublishSources([]livekit.TrackSource{
		livekit.TrackSource_MICROPHONE,
		livekit.TrackSource_CAMERA,
		livekit.TrackSource_SCREEN_SHARE,
		livekit.TrackSource_SCREEN_SHARE_AUDIO,
	})
	grant.SetCanSubscribe(true)
	grant.SetCanPublishData(false)
	return grant
}

func (service *LiveKit) Remove(ctx context.Context, channelID, userID string) error {
	_, err := service.rooms.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room: RoomName(channelID), Identity: userID,
	})
	if isParticipantNotFound(err) {
		return nil
	}
	return err
}

func isParticipantNotFound(err error) bool {
	var twirpErr twirp.Error
	return errors.As(err, &twirpErr) && twirpErr.Code() == twirp.NotFound
}
