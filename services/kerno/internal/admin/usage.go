package admin

// Describes who and what uses the application's storage, for finding abuse and runaway growth

// AppBytes splits a user's stored bytes by the application that holds them.
type AppBytes struct {
	Posts    int64 `json:"posts"`
	Messages int64 `json:"messages"`
	Channels int64 `json:"channels"`
	Profile  int64 `json:"profile"`
	Journal  int64 `json:"journal"`
	Learning int64 `json:"learning"`
}

// UserData is one account's share of storage. Content is encrypted on devices, so the server
// knows sizes and the application, never what a file shows.
type UserData struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	// Media is uploaded files referenced by the user's content
	Media AppBytes `json:"media"`
	// Records is the user's encrypted rows in the database
	Records   AppBytes `json:"records"`
	Total     int64    `json:"total"`
	AddedWeek int64    `json:"addedWeek"`
}

type DatabaseSize struct {
	Name  string `json:"name"`
	Bytes int64  `json:"bytes"`
}

// TableSize includes dead rows, which pile up when updates outrun cleanup.
type TableSize struct {
	Name     string `json:"name"`
	Bytes    int64  `json:"bytes"`
	Rows     int64  `json:"rows"`
	DeadRows int64  `json:"deadRows"`
}

type DataUsage struct {
	Users     []UserData     `json:"users"`
	Databases []DatabaseSize `json:"databases"`
	Tables    []TableSize    `json:"tables"`
	// ReferencedMedia is what content still points at; the rest of the media directory awaits cleanup
	ReferencedMedia   int64 `json:"referencedMedia"`
	ReferencedUploads int64 `json:"referencedUploads"`
}
