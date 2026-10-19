package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
)

// ListFaq pesquisa a ajuda do app: perguntas publicadas para o cliente desta maquina.
func (c *Client) ListFaq(ctx context.Context, search, category string) (FaqList, error) {
	q := url.Values{}
	if search != "" {
		q.Set("search", search)
	}
	if category != "" {
		q.Set("category", category)
	}
	path := "/api/tray/faq"
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	var l FaqList
	err := c.do(ctx, http.MethodGet, path, nil, &l)
	if l.Categories == nil {
		l.Categories = []string{}
	}
	if l.Entries == nil {
		l.Entries = []FaqItem{}
	}
	return l, err
}

// GetFaq devolve a resposta completa; a API conta a abertura.
func (c *Client) GetFaq(ctx context.Context, id int) (FaqEntry, error) {
	var e FaqEntry
	err := c.do(ctx, http.MethodGet, "/api/tray/faq/"+strconv.Itoa(id), nil, &e)
	return e, err
}

// FaqFeedback registra se a resposta resolveu o problema.
func (c *Client) FaqFeedback(ctx context.Context, id int, helpful bool) error {
	payload, err := json.Marshal(map[string]bool{"helpful": helpful})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, "/api/tray/faq/"+strconv.Itoa(id)+"/feedback", &requestBody{contentType: "application/json", data: payload}, nil)
}

// SuggestFaq envia uma pergunta para a equipe responder no FAQ. A API devolve 429 depois de varias perguntas na mesma hora.
func (c *Client) SuggestFaq(ctx context.Context, question string) error {
	payload, err := json.Marshal(map[string]string{"question": question})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPost, "/api/tray/faq/suggestions", &requestBody{contentType: "application/json", data: payload}, nil)
}
