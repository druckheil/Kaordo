package rondovoice

// Checks SDK-signed join tokens and the minimal channel media grant without hand-written JWT logic
import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	"github.com/twitchtv/twirp"
)

func TestJoinTokenUsesScopedSDKGrantAndShortLifetime(t *testing.T) {
	service := New("http://127.0.0.1:7880", "synthetic-key", "synthetic-secret-for-tests-only")
	before := time.Now()
	raw, err := service.JoinToken("channel-id", "user-id", "Learner")
	if err != nil {
		t.Fatal(err)
	}
	verifier, err := auth.ParseAPIToken(raw)
	if err != nil {
		t.Fatal(err)
	}
	registered, claims, err := verifier.Verify("synthetic-secret-for-tests-only")
	if err != nil {
		t.Fatal(err)
	}
	if verifier.APIKey() != "synthetic-key" || claims.Identity != "user-id" || claims.Name != "Learner" || claims.Video == nil {
		t.Fatal("identity grant changed")
	}
	if !claims.Video.RoomJoin || claims.Video.Room != RoomName("channel-id") || claims.Video.RoomAdmin || claims.Video.RoomCreate || claims.Video.RoomList {
		t.Fatalf("unexpected room privileges: %+v", claims.Video)
	}
	if !claims.Video.GetCanPublish() || !claims.Video.GetCanSubscribe() || claims.Video.GetCanPublishData() {
		t.Fatal("unexpected media privileges")
	}
	if !reflect.DeepEqual(claims.Video.CanPublishSources, []string{"microphone", "camera", "screen_share", "screen_share_audio"}) {
		t.Fatalf("sources: %+v", claims.Video.CanPublishSources)
	}
	if registered.ExpiresAt == nil || registered.ExpiresAt.Before(before.Add(joinTokenLifetime-time.Second)) || registered.ExpiresAt.After(time.Now().Add(joinTokenLifetime)) {
		t.Fatal("join token outlives its two-minute bound")
	}
	if _, _, err := verifier.Verify("wrong-secret"); err == nil {
		t.Fatal("incorrect secret verified the join token")
	}
	if !reflect.DeepEqual(joinGrant("channel-id").GetCanPublishSources(), []livekit.TrackSource{livekit.TrackSource_MICROPHONE, livekit.TrackSource_CAMERA, livekit.TrackSource_SCREEN_SHARE, livekit.TrackSource_SCREEN_SHARE_AUDIO}) {
		t.Fatal("unsupported track source")
	}
}

func TestParticipantRemovalIgnoresOnlyVerifiedNotFound(t *testing.T) {
	missing := twirp.NotFoundError("participant is not in the room")
	if !isParticipantNotFound(missing) || !isParticipantNotFound(fmt.Errorf("wrapped: %w", missing)) {
		t.Fatal("idempotent removal rejected")
	}
	if isParticipantNotFound(nil) || isParticipantNotFound(twirp.NewError(twirp.Unavailable, "room service unavailable")) || isParticipantNotFound(fmt.Errorf("unverified not found")) {
		t.Fatal("room-service failure hidden as missing participant")
	}
}
