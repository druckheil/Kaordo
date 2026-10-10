package api

// Builds integrity operations for the scheduler and for checks an operator starts
import (
	"context"
	"errors"
	"slices"
	"strings"

	"github.com/druckheil/Kaordo/services/regado-agent/internal/host"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/integrity"
	"github.com/druckheil/Kaordo/services/regado-agent/internal/operation"
)

var (
	ErrUnknownCheck = errors.New("unknown integrity check")
	ErrCheckRunning = errors.New("another integrity check is still running")
)

// CheckRequest starts an integrity check outside its schedule.
type CheckRequest struct {
	Kind        string `json:"kind"`
	Reason      string `json:"reason"`
	RequestedBy string `json:"requestedBy"`
}

// IntegrityRequest builds the operation for a check kind.
func (service *Service) IntegrityRequest(ctx context.Context, kind, requestedBy, reason string) (operation.Request, error) {
	request := operation.Request{Kind: kind, Reason: reason, RequestedBy: requestedBy, Cancellable: true}
	switch kind {
	case integrity.KindScrub:
		// Scrub competes with pool changes for the same disks, so it queues with them
		request.Target, request.Exclusive = service.Host.PoolMount, true
		request.Stages, request.Run = []string{"Verify every copy"}, service.Integrity.Scrub
		return request, nil
	case integrity.KindSMARTShort, integrity.KindSMARTLong:
		devices, err := service.selfTestDevices(ctx)
		if err != nil {
			return operation.Request{}, err
		}
		test := strings.TrimPrefix(kind, "integrity.smart-")
		for _, device := range devices {
			request.Stages = append(request.Stages, "Run the "+test+" self-test on "+label(device))
		}
		request.Run = func(ctx context.Context, job *operation.Job) error {
			return service.Integrity.SelfTest(ctx, job, kind, devices)
		}
		return request, nil
	default:
		return operation.Request{}, ErrUnknownCheck
	}
}

// selfTestDevices are the pool and backup devices whose SMART is readable or not yet read
func (service *Service) selfTestDevices(ctx context.Context) ([]host.Device, error) {
	devices, _, err := service.facts(ctx)
	if err != nil {
		return nil, err
	}
	devices = slices.DeleteFunc(devices, func(device host.Device) bool {
		health := service.Health.Lookup(device.ID)
		managed := device.Class == host.ClassPool || device.Class == host.ClassBackup
		return !managed || health != nil && health.State == host.HealthUnavailable
	})
	if len(devices) == 0 {
		return nil, integrity.ErrNothingToCheck
	}
	return devices, nil
}

// StartCheck runs an integrity check now, unless another one is still running.
func (service *Service) StartCheck(ctx context.Context, check CheckRequest) (operation.Operation, error) {
	if check.RequestedBy == "" {
		return operation.Operation{}, ErrIncomplete
	}
	recent, err := service.Operations.List(50)
	if err != nil {
		return operation.Operation{}, err
	}
	if slices.ContainsFunc(recent, func(item operation.Operation) bool {
		return strings.HasPrefix(item.Kind, "integrity.") && !item.State.Finished()
	}) {
		return operation.Operation{}, ErrCheckRunning
	}
	request, err := service.IntegrityRequest(ctx, check.Kind, check.RequestedBy, check.Reason)
	if err != nil {
		return operation.Operation{}, err
	}
	return service.Operations.Start(request)
}

func label(device host.Device) string {
	if device.Serial != "" {
		return device.Serial
	}
	return device.ID
}
