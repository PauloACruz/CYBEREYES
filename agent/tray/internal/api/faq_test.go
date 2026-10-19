package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFaqListGetFeedbackAndSuggest(t *testing.T) {
	var feedback map[string]bool
	var suggestion map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/tray/faq":
			if r.URL.Query().Get("search") != "impressora" || r.URL.Query().Get("category") != "Impressoras" {
				t.Errorf("query inesperada: %s", r.URL.RawQuery)
			}
			_, _ = io.WriteString(w, `{"categories":["Impressoras"],"entries":[{"id":7,"question":"A impressora nao imprime","category":"Impressoras","excerpt":"1. Desligue"}]}`)
		case r.Method == http.MethodGet && r.URL.Path == "/api/tray/faq/7":
			_, _ = io.WriteString(w, `{"id":7,"question":"A impressora nao imprime","answer":"1. Desligue\n2. Ligue","category":null,"updatedAt":"2026-10-19T10:00:00Z"}`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/tray/faq/7/feedback":
			_ = json.NewDecoder(r.Body).Decode(&feedback)
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && r.URL.Path == "/api/tray/faq/suggestions":
			_ = json.NewDecoder(r.Body).Decode(&suggestion)
			if suggestion["question"] == "limite" {
				w.Header().Set("Content-Type", "application/problem+json")
				w.WriteHeader(http.StatusTooManyRequests)
				_, _ = io.WriteString(w, `{"title":"Muitas perguntas","status":429,"code":"RATE_LIMITED"}`)
				return
			}
			w.WriteHeader(http.StatusCreated)
			_, _ = io.WriteString(w, `{"id":12}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := &Client{Tokens: &fakeTokens{url: srv.URL, tokens: []string{"a"}}, HTTP: srv.Client()}
	ctx := context.Background()

	list, err := c.ListFaq(ctx, "impressora", "Impressoras")
	if err != nil || len(list.Entries) != 1 || list.Entries[0].ID != 7 || *list.Entries[0].Category != "Impressoras" || list.Categories[0] != "Impressoras" {
		t.Fatalf("lista: %+v %v", list, err)
	}
	entry, err := c.GetFaq(ctx, 7)
	if err != nil || entry.Answer != "1. Desligue\n2. Ligue" || entry.Category != nil {
		t.Fatalf("entrada: %+v %v", entry, err)
	}
	if err := c.FaqFeedback(ctx, 7, true); err != nil || !feedback["helpful"] {
		t.Fatalf("avaliacao: %v %v", feedback, err)
	}
	if err := c.SuggestFaq(ctx, "Como trocar o papel de parede?"); err != nil || suggestion["question"] != "Como trocar o papel de parede?" {
		t.Fatalf("sugestao: %v %v", suggestion, err)
	}
	var apiErr *Error
	if err := c.SuggestFaq(ctx, "limite"); !errors.As(err, &apiErr) || apiErr.Status != http.StatusTooManyRequests {
		t.Fatalf("esperava 429, veio %v", err)
	}
}
