package usta

import (
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

type PlayerRow struct {
	Rank     int
	ListID   int
	RowP     int
	Token    string
	Name     string
	City     string
	State    string
	Section  string
	District string
	Points   int
}

var playerRowRe = regexp.MustCompile(
	`lblRank">([^<]*)</span>[\s\S]{0,400}?Sender=PlayerRecords&(?:amp;)?id=(\d+)&(?:amp;)?p=(\d+)&(?:amp;)?PlayerID=([^&']*)&(?:amp;)?Type=viewranklist'\)">([^<]*)</a>[\s\S]{0,300}?lblCity">([^<]*)</span>[\s\S]{0,300}?lblState">([^<]*)</span>[\s\S]{0,300}?lblSection">([^<]*)</span>[\s\S]{0,300}?lblDistrict">([^<]*)</span>[\s\S]{0,300}?lblPoints">([^<]*)</span>`,
)

func parsePlayerRows(html string) []PlayerRow {
	var rows []PlayerRow
	for _, m := range playerRowRe.FindAllStringSubmatch(html, -1) {
		rank, _ := strconv.Atoi(strings.TrimSpace(m[1]))
		listID, _ := strconv.Atoi(m[2])
		rowP, _ := strconv.Atoi(m[3])
		tok, _ := url.QueryUnescape(decodeEntities(m[4]))
		pts, _ := strconv.Atoi(strings.ReplaceAll(strings.TrimSpace(m[10]), ",", ""))
		rows = append(rows, PlayerRow{
			Rank: rank, ListID: listID, RowP: rowP, Token: tok,
			Name:     strings.TrimSpace(decodeEntities(m[5])),
			City:     strings.TrimSpace(decodeEntities(m[6])),
			State:    strings.TrimSpace(decodeEntities(m[7])),
			Section:  strings.TrimSpace(decodeEntities(m[8])),
			District: strings.TrimSpace(decodeEntities(m[9])),
			Points:   pts,
		})
	}
	return rows
}

func matchRow(rows []PlayerRow, lastName, token string) *PlayerRow {
	ln := strings.ToLower(lastName)
	for i := range rows {
		r := &rows[i]
		if token != "" && r.Token == token {
			return r
		}
		if token == "" && strings.HasPrefix(strings.ToLower(r.Name), ln) {
			return r
		}
	}
	return nil
}

// FindPlayerInList opens a ranking list and locates the player row.
// requestsUsed is the number of HTTP postbacks made for this lookup.
func FindPlayerInList(s *Session, listID int, lastName, token string) (row *PlayerRow, requestsUsed int, err error) {
	before := s.RequestCount

	open, err := s.Post("ctl00_mainContent_UpdatePanel_RankingHome", PostOpts{
		EventTarget:   "ctl00_mainContent_UpdatePanel_RankingHome",
		EventArgument: "Sender=RankingList&type=searchresults&id=" + strconv.Itoa(listID),
	})
	if err != nil {
		return nil, s.RequestCount - before, err
	}
	if r := matchRow(parsePlayerRows(open), lastName, token); r != nil {
		return r, s.RequestCount - before, nil
	}

	byName, err := s.Post("ctl00$mainContent$optNameOrder", PostOpts{
		EventTarget: "ctl00$mainContent$optNameOrder",
		Extra:       map[string]string{"ctl00$mainContent$optOrder": "optNameOrder"},
	})
	if err != nil {
		return nil, s.RequestCount - before, err
	}
	if r := matchRow(parsePlayerRows(byName), lastName, token); r != nil {
		return r, s.RequestCount - before, nil
	}

	if lastName == "" {
		return nil, s.RequestCount - before, nil
	}
	letter := strings.ToUpper(string(lastName[0]))
	foundLetter := false
	for _, pair := range s.selects["ctl00$mainContent$cboOrderOption"] {
		if strings.ToUpper(pair[0]) == letter {
			foundLetter = true
			break
		}
	}
	if !foundLetter {
		return nil, s.RequestCount - before, nil
	}

	resp, err := s.Post("ctl00$mainContent$cboOrderOption", PostOpts{
		EventTarget: "ctl00$mainContent$cboOrderOption",
		Extra:       map[string]string{"ctl00$mainContent$cboOrderOption": letter},
	})
	if err != nil {
		return nil, s.RequestCount - before, err
	}
	if r := matchRow(parsePlayerRows(resp), lastName, token); r != nil {
		return r, s.RequestCount - before, nil
	}

	for page := 2; page <= 12; page++ {
		pagerRe := regexp.MustCompile(`__doPostBack\('(ctl00\$mainContent\$grdMain2)','(Page\$` + strconv.Itoa(page) + `)'\)`)
		pm := pagerRe.FindStringSubmatch(resp)
		if pm == nil {
			break
		}
		resp, err = s.Post(pm[1], PostOpts{EventTarget: pm[1], EventArgument: pm[2]})
		if err != nil {
			return nil, s.RequestCount - before, err
		}
		if r := matchRow(parsePlayerRows(resp), lastName, token); r != nil {
			return r, s.RequestCount - before, nil
		}
	}
	return nil, s.RequestCount - before, nil
}

// ScanResult is the outcome of a benchmark or batch scan.
type ScanResult struct {
	Hits       int
	Requests   int
	ElapsedMs  int64
	Workers    int
	DelayMs    int
	ListCount  int
}

// ScanLists checks listIDs using workerCount independent sessions in parallel.
func ScanLists(listIDs []int, lastName, token string, workers, delayMs int) ScanResult {
	if workers < 1 {
		workers = 1
	}
	start := time.Now()
	jobs := make(chan int, len(listIDs))
	for _, id := range listIDs {
		jobs <- id
	}
	close(jobs)

	var hits, requests int64
	errCh := make(chan error, workers)
	for w := 0; w < workers; w++ {
		go func() {
			s := NewSession(delayMs)
			if err := s.Init(); err != nil {
				errCh <- err
				return
			}
			for listID := range jobs {
				row, used, err := FindPlayerInList(s, listID, lastName, token)
				if err != nil {
					errCh <- err
					return
				}
				atomic.AddInt64(&requests, int64(used))
				if row != nil {
					atomic.AddInt64(&hits, 1)
				}
			}
			errCh <- nil
		}()
	}
	for w := 0; w < workers; w++ {
		if err := <-errCh; err != nil {
			return ScanResult{ElapsedMs: time.Since(start).Milliseconds(), Workers: workers, DelayMs: delayMs, ListCount: len(listIDs)}
		}
	}
	return ScanResult{
		Hits:      int(hits),
		Requests:  int(requests),
		ElapsedMs: time.Since(start).Milliseconds(),
		Workers:   workers,
		DelayMs:   delayMs,
		ListCount: len(listIDs),
	}
}
