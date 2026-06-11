// Bench runs the standard list-scan benchmark and prints JSON to stdout.
package main

import (
	"encoding/json"
	"flag"
	"os"

	"github.com/softwarebyze/usta-rankings/scraper-go/usta"
)

type fixture struct {
	LastName string `json:"lastName"`
	Token    string `json:"token"`
	ListIDs  []int  `json:"listIds"`
}

func main() {
	fixPath := flag.String("fixture", "../bench/fixture.json", "benchmark fixture path")
	workers := flag.Int("workers", 8, "parallel sessions")
	delayMs := flag.Int("delay-ms", 150, "delay before each postback per session")
	flag.Parse()

	raw, err := os.ReadFile(*fixPath)
	if err != nil {
		fatal(err)
	}
	var f fixture
	if err := json.Unmarshal(raw, &f); err != nil {
		fatal(err)
	}

	res := usta.ScanLists(f.ListIDs, f.LastName, f.Token, *workers, *delayMs)
	out := map[string]any{
		"runtime":   "go",
		"hits":      res.Hits,
		"requests":  res.Requests,
		"elapsedMs": res.ElapsedMs,
		"workers":   res.Workers,
		"delayMs":   res.DelayMs,
		"lists":     res.ListCount,
		"listsPerSec": float64(res.ListCount) / (float64(res.ElapsedMs) / 1000),
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(out)
}

func fatal(err error) {
	os.Stderr.WriteString(err.Error() + "\n")
	os.Exit(1)
}
