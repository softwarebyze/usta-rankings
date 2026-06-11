// Scan reads a JSON job from stdin and writes results to stdout.
// Used by the Node API via server/go-bridge.js (SCRAPER_ENGINE=go).
package main

import (
	"encoding/json"
	"os"

	"github.com/softwarebyze/usta-rankings/scraper-go/usta"
)

type jobIn struct {
	LastName string `json:"lastName"`
	Token    string `json:"token"`
	ListIDs  []int  `json:"listIds"`
	Workers  int    `json:"workers"`
	DelayMs  int    `json:"delayMs"`
}

type rowOut struct {
	Rank     int    `json:"rank"`
	Points   int    `json:"points"`
	RowP     int    `json:"rowP"`
	District string `json:"district"`
}

type resultOut struct {
	ListID int     `json:"listId"`
	Row    *rowOut `json:"row"`
}

func main() {
	var job jobIn
	if err := json.NewDecoder(os.Stdin).Decode(&job); err != nil {
		fatal(err)
	}
	if job.Workers < 1 {
		job.Workers = 8
	}
	if job.DelayMs < 0 {
		job.DelayMs = 150
	}

	jobs := make(chan int, len(job.ListIDs))
	for _, id := range job.ListIDs {
		jobs <- id
	}
	close(jobs)

	outCh := make(chan resultOut, len(job.ListIDs))
	errCh := make(chan error, job.Workers)

	for w := 0; w < job.Workers; w++ {
		go func() {
			s := usta.NewSession(job.DelayMs)
			if err := s.Init(); err != nil {
				errCh <- err
				return
			}
			for listID := range jobs {
				row, _, err := usta.FindPlayerInList(s, listID, job.LastName, job.Token)
				if err != nil {
					errCh <- err
					return
				}
				var ro *rowOut
				if row != nil {
					ro = &rowOut{Rank: row.Rank, Points: row.Points, RowP: row.RowP, District: row.District}
				}
				outCh <- resultOut{ListID: listID, Row: ro}
			}
			errCh <- nil
		}()
	}

	results := make([]resultOut, 0, len(job.ListIDs))
	for range job.ListIDs {
		results = append(results, <-outCh)
	}
	for w := 0; w < job.Workers; w++ {
		if err := <-errCh; err != nil {
			fatal(err)
		}
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"results": results})
}

func fatal(err error) {
	os.Stderr.WriteString(err.Error() + "\n")
	os.Exit(1)
}
