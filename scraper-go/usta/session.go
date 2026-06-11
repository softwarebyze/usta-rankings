// Package usta drives the legacy USTA TennisLink site via plain HTTP postbacks
// (ASP.NET WebForms + MS AJAX UpdatePanels). Each Session owns cookies and
// form state; goroutines must not share a Session.
package usta

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	BaseURL   = "https://tennislink.usta.com/tournaments/rankings/rankinghome.aspx"
	UserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

var (
	inputRe  = regexp.MustCompile(`(?i)<input[^>]*name="([^"]+)"[^>]*>`)
	selectRe = regexp.MustCompile(`(?i)<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)</select>`)
	optionRe = regexp.MustCompile(`(?i)<option[^>]*value=['"]([^'"]*)['"][^>]*>([^<]*)`)
	deltaHdr = regexp.MustCompile(`^(\d+)\|([^|]*)\|([^|]*)\|`)
)

// Session emulates one browser tab on TennisLink.
type Session struct {
	client       *http.Client
	fields       map[string]string
	selects      map[string][][2]string
	ready        bool
	RequestCount int
	delay        time.Duration
}

func NewSession(delayMs int) *Session {
	jar, _ := cookiejar.New(nil)
	tr := http.DefaultTransport.(*http.Transport).Clone()
	tr.MaxIdleConns = 32
	tr.MaxIdleConnsPerHost = 16
	tr.IdleConnTimeout = 90 * time.Second
	return &Session{
		client: &http.Client{
			Jar:     jar,
			Timeout: 60 * time.Second,
			Transport: tr,
		},
		fields:  map[string]string{},
		selects: map[string][][2]string{},
		delay:   time.Duration(delayMs) * time.Millisecond,
	}
}

func decodeEntities(s string) string {
	r := strings.NewReplacer(
		"&quot;", `"`, "&#39;", "'", "&lt;", "<", "&gt;", ">",
		"&nbsp;", " ", "&amp;", "&",
	)
	return r.Replace(s)
}

func (s *Session) absorbHTML(doc string) {
	for _, m := range inputRe.FindAllStringSubmatch(doc, -1) {
		tag, name := m[0], decodeEntities(m[1])
		typ := strings.ToLower(submatch(tag, `(?i)type="([^"]*)"`))
		if typ == "" {
			typ = "text"
		}
		switch typ {
		case "submit", "button", "image":
			continue
		case "checkbox", "radio":
			if strings.Contains(strings.ToLower(tag), "checked") {
				s.fields[name] = decodeEntities(submatch(tag, `(?i)value="([^"]*)"`))
				if s.fields[name] == "" {
					s.fields[name] = "on"
				}
			}
		default:
			s.fields[name] = decodeEntities(submatch(tag, `(?i)value="([^"]*)"`))
		}
	}
	for _, m := range selectRe.FindAllStringSubmatch(doc, -1) {
		name := decodeEntities(m[1])
		body := m[2]
		var opts [][2]string
		for _, o := range optionRe.FindAllStringSubmatch(body, -1) {
			opts = append(opts, [2]string{decodeEntities(o[1]), strings.TrimSpace(decodeEntities(o[2]))})
		}
		s.selects[name] = opts
		sel := submatch(body, `(?i)<option[^>]*selected[^>]*value=['"]([^'"]*)['"]`)
		if sel == "" {
			sel = submatch(body, `(?i)<option[^>]*value=['"]([^'"]*)['"][^>]*selected`)
		}
		if sel != "" {
			s.fields[name] = decodeEntities(sel)
		} else if len(opts) > 0 {
			s.fields[name] = opts[0][0]
		}
	}
}

func submatch(s, pat string) string {
	re := regexp.MustCompile(pat)
	if m := re.FindStringSubmatch(s); len(m) > 1 {
		return m[1]
	}
	return ""
}

func (s *Session) absorbDelta(delta string) {
	i := 0
	for i < len(delta) {
		chunk := delta[i:]
		if len(chunk) > 4000 {
			chunk = chunk[:4000]
		}
		m := deltaHdr.FindStringSubmatch(chunk)
		if m == nil {
			break
		}
		ln, _ := strconv.Atoi(m[1])
		typ, id := m[2], m[3]
		start := i + len(m[0])
		end := start + ln
		if end > len(delta) {
			break
		}
		content := delta[start:end]
		switch typ {
		case "hiddenField":
			s.fields[id] = content
		case "updatePanel":
			s.absorbHTML(content)
		case "pageRedirect":
			panic(fmt.Sprintf("unexpected pageRedirect: %s", content))
		}
		i = end + 1
	}
}

func (s *Session) Init() error {
	req, _ := http.NewRequest(http.MethodGet, BaseURL, nil)
	req.Header.Set("User-Agent", UserAgent)
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	s.fields = map[string]string{}
	s.selects = map[string][][2]string{}
	s.absorbHTML(string(body))
	s.ready = true
	return nil
}

type PostOpts struct {
	EventTarget   string
	EventArgument string
	Extra         map[string]string
}

func (s *Session) Post(trigger string, opts PostOpts) (string, error) {
	if !s.ready {
		if err := s.Init(); err != nil {
			return "", err
		}
	}
	if s.delay > 0 {
		time.Sleep(s.delay)
	}
	f := make(map[string]string, len(s.fields)+8)
	for k, v := range s.fields {
		f[k] = v
	}
	f["ctl00$ScriptManager1"] = "ctl00$mainContent$UpdatePanel_RankingHome|" + trigger
	f["__EVENTTARGET"] = opts.EventTarget
	f["__EVENTARGUMENT"] = opts.EventArgument
	f["__ASYNCPOST"] = "true"
	for k, v := range opts.Extra {
		f[k] = v
	}
	form := url.Values{}
	for k, v := range f {
		form.Set(k, v)
	}
	req, _ := http.NewRequest(http.MethodPost, BaseURL, strings.NewReader(form.Encode()))
	req.Header.Set("User-Agent", UserAgent)
	req.Header.Set("X-MicrosoftAjax", "Delta=true")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
	req.Header.Set("Referer", BaseURL)
	res, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	textBytes, _ := io.ReadAll(res.Body)
	text := string(textBytes)
	s.RequestCount++
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fmt.Errorf("USTA postback failed: HTTP %d", res.StatusCode)
	}
	if strings.Contains(text, "|error|") {
		return "", fmt.Errorf("USTA postback returned server error")
	}
	s.absorbDelta(text)
	return text, nil
}
