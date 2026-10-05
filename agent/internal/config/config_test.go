package config

import "testing"

func TestNatsServerHasExplicitPort(t *testing.T) {
	cases := map[string]string{
		"https://cyber.exemplo.com.br":      "wss://cyber.exemplo.com.br:443/natsws",
		"https://cyber.exemplo.com.br:8443": "wss://cyber.exemplo.com.br:8443/natsws",
		"http://10.0.0.5":                   "ws://10.0.0.5:80/natsws",
		"http://[::1]:5080":                 "ws://[::1]:5080/natsws",
	}
	for api, want := range cases {
		c := Config{API: api}
		if got := c.NatsServer(); got != want {
			t.Errorf("%s: esperado %s, veio %s", api, want, got)
		}
	}
	c := Config{API: "https://x", NatsURL: "nats://127.0.0.1:4222"}
	if got := c.NatsServer(); got != "nats://127.0.0.1:4222" {
		t.Errorf("nats_url deve prevalecer: %s", got)
	}
}
