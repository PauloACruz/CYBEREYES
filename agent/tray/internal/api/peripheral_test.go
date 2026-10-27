package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestPeripheralTestCalls(t *testing.T) {
	var open atomic.Bool
	var got json.RawMessage
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/tray/peripheral-test":
			if !open.Load() {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"testId":9,"section":"keyboard","technician":"Ana"}`)
		case r.Method == http.MethodPut && r.URL.Path == "/api/tray/peripheral-test/9":
			var body struct {
				State json.RawMessage `json:"state"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("corpo: %v", err)
			}
			got = body.State
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPost && r.URL.Path == "/api/tray/peripheral-test/9/end":
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodPut && r.URL.Path == "/api/tray/peripheral-test/8":
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"title":"O teste foi encerrado"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	c := &Client{Tokens: &fakeTokens{url: srv.URL, tokens: []string{"a"}}, HTTP: srv.Client()}
	ctx := context.Background()

	if test, err := c.PeripheralTestOpen(ctx); err != nil || test != nil {
		t.Fatalf("sem teste aberto: %+v %v", test, err)
	}
	open.Store(true)
	test, err := c.PeripheralTestOpen(ctx)
	if err != nil || test == nil || test.TestID != 9 || test.Section != "keyboard" || test.Technician != "Ana" {
		t.Fatalf("teste aberto: %+v %v", test, err)
	}
	if err := c.PeripheralTestState(ctx, 9, json.RawMessage(`{"section":"keyboard","keyboard":{"typed":"Maçã"}}`)); err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"section":"keyboard","keyboard":{"typed":"Maçã"}}` {
		t.Fatalf("estado enviado: %s", got)
	}
	if err := c.PeripheralTestEnd(ctx, 9); err != nil {
		t.Fatal(err)
	}
	if err := c.PeripheralTestState(ctx, 8, json.RawMessage(`{}`)); !IsStatus(err, http.StatusConflict) {
		t.Fatalf("teste encerrado deve dar 409: %v", err)
	}
}
