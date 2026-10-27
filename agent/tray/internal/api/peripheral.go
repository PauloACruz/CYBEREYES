package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
)

// PeripheralTest e o teste de perifericos que o tecnico abriu no console para esta maquina.
type PeripheralTest struct {
	TestID     int64  `json:"testId"`
	Section    string `json:"section"`
	Technician string `json:"technician"`
}

// PeripheralTestOpen devolve o teste aberto para a maquina, ou nil se nao ha (204).
func (c *Client) PeripheralTestOpen(ctx context.Context) (*PeripheralTest, error) {
	data, _, err := c.raw(ctx, http.MethodGet, "/api/tray/peripheral-test", nil)
	if err != nil || len(data) == 0 {
		return nil, err
	}
	var t PeripheralTest
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, err
	}
	if t.TestID == 0 {
		return nil, nil
	}
	return &t, nil
}

// PeripheralTestState envia o estado da tela de teste, que o tecnico ve ao vivo no console.
func (c *Client) PeripheralTestState(ctx context.Context, testID int64, state json.RawMessage) error {
	payload, err := json.Marshal(map[string]json.RawMessage{"state": state})
	if err != nil {
		return err
	}
	return c.do(ctx, http.MethodPut, "/api/tray/peripheral-test/"+strconv.FormatInt(testID, 10),
		&requestBody{contentType: "application/json", data: payload}, nil)
}

// PeripheralTestEnd encerra o teste pelo lado do usuario.
func (c *Client) PeripheralTestEnd(ctx context.Context, testID int64) error {
	return c.do(ctx, http.MethodPost, "/api/tray/peripheral-test/"+strconv.FormatInt(testID, 10)+"/end", nil, nil)
}
