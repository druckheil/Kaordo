module github.com/druckheil/Kaordo/services/nodo

go 1.27.1

replace github.com/druckheil/Kaordo/services/mediaauth => ../mediaauth

require (
	github.com/druckheil/Kaordo/services/mediaauth v0.0.0
	github.com/google/uuid v1.6.0
	github.com/tus/tusd/v2 v2.10.1
)

require (
	github.com/tus/lockfile v1.2.0 // indirect
	golang.org/x/exp v0.0.0-20260611194520-c48552f49976 // indirect
)
