package rondovoice

import (
	"context"
	"errors"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/twitchtv/twirp"
)

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
	return auth.NewAccessToken(service.key, service.secret).
		SetVideoGrant(grant).SetIdentity(userID).SetName(displayName).
		SetValidFor(2 * time.Minute).ToJWT()
}

func (service *LiveKit) Remove(ctx context.Context, channelID, userID string) error {
	_, err := service.rooms.RemoveParticipant(ctx, &livekit.RoomParticipantIdentity{
		Room: RoomName(channelID), Identity: userID,
	})
	var twirpErr twirp.Error
	if errors.As(err, &twirpErr) && twirpErr.Code() == twirp.NotFound {
		return nil
	}
	return err
}
