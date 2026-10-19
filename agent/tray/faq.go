package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/pauloacruz/cybereyes/agent/tray/internal/api"
)

const maxFaqQuestion = 300

func (s *TrayService) friendlyFaq(err error) error {
	var apiErr *api.Error
	if errors.As(err, &apiErr) {
		switch apiErr.Status {
		case http.StatusNotFound:
			log.Printf("erro: %v", err)
			return errors.New("Esta pergunta não está mais disponível.")
		case http.StatusTooManyRequests:
			log.Printf("erro: %v", err)
			return errors.New("Você já enviou várias perguntas agora há pouco. Tente de novo mais tarde.")
		}
	}
	return s.friendly(err)
}

// ListFaq pesquisa as perguntas frequentes publicadas para este computador.
func (s *TrayService) ListFaq(ctx context.Context, search, category string) (api.FaqList, error) {
	l, err := s.client.ListFaq(ctx, strings.TrimSpace(search), strings.TrimSpace(category))
	if err != nil {
		return api.FaqList{Categories: []string{}, Entries: []api.FaqItem{}}, s.friendlyFaq(err)
	}
	return l, nil
}

// GetFaq devolve a resposta completa de uma pergunta.
func (s *TrayService) GetFaq(ctx context.Context, id int) (api.FaqEntry, error) {
	e, err := s.client.GetFaq(ctx, id)
	if err != nil {
		return api.FaqEntry{}, s.friendlyFaq(err)
	}
	return e, nil
}

// FaqFeedback registra se a resposta resolveu.
func (s *TrayService) FaqFeedback(ctx context.Context, id int, helpful bool) error {
	return s.friendlyFaqOrNil(s.client.FaqFeedback(ctx, id, helpful))
}

// SuggestFaq envia uma pergunta que ainda nao tem resposta na ajuda.
func (s *TrayService) SuggestFaq(ctx context.Context, question string) error {
	question = strings.Join(strings.Fields(question), " ")
	if utf8.RuneCountInString(question) < 3 {
		return errors.New("Escreva a sua pergunta.")
	}
	if utf8.RuneCountInString(question) > maxFaqQuestion {
		return errors.New("A pergunta pode ter no máximo 300 caracteres.")
	}
	return s.friendlyFaqOrNil(s.client.SuggestFaq(ctx, question))
}

func (s *TrayService) friendlyFaqOrNil(err error) error {
	if err == nil {
		return nil
	}
	return s.friendlyFaq(err)
}
