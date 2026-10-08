package admin

// Defines fixed agent operation inputs independently of their transport

type ActionRequest struct {
	Target     string `json:"target,omitempty"`
	Identity   string `json:"identity,omitempty"`
	Filesystem string `json:"filesystem,omitempty"`
}

type LayoutRequest struct {
	Device       string `json:"device"`
	Identity     string `json:"identity"`
	Filesystem   string `json:"filesystem"`
	SystemBytes  int64  `json:"systemBytes"`
	StorageBytes int64  `json:"storageBytes"`
	Fingerprint  string `json:"fingerprint,omitempty"`
	Confirmation string `json:"confirmation,omitempty"`
}
